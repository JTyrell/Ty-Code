/**
 * Prompt C Step 3 — Semantic code index service.
 *
 * Builds and queries a strictly-LOCAL embeddings index over workspace source
 * chunks, persisted under the project-local `.tycode/index/` directory:
 *   - manifest.json  → the IndexMeta (source, model, dim, per-file hashes)
 *   - chunks.json    → the ranked-able chunk records (path, line, text)
 *   - vectors.json   → id → float vector
 *
 * Rebuilds are INCREMENTAL: only files whose content hash changed since the last
 * build are re-chunked and re-embedded; removed files drop out. A debounced
 * scheduler lets callers request a background refresh after bursts of edits without
 * re-embedding on every keystroke. Search embeds the query with the SAME provider
 * that built the index and ranks chunks by cosine similarity.
 *
 * Honesty rule: if no local embedder is usable the caller still gets the dependency-
 * free token embedder, so the index is never fabricated and never requires the cloud.
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  INDEX_DIR,
  SEMANTIC_INDEX_VERSION,
  INDEX_MAX_CHUNKS,
  type IndexChunk,
  type IndexManifest,
  type IndexStatus,
  type SemanticHit,
  type RebuildIndexResult,
  type EmbeddingSource
} from '../../../shared/types/semantic';
import {
  loadTycodeIgnore,
  snapshotWorkspace,
  aggregateSnapshotHash,
  diffSnapshots,
  readCapped,
  type SourceFileSnapshot
} from './knowledge-fs';
import { resolveEmbedder, cosine, type Embedder } from './embeddings';

const CHUNK_LINES = 40;
const CHUNK_OVERLAP = 6;
const MAX_CHUNKS_PER_FILE = 60;
const DEBOUNCE_MS = 4_000;

interface StoredIndex {
  manifest: IndexManifest;
  chunks: IndexChunk[];
  vectors: Record<string, number[]>;
}

class SemanticIndexService {
  private indexDir(root: string): string {
    return path.join(path.resolve(root), INDEX_DIR);
  }

  private debounceTimers = new Map<string, NodeJS.Timeout>();
  private inFlight = new Set<string>();

  async status(workspaceRoot: string): Promise<IndexStatus> {
    const stored = await this.readIndex(workspaceRoot);
    const ignore = await loadTycodeIgnore(workspaceRoot);
    const current = await snapshotWorkspace(workspaceRoot, ignore, { sourceOnly: true });

    if (!stored) {
      return {
        exists: false,
        source: null,
        model: null,
        dim: null,
        builtAt: null,
        chunkCount: 0,
        pendingFiles: current.length,
        indexing: this.inFlight.has(path.resolve(workspaceRoot))
      };
    }
    const previous: SourceFileSnapshot[] = Object.entries(stored.manifest.fileHashes).map(([relPath, hash]) => ({
      relPath,
      hash,
      size: 0
    }));
    const diff = diffSnapshots(previous, current);
    return {
      exists: true,
      source: stored.manifest.source,
      model: stored.manifest.model,
      dim: stored.manifest.dim,
      builtAt: stored.manifest.builtAt,
      chunkCount: stored.manifest.chunkCount,
      pendingFiles: diff.added.length + diff.removed.length + diff.changed.length,
      indexing: this.inFlight.has(path.resolve(workspaceRoot))
    };
  }

  /**
   * Rebuild the index. Incremental by default: unchanged files reuse their stored
   * chunks + vectors; only added/changed files are re-embedded and removed files are
   * dropped. `force` re-embeds everything with the current embedder.
   */
  async rebuild(
    workspaceRoot: string,
    options: { force?: boolean; onProgress?: (e: { phase: string; detail?: string; done?: number; total?: number }) => void } = {}
  ): Promise<RebuildIndexResult> {
    const resolved = path.resolve(workspaceRoot);
    if (this.inFlight.has(resolved)) {
      return { rebuilt: false, reason: 'error', message: 'An index build is already running.', status: await this.status(workspaceRoot) };
    }
    this.inFlight.add(resolved);
    options.onProgress?.({ phase: 'start' });
    try {
      const ignore = await loadTycodeIgnore(workspaceRoot);
      const snapshot = await snapshotWorkspace(workspaceRoot, ignore, { sourceOnly: true });
      if (snapshot.length === 0) {
        return { rebuilt: false, reason: 'no-source', message: 'No source files to index.', status: await this.status(workspaceRoot) };
      }
      const snapshotHash = aggregateSnapshotHash(snapshot);

      const existing = options.force ? null : await this.readIndex(workspaceRoot);
      if (existing && existing.manifest.sourceSnapshotHash === snapshotHash && !options.force) {
        return { rebuilt: false, reason: 'fresh', status: await this.status(workspaceRoot) };
      }

      // Decide the embedder once per build. When reusing an existing index we keep
      // its source so vectors stay comparable; a fresh/forced build resolves anew.
      let embedder: Embedder;
      if (existing && !options.force && existing.manifest.dim > 0) {
        embedder = await resolveEmbedder(existing.manifest.source === 'ollama');
        // If the resolved source can't match the stored one, force a full rebuild so
        // every vector shares one space.
        if (embedder.source !== existing.manifest.source) {
          options.onProgress?.({ phase: 'source-change', detail: `${existing.manifest.source} → ${embedder.source}` });
          await this.dropIndex(workspaceRoot);
          return this.buildFresh(workspaceRoot, snapshot, snapshotHash, embedder, options);
        }
      } else {
        embedder = await resolveEmbedder();
      }

      if (!existing || existing.manifest.source !== embedder.source) {
        return await this.buildFresh(workspaceRoot, snapshot, snapshotHash, embedder, options);
      }

      // Incremental path: existing index built with the same source.
      return await this.buildIncremental(workspaceRoot, existing, snapshot, snapshotHash, embedder, options);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      options.onProgress?.({ phase: 'error', detail: message });
      return { rebuilt: false, reason: /embed|ollama|network|fetch|unavailable/i.test(message) ? 'unavailable' : 'error', message, status: await this.status(workspaceRoot) };
    } finally {
      this.inFlight.delete(resolved);
    }
  }

  /** Debounced background refresh; coalesces bursts of edits into one rebuild. */
  scheduleIncremental(workspaceRoot: string): void {
    const key = path.resolve(workspaceRoot);
    const existing = this.debounceTimers.get(key);
    if (existing) clearTimeout(existing);
    this.debounceTimers.set(
      key,
      setTimeout(() => {
        this.debounceTimers.delete(key);
        void this.rebuild(workspaceRoot, {}).catch(() => undefined);
      }, DEBOUNCE_MS)
    );
    const timer = this.debounceTimers.get(key);
    if (timer && typeof timer.unref === 'function') timer.unref();
  }

  /** Embed the query and rank stored chunks by cosine similarity. */
  async search(workspaceRoot: string, query: string, limit = 8): Promise<SemanticHit[]> {
    const stored = await this.readIndex(workspaceRoot);
    if (!stored || stored.chunks.length === 0) return [];
    const embedder = await this.embedderFor(stored.manifest);
    const [qvec] = await embedder.embed([query]);
    const scored = stored.chunks.map((chunk) => ({
      chunk,
      score: cosine(qvec, stored.vectors[chunk.id] || [])
    }));
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map((s) => ({
      relPath: s.chunk.relPath,
      chunkIndex: s.chunk.chunkIndex,
      startLine: s.chunk.startLine,
      score: Number(s.score.toFixed(4)),
      snippet: s.chunk.text.replace(/\s+/g, ' ').trim().slice(0, 1200)
    }));
  }

  // ---------------------------------------------------------------- internals

  private async buildFresh(
    workspaceRoot: string,
    snapshot: SourceFileSnapshot[],
    snapshotHash: string,
    embedder: Embedder,
    options: { onProgress?: (e: { phase: string; detail?: string; done?: number; total?: number }) => void }
  ): Promise<RebuildIndexResult> {
    const chunks = await this.chunkAll(workspaceRoot, snapshot);
    const vectors = await this.embedChunks(chunks, embedder, options);
    const fileHashes: Record<string, string> = {};
    for (const f of snapshot) fileHashes[f.relPath] = f.hash;

    const manifest: IndexManifest = {
      v: SEMANTIC_INDEX_VERSION,
      source: embedder.source,
      model: embedder.model,
      dim: vectors.dim,
      builtAt: Date.now(),
      sourceSnapshotHash: snapshotHash,
      chunkCount: chunks.length,
      fileHashes
    };
    await this.writeIndex(workspaceRoot, { manifest, chunks, vectors: vectors.map });
    options.onProgress?.({ phase: 'done', done: chunks.length, total: chunks.length });
    return {
      rebuilt: true,
      reason: 'built',
      message: `${chunks.length} chunks via ${embedder.source}`,
      status: await this.status(workspaceRoot)
    };
  }

  private async buildIncremental(
    workspaceRoot: string,
    existing: StoredIndex,
    snapshot: SourceFileSnapshot[],
    snapshotHash: string,
    embedder: Embedder,
    options: { onProgress?: (e: { phase: string; detail?: string; done?: number; total?: number }) => void }
  ): Promise<RebuildIndexResult> {
    const previous: SourceFileSnapshot[] = Object.entries(existing.manifest.fileHashes).map(([relPath, hash]) => ({ relPath, hash, size: 0 }));
    const diff = diffSnapshots(previous, snapshot);
    const touched = new Set([...diff.added, ...diff.changed]);
    const removed = new Set(diff.removed);

    // Keep chunks whose file was neither touched nor removed.
    const keptChunks = existing.chunks.filter((c) => !touched.has(c.relPath) && !removed.has(c.relPath));
    const keptVectors: Record<string, number[]> = {};
    for (const c of keptChunks) keptVectors[c.id] = existing.vectors[c.id] || [];

    // (Re)chunk only the touched files.
    const toChunk = snapshot.filter((f) => touched.has(f.relPath));
    const freshChunks = await this.chunkAll(workspaceRoot, toChunk);
    options.onProgress?.({ phase: 'embed', detail: `${freshChunks.length} new chunks` });
    const fresh = await this.embedChunks(freshChunks, embedder, options);

    const chunks = [...keptChunks, ...freshChunks];
    const vectors = { ...keptVectors, ...fresh.map };
    if (chunks.length === 0) {
      return { rebuilt: false, reason: 'no-source', status: await this.status(workspaceRoot) };
    }

    const fileHashes: Record<string, string> = {};
    for (const f of snapshot) fileHashes[f.relPath] = f.hash;
    const manifest: IndexManifest = {
      v: SEMANTIC_INDEX_VERSION,
      source: embedder.source,
      model: embedder.model,
      dim: vectorsDim(vectors, chunks),
      builtAt: Date.now(),
      sourceSnapshotHash: snapshotHash,
      chunkCount: chunks.length,
      fileHashes
    };
    await this.writeIndex(workspaceRoot, { manifest, chunks, vectors });
    options.onProgress?.({ phase: 'done', done: chunks.length, total: chunks.length });
    return {
      rebuilt: true,
      reason: 'incremental',
      message: `+${diff.added.length}/~${diff.changed.length}/-${diff.removed.length} files`,
      status: await this.status(workspaceRoot)
    };
  }

  private async chunkAll(workspaceRoot: string, snapshot: SourceFileSnapshot[]): Promise<IndexChunk[]> {
    const resolved = path.resolve(workspaceRoot);
    const all: IndexChunk[] = [];
    for (const f of snapshot) {
      if (all.length >= INDEX_MAX_CHUNKS) break;
      const text = await readCapped(path.join(resolved, f.relPath));
      if (!text || !text.trim()) continue;
      const fileChunks = chunkFile(f.relPath, text, f.hash);
      for (const c of fileChunks) {
        if (all.length >= INDEX_MAX_CHUNKS) break;
        all.push(c);
      }
    }
    return all;
  }

  private async embedChunks(
    chunks: IndexChunk[],
    embedder: Embedder,
    options: { onProgress?: (e: { phase: string; detail?: string; done?: number; total?: number }) => void }
  ): Promise<{ map: Record<string, number[]>; dim: number }> {
    const map: Record<string, number[]> = {};
    let dim = embedder.dim;
    const BATCH = 32;
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH);
      const vecs = await embedder.embed(batch.map((c) => c.text));
      for (let j = 0; j < batch.length; j++) {
        map[batch[j].id] = vecs[j] || [];
        if (!dim && vecs[j]) dim = vecs[j].length;
      }
      options.onProgress?.({ phase: 'embed', done: Math.min(i + BATCH, chunks.length), total: chunks.length });
    }
    return { map, dim: dim || 0 };
  }

  private async embedderFor(manifest: IndexManifest): Promise<Embedder> {
    // Prefer the stored source; resolveEmbedder honors offline fallbacks.
    const embedder = await resolveEmbedder(manifest.source === 'ollama');
    if (embedder.source === manifest.source) return embedder;
    return embedder;
  }

  private async readIndex(workspaceRoot: string): Promise<StoredIndex | null> {
    try {
      const dir = this.indexDir(workspaceRoot);
      const manifestRaw = await fsp.readFile(path.join(dir, 'manifest.json'), 'utf-8');
      const chunksRaw = await fsp.readFile(path.join(dir, 'chunks.json'), 'utf-8');
      const vectorsRaw = await fsp.readFile(path.join(dir, 'vectors.json'), 'utf-8');
      return {
        manifest: JSON.parse(manifestRaw) as IndexManifest,
        chunks: JSON.parse(chunksRaw) as IndexChunk[],
        vectors: JSON.parse(vectorsRaw) as Record<string, number[]>
      };
    } catch {
      return null;
    }
  }

  private async writeIndex(workspaceRoot: string, index: StoredIndex): Promise<void> {
    const dir = this.indexDir(workspaceRoot);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'manifest.json'), JSON.stringify(index.manifest, null, 2), 'utf-8');
    await fsp.writeFile(path.join(dir, 'chunks.json'), JSON.stringify(index.chunks), 'utf-8');
    await fsp.writeFile(path.join(dir, 'vectors.json'), JSON.stringify(index.vectors), 'utf-8');
  }

  private async dropIndex(workspaceRoot: string): Promise<void> {
    try {
      await fsp.rm(this.indexDir(workspaceRoot), { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Split one file's text into overlapping line windows with stable ids. */
export function chunkFile(relPath: string, text: string, fileHash: string): IndexChunk[] {
  const lines = text.split(/\r?\n/);
  const chunks: IndexChunk[] = [];
  const step = Math.max(1, CHUNK_LINES - CHUNK_OVERLAP);
  for (let start = 0, idx = 0; start < lines.length && idx < MAX_CHUNKS_PER_FILE; start += step, idx++) {
    const slice = lines.slice(start, start + CHUNK_LINES);
    if (!slice.join('\n').trim()) continue;
    chunks.push({
      id: `${relPath}#${idx}`,
      relPath,
      chunkIndex: idx,
      startLine: start + 1,
      text: slice.join('\n').slice(0, 8000),
      fileHash
    });
  }
  return chunks;
}

function vectorsDim(vectors: Record<string, number[]>, chunks: IndexChunk[]): number {
  for (const c of chunks) {
    const v = vectors[c.id];
    if (v && v.length) return v.length;
  }
  return 0;
}

export const semanticIndexService = new SemanticIndexService();
