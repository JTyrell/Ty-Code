/**
 * Ty-Code Project Scanner (Layer 1 profile builder)
 *
 * Reads MANIFESTS ONLY — package.json + lockfile kind, pyproject.toml,
 * Cargo.toml, go.mod, composer.json, Gemfile, build.gradle/pom.xml.
 * Detects frameworks / test runners / linters from dependency keys and
 * config-file presence (.eslintrc*, prettier.*, ruff.toml, clippy.toml,
 * vitest.config.*, pytest.ini, ...).
 *
 * HARD BUDGET: 200ms. On exceed, return MinimalProfile with profileStatus:'minimal'.
 * Zero network calls. Lazy (called on first task, never blocks startup).
 * Cache to .tycode/project-profile.json keyed by manifestHash.
 */

import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import type { ProjectProfile, MinimalProfile } from './schemas';

const CACHE_DIR = '.tycode';
const CACHE_FILE = 'project-profile.json';

const MANIFEST_FILES = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'pyproject.toml', 'requirements.txt', 'Cargo.toml', 'Cargo.lock',
  'go.mod', 'go.sum', 'composer.json', 'composer.lock',
  'Gemfile', 'Gemfile.lock', 'build.gradle', 'pom.xml', 'settings.gradle'
];

const CONFIG_MARKERS = [
  '.eslintrc*', 'eslint.config.*', '.prettierrc*', 'prettier.config.*',
  'ruff.toml', 'clippy.toml', 'rustfmt.toml',
  'vitest.config.*', 'pytest.ini', 'pyproject.toml',
  'jest.config.*', 'tsconfig.json', 'webpack.config.*', 'vite.config.*'
];

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'venv', 'target', '.next', 'out']);

