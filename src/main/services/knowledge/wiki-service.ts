/**
 * Prompt C Step 1 — Project Wiki Generator service.
 *
 * Generates a set of markdown documents (overview, architecture, modules,
 * data-flow, api-surface, conventions) into the project-local, git-shareable
 * `.tycode/wiki/` directory, using the Context Engine profile + a bounded source
 * snapshot, rendered through the LOCKED-ROUTE model (ProviderGateway).
 *
 * Guarantees / honesty rules:
 *  - The model is asked to describe ONLY what is present in the supplied context
 *    pack; we never synthesize docs from nothing and never write a fabricated
 *    fallback document when the LLM is unavailable — we surface an honest status.
 *  - Drift is detected from content hashes (no model call): a wiki is "stale"
 *    when the number of added/removed/changed source files since generation
 *    reaches WIKI_DRIFT_FILE_THRESHOLD.
 *  - Everything stays on local disk inside `.tycode/` (git-shareable by design);
 *    the only network hop is the same provider call the chat already makes.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  WIKI_DIR,
  WIKI_SECTIONS,
  WIKI_DRIFT_FILE_THRESHOLD,
  WIKI_INDEX_VERSION,
  type WikiIndex,
  type WikiSectionId,
  type WikiSectionMeta,
  type WikiStatus,
  type WikiSearchHit,
  type GenerateWikiResult
} from '../../../shared/types/wiki';
import { computeWorkspaceHash } from '../context-engine/correction-memory';
import { getOrScanWorkspaceProfile } from '../context-engine/workspace-scanner';
import type { WorkspaceProfile } from '../context-engine/types';
import {
  loadTycodeIgnore,
  snapshotWorkspace,
  aggregateSnapshotHash,
  diffSnapshots,
  readCapped,
  type SourceFileSnapshot
} from './knowledge-fs';

const SECTION_TITLES: Record<WikiSectionId, string> = {
  overview: 'Project Overview',
  architecture: 'Architecture',
  modules: 'Modules & Responsibilities',
  'data-flow': 'Data Flow',
  'api-surface': 'API Surface',
  conventions: 'Conventions & Standards'
};

const GENERATION_TIMEOUT_MS = 120_000;
const CONTEXT_PACK_MAX_CHARS = 16_000;
const TREE_ENTRY_CAP = 400;
const HEAD_FILE_CAP = 14;
const HEAD_LINES = 40;

export interface GenerateWikiOptions {
  force?: boolean;
  onProgress?: (event: { section: WikiSectionId; phase: 'start' | 'done' | 'error'; message?: string }) => void;
}

class WikiService {
  private wikiDir(workspaceRoot: string): string {
    return path.join(path.resolve(workspaceRoot), WIKI_DIR);
  }

  private async readIndex(workspaceRoot: string): Promise<WikiIndex | null> {
    try {
      const raw = await fsp.readFile(path.join(this.wikiDir(workspaceRoot), 'index.json'), 'utf-8');
      return JSON.parse(raw) as WikiIndex;
    } catch {
      return null;
    }
  }

  /** Current stale/fresh assessment derived purely from content hashes. */
  async status(workspaceRoot: string): Promise<WikiStatus> {
    const index = await this.readIndex(workspaceRoot);
    const ignore = await loadTycodeIgnore(workspaceRoot);
    const current = await snapshotWorkspace(workspaceRoot, ignore, { sourceOnly: true });

    if (!index) {
      return {
        exists: false,
        generatedAt: null,
        stale: true,
        changedFiles: current.length,
        driftThreshold: WIKI_DRIFT_FILE_THRESHOLD,
        sections: []
      };
    }
    const previous: SourceFileSnapshot[] = Object.entries(index.fileHashes).map(([relPath, hash]) => ({
      relPath,
      hash,
      size: 0
    }));
    const diff = diffSnapshots(previous, current);
    const changedFiles = diff.added.length + diff.removed.length + diff.changed.length;
    return {
      exists: true,
      generatedAt: index.generatedAt,
      stale: changedFiles >= WIKI_DRIFT_FILE_THRESHOLD,
      changedFiles,
      driftThreshold: WIKI_DRIFT_FILE_THRESHOLD,
      sections: index.sections
    };
  }

  /**
   * Regenerate the wiki. When fresh and not forced, does nothing (no model call).
   * Returns an honest result even on failure — never writes fabricated content.
   */
  async generate(workspaceRoot: string, options: GenerateWikiOptions = {}): Promise<GenerateWikiResult> {
    const force = options.force === true;
    const currentStatus = await this.status(workspaceRoot);
    if (!force && currentStatus.exists && !currentStatus.stale) {
      return { generated: false, reason: 'fresh', status: currentStatus };
    }

    const ignore = await loadTycodeIgnore(workspaceRoot);
    const snapshot = await snapshotWorkspace(workspaceRoot, ignore, { sourceOnly: true });
    if (snapshot.length === 0) {
      const fresh = await this.status(workspaceRoot);
      return { generated: false, reason: 'no-stale-source', message: 'No source files to describe.', status: fresh };
    }
    const snapshotHash = aggregateSnapshotHash(snapshot);

    const profile = await getOrScanWorkspaceProfile(workspaceRoot);
    const pack = await this.buildContextPack(workspaceRoot, profile, snapshot);

    const fileHashes: Record<string, string> = {};
    for (const f of snapshot) fileHashes[f.relPath] = f.hash;

    const dir = this.wikiDir(workspaceRoot);
    await fsp.mkdir(dir, { recursive: true });

    const sections: WikiSectionMeta[] = [];
    const now = Date.now();
    for (const section of WIKI_SECTIONS) {
      options.onProgress?.({ section, phase: 'start' });
      let body: string;
      try {
        body = await this.generateSection(section, pack);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        options.onProgress?.({ section, phase: 'error', message });
        // Honest failure: do not fabricate. If the very first section fails we abort.
        if (sections.length === 0) {
          return {
            generated: false,
            reason: /route|provider|no active|model|gateway|unavailable/i.test(message) ? 'llm-unavailable' : 'error',
            message,
            status: await this.status(workspaceRoot)
          };
        }
        // Partial run: keep already-generated sections but report the error.
        break;
      }

      const title = SECTION_TITLES[section];
      const rel = `${WIKI_DIR}/${section}.md`;
      const front = [
        '---',
        `section: ${section}`,
        `generated: ${new Date(now).toISOString()}`,
        `sourceHash: ${snapshotHash}`,
        '---',
        ''
      ].join('\n');
      await fsp.writeFile(path.join(path.resolve(workspaceRoot), rel), `${front}# ${title}\n\n${body.trim()}\n`, 'utf-8');
      sections.push({ id: section, title, file: rel, generatedAt: now, sourceSnapshotHash: snapshotHash });
      options.onProgress?.({ section, phase: 'done' });
    }

    if (sections.length === 0) {
      return { generated: false, reason: 'error', message: 'Wiki generation produced no sections.', status: await this.status(workspaceRoot) };
    }

    const index: WikiIndex = {
      v: WIKI_INDEX_VERSION,
      wsHash: computeWorkspaceHash(workspaceRoot),
      generatedAt: now,
      sourceSnapshotHash: snapshotHash,
      fileHashes,
      sections
    };
    await fsp.writeFile(path.join(dir, 'index.json'), JSON.stringify(index, null, 2), 'utf-8');

    return {
      generated: sections.length === WIKI_SECTIONS.length,
      reason: 'generated',
      status: await this.status(workspaceRoot)
    };
  }

  /** Read a section's markdown body (frontmatter stripped). */
  async readSection(workspaceRoot: string, section: WikiSectionId): Promise<string | null> {
    try {
      const raw = await fsp.readFile(path.join(this.wikiDir(workspaceRoot), `${section}.md`), 'utf-8');
      return stripFrontmatter(raw);
    } catch {
      return null;
    }
  }

  /** Section-level search across the generated docs (no embeddings needed). */
  async search(workspaceRoot: string, query: string, limit = 5): Promise<WikiSearchHit[]> {
    const index = await this.readIndex(workspaceRoot);
    if (!index) return [];
    const terms = tokenize(query);
    if (terms.length === 0) return [];
    const hits: WikiSearchHit[] = [];
    for (const meta of index.sections) {
      const body = (await this.readSection(workspaceRoot, meta.id)) || '';
      const hay = `${meta.title}\n${body}`.toLowerCase();
      const titleHay = meta.title.toLowerCase();
      let score = 0;
      for (const t of terms) {
        if (titleHay.includes(t)) score += 3;
        const matches = countOccurrences(hay, t);
        score += Math.min(matches, 10);
      }
      if (score === 0) continue;
      hits.push({ section: meta.id, title: meta.title, score, snippet: buildSnippet(body, terms) });
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  // ---------------------------------------------------------------- internals

  private async buildContextPack(
    workspaceRoot: string,
    profile: WorkspaceProfile,
    snapshot: SourceFileSnapshot[]
  ): Promise<string> {
    const resolved = path.resolve(workspaceRoot);
    const lines: string[] = [];
    lines.push(`PRIMARY LANGUAGE: ${profile.primaryLanguage}`);
    lines.push(`FRAMEWORKS: ${profile.frameworks.join(', ') || 'n/a'}`);
    lines.push(`DATABASES: ${profile.databases.join(', ') || 'n/a'}`);
    lines.push(`ARCHITECTURE: ${profile.architecture}`);
    if (profile.keyDirectories && Object.keys(profile.keyDirectories).length) {
      lines.push(`KEY DIRECTORIES: ${Object.entries(profile.keyDirectories).map(([k, v]) => `${k}=${v}`).join(', ')}`);
    }
    if (profile.codeStats) {
      lines.push(`SIZE: ${profile.codeStats.sourceFiles} source files, ~${profile.codeStats.estimatedTokens} tokens`);
    }

    const tree = snapshot.slice(0, TREE_ENTRY_CAP).map((f) => f.relPath);
    lines.push('\nFILE TREE (source, capped):');
    lines.push(tree.join('\n'));
    if (snapshot.length > TREE_ENTRY_CAP) lines.push(`… (${snapshot.length - TREE_ENTRY_CAP} more)`);

    // Representative heads: prefer entry/config files + a spread across directories.
    const picks = pickRepresentative(snapshot);
    lines.push('\nFILE HEADS:');
    let used = lines.join('\n').length;
    for (const rel of picks) {
      const head = await readCapped(path.join(resolved, rel));
      if (!head) continue;
      const snippet = head.split(/\r?\n/).slice(0, HEAD_LINES).join('\n');
      const block = `\n--- ${rel} ---\n${snippet}`;
      if (used + block.length > CONTEXT_PACK_MAX_CHARS) break;
      lines.push(block);
      used += block.length;
    }
    return lines.join('\n');
  }

  private async generateSection(section: WikiSectionId, pack: string): Promise<string> {
    const system =
      'You are Ty-Code\'s technical writer. Produce ONE concise Markdown reference section about a real ' +
      'software project using ONLY the supplied context. Never invent files, endpoints, or modules that are ' +
      'not evidenced by the context; if something is unknown, omit it. Output raw Markdown (no code fences ' +
      'around the whole answer), no preamble, and do not repeat the top-level title.';
    const focus = SECTION_FOCUS[section];
    const user = `${focus}\n\n=== PROJECT CONTEXT ===\n${pack}\n=== END CONTEXT ===`;
    return callLockedRoute(system, user);
  }
}

const SECTION_FOCUS: Record<WikiSectionId, string> = {
  overview:
    'Write the OVERVIEW section: what this project is and does, its primary language, frameworks, databases, ' +
    'architecture style, and overall size. 5-10 bullet points or a short paragraph.',
  architecture:
    'Write the ARCHITECTURE section: the high-level structure and the key directories and their roles, plus ' +
    'how the major parts fit together. Use headings and short bullets grounded in the file tree.',
  modules:
    'Write the MODULES & RESPONSIBILITIES section: enumerate the main modules/packages visible in the tree and ' +
    'one line on each one\'s responsibility. Only list directories/files that actually appear in the context.',
  'data-flow':
    'Write the DATA FLOW section: trace how data moves through the system (entry points → processing → ' +
    'persistence/output) as inferred from the file heads and directory layout. Describe only flows you can ' +
    'support from the context.',
  'api-surface':
    'Write the API SURFACE section: the externally-facing entry points (routes, controllers, exported ' +
    'functions, CLI commands, IPC channels) that are visible in the context. Format as a list of ' +
    '`path/name — purpose`. Omit anything not evidenced.',
  conventions:
    'Write the CONVENTIONS & STANDARDS section: naming, directory, and structural conventions observable from ' +
    'the file tree and heads (e.g. how components/modules are organized and named). Be concrete and evidence-based.'
};

/**
 * The locked-route LLM seam. Split out so tests can mock ProviderGateway without
 * network. Reads the currently locked provider/model and does a single
 * non-streaming request with a hard timeout. Throws (never fakes) when there is
 * no usable route.
 */
export async function callLockedRoute(system: string, user: string): Promise<string> {
  const gateway = await import('../../providers/provider-gateway');
  const active = gateway.getActiveModel();
  if (!active || !active.providerId || !active.modelId) {
    throw new Error('no active model route is configured for wiki generation');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  try {
    const text = await gateway.sendChatRequest(
      active.providerId,
      active.modelId,
      [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ],
      false,
      undefined,
      undefined,
      0,
      controller.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      `wiki-gen-${Date.now()}`,
      'chat'
    );
    if (!text || !text.trim()) throw new Error('model returned an empty section');
    return text;
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------- helpers

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith('---')) return raw;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return raw;
  const after = raw.slice(end + 4);
  return after.replace(/^\r?\n/, '');
}

function tokenize(q: string): string[] {
  return Array.from(
    new Set(
      q
        .toLowerCase()
        .split(/[^a-z0-9]+/)
        .filter((t) => t.length > 1)
    )
  ).slice(0, 16);
}

function countOccurrences(hay: string, needle: string): number {
  let count = 0;
  let idx = hay.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = hay.indexOf(needle, idx + needle.length);
  }
  return count;
}

function buildSnippet(body: string, terms: string[]): string {
  const lower = body.toLowerCase();
  let pos = -1;
  for (const t of terms) {
    const p = lower.indexOf(t);
    if (p !== -1 && (pos === -1 || p < pos)) pos = p;
  }
  if (pos === -1) pos = 0;
  const start = Math.max(0, pos - 80);
  const slice = body.slice(start, start + 240).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + slice + (start + 240 < body.length ? '…' : '');
}

function pickRepresentative(snapshot: SourceFileSnapshot[]): string[] {
  const priority = [
    /(^|\/)(package|pyproject|cargo|go\.mod|pom|build\.gradle)(\.(json|toml))?$/i,
    /(^|\/)(readme|index|main|app|server)\.(md|ts|tsx|js|py|go|rs|java)$/i,
    /(^|\/)(routes?|controller|api|handler)s?\b/i,
    /(^|\/)src\//i
  ];
  const picked = new Set<string>();
  for (const re of priority) {
    for (const f of snapshot) {
      if (picked.size >= HEAD_FILE_CAP) break;
      if (re.test(f.relPath)) picked.add(f.relPath);
    }
    if (picked.size >= HEAD_FILE_CAP) break;
  }
  // Fill remaining slots spread across the tree.
  for (const f of snapshot) {
    if (picked.size >= HEAD_FILE_CAP) break;
    picked.add(f.relPath);
  }
  return Array.from(picked);
}

export const wikiService = new WikiService();
