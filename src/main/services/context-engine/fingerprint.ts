/**
 * Ty-Code Context Engine: Codebase Fingerprint & Metadata Collector
 *
 * Implements local-first codebase fingerprinting based on the mechanics of Caliber:
 * - Streaming file tree resolution with Git awareness and fallback directory walking.
 * - Secret sanitization and ignore filter lists.
 * - Git repository metadata and commit history tracking.
 * - Discovery of existing agent instructions, rules, skills, and MCP configurations.
 * - Codebase size and token estimation.
 *
 * Strictly local, non-blocking asynchronous file system traversal.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { Dirent } from 'node:fs';
import type {
  WorkspaceExistingConfigs,
  WorkspaceGitInfo,
  WorkspaceCodeStats
} from './types';

const execFileAsync = promisify(execFile);

export const IGNORED_DIRECTORIES = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  'out',
  '.next',
  '.nuxt',
  '.svelte-kit',
  'coverage',
  '__pycache__',
  '.venv',
  'venv',
  'env',
  '.idea',
  '.vscode',
  '.gradle',
  'target',
  'bin',
  'obj',
  'vendor',
  '.ty-code',
  '.cache',
  '.wrangler',
  '.turbo',
  '.output',
  '.parcel-cache',
  '.nyc_output'
]);

export const SKIP_PATTERNS = [
  /\.min\.(js|css)$/,
  /\.bundle\.(js|css)$/,
  /\.map$/,
  /\.d\.ts$/,
  /\.generated\./,
  /\.snap$/,
  /^\.env($|\.)/,
  /\.(pem|key|crt|cer|pfx|p12|jks|keystore)$/,
  /^id_(rsa|ed25519|ecdsa)$/,
  /^(known_hosts|authorized_keys)$/
];

export const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.pyw',
  '.go',
  '.rs',
  '.rb',
  '.java',
  '.kt',
  '.scala',
  '.cs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.swift',
  '.php'
]);

export interface DiscoveredFile {
  relativePath: string;
  name: string;
  depth: number;
}

export interface DiscoveredDirectory {
  relativePath: string;
  name: string;
  depth: number;
}

export interface FingerprintResult {
  files: DiscoveredFile[];
  directories: DiscoveredDirectory[];
  extensionCounts: Record<string, number>;
  gitInfo: WorkspaceGitInfo;
  existingConfigs: WorkspaceExistingConfigs;
  codeStats: WorkspaceCodeStats;
}

/**
 * Executes a Git command safely with timeout, returning trimmed stdout or null.
 */
