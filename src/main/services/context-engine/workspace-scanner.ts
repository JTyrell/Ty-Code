/**
 * Ty-Code Context Engine: Workspace Intelligence Scanner & Stack Profiler
 *
 * Local-first scanner that analyzes the repository file system, detects the
 * tech stack, databases, architectural patterns, and calculates an AI-readiness
 * profile with config drift diagnostics based on the mechanics of Caliber.
 *
 * Strictly local, non-blocking asynchronous file system traversal.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkspaceProfile, WorkspaceProfileSchema } from './types';
import {
  collectFingerprint,
  DiscoveredFile,
  DiscoveredDirectory
} from './fingerprint';
import { evaluateReadiness } from './scoring';
import { getRecommendedMCPs, injectRecommendedMCPs } from './mcp-router';

const MAX_FILE_READ_BYTES = 512 * 1024; // 512 KB limit for manifest files

/**
 * Safely reads a small manifest or config file.
 */
async function safeReadFile(fullPath: string): Promise<string | null> {
  try {
    const stat = await fs.stat(fullPath);
    if (stat.size > MAX_FILE_READ_BYTES) return null;
    return await fs.readFile(fullPath, 'utf-8');
  } catch {
    return null;
  }
}

/**
 * Detects the primary programming language based on file extensions and project manifests.
 */
function detectPrimaryLanguage(
  files: DiscoveredFile[],
  extensionCounts: Record<string, number>
): string {
  const fileNames = new Set(files.map((f) => f.name.toLowerCase()));

  const hasTsFiles = (extensionCounts['.ts'] || 0) + (extensionCounts['.tsx'] || 0) > 0;
  const tsScore = (extensionCounts['.ts'] || 0) * 3 + (extensionCounts['.tsx'] || 0) * 3 + (fileNames.has('tsconfig.json') ? 10 : 0);
  const jsScore = (extensionCounts['.js'] || 0) * 2 + (extensionCounts['.jsx'] || 0) * 2 + (extensionCounts['.mjs'] || 0) * 2 + (fileNames.has('package.json') && !hasTsFiles ? 5 : 0);
  const pyScore = (extensionCounts['.py'] || 0) * 2 + (fileNames.has('requirements.txt') ? 8 : 0) + (fileNames.has('pyproject.toml') ? 8 : 0);
  const rustScore = (extensionCounts['.rs'] || 0) * 2 + (fileNames.has('cargo.toml') ? 10 : 0);
  const goScore = (extensionCounts['.go'] || 0) * 2 + (fileNames.has('go.mod') ? 10 : 0);
  const javaScore = (extensionCounts['.java'] || 0) * 2 + (fileNames.has('pom.xml') || fileNames.has('build.gradle') ? 8 : 0);
  const csharpScore = (extensionCounts['.cs'] || 0) * 2;
  const cppScore = (extensionCounts['.cpp'] || 0) * 2 + (extensionCounts['.c'] || 0) * 2 + (fileNames.has('cmakelists.txt') ? 8 : 0);
  const phpScore = (extensionCounts['.php'] || 0) * 2 + (fileNames.has('composer.json') ? 8 : 0);
  const rubyScore = (extensionCounts['.rb'] || 0) * 2 + (fileNames.has('gemfile') ? 8 : 0);
  const swiftScore = (extensionCounts['.swift'] || 0) * 2 + (fileNames.has('package.swift') ? 8 : 0);

  const scores: Array<{ lang: string; score: number }> = [
    { lang: 'TypeScript', score: tsScore },
    { lang: 'JavaScript', score: jsScore },
    { lang: 'Python', score: pyScore },
    { lang: 'Rust', score: rustScore },
    { lang: 'Go', score: goScore },
    { lang: 'Java', score: javaScore },
    { lang: 'C#', score: csharpScore },
    { lang: 'C/C++', score: cppScore },
    { lang: 'PHP', score: phpScore },
    { lang: 'Ruby', score: rubyScore },
    { lang: 'Swift', score: swiftScore }
  ];

  scores.sort((a, b) => b.score - a.score);
  return scores[0].score > 0 ? scores[0].lang : 'JavaScript';
}

/**
 * Scans manifests (package.json, requirements.txt, pyproject.toml, Cargo.toml, go.mod) for frameworks and scripts.
 */