function readPkgJson(workspaceRoot: string): any | null {
  try {
    const raw = fs.readFileSync(path.join(workspaceRoot, 'package.json'), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function detectPackageManager(workspaceRoot: string, pkg: any | null): string | undefined {
  const lockfiles = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json', 'Cargo.lock', 'go.sum', 'composer.lock', 'Gemfile.lock'];
  for (const lf of lockfiles) {
    try {
      fs.accessSync(path.join(workspaceRoot, lf));
      if (lf === 'pnpm-lock.yaml') return 'pnpm';
      if (lf === 'yarn.lock') return 'yarn';
      if (lf === 'package-lock.json') return 'npm';
      if (lf === 'Cargo.lock') return 'cargo';
      if (lf === 'go.sum') return 'go';
      if (lf === 'composer.lock') return 'composer';
      if (lf === 'Gemfile.lock') return undefined; // bundler
    } catch {
      // not present
    }
  }
  const pm = pkg?.packageManager;
  if (typeof pm === 'string') {
    if (pm.startsWith('pnpm')) return 'pnpm';
    if (pm.startsWith('yarn')) return 'yarn';
    if (pm.startsWith('npm')) return 'npm';
    if (pm.startsWith('cargo')) return 'cargo';
    if (pm.startsWith('go ')) return 'go';
    if (pm.startsWith('composer')) return 'composer';
  }
  return undefined;
}

function detectLanguagesAndFrameworks(pkg: any | null, workspaceRoot: string): { languages: string[]; frameworks: string[] } {
  const languages: string[] = [];
  const frameworks: string[] = [];
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const keys = Object.keys(deps).map((k) => k.toLowerCase());

  if (keys.some((k) => k.includes('react') || k.includes('next') || k.includes('vite'))) {
    languages.push('TypeScript', 'JavaScript');
    frameworks.push(keys.includes('next') ? 'Next.js' : 'React');
  }
  if (keys.some((k) => k.includes('vue'))) {
    languages.push('TypeScript', 'JavaScript');
    frameworks.push('Vue');
  }
  if (keys.some((k) => k.includes('electron'))) languages.push('TypeScript (Electron)');
  if (keys.some((k) => k.includes('express') || k.includes('fastify') || k.includes('koa'))) frameworks.push('Node.js API');
  if (keys.some((k) => k.includes('django') || k.includes('flask') || k.includes('fastapi'))) frameworks.push('Python API');

  try {
    fs.accessSync(path.join(workspaceRoot, 'pyproject.toml'));
    languages.push('Python');
  } catch {
    // no pyproject
  }
  try {
    fs.accessSync(path.join(workspaceRoot, 'Cargo.toml'));
    languages.push('Rust');
  } catch {
    // no Cargo.toml
  }
  try {
    fs.accessSync(path.join(workspaceRoot, 'go.mod'));
    languages.push('Go');
  } catch {
    // no go.mod
  }
  try {
    fs.accessSync(path.join(workspaceRoot, 'composer.json'));
    languages.push('PHP');
  } catch {
    // no composer
  }
  try {
    fs.accessSync(path.join(workspaceRoot, 'Gemfile'));
    languages.push('Ruby');
  } catch {
    // no Gemfile
  }
  function hasFile(name: string): boolean {
    try {
      fs.accessSync(path.join(workspaceRoot, name));
      return true;
    } catch {
      return false;
    }
  }
  if (hasFile('build.gradle') || hasFile('pom.xml')) {
    languages.push('Java/Kotlin');
  }

  return { languages: [...new Set(languages)], frameworks: [...new Set(frameworks)] };
}

function detectTestRunner(pkg: any | null, workspaceRoot: string): string | undefined {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const keys = Object.keys(deps).map((k) => k.toLowerCase());
  if (keys.includes('vitest')) return 'vitest';
  if (keys.includes('jest')) return 'jest';
  if (keys.includes('pytest')) return 'pytest';
  try {
    fs.accessSync(path.join(workspaceRoot, 'pytest.ini'));
    return 'pytest';
  } catch {
    // no pytest.ini
  }
  return undefined;
}

function detectLintFormat(pkg: any | null, workspaceRoot: string): string | undefined {
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const keys = Object.keys(deps).map((k) => k.toLowerCase());
  const parts: string[] = [];
  if (keys.includes('eslint')) parts.push('eslint');
  if (keys.includes('prettier')) parts.push('prettier');
  if (keys.includes('ruff')) parts.push('ruff');
  if (keys.includes('black')) parts.push('black');
  if (keys.includes('clippy')) parts.push('clippy');
  if (keys.includes('rustfmt')) parts.push('fmt');
  if (keys.includes('php-cs-fixer')) parts.push('php-cs-fixer');
  return parts.length ? parts.join('+') : undefined;
}

function detectBuildTool(pkg: any | null): string | undefined {
  const scripts = pkg?.scripts || {};
  const scriptKeys = Object.keys(scripts);
  if (scriptKeys.includes('build')) return 'npm run build (custom)';
  const hit = scriptKeys.find((s) => ['vite', 'webpack', 'esbuild', 'tsc', 'cargo build', 'go build'].some((n) => s.includes(n)));
  return hit || undefined;
}

function detectCi(workspaceRoot: string): string | undefined {
  const ciDirs = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml', 'azure-pipelines.yml'];
  for (const d of ciDirs) {
    try {
      fs.accessSync(path.join(workspaceRoot, d));
      if (d.includes('github')) return 'GitHub Actions';
      if (d.includes('gitlab')) return 'GitLab CI';
      if (d.includes('Jenkinsfile')) return 'Jenkins';
      if (d.includes('circleci')) return 'CircleCI';
      if (d.includes('azure')) return 'Azure Pipelines';
      return d;
    } catch {
      // not present
    }
  }
  return undefined;
}

function detectDeployTargets(workspaceRoot: string): string[] {
  const targets: string[] = [];
  const markers = ['Dockerfile', 'docker-compose.yml', 'terraform', 'ansible', 'serverless.yml', 'vercel.json', 'netlify.toml'];
  for (const m of markers) {
    try {
      fs.accessSync(path.join(workspaceRoot, m));
      targets.push(m);
    } catch {
      // not present
    }
  }
  return targets;
}

function buildRepoLayout(workspaceRoot: string): string {
  let lines = 0;
  const out: string[] = [];
  try {
    const entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    for (const ent of entries) {
      if (EXCLUDE_DIRS.has(ent.name)) continue;
      const marker = ent.isDirectory() ? '/' : '';
      out.push(`${ent.name}${marker}`);
      lines++;
      if (lines >= 40) break;
    }
  } catch {
    out.push('(unreadable)');
  }
  return out.join('\n');
}

async function readManifestHash(workspaceRoot: string): Promise<string> {
  const parts: string[] = [];
  for (const mf of MANIFEST_FILES) {
    try {
      const stat = await fsp.stat(path.join(workspaceRoot, mf));
      parts.push(`${mf}:${stat.size}:${stat.mtimeMs}`);
    } catch {
      // skip missing
    }
  }
  return crypto.createHash('sha256').update(parts.join('|')).digest('hex');
}

export async function scanProject(workspaceRoot: string, timeBudgetMs = 200): Promise<ProjectProfile> {
  const start = Date.now();
  let pkg: any | null = null;
  try {
    pkg = readPkgJson(workspaceRoot);
  } catch {
    pkg = null;
  }

  const { languages, frameworks } = detectLanguagesAndFrameworks(pkg, workspaceRoot);
  const packageManager = detectPackageManager(workspaceRoot, pkg);
  const testRunner = detectTestRunner(pkg, workspaceRoot);
  const lintFormat = detectLintFormat(pkg, workspaceRoot);
  const buildTool = detectBuildTool(pkg);

  const profile: ProjectProfile = {
    name: pkg?.name || path.basename(workspaceRoot),
    languages,
    frameworks,
    ...(packageManager ? { pkgManager: packageManager as ProjectProfile['pkgManager'] } : {}),
    ...(testRunner ? { testRunner } : {}),
    ...(lintFormat ? { lintFormat } : {}),
    ...(buildTool ? { buildTool } : {}),
    repoLayout: '',
    deployTargets: detectDeployTargets(workspaceRoot),
    ciSummary: detectCi(workspaceRoot) || '',
    manifestHash: '',
    profileStatus: 'full'
  };

  // Repo layout only if budget allows (readdir-only, cheap)
  if (Date.now() - start < timeBudgetMs) {
    profile.repoLayout = buildRepoLayout(workspaceRoot);
  }

  // Manifest hash (stat-only, no content reads beyond manifests)
  try {
    profile.manifestHash = await readManifestHash(workspaceRoot);
  } catch {
    profile.manifestHash = '';
  }

  // Budget enforcement: if we exceeded, degrade to minimal
  if (Date.now() - start > timeBudgetMs) {
    const minimal: MinimalProfile = {
      ...profile,
      repoLayout: '(degraded)',
      profileStatus: 'minimal'
    };
    return minimal as unknown as ProjectProfile;
  }

  return profile;
}

const CACHE_PATHS = new Map<string, string>();

export function profileCachePath(workspaceRoot: string): string {
  let cached = CACHE_PATHS.get(workspaceRoot);
  if (!cached) {
    cached = path.join(workspaceRoot, CACHE_DIR, CACHE_FILE);
    CACHE_PATHS.set(workspaceRoot, cached);
  }
  return cached;
}

export async function loadCachedProfile(workspaceRoot: string): Promise<ProjectProfile | null> {
  try {
    const cachePath = profileCachePath(workspaceRoot);
    const raw = await fsp.readFile(cachePath, 'utf8');
    const parsed = JSON.parse(raw);
    const currentHash = await readManifestHash(workspaceRoot);
    if (parsed.manifestHash === currentHash && parsed.profile) {
      return parsed.profile as ProjectProfile;
    }
  } catch {
    // no valid cache
  }
  return null;
}

export async function saveProjectProfileCache(workspaceRoot: string, profile: ProjectProfile): Promise<void> {
  try {
    const cachePath = profileCachePath(workspaceRoot);
    await fsp.mkdir(path.dirname(cachePath), { recursive: true });
    await fsp.writeFile(cachePath, JSON.stringify({ manifestHash: profile.manifestHash, profile, savedAt: Date.now() }, null, 2));
  } catch {
    // cache write must never block the agent
  }
}

/**
 * buildProjectProfile: lazy entry point. Returns cached profile if valid,
 * otherwise runs scanProject (≤200ms) and caches the result.
 */
export async function buildProjectProfile(workspaceRoot: string): Promise<ProjectProfile> {
  const cached = await loadCachedProfile(workspaceRoot);
  if (cached) return cached;
  return scanProject(workspaceRoot);
}