async function runGit(args: string[], cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
      maxBuffer: 10 * 1024 * 1024
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

/**
 * Collects Git-tracked files if available.
 */
async function getGitTrackedFiles(dir: string): Promise<string[] | null> {
  const output = await runGit(['ls-files', '--cached', '--others', '--exclude-standard'], dir);
  if (!output) return null;
  return output.split(/\r?\n/).filter(Boolean);
}

/**
 * Non-blocking streaming file walker.
 * Periodically yields with setImmediate so the main loop and Monaco remain responsive.
 */
export async function walkWorkspace(
  rootPath: string,
  maxDepth = 5
): Promise<{
  files: DiscoveredFile[];
  directories: DiscoveredDirectory[];
  extensionCounts: Record<string, number>;
}> {
  // Check if Git tracking is available for super-fast index retrieval
  const gitFiles = await getGitTrackedFiles(rootPath);

  if (gitFiles && gitFiles.length > 0) {
    const files: DiscoveredFile[] = [];
    const dirSet = new Set<string>();
    const directories: DiscoveredDirectory[] = [];
    const extensionCounts: Record<string, number> = {};

    for (const relFile of gitFiles) {
      const normalized = relFile.replace(/\\/g, '/');
      const parts = normalized.split('/');
      const depth = parts.length - 1;
      if (depth > maxDepth) continue;

      const fileName = parts[parts.length - 1];
      files.push({ relativePath: normalized, name: fileName, depth });

      const ext = path.extname(fileName).toLowerCase();
      if (ext) {
        extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
      }

      // Track directories
      for (let i = 1; i < parts.length; i++) {
        const dirRel = parts.slice(0, i).join('/');
        if (!dirSet.has(dirRel)) {
          dirSet.add(dirRel);
          directories.push({
            relativePath: dirRel,
            name: parts[i - 1],
            depth: i - 1
          });
        }
      }
    }

    return { files, directories, extensionCounts };
  }

  // Fallback to recursive directory walk with periodic yields
  const files: DiscoveredFile[] = [];
  const directories: DiscoveredDirectory[] = [];
  const extensionCounts: Record<string, number> = {};

  let operationsSinceYield = 0;

  async function walk(currentDir: string, currentDepth: number): Promise<void> {
    if (currentDepth > maxDepth) return;

    let entries: Dirent[] = [];
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      operationsSinceYield++;
      if (operationsSinceYield >= 60) {
        operationsSinceYield = 0;
        await new Promise((resolve) => setImmediate(resolve));
      }

      const fullPath = path.join(currentDir, entry.name);
      const relPath = path.relative(rootPath, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entry.name)) continue;
        directories.push({ relativePath: relPath, name: entry.name, depth: currentDepth });
        await walk(fullPath, currentDepth + 1);
      } else if (entry.isFile()) {
        files.push({ relativePath: relPath, name: entry.name, depth: currentDepth });
        const ext = path.extname(entry.name).toLowerCase();
        if (ext) {
          extensionCounts[ext] = (extensionCounts[ext] || 0) + 1;
        }
      }
    }
  }

  await walk(rootPath, 0);
  return { files, directories, extensionCounts };
}

/**
 * Extracts Git repository information (branch, remote, repo name, clean status, recent commit).
 */
export async function collectGitInfo(dir: string): Promise<WorkspaceGitInfo> {
  const isInside = await runGit(['rev-parse', '--is-inside-work-tree'], dir);
  if (isInside !== 'true') {
    return { isGitRepo: false };
  }

  const branch = (await runGit(['branch', '--show-current'], dir)) ||
    (await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir)) || undefined;

  const remoteUrl = (await runGit(['config', '--get', 'remote.origin.url'], dir)) || undefined;

  let repoName: string | undefined;
  if (remoteUrl) {
    const match = remoteUrl.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) repoName = match[1];
  }
  if (!repoName) {
    repoName = path.basename(path.resolve(dir));
  }

  const status = await runGit(['status', '--porcelain'], dir);
  const isClean = status !== null && status.length === 0;

  const lastCommit = (await runGit(['log', '-1', '--format=%h %s (%cr)'], dir)) || undefined;

  // Calculate commit drift: how many commits since instruction files were last updated
  let commitsSinceConfigUpdate: number | undefined;
  const configCandidateFiles = ['AGENTS.md', 'README.md', '.agents'];
  for (const candidate of configCandidateFiles) {
    const commitCount = await runGit(['rev-list', '--count', `HEAD...HEAD^{/^.*}`, '--', candidate], dir);
    if (commitCount && !isNaN(Number(commitCount))) {
      commitsSinceConfigUpdate = Number(commitCount);
      break;
    }
  }

  return {
    isGitRepo: true,
    branch,
    remoteUrl,
    repoName,
    isClean,
    lastCommit,
    commitsSinceConfigUpdate: commitsSinceConfigUpdate ?? 0
  };
}

/**
 * Discovers existing agent instructions, documentation, rules, skills, and MCP configurations.
 */
