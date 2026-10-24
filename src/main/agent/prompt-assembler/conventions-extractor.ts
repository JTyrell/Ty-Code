/**
 * Ty-Code Conventions Extractor (Layer 4)
 *
 * Builds a repo map from the cached profile + up to 5 representative source files
 * (each capped 6KB, chosen by centrality: most-imported extensions first).
 * One-shot ProviderGateway.sendChatRequest using the Layer 4 'repo anthropologist'
 * prompt on the cheapest available model; parses STRICT JSON via ConventionsSummarySchema.
 * Caches to .tycode/conventions.json keyed by git HEAD hash + manifestHash.
 * Background execution; exposes getStatus(): 'idle'|'running'|'ready'|'failed'.
 */

import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { ConventionsSummarySchema, type ConventionsSummary } from './schemas';
import { ProviderGateway, getVerifiedModels } from '../../providers/provider-gateway';

const CACHE_DIR = '.tycode';
const CACHE_FILE = 'conventions.json';
const MAX_FILE_BYTES = 6 * 1024;
const MAX_FILES = 5;

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.rb', '.php', '.java', '.kt', '.cs', '.cpp', '.c', '.h'];

let status: 'idle' | 'running' | 'ready' | 'failed' = 'idle';
let lastResult: ConventionsSummary | null = null;

export function getConventionsStatus(): 'idle' | 'running' | 'ready' | 'failed' {
  return status;
}

export function getLastConventions(): ConventionsSummary | null {
  return lastResult;
}

const CACHE_PATHS = new Map<string, string>();

function conventionsCachePath(workspaceRoot: string): string {
  let cached = CACHE_PATHS.get(workspaceRoot);
  if (!cached) {
    cached = path.join(workspaceRoot, CACHE_DIR, CACHE_FILE);
    CACHE_PATHS.set(workspaceRoot, cached);
  }
  return cached;
}

async function readGitHead(workspaceRoot: string): Promise<string> {
  try {
    const { execSync } = await import('child_process');
    return execSync('git rev-parse HEAD', { cwd: workspaceRoot, stdio: ['pipe', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'no-git';
  }
}

async function conventionsCacheKey(workspaceRoot: string, manifestHash: string): Promise<string> {
  const head = await readGitHead(workspaceRoot);
  return crypto.createHash('sha256').update(`${head}:${manifestHash}`).digest('hex');
}

function pickRepresentativeFiles(entries: string[], workspaceRoot: string): string[] {
  const byExt: Record<string, string[]> = {};
  for (const e of entries) {
    const ext = path.extname(e).toLowerCase();
    if (SOURCE_EXTENSIONS.includes(ext)) {
      (byExt[ext] ??= []).push(e);
    }
  }
  // Most-imported extensions first (heuristic: count files per ext)
  const orderedExts = Object.entries(byExt).sort((a, b) => b[1].length - a[1].length);
  const picked: string[] = [];
  for (const [ext, files] of orderedExts) {
    for (const f of files) {
      picked.push(f);
      if (picked.length >= MAX_FILES) break;
    }
    if (picked.length >= MAX_FILES) break;
  }
  return picked;
}

async function readFileCapped(workspaceRoot: string, relPath: string): Promise<string | null> {
  try {
    const full = path.join(workspaceRoot, relPath);
    const stat = await fsp.stat(full);
    if (!stat.isFile()) return null;
    const content = await fsp.readFile(full, 'utf8');
    return content.slice(0, MAX_FILE_BYTES);
  } catch {
    return null;
  }
}

const LAYER4_PROMPT = `You are a repository anthropologist. Analyze this codebase and output STRICT JSON describing its living conventions. Do not suggest improvements; describe only what IS.

{
  "fileNaming": "...",
  "importStyle": "...",
  "errorHandling": "...",
  "stateManagement": "...",
  "styling": "...",
  "testLayout": "...",
  "commentPolicy": "...",
  "forbiddenPatterns": ["..."],
  "commitStyle": "...",
  "moduleBoundaries": "..."
}

Repo map:
{repoMap}

Representative files:
{files}`;

async function pickCheapestModel(): Promise<{ providerId: string; modelId: string } | null> {
  try {
    const models = await getVerifiedModels();
    const free = models.find((m) => !m.requiresKey);
    if (free) return { providerId: free.providerId, modelId: free.modelId };
    const cheapest = models[0];
    if (cheapest) return { providerId: cheapest.providerId, modelId: cheapest.modelId };
  } catch {
    // fall through
  }
  return null;
}

export async function extractConventions(workspaceRoot: string, manifestHash: string): Promise<ConventionsSummary | null> {
  if (status === 'running') return lastResult;
  status = 'running';

  try {
    const key = await conventionsCacheKey(workspaceRoot, manifestHash);
    const cachePath = conventionsCachePath(workspaceRoot);

    // Try cache
    try {
      const raw = await fsp.readFile(cachePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed.key === key && parsed.summary) {
        const validated = ConventionsSummarySchema.parse(parsed.summary);
        lastResult = validated;
        status = 'ready';
        return validated;
      }
    } catch {
      // no valid cache
    }

    // Build repo map + representative files
    let entries: string[] = [];
    try {
      const dirEnts = await fsp.readdir(workspaceRoot, { withFileTypes: true });
      for (const ent of dirEnts) {
        entries.push(ent.name);
      }
    } catch {
      entries = [];
    }
    const repoMap = entries.slice(0, 60).join('\n');

    const picked = pickRepresentativeFiles(entries, workspaceRoot);
    const fileContents: string[] = [];
    for (const f of picked) {
      const content = await readFileCapped(workspaceRoot, f);
      if (content) {
        fileContents.push(`### ${f}\n${content}`);
      }
    }

    const model = await pickCheapestModel();
    if (!model) {
      status = 'failed';
      lastResult = null;
      return null;
    }

    const prompt = LAYER4_PROMPT.replace('{repoMap}', repoMap).replace('{files}', fileContents.join('\n\n'));
    const response = await ProviderGateway.sendChatRequest(model.providerId, model.modelId, [
      { role: 'system', content: 'You output strict JSON only.' },
      { role: 'user', content: prompt }
    ], false);

    const cleaned = (response || '').trim();
    const jsonStart = cleaned.indexOf('{');
    if (jsonStart < 0) {
      status = 'failed';
      lastResult = null;
      return null;
    }
    const parsed = JSON.parse(cleaned.substring(jsonStart));
    const validated = ConventionsSummarySchema.parse(parsed);

    // Persist cache
    try {
      const cachePathDir = path.dirname(cachePath);
      await fsp.mkdir(cachePathDir, { recursive: true });
      await fsp.writeFile(cachePath, JSON.stringify({ key, summary: validated, savedAt: Date.now() }, null, 2));
    } catch {
      // cache write must never block
    }

    lastResult = validated;
    status = 'ready';
    return validated;
  } catch {
    status = 'failed';
    lastResult = null;
    return null;
  }
}

export function resetConventionsStatus(): void {
  status = 'idle';
  lastResult = null;
}

export async function pickProviderModel(): Promise<{ providerId: string; modelId: string }> {
  const model = await pickCheapestModel();
  return model || { providerId: 'google', modelId: 'gemini-1.5-flash' };
}

export async function runConventionsExtractor(
  workspaceRoot: string,
  _providerId?: string,
  _modelId?: string
): Promise<ConventionsSummary | null> {
  return extractConventions(workspaceRoot, 'latest');
}