async function detectFrameworks(
  rootPath: string,
  files: DiscoveredFile[]
): Promise<{
  frameworks: string[];
  hasTesting: boolean;
  isMonorepoWorkspace: boolean;
  manifestScripts: string[];
}> {
  const frameworks = new Set<string>();
  let hasTesting = false;
  let isMonorepoWorkspace = false;
  const manifestScripts: string[] = [];

  const fileMap = new Map(files.map((f) => [f.name.toLowerCase(), f]));

  // 1. Node / JS: package.json
  const packageJsonFile = fileMap.get('package.json');
  if (packageJsonFile) {
    const content = await safeReadFile(path.join(rootPath, packageJsonFile.relativePath));
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = {
          ...(pkg.dependencies || {}),
          ...(pkg.devDependencies || {}),
          ...(pkg.peerDependencies || {})
        };

        if (pkg.scripts && typeof pkg.scripts === 'object') {
          manifestScripts.push(...Object.keys(pkg.scripts));
        }

        if (pkg.workspaces || Array.isArray(pkg.workspaces?.packages)) {
          isMonorepoWorkspace = true;
        }

        // Frameworks & UI
        if (deps['next']) frameworks.add('Next.js');
        if (deps['react']) frameworks.add('React');
        if (deps['vue']) frameworks.add('Vue');
        if (deps['nuxt'] || deps['nuxt3']) frameworks.add('Nuxt');
        if (deps['@sveltejs/kit'] || deps['svelte']) frameworks.add('Svelte');
        if (deps['@angular/core']) frameworks.add('Angular');
        if (deps['tailwindcss']) frameworks.add('Tailwind CSS');
        if (deps['@trpc/server'] || deps['@trpc/client']) frameworks.add('tRPC');
        if (deps['vite']) frameworks.add('Vite');
        if (deps['express']) frameworks.add('Express');
        if (deps['@nestjs/core']) frameworks.add('NestJS');
        if (deps['fastify']) frameworks.add('Fastify');
        if (deps['@remix-run/react'] || deps['@remix-run/node']) frameworks.add('Remix');
        if (deps['electron']) frameworks.add('Electron');
        if (deps['astro']) frameworks.add('Astro');
        if (deps['hono']) frameworks.add('Hono');
        if (deps['zustand']) frameworks.add('Zustand');
        if (deps['redux'] || deps['@reduxjs/toolkit']) frameworks.add('Redux');

        // Testing frameworks
        if (
          deps['vitest'] ||
          deps['jest'] ||
          deps['mocha'] ||
          deps['playwright'] ||
          deps['@playwright/test'] ||
          deps['cypress']
        ) {
          hasTesting = true;
        }
      } catch {}
    }
  }

  // 2. Python: requirements.txt, pyproject.toml, Pipfile
  const reqFile = fileMap.get('requirements.txt');
  if (reqFile) {
    const content = await safeReadFile(path.join(rootPath, reqFile.relativePath));
    if (content) {
      const lower = content.toLowerCase();
      if (/django/i.test(lower)) frameworks.add('Django');
      if (/fastapi/i.test(lower)) frameworks.add('FastAPI');
      if (/flask/i.test(lower)) frameworks.add('Flask');
      if (/celery/i.test(lower)) frameworks.add('Celery');
      if (/pytorch|torch/i.test(lower)) frameworks.add('PyTorch');
      if (/tensorflow/i.test(lower)) frameworks.add('TensorFlow');
      if (/pandas/i.test(lower)) frameworks.add('Pandas');
      if (/pytest/i.test(lower)) hasTesting = true;
    }
  }

  const pyprojectFile = fileMap.get('pyproject.toml');
  if (pyprojectFile) {
    const content = await safeReadFile(path.join(rootPath, pyprojectFile.relativePath));
    if (content) {
      const lower = content.toLowerCase();
      if (/django/i.test(lower)) frameworks.add('Django');
      if (/fastapi/i.test(lower)) frameworks.add('FastAPI');
      if (/flask/i.test(lower)) frameworks.add('Flask');
      if (/celery/i.test(lower)) frameworks.add('Celery');
      if (/pytest/i.test(lower)) hasTesting = true;
    }
  }

  // 3. Rust: Cargo.toml
  const cargoFile = fileMap.get('cargo.toml');
  if (cargoFile) {
    const content = await safeReadFile(path.join(rootPath, cargoFile.relativePath));
    if (content) {
      const lower = content.toLowerCase();
      if (/actix-web/i.test(lower)) frameworks.add('Actix Web');
      if (/axum/i.test(lower)) frameworks.add('Axum');
      if (/tokio/i.test(lower)) frameworks.add('Tokio');
      if (/rocket/i.test(lower)) frameworks.add('Rocket');
      if (/tauri/i.test(lower)) frameworks.add('Tauri');
      if (/\[workspace\]/i.test(content)) isMonorepoWorkspace = true;
    }
  }

  // 4. Go: go.mod
  const goModFile = fileMap.get('go.mod');
  if (goModFile) {
    const content = await safeReadFile(path.join(rootPath, goModFile.relativePath));
    if (content) {
      const lower = content.toLowerCase();
      if (/github\.com\/gin-gonic\/gin/i.test(lower)) frameworks.add('Gin');
      if (/github\.com\/labstack\/echo/i.test(lower)) frameworks.add('Echo');
      if (/github\.com\/gofiber\/fiber/i.test(lower)) frameworks.add('Fiber');
      if (/gorm\.io\/gorm/i.test(lower)) frameworks.add('GORM');
    }
  }

  return { frameworks: Array.from(frameworks), hasTesting, isMonorepoWorkspace, manifestScripts };
}

