/**
 * UnifiedSessionStore — the ONE writer/reader for chat sessions.
 *
 *   ~/.tycode/sessions/{wsHash}/{sessionId}.json
 *     { v:1, cipher:'safeStorage', meta:<plaintext sidecar>, payload:<tagged base64> }
 *
 * Guarantees:
 *  - Listing never decrypts. `listSidecars`/`search` read only the `meta`
 *    sidecar, so the history browser renders with decryptionCount === 0.
 *  - A session decrypts at most once, then it is cached in RAM for the process
 *    lifetime (`secureOpen`).
 *  - Writes are debounced 800ms OFF the streaming path, atomic (tmp + rename),
 *    and flushed on demand. A kill mid-write leaves the prior version intact.
 *  - Payloads larger than MAX_INLINE_BYTES split their trailing messages into
 *    encrypted chunk files under the same envelope and reassemble on open.
 *  - There is never a plaintext fallback: if encryption is unavailable the write
 *    is refused (and recorded) rather than persisted in the clear.
 *
 * Migration-only readers of the legacy stores live in `session-migration.ts`,
 * not here. This module is the single forward writer.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  SESSION_ENVELOPE_VERSION,
  SessionEnvelopeSchema,
  SessionPayloadSchema,
  type OpenedSession,
  type SessionEnvelope,
  type SessionPayload,
  type SessionSidecar
} from '../../../shared/types/session-envelope';
import { decryptPayload, encryptJson, isEncryptionAvailable } from './session-crypto';

const SESSIONS_ROOT = path.join(os.homedir(), '.tycode', 'sessions');
const SAVE_DEBOUNCE_MS = 800;
const MAX_INLINE_BYTES = 4 * 1024 * 1024; // split threshold for the serialized payload
const CHUNK_TARGET_BYTES = 3 * 1024 * 1024; // keep each chunk comfortably under the cap

export function computeWsHash(workspaceRoot: string): string {
  const normalized = path.resolve(workspaceRoot || '').replace(/\\/g, '/').toLowerCase();
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

function safeFileName(sessionId: string): string {
  return sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function workspaceDir(workspaceRoot: string): string {
  return path.join(SESSIONS_ROOT, computeWsHash(workspaceRoot));
}

function sessionFilePath(workspaceRoot: string, sessionId: string): string {
  return path.join(workspaceDir(workspaceRoot), `${safeFileName(sessionId)}.json`);
}

function chunkFilePath(workspaceRoot: string, sessionId: string, n: number): string {
  return path.join(workspaceDir(workspaceRoot), `${safeFileName(sessionId)}.p${n}.json`);
}

function newSessionId(): string {
  return `session_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

async function atomicWrite(filePath: string, contents: string): Promise<void> {
  const tmpPath = `${filePath}.${process.pid}.${crypto.randomBytes(3).toString('hex')}.tmp`;
  await fs.writeFile(tmpPath, contents, 'utf-8');
  await fs.rename(tmpPath, filePath);
}

/** Turn a payload into the plaintext sidecar that ships alongside the blob. */
function sidecarOf(workspaceRoot: string, payload: SessionPayload): SessionSidecar {
  return {
    sessionId: payload.sessionId,
    wsHash: computeWsHash(workspaceRoot),
    title: payload.title,
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    messageCount: payload.messages.length,
    lockRouteId: payload.lockRouteId ?? null,
    agentMode: payload.agentMode,
    todoCount: payload.todos.length,
    totalTokensUsed: payload.totalTokensUsed,
    contextLimit: payload.contextLimit
  };
}

export interface CreateSessionOptions {
  title?: string;
  agentMode?: SessionPayload['agentMode'];
  contextLimit?: number;
  lockRouteId?: string | null;
}

export class UnifiedSessionStore {
  /** sessionId -> decrypted payload, cached for the process lifetime. */
  private cache = new Map<string, SessionPayload>();
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWrites = new Map<string, { workspaceRoot: string; payload: SessionPayload }>();
  /** Instrumentation the tests assert on: opens that actually ran a decrypt. */
  private decryptCount = 0;
  private writeFailures = 0;

  resetInstrumentation(): void {
    this.decryptCount = 0;
    this.writeFailures = 0;
  }
  getDecryptionCount(): number {
    return this.decryptCount;
  }
  getWriteFailureCount(): number {
    return this.writeFailures;
  }