export async function collectExistingConfigs(
  dir: string,
  files: DiscoveredFile[]
): Promise<WorkspaceExistingConfigs> {
  const filePaths = new Set(files.map((f) => f.relativePath.toLowerCase()));
  const instructionFiles: string[] = [];
  const docFiles: string[] = [];

  const candidateInstructions = [
    'agents.md',
    'readme.md',
    'architecture.md',
    'contributing.md',
    'development.md',
    'setup.md'
  ];

  for (const candidate of candidateInstructions) {
    const match = files.find((f) => f.relativePath.toLowerCase() === candidate);
    if (match) {
      instructionFiles.push(match.relativePath);
    }
  }

  for (const file of files) {
    const lower = file.relativePath.toLowerCase();
    if (lower.startsWith('docs/') && lower.endsWith('.md')) {
      docFiles.push(file.relativePath);
    }
  }

  // Count rules (.agents/rules/*.md, rules/*.md)
  let rulesCount = 0;
  for (const file of files) {
    const lower = file.relativePath.toLowerCase();
    if ((lower.startsWith('.agents/rules/') || lower.startsWith('rules/')) && lower.endsWith('.md')) {
      rulesCount++;
    }
  }

  // Count skills (.agents/skills/*/SKILL.md, skills/*/SKILL.md)
  let skillsCount = 0;
  for (const file of files) {
    const lower = file.relativePath.toLowerCase();
    if (
      (lower.startsWith('.agents/skills/') || lower.startsWith('skills/')) &&
      lower.endsWith('/skill.md')
    ) {
      skillsCount++;
    }
  }

  // Check MCP configurations (mcp_config.json, .agents/mcp_config.json, mcp.json)
  let mcpServersCount = 0;
  const mcpCandidates = ['mcp_config.json', '.agents/mcp_config.json', 'mcp.json'];
  for (const candidate of mcpCandidates) {
    if (filePaths.has(candidate.toLowerCase())) {
      try {
        const content = await fs.readFile(path.join(dir, candidate), 'utf-8');
        const parsed = JSON.parse(content);
        if (parsed.mcpServers && typeof parsed.mcpServers === 'object') {
          mcpServersCount += Object.keys(parsed.mcpServers).length;
        } else {
          mcpServersCount += 1;
        }
      } catch {
        mcpServersCount += 1;
      }
    }
  }

  return {
    hasInstructions: instructionFiles.length > 0,
    instructionFiles,
    rulesCount,
    skillsCount,
    mcpServersCount,
    docFiles
  };
}

/**
 * Calculates project size and token estimation without loading massive binaries or secrets into memory.
 */
export async function collectCodeStats(
  dir: string,
  files: DiscoveredFile[]
): Promise<WorkspaceCodeStats> {
  const sourceFiles = files.filter((f) => {
    const ext = path.extname(f.name).toLowerCase();
    if (!SOURCE_EXTENSIONS.has(ext)) return false;
    for (const pattern of SKIP_PATTERNS) {
      if (pattern.test(f.name)) return false;
    }
    return true;
  });

  let estimatedTokens = 0;
  const sampleLimit = Math.min(sourceFiles.length, 50);

  for (let i = 0; i < sampleLimit; i++) {
    try {
      const fullPath = path.join(dir, sourceFiles[i].relativePath);
      const stat = await fs.stat(fullPath);
      // Average ~4 chars per token
      estimatedTokens += Math.round(stat.size / 4);
    } catch {}
  }

  if (sourceFiles.length > sampleLimit) {
    const avgTokensPerFile = Math.round(estimatedTokens / sampleLimit);
    estimatedTokens = avgTokensPerFile * sourceFiles.length;
  }

  return {
    totalFiles: files.length,
    sourceFiles: sourceFiles.length,
    estimatedTokens
  };
}

/**
 * Collects the complete codebase fingerprint.
 */
export async function collectFingerprint(dir: string): Promise<FingerprintResult> {
  const resolvedDir = path.resolve(dir);
  const { files, directories, extensionCounts } = await walkWorkspace(resolvedDir);
  const gitInfo = await collectGitInfo(resolvedDir);
  const existingConfigs = await collectExistingConfigs(resolvedDir, files);
  const codeStats = await collectCodeStats(resolvedDir, files);

  return {
    files,
    directories,
    extensionCounts,
    gitInfo,
    existingConfigs,
    codeStats
  };
}