/**
 * Detects databases and infrastructure from compose files, schemas, and .env.example.
 */
async function detectDatabases(
  rootPath: string,
  files: DiscoveredFile[]
): Promise<{ databases: string[]; hasDbSchema: boolean }> {
  const databases = new Set<string>();
  let hasDbSchema = false;

  const fileMap = new Map(files.map((f) => [f.name.toLowerCase(), f]));

  // 1. Prisma schema
  const prismaFile = files.find(
    (f) => f.name.toLowerCase() === 'schema.prisma' || f.relativePath.toLowerCase().endsWith('schema.prisma')
  );
  if (prismaFile) {
    hasDbSchema = true;
    const content = await safeReadFile(path.join(rootPath, prismaFile.relativePath));
    if (content) {
      const providerMatch = content.match(/provider\s*=\s*["']([^"']+)["']/i);
      if (providerMatch) {
        const provider = providerMatch[1].toLowerCase();
        if (provider.includes('postgres')) databases.add('PostgreSQL');
        else if (provider.includes('mysql')) databases.add('MySQL');
        else if (provider.includes('sqlite')) databases.add('SQLite');
        else if (provider.includes('mongo')) databases.add('MongoDB');
        else if (provider.includes('sqlserver')) databases.add('SQL Server');
        else if (provider.includes('cockroach')) databases.add('CockroachDB');
      }
    }
  }

  // 2. Drizzle config / migrations
  const drizzleConfig = files.find((f) => f.name.toLowerCase().startsWith('drizzle.config'));
  if (drizzleConfig) {
    hasDbSchema = true;
    const content = await safeReadFile(path.join(rootPath, drizzleConfig.relativePath));
    if (content) {
      const dialectMatch = content.match(/(?:dialect|driver)\s*:\s*["']([^"']+)["']/i);
      if (dialectMatch) {
        const dialect = dialectMatch[1].toLowerCase();
        if (dialect.includes('postgres') || dialect.includes('pg')) databases.add('PostgreSQL');
        else if (dialect.includes('mysql')) databases.add('MySQL');
        else if (dialect.includes('sqlite')) databases.add('SQLite');
      }
    }
  }

  // 3. Docker Compose files
  const composeFiles = files.filter((f) => {
    const n = f.name.toLowerCase();
    return n === 'docker-compose.yml' || n === 'docker-compose.yaml' || n === 'compose.yml' || n === 'compose.yaml';
  });

  for (const cFile of composeFiles) {
    const content = await safeReadFile(path.join(rootPath, cFile.relativePath));
    if (content) {
      const lower = content.toLowerCase();
      if (/image\s*:\s*.*postgres/i.test(lower)) databases.add('PostgreSQL');
      if (/image\s*:\s*.*(?:mysql|mariadb)/i.test(lower)) databases.add('MySQL');
      if (/image\s*:\s*.*(?:mongo|mongodb)/i.test(lower)) databases.add('MongoDB');
      if (/image\s*:\s*.*redis/i.test(lower)) databases.add('Redis');
      if (/image\s*:\s*.*elasticsearch/i.test(lower)) databases.add('Elasticsearch');
      if (/image\s*:\s*.*neo4j/i.test(lower)) databases.add('Neo4j');
      if (/image\s*:\s*.*cassandra/i.test(lower)) databases.add('Cassandra');
      if (/image\s*:\s*.*supabase/i.test(lower)) databases.add('Supabase');
    }
  }

  // 4. Scan environment template files (e.g. .env.example, .env.sample, .env.template)
  const envExampleFiles = files.filter((f) => {
    const n = f.name.toLowerCase();
    return n === '.env.example' || n === '.env.sample' || n === '.env.template' || n === '.env.local.example';
  });

  for (const envFile of envExampleFiles) {
    const content = await safeReadFile(path.join(rootPath, envFile.relativePath));
    if (content) {
      const lower = content.toLowerCase();
      if (/postgres(?:ql)?:\/\//i.test(lower) || /postgres_url/i.test(lower)) databases.add('PostgreSQL');
      if (/mysql:\/\//i.test(lower) || /mysql_url/i.test(lower)) databases.add('MySQL');
      if (/mongodb(?:\+srv)?:\/\//i.test(lower) || /mongo(?:db)?_uri/i.test(lower)) databases.add('MongoDB');
      if (/redis:\/\//i.test(lower) || /redis_url/i.test(lower)) databases.add('Redis');
      if (/supabase_url/i.test(lower)) databases.add('Supabase');
      if (/sqlite/i.test(lower)) databases.add('SQLite');
    }
  }

  // 5. Dependency hints from package.json
  const packageJsonFile = fileMap.get('package.json');
  if (packageJsonFile) {
    const content = await safeReadFile(path.join(rootPath, packageJsonFile.relativePath));
    if (content) {
      try {
        const pkg = JSON.parse(content);
        const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
        if (deps['pg'] || deps['postgres']) databases.add('PostgreSQL');
        if (deps['mysql'] || deps['mysql2']) databases.add('MySQL');
        if (deps['mongodb'] || deps['mongoose']) databases.add('MongoDB');
        if (deps['redis'] || deps['ioredis']) databases.add('Redis');
        if (deps['better-sqlite3'] || deps['sqlite3'] || deps['sqlite']) databases.add('SQLite');
        if (deps['@supabase/supabase-js']) databases.add('Supabase');
      } catch {}
    }
  }

  // Check if migrations directory exists
  if (files.some((f) => f.relativePath.toLowerCase().includes('migrations/'))) {
    hasDbSchema = true;
  }

  return { databases: Array.from(databases), hasDbSchema };
}

/**
 * Detects architectural patterns (Monorepo, Next.js App Router, MVC, Microservices, etc.).
 */
function detectArchitecture(
  directories: DiscoveredDirectory[],
  files: DiscoveredFile[],
  isMonorepoWorkspace: boolean
): string {
  const dirPaths = new Set(directories.map((d) => d.relativePath.toLowerCase()));
  const fileNames = new Set(files.map((f) => f.name.toLowerCase()));

  // 1. Monorepo detection
  if (
    isMonorepoWorkspace ||
    fileNames.has('pnpm-workspace.yaml') ||
    fileNames.has('turbo.json') ||
    fileNames.has('lerna.json') ||
    fileNames.has('nx.json')
  ) {
    return 'Monorepo';
  }

  // 2. Next.js App Router vs Pages Router
  const hasAppRouter = dirPaths.has('src/app') || dirPaths.has('app');
  const hasPagesRouter = dirPaths.has('src/pages') || dirPaths.has('pages');

  if (hasAppRouter && hasPagesRouter) {
    return 'Hybrid Next.js (App & Pages Router)';
  }
  if (hasAppRouter) {
    return 'Next.js App Router';
  }
  if (hasPagesRouter) {
    return 'Next.js Pages Router';
  }

  // 3. MVC / Layered Architecture
  const hasControllers = dirPaths.has('src/controllers') || dirPaths.has('controllers');
  const hasServices = dirPaths.has('src/services') || dirPaths.has('services');
  const hasModels = dirPaths.has('src/models') || dirPaths.has('models');

  if (hasControllers && (hasServices || hasModels)) {
    return 'MVC / Layered Architecture';
  }

  // 4. Microservices
  const dockerfiles = files.filter((f) => f.name.toLowerCase().startsWith('dockerfile'));
  if (dockerfiles.length > 2 || dirPaths.has('services')) {
    return 'Microservices';
  }

  // 5. Clean / Hexagonal Architecture
  const hasDomain = dirPaths.has('src/domain') || dirPaths.has('domain');
  const hasInfrastructure = dirPaths.has('src/infrastructure') || dirPaths.has('infrastructure');
  if (hasDomain && hasInfrastructure) {
    return 'Clean / Hexagonal Architecture';
  }

  // 6. Component-Driven Frontend SPA
  const hasComponents = dirPaths.has('src/components') || dirPaths.has('components');
  if (hasComponents) {
    return 'Component-Driven Architecture';
  }

  // 7. CLI / Library pattern
  if (dirPaths.has('bin') || fileNames.has('cargo.toml') || fileNames.has('setup.py')) {
    return 'CLI / Library Architecture';
  }

  return 'Modular Application';
}

/**
 * Maps standard key directories present in the workspace.
 */
function identifyKeyDirectories(directories: DiscoveredDirectory[]): Record<string, string> {
  const keyDirs: Record<string, string> = {};
  const paths = directories.map((d) => d.relativePath);

  const candidates: Array<{ key: string; matches: string[] }> = [
    { key: 'components', matches: ['src/components', 'components'] },
    { key: 'app', matches: ['src/app', 'app'] },
    { key: 'pages', matches: ['src/pages', 'pages'] },
    { key: 'api', matches: ['src/app/api', 'src/api', 'pages/api', 'api'] },
    { key: 'services', matches: ['src/services', 'services'] },
    { key: 'controllers', matches: ['src/controllers', 'controllers'] },
    { key: 'models', matches: ['src/models', 'models'] },
    { key: 'routes', matches: ['src/routes', 'routes'] },
    { key: 'utils', matches: ['src/utils', 'src/lib', 'utils', 'lib'] },
    { key: 'hooks', matches: ['src/hooks', 'hooks'] },
    { key: 'types', matches: ['src/types', 'types', 'src/shared/types'] },
    { key: 'styles', matches: ['src/styles', 'styles'] },
    { key: 'tests', matches: ['tests', 'src/__tests__', 'test'] },
    { key: 'public', matches: ['public'] },
    { key: 'scripts', matches: ['scripts'] },
    { key: 'docs', matches: ['docs'] },
    { key: 'config', matches: ['config', 'src/config'] },
    { key: 'packages', matches: ['packages', 'apps'] }
  ];

  for (const candidate of candidates) {
    for (const match of candidate.matches) {
      const found = paths.find((p) => p.toLowerCase() === match.toLowerCase());
      if (found) {
        keyDirs[candidate.key] = found;
        break;
      }
    }
  }

  return keyDirs;
}

/**
 * Identifies missing context for the AI agent (e.g. testing, schema, linter, CI/CD, docker).
 */
function findMissingContext(
  files: DiscoveredFile[],
  directories: DiscoveredDirectory[],
  hasTesting: boolean,
  hasDatabases: boolean,
  hasDbSchema: boolean
): string[] {
  const missing: string[] = [];
  const fileNames = new Set(files.map((f) => f.name.toLowerCase()));
  const dirPaths = new Set(directories.map((d) => d.relativePath.toLowerCase()));

  // 1. Testing framework check
  const hasTestFiles = files.some((f) => {
    const l = f.name.toLowerCase();
    return l.includes('.test.') || l.includes('.spec.') || l.startsWith('test_');
  });
  if (!hasTesting && !hasTestFiles) {
    missing.push('No testing framework detected');
  }

  // 2. Database schema check
  if (hasDatabases && !hasDbSchema) {
    missing.push('Database detected without schema or migrations');
  }

  // 3. Linter / Formatter check
  const hasLinter = Array.from(fileNames).some(
    (name) =>
      name.startsWith('.eslintrc') ||
      name.startsWith('eslint.config') ||
      name.startsWith('.prettierrc') ||
      name === 'biome.json' ||
      name === 'ruff.toml'
  );
  if (!hasLinter) {
    missing.push('No linter or formatter configuration detected');
  }

  // 4. CI/CD pipeline check
  const hasCI = dirPaths.has('.github/workflows') || fileNames.has('.gitlab-ci.yml') || fileNames.has('azure-pipelines.yml');
  if (!hasCI) {
    missing.push('No CI/CD pipeline detected');
  }

  // 5. Container configuration check
  const hasContainers = Array.from(fileNames).some(
    (name) => name.startsWith('dockerfile') || name.startsWith('docker-compose') || name.startsWith('compose.')
  );
  if (!hasContainers) {
    missing.push('No Docker or container configuration detected');
  }

  return missing;
}

/**
 * Scans the workspace and builds a structured, validated WorkspaceProfile
 * based on the full mechanics of Caliber.
 */
export async function scanWorkspace(rootPath: string): Promise<WorkspaceProfile> {
  const resolvedRoot = path.resolve(rootPath);

  // 1. Fingerprint the workspace (files, dirs, git, existing configs, code stats)
  const fingerprint = await collectFingerprint(resolvedRoot);
  const { files, directories, extensionCounts, gitInfo, existingConfigs, codeStats } = fingerprint;

  // 2. Language & Frameworks
  const primaryLanguage = detectPrimaryLanguage(files, extensionCounts);
  const { frameworks, hasTesting, isMonorepoWorkspace, manifestScripts } = await detectFrameworks(resolvedRoot, files);

  // 3. Databases & Infrastructure
  const { databases, hasDbSchema } = await detectDatabases(resolvedRoot, files);

  // 4. Architecture
  const architecture = detectArchitecture(directories, files, isMonorepoWorkspace);

  // 5. Key Directories
  const keyDirectories = identifyKeyDirectories(directories);

  // 6. Base Missing Context
  const baseMissingContext = findMissingContext(
    files,
    directories,
    hasTesting,
    databases.length > 0,
    hasDbSchema
  );

  // 7. Caliber-grade Deterministic AI Readiness Scoring & Drift Analysis
  const scoreResult = await evaluateReadiness(
    resolvedRoot,
    files,
    directories,
    gitInfo,
    existingConfigs,
    frameworks,
    manifestScripts
  );

  // Combine missing context with Caliber suggested improvements (deduplicated)
  const combinedMissingContext = Array.from(
    new Set([...baseMissingContext, ...scoreResult.suggestedImprovements])
  );

  const rawProfile: WorkspaceProfile = {
    primaryLanguage,
    frameworks,
    databases,
    architecture,
    keyDirectories,
    missingContext: combinedMissingContext,
    lastScanned: Date.now(),
    readinessScore: scoreResult.score,
    readinessGrade: scoreResult.grade,
    categoryScores: scoreResult.categoryScores,
    checks: scoreResult.checks,
    gitInfo,
    existingConfigs,
    codeStats
  };

  // 8. Auto-route recommended MCP servers based on detected stack
  const recommendedMCPs = getRecommendedMCPs(rawProfile);
  rawProfile.recommendedMCPs = recommendedMCPs;

  // Auto-inject recommended MCP servers into workspace mcp_config.json
  try {
    await injectRecommendedMCPs(resolvedRoot, rawProfile);
  } catch (err) {
    // Inject is best-effort (e.g. read-only filesystem during tests)
    console.warn('[WorkspaceScanner] MCP injection skipped:', err);
  }

  // 9. Validate output with Zod schema before returning
  const validated = WorkspaceProfileSchema.parse(rawProfile);
  workspaceProfileCache.set(resolvedRoot, { profile: validated, timestamp: Date.now() });
  return validated;
}

const workspaceProfileCache = new Map<string, { profile: WorkspaceProfile; timestamp: number }>();

/**
 * Returns cached WorkspaceProfile if available and less than 5 minutes old.
 */
export function getCachedWorkspaceProfile(rootPath: string): WorkspaceProfile | null {
  const resolved = path.resolve(rootPath);
  const entry = workspaceProfileCache.get(resolved);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > 5 * 60 * 1000) {
    workspaceProfileCache.delete(resolved);
    return null;
  }
  return entry.profile;
}

/**
 * Retrieves cached WorkspaceProfile or triggers a fresh scan.
 */
export async function getOrScanWorkspaceProfile(rootPath: string): Promise<WorkspaceProfile> {
  const cached = getCachedWorkspaceProfile(rootPath);
  if (cached) return cached;
  return scanWorkspace(rootPath);
}

/**
 * Clears cached workspace profiles (for testing or manual resync).
 */
export function clearWorkspaceProfileCache(): void {
  workspaceProfileCache.clear();
}

/**
 * Standard alias for getOrScanWorkspaceProfile.
 */
export const getWorkspaceProfile = getOrScanWorkspaceProfile;