  async ensureWorkspaceDir(workspaceRoot: string): Promise<string> {
    const dir = workspaceDir(workspaceRoot);
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  buildEmptyPayload(workspaceRoot: string, opts: CreateSessionOptions = {}): SessionPayload {
    const now = Date.now();
    const sessionId = newSessionId();
    return {
      sessionId,
      workspacePath: path.resolve(workspaceRoot || ''),
      title: opts.title?.trim() || 'New Coding Session',
      agentMode: opts.agentMode || 'build',
      messages: [],
      todos: [],
      routeTrail: [],
      checkpointRefs: [],
      subConversations: [],
      lockRouteId: opts.lockRouteId ?? null,
      totalTokensUsed: 0,
      contextLimit: opts.contextLimit || 128_000,
      compacted: false,
      compactCount: 0,
      modifiedFiles: [],
      createdAt: now,
      updatedAt: now
    };
  }

  async createSession(workspaceRoot: string, opts: CreateSessionOptions = {}): Promise<SessionPayload> {
    const payload = this.buildEmptyPayload(workspaceRoot, opts);
    await this.writeNow(workspaceRoot, payload);
    this.cache.set(payload.sessionId, payload);
    return payload;
  }

  /**
   * Schedule a debounced encrypted rewrite off the streaming critical path.
   * Never throws to the caller — a persistence failure must not abort a turn.
   */
  saveSession(workspaceRoot: string, payload: SessionPayload): void {
    payload.updatedAt = Date.now();
    this.cache.set(payload.sessionId, payload);
    this.pendingWrites.set(payload.sessionId, { workspaceRoot, payload });
    if (this.writeTimers.has(payload.sessionId)) return;
    const timer = setTimeout((sessionId: string) => {
      this.writeTimers.delete(sessionId);
      const pending = this.pendingWrites.get(sessionId);
      this.pendingWrites.delete(sessionId);
      if (!pending) return;
      void this.writeNow(pending.workspaceRoot, pending.payload).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS, payload.sessionId);
    this.writeTimers.set(payload.sessionId, timer);
  }

  /** Immediate atomic encrypted write. Refuses (throws) if storage unavailable. */
  async writeNow(workspaceRoot: string, payload: SessionPayload): Promise<void> {
    if (!isEncryptionAvailable()) {
      this.writeFailures++;
      throw new Error('secure storage unavailable: refusing to persist an unencrypted session');
    }
    await this.ensureWorkspaceDir(workspaceRoot);
    const meta = sidecarOf(workspaceRoot, payload);

    const fullJson = JSON.stringify(payload);
    if (fullJson.length > MAX_INLINE_BYTES) {
      await this.writeSplit(workspaceRoot, meta, payload, fullJson);
      return;
    }

    const envelope: SessionEnvelope = {
      v: SESSION_ENVELOPE_VERSION,
      cipher: 'safeStorage',
      meta,
      payload: encryptJson(payload),
      chunks: { count: 0, dir: '' }
    };
    await atomicWrite(sessionFilePath(workspaceRoot, payload.sessionId), JSON.stringify(envelope, null, 2));
  }

  /**
   * Split path: keep the leading messages inline and spill the tail into a run
   * of encrypted chunk files. Each chunk envelope's payload is a JSON array of
   * messages. `secureOpen` reassembles them in order.
   */
  private async writeSplit(workspaceRoot: string, meta: SessionSidecar, payload: SessionPayload, _fullJson: string): Promise<void> {
    // Partition messages so the head envelope stays under the cap.
    const headMessages: unknown[] = [];
    let headBytes = 0;
    const tail: unknown[] = [];
    for (const msg of payload.messages) {
      const size = JSON.stringify(msg).length;
      if (headBytes + size <= CHUNK_TARGET_BYTES) {
        headMessages.push(msg);
        headBytes += size;
      } else {
        tail.push(msg);
      }
    }

    const headPayload = { ...payload, messages: headMessages as SessionPayload['messages'] };
    const headEnvelope: SessionEnvelope = {
      v: SESSION_ENVELOPE_VERSION,
      cipher: 'safeStorage',
      meta,
      payload: encryptJson(headPayload),
      chunks: null
    };

    // Chunk the tail.
    const chunkGroups: unknown[][] = [];
    let current: unknown[] = [];
    let currentBytes = 0;
    for (const msg of tail) {
      const size = JSON.stringify(msg).length;
      if (currentBytes + size > CHUNK_TARGET_BYTES && current.length > 0) {
        chunkGroups.push(current);
        current = [];
        currentBytes = 0;
      }
      current.push(msg);
      currentBytes += size;
    }
    if (current.length > 0) chunkGroups.push(current);

    for (let i = 0; i < chunkGroups.length; i++) {
      const chunkEnvelope = {
        v: SESSION_ENVELOPE_VERSION,
        cipher: 'safeStorage',
        payload: encryptJson(chunkGroups[i])
      };
      await atomicWrite(chunkFilePath(workspaceRoot, payload.sessionId, i + 1), JSON.stringify(chunkEnvelope));
    }
    // Clean up stale higher-numbered chunks from a previous, longer write.
    for (let i = chunkGroups.length + 1; i <= chunkGroups.length + 8; i++) {
      try {
        await fs.unlink(chunkFilePath(workspaceRoot, payload.sessionId, i));
      } catch {
        break;
      }
    }

    headEnvelope.chunks = { count: chunkGroups.length, dir: workspaceDir(workspaceRoot) };
    await atomicWrite(sessionFilePath(workspaceRoot, payload.sessionId), JSON.stringify(headEnvelope, null, 2));
  }

  /** Read ONLY the sidecar. Never decrypts. */
  async listSidecars(workspaceRoot: string): Promise<SessionSidecar[]> {
    const dir = workspaceDir(workspaceRoot);
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      return [];
    }
    const out: SessionSidecar[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json') || entry.includes('.p')) continue;
      const meta = await this.readSidecar(path.join(dir, entry));
      if (meta) out.push(meta);
    }
    out.sort((a, b) => b.updatedAt - a.updatedAt);
    return out;
  }

  private async readSidecar(filePath: string): Promise<SessionSidecar | null> {
    try {
      const raw = await fs.readFile(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      const envelope = SessionEnvelopeSchema.safeParse(parsed);
      if (envelope.success) return envelope.data.meta;
      // Head envelopes carry `chunks`; a legacy/plain file without meta is skipped.
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Open a session: decrypt once, validate, RAM-cache. A decrypt failure still
   * returns the sidecar marked `locked` (never crashes, never plaintext).
   */
  async secureOpen(workspaceRoot: string, sessionId: string): Promise<OpenedSession | null> {
    const cached = this.cache.get(sessionId);
    if (cached) {
      return { locked: false, meta: sidecarOf(workspaceRoot, cached), payload: cached };
    }
    const filePath = sessionFilePath(workspaceRoot, sessionId);
    let envelopeRaw: string;
    try {
      envelopeRaw = await fs.readFile(filePath, 'utf-8');
    } catch {
      return null;
    }
    const envelopeParse = SessionEnvelopeSchema.safeParse(JSON.parse(envelopeRaw) as unknown);
    if (!envelopeParse.success) {
      return null;
    }
    const envelope = envelopeParse.data;

    this.decryptCount++;
    const decrypted = decryptPayload<unknown>(envelope.payload);
    if (!decrypted.ok) {
      return { locked: true, meta: envelope.meta, reason: decrypted.reason };
    }

    let payload = SessionPayloadSchema.safeParse(decrypted.data);
    if (!payload.success) {
      return { locked: true, meta: envelope.meta, reason: 'dpapi-mismatch' };
    }
    let resolved = payload.data;

    // Reassemble split transcript chunks, if any.
    if (envelope.chunks && envelope.chunks.count > 0) {
      const allMessages = [...resolved.messages];
      for (let i = 1; i <= envelope.chunks.count; i++) {
        try {
          const chunkRaw = await fs.readFile(chunkFilePath(workspaceRoot, sessionId, i), 'utf-8');
          const chunkEnvelope = JSON.parse(chunkRaw) as { payload?: string };
          if (!chunkEnvelope.payload) break;
          this.decryptCount++;
          const chunkDecrypted = decryptPayload<unknown[]>(chunkEnvelope.payload);
          if (!chunkDecrypted.ok) break;
          if (Array.isArray(chunkDecrypted.data)) allMessages.push(...(chunkDecrypted.data as SessionPayload['messages']));
        } catch {
          break;
        }
      }
      resolved = { ...resolved, messages: allMessages };
      payload = SessionPayloadSchema.safeParse(resolved);
      if (!payload.success) return { locked: true, meta: envelope.meta, reason: 'dpapi-mismatch' };
      resolved = payload.data;
    }

    this.cache.set(sessionId, resolved);
    return { locked: false, meta: envelope.meta, payload: resolved };
  }

  /**
   * Read-modify-write a session off the streaming path. Opens (or, when absent,
   * creates) the payload, applies `mutate`, and schedules the usual debounced
   * encrypted save. This is the single mutation seam both the agent runtime (todos
   * /mode) and the chat runtime (messages/token usage) write through, so neither
   * ever touches plaintext disk. Never throws to the caller on the debounce; a
   * missing session with no mutate is a no-op.
   */
  async patchSession(
    workspaceRoot: string,
    sessionId: string,
    mutate: (payload: SessionPayload) => void,
    createSeed?: CreateSessionOptions
  ): Promise<SessionPayload> {
    const existing = await this.secureOpen(workspaceRoot, sessionId);
    let payload: SessionPayload;
    if (existing && !existing.locked) {
      payload = existing.payload;
    } else {
      // Fresh session: build a seed then mutate it.
      payload = this.buildEmptyPayload(workspaceRoot, { ...(createSeed ?? {}), title: createSeed?.title });
      // Force the id so callers that pre-mint a sessionId keep their own id.
      payload = { ...payload, sessionId };
    }
    mutate(payload);
    this.saveSession(workspaceRoot, payload);
    return payload;
  }

  async renameSession(workspaceRoot: string, sessionId: string, title: string): Promise<SessionPayload | null> {
    const opened = await this.secureOpen(workspaceRoot, sessionId);
    if (!opened || opened.locked) return null;
    const updated: SessionPayload = { ...opened.payload, title: title.trim() || opened.payload.title, updatedAt: Date.now() };
    await this.writeNow(workspaceRoot, updated);
    this.cache.set(sessionId, updated);
    return updated;
  }

  async deleteSession(workspaceRoot: string, sessionId: string): Promise<boolean> {
    this.cache.delete(sessionId);
    const timer = this.writeTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.writeTimers.delete(sessionId);
      this.pendingWrites.delete(sessionId);
    }
    let removed = false;
    try {
      await fs.unlink(sessionFilePath(workspaceRoot, sessionId));
      removed = true;
    } catch {
      /* main file may be absent */
    }
    // Remove any chunk files.
    for (let i = 1; i <= 64; i++) {
      try {
        await fs.unlink(chunkFilePath(workspaceRoot, sessionId, i));
      } catch {
        break;
      }
    }
    return removed;
  }

  /**
   * Fork a session at a message boundary: the new session inherits everything
   * up to and including `uptoMessageId`, with a fresh id and a "(fork)" title.
   */
  async forkFromMessage(workspaceRoot: string, sessionId: string, uptoMessageId: string): Promise<SessionPayload | null> {
    const opened = await this.secureOpen(workspaceRoot, sessionId);
    if (!opened || opened.locked) return null;
    const src = opened.payload;
    const idx = src.messages.findIndex((m) => (m as { id?: string }).id === uptoMessageId);
    const cut = idx >= 0 ? idx : src.messages.length - 1;
    const now = Date.now();
    const forked: SessionPayload = {
      ...src,
      sessionId: newSessionId(),
      title: `${src.title} (fork)`,
      messages: src.messages.slice(0, cut + 1),
      subConversations: [],
      checkpointRefs: [],
      createdAt: now,
      updatedAt: now,
      completed: false
    };
    await this.writeNow(workspaceRoot, forked);
    this.cache.set(forked.sessionId, forked);
    return forked;
  }

  /** Search across sidecar titles (no decryption). */
  async search(workspaceRoot: string, query: string): Promise<SessionSidecar[]> {
    const sidecars = await this.listSidecars(workspaceRoot);
    const q = query.toLowerCase().trim();
    if (!q) return sidecars;
    return sidecars.filter((s) => s.title.toLowerCase().includes(q) || s.sessionId.toLowerCase().includes(q));
  }

  /** Flush every pending write immediately (window close / app quit). */
  async flushOnExit(): Promise<void> {
    for (const timer of this.writeTimers.values()) clearTimeout(timer);
    this.writeTimers.clear();
    const pending = [...this.pendingWrites.values()];
    this.pendingWrites.clear();
    await Promise.all(
      pending.map(async ({ workspaceRoot, payload }) => {
        try {
          await this.writeNow(workspaceRoot, payload);
        } catch {
          this.writeFailures++;
        }
      })
    );
  }

  /** Persist a payload built externally (e.g. the migration importer). */
  async importSession(workspaceRoot: string, payload: SessionPayload): Promise<void> {
    const validated = SessionPayloadSchema.parse(payload);
    await this.writeNow(workspaceRoot, validated);
    this.cache.set(validated.sessionId, validated);
  }
}

export const unifiedSessionStore = new UnifiedSessionStore();
