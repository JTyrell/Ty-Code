/**
 * Prompt C Step 3 — Local embedding providers.
 *
 * Supplies vectors for the semantic index from a STRICTLY LOCAL source only, chosen
 * at runtime in this precedence order and exposed behind a single `Embedder` seam:
 *
 *   ollama → Ollama's /api/embeddings on localhost (no key). Chosen when the daemon
 *            answers and exposes an embedding model.
 *   wasm   → an in-process transformers.js model, IF such a package is installed.
 *            Detected dynamically so this module never hard-depends on a heavy lib.
 *   token  → a deterministic hashed bag-of-tokens vector. Always available, fully
 *            offline, and good enough for renamed-concept recall that literal grep
 *            misses (shared identifier/keyword neighborhoods).
 *
 * There is NO cloud hop in any branch. Only the `ollama` path touches a socket, and
 * only on 127.0.0.1 / localhost.
 */

import type { EmbeddingSource } from '../../../shared/types/semantic';

const TOKEN_DIM = 512;

export interface Embedder {
  source: EmbeddingSource;
  model: string;
  dim: number;
  embed(texts: string[]): Promise<number[][]>;
}

/**
 * Attempts to build the best available embedder for this machine. Never throws:
 * the cheapest, dependency-free token embedder is the guaranteed final fallback.
 */
export async function resolveEmbedder(preferOllama = true): Promise<Embedder> {
  if (preferOllama) {
    const ollama = await tryOllama().catch(() => null);
    if (ollama) return ollama;
  }
  const wasm = await tryWasm().catch(() => null);
  if (wasm) return wasm;
  return tokenEmbedder();
}

// ---------------------------------------------------------------- Ollama ----

const OLLAMA_BASE = 'http://127.0.0.1:11434';

async function tryOllama(): Promise<Embedder | null> {
  // Fast probe of the tags endpoint; if Ollama isn't running this rejects quickly.
  const tagsRes = await fetch(`${OLLAMA_BASE}/api/tags`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(800)
  });
  if (!tagsRes.ok) return null;
  const data = (await tagsRes.json()) as { models?: Array<{ name: string }> };
  const names = (data.models || []).map((m) => m.name);
  // Prefer a model literally tagged as an embedding model; else a well-known default.
  const model = names.find((n) => /embed/i.test(n)) || (names.length ? null : null) || 'nomic-embed-text';
  if (!names.includes(model) && !names.some((n) => /embed/i.test(n))) {
    // No embedding model pulled locally → don't pretend; fall through.
    if (!names.includes(model)) return null;
  }

  return {
    source: 'ollama',
    model,
    dim: 0, // discovered on first embed
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (const text of texts) {
        const res = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model, prompt: text }),
          signal: AbortSignal.timeout(20_000)
        });
        if (!res.ok) throw new Error(`Ollama embeddings HTTP ${res.status}`);
        const json = (await res.json()) as { embedding?: number[] };
        if (!Array.isArray(json.embedding)) throw new Error('Ollama returned no embedding');
        out.push(json.embedding);
      }
      return out;
    }
  };
}

// ------------------------------------------------------------------ WASM ----

async function tryWasm(): Promise<Embedder | null> {
  // Dynamically import a transformers runtime only if the user installed one.
  // Absent the package, this rejects and we fall to the token embedder.
  let pipelineFactory: any;
  try {
    const mod = await import('@xenova/transformers' as string).catch(() => null);
    if (!mod || typeof (mod as any).pipeline !== 'function') return null;
    pipelineFactory = (mod as any).pipeline;
  } catch {
    return null;
  }

  const extractor = await pipelineFactory('feature-extraction', 'Xenova/all-MiniLM-L6-v2').catch(() => null);
  if (!extractor) return null;

  return {
    source: 'wasm',
    model: 'Xenova/all-MiniLM-L6-v2',
    dim: 384,
    async embed(texts: string[]): Promise<number[][]> {
      const out: number[][] = [];
      for (const text of texts) {
        const tensor = await extractor(text, { pooling: 'mean', normalize: true });
        out.push(Array.from(tensor.data as Float32Array));
      }
      return out;
    }
  };
}

// ----------------------------------------------------------------- token ----

/**
 * Deterministic hashed bag-of-tokens embedder. Tokens are hashed into a fixed
 * number of buckets with sublinear term weighting, then L2-normalized so cosine
 * similarity is meaningful. Stable across runs and machines — no model, no network.
 */
export function tokenEmbedder(dim = TOKEN_DIM): Embedder {
  return {
    source: 'token',
    model: `hashed-bag-of-tokens:${dim}`,
    dim,
    async embed(texts: string[]): Promise<number[][]> {
      return texts.map((t) => hashVector(t, dim));
    }
  };
}

function tokenize(text: string): string[] {
  // Split identifiers and camelCase/snake_case into sub-tokens so "renamedConcept"
  // shares buckets with "rename" and "concept".
  const raw = text
    .toLowerCase()
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .match(/[a-z0-9]+/g);
  return raw || [];
}

function hashVector(text: string, dim: number): number[] {
  const vec = new Float64Array(dim);
  const tf = new Map<string, number>();
  for (const tok of tokenize(text)) tf.set(tok, (tf.get(tok) || 0) + 1);
  for (const [tok, count] of tf) {
    // sublinear term weighting dampens very common tokens
    const weight = 1 + Math.log(count);
    const bucket = fnv1a(tok) % dim;
    vec[bucket] += weight;
    // also distribute on a second hash to reduce collisions
    const bucket2 = fnv1a(tok + '\u0001salt') % dim;
    vec[bucket2] += weight * 0.5;
  }
  // L2-normalize
  let norm = 0;
  for (let i = 0; i < dim; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm) || 1;
  const out = new Array<number>(dim);
  for (let i = 0; i < dim; i++) out[i] = vec[i] / norm;
  return out;
}

function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Cosine similarity for two equal-length vectors (assumed L2-normalized or not). */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}
