/**
 * Session migration — one-shot upgrade into the unified encrypted store.
 *
 * Runs on first launch after upgrade. The order is deliberate and load-bearing:
 *
 *  1. IN-FLIGHT PRESERVATION (gates everything). If the workspace-session bus
 *     reports an active session id, we capture the LIVE agent state — todos,
 *     route trail, checkpoint refs, and the message buffer — and write it as the
 *     FIRST encrypted payload before touching anything else. Migration is
 *     BLOCKED until this succeeds: if capture or write throws, we abort, the
 *     journal stays `pending`, and the legacy writers keep serving the session
 *     (the rollback safety net). This is what guarantees an in-progress task's
 *     todos survive the upgrade verbatim, as a full payload — not a sidecar hint.
 *  2. Legacy imports — the flat agent store (~/.tycode/sessions/{id}.json) and
 *     the workspace chat store ({workspaceRoot}/.ty-code/sessions/{id}.json) are
 *     imported into the new store.
 *  3. Quarantine — imported originals are MOVED to ~/.tycode/sessions/quarantine
 *     (never deleted by migration). The workspace chat dir is removed once empty
 *     so user repos stay clean.
 *
 * The whole run is idempotent and resumable: a journal records the preserved
 * active id and the set of imported ids, so a relaunch skips completed work and
 * only finishes the remainder. Any per-file failure leaves that original in
 * place to retry next launch.
 *
 * Legacy READ logic lives here and ONLY here. The old writers are gone.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionPayload } from '../../../shared/types/session-envelope';
import { unifiedSessionStore, type UnifiedSessionStore } from './unified-session-store';

const SESSIONS_ROOT = path.join(os.homedir(), '.tycode', 'sessions');
const JOURNAL_PATH = path.join(SESSIONS_ROOT, '.migration-state.json');
const QUARANTINE_DIR = path.join(SESSIONS_ROOT, 'quarantine');
const QUARANTINE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type Journal = {
  version: 1;
  phase: 'pending' | 'done';
  preservedActiveId: string | null;
  importedIds: string[];
};

/** The flat agent-session record (mirrors the deprecated agent session-store). */
interface LegacyAgentRecord {
  sessionId: string;
  workspacePath: string;
  mode: 'plan' | 'execute' | 'hybrid';
  todos: unknown[];
  iterationCount: number;
  recentToolCalls: Array<{ tool: string; timestamp: number }>;
  createdAt: number;
  updatedAt: number;
  completed?: boolean;
  completionContract?: unknown;
}

/** The workspace chat-session record (mirrors the deprecated orchestration store). */
interface LegacyChatRecord {
  metadata: {
    id: string;
    title: string;
    workspacePath: string;
    agentMode: string;
    createdAt: number;
    updatedAt: number;
    totalTokensUsed: number;
    contextLimit: number;
    compacted: boolean;
    compactCount: number;
    modifiedFiles: string[];
  };
  messages: unknown[];
}

export interface MigrationDeps {
  store?: UnifiedSessionStore;
  workspaceRoot: string;
  /** Active chat session id from the workspace-session bus (null when none). */
  getActiveSessionId: () => string | null;
  /**
   * Capture the live agent state for the active session as a full payload. This
   * is the ONLY path that reads mutable agent memory, so it is injected rather
   * than imported (keeps migration out of the engine's module graph). Returning
   * null means "nothing live to preserve"; throwing means "abort migration".
   */
  captureLiveSession: (activeSessionId: string) => Promise<SessionPayload | null>;
}

export interface MigrationResult {
  aborted: boolean;
  reason?: string;
  preservedActiveId?: string | null;
  imported: number;
  quarantined: number;
  alreadyDone: boolean;
}

function emptyJournal(): Journal {
  return { version: 1, phase: 'pending', preservedActiveId: null, importedIds: [] };
}

async function readJournal(): Promise<Journal> {
  try {
    const raw = await fs.readFile(JOURNAL_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Journal;
    if (parsed && Array.isArray(parsed.importedIds)) {
      return { version: 1, phase: parsed.phase === 'done' ? 'done' : 'pending', preservedActiveId: parsed.preservedActiveId ?? null, importedIds: parsed.importedIds };
    }
  } catch {
    /* no journal yet */
  }
  return emptyJournal();
}

async function writeJournal(journal: Journal): Promise<void> {
  await fs.mkdir(SESSIONS_ROOT, { recursive: true });
  const tmp = `${JOURNAL_PATH}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(journal, null, 2), 'utf-8');
  await fs.rename(tmp, JOURNAL_PATH);
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

/** Top-level legacy agent files only: direct .json children, excluding the new per-wsHash dirs. */
async function listLegacyAgentFiles(): Promise<string[]> {
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(SESSIONS_ROOT, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.endsWith('.json') && !e.name.startsWith('.'))
    .map((e) => path.join(SESSIONS_ROOT, e.name));
}

async function listLegacyChatFiles(workspaceRoot: string): Promise<string[]> {
  const dir = path.join(workspaceRoot, '.ty-code', 'sessions');
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.filter((e) => e.isFile() && e.name.endsWith('.json')).map((e) => path.join(dir, e.name));
}

function toAgentPayload(rec: LegacyAgentRecord): SessionPayload {
  const now = Date.now();
  return {
    sessionId: rec.sessionId,
    workspacePath: rec.workspacePath,
    title: 'Imported agent session',
    agentMode: rec.mode === 'execute' ? 'execute' : rec.mode === 'plan' ? 'plan' : 'hybrid',
    messages: [],
    todos: Array.isArray(rec.todos) ? (rec.todos as SessionPayload['todos']) : [],
    routeTrail: (rec.recentToolCalls || []).map((t) => ({ tool: t.tool, timestamp: t.timestamp })),
    checkpointRefs: [],
    subConversations: [],
    lockRouteId: null,
    totalTokensUsed: 0,
    contextLimit: 128_000,
    compacted: false,
    compactCount: 0,
    modifiedFiles: [],
    createdAt: rec.createdAt || now,
    updatedAt: rec.updatedAt || now,
    completed: rec.completed === true
  };
}

function toChatPayload(rec: LegacyChatRecord): SessionPayload {
  const now = Date.now();
  const mode = (['plan', 'build', 'execute', 'hybrid'] as const).includes(rec.metadata.agentMode as never)
    ? (rec.metadata.agentMode as SessionPayload['agentMode'])
    : 'build';
  return {
    sessionId: rec.metadata.id,
    workspacePath: rec.metadata.workspacePath,
    title: rec.metadata.title || 'Imported chat session',
    agentMode: mode,
    messages: Array.isArray(rec.messages) ? (rec.messages as SessionPayload['messages']) : [],
    todos: [],
    routeTrail: [],
    checkpointRefs: [],
    subConversations: [],
    lockRouteId: null,
    totalTokensUsed: rec.metadata.totalTokensUsed || 0,
    contextLimit: rec.metadata.contextLimit || 128_000,
    compacted: rec.metadata.compacted || false,
    compactCount: rec.metadata.compactCount || 0,
    modifiedFiles: Array.isArray(rec.metadata.modifiedFiles) ? rec.metadata.modifiedFiles : [],
    createdAt: rec.metadata.createdAt || now,
    updatedAt: rec.metadata.updatedAt || now
  };
}

/** Merge a chat payload's messages/metadata with an agent payload's todos/route trail by id. */
function mergePayloads(chat: SessionPayload, agent: SessionPayload): SessionPayload {
  return {
    ...agent,
    title: chat.title && chat.title !== 'Imported chat session' ? chat.title : agent.title,
    workspacePath: chat.workspacePath || agent.workspacePath,
    messages: chat.messages.length ? chat.messages : agent.messages,
    todos: agent.todos.length ? agent.todos : chat.todos,
    routeTrail: agent.routeTrail.length ? agent.routeTrail : chat.routeTrail,
    totalTokensUsed: chat.totalTokensUsed || agent.totalTokensUsed,
    contextLimit: chat.contextLimit || agent.contextLimit,
    compacted: chat.compacted,
    compactCount: chat.compactCount,
    modifiedFiles: chat.modifiedFiles,
    createdAt: Math.min(agent.createdAt, chat.createdAt),
    updatedAt: Math.max(agent.updatedAt, chat.updatedAt),
    completed: agent.completed || chat.completed
  };
}

async function quarantine(filePath: string): Promise<void> {
  await fs.mkdir(QUARANTINE_DIR, { recursive: true });
  const base = path.basename(filePath);
  const marker = path.dirname(filePath).replace(/^.*[\\/]/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
  const dest = path.join(QUARANTINE_DIR, `${marker}__${base}`);
  await fs.rename(filePath, dest);
}

/**
 * Run the migration. Safe to call every launch: it returns immediately when the
 * journal is `done`. The active-session preservation is gated FIRST and will
 * abort (leaving legacy writers authoritative) if it cannot capture + write.
 */
export async function runSessionMigration(deps: MigrationDeps): Promise<MigrationResult> {
  const store = deps.store ?? unifiedSessionStore;
  const journal = await readJournal();
  if (journal.phase === 'done') {
    return { aborted: false, preservedActiveId: journal.preservedActiveId, imported: 0, quarantined: 0, alreadyDone: true };
  }

  // ---- Step 1: in-flight preservation (blocks everything downstream) --------
  const activeId = deps.getActiveSessionId();
  if (activeId && journal.preservedActiveId !== activeId) {
    try {
      const live = await deps.captureLiveSession(activeId);
      if (live) {
        await store.importSession(live.workspacePath || deps.workspaceRoot, live);
      }
      journal.preservedActiveId = activeId;
      await writeJournal(journal);
    } catch (err) {
      // Abort: originals stay untouched and the legacy writers keep serving.
      return { aborted: true, reason: err instanceof Error ? err.message : String(err), preservedActiveId: journal.preservedActiveId, imported: 0, quarantined: 0, alreadyDone: false };
    }
  }

  const importedIds = new Set(journal.importedIds);
  let imported = 0;
  let quarantined = 0;

  // ---- Step 2a: legacy workspace chat store ---------------------------------
  const pendingBySession = new Map<string, SessionPayload>();
  const chatFiles = await listLegacyChatFiles(deps.workspaceRoot);
  const chatPathsById = new Map<string, string>();
  for (const file of chatFiles) {
    try {
      const rec = JSON.parse(await fs.readFile(file, 'utf-8')) as LegacyChatRecord;
      if (!rec?.metadata?.id || importedIds.has(rec.metadata.id)) continue;
      const payload = toChatPayload(rec);
      pendingBySession.set(payload.sessionId, payload);
      chatPathsById.set(payload.sessionId, file);
    } catch {
      /* leave for next launch */
    }
  }

  // ---- Step 2b: legacy flat agent store -------------------------------------
  const agentFiles = await listLegacyAgentFiles();
  const agentPathsById = new Map<string, string>();
  for (const file of agentFiles) {
    try {
      const rec = JSON.parse(await fs.readFile(file, 'utf-8')) as LegacyAgentRecord;
      if (!rec?.sessionId || !Array.isArray(rec.todos)) continue;
      if (rec.sessionId === journal.preservedActiveId) continue; // already preserved live
      const agentPayload = toAgentPayload(rec);
      const existing = pendingBySession.get(agentPayload.sessionId);
      pendingBySession.set(agentPayload.sessionId, existing ? mergePayloads(existing, agentPayload) : agentPayload);
      agentPathsById.set(agentPayload.sessionId, file);
    } catch {
      /* ignore */
    }
  }

  // ---- Step 3: write + quarantine -------------------------------------------
  for (const [sessionId, payload] of pendingBySession) {
    try {
      await store.importSession(payload.workspacePath || deps.workspaceRoot, payload);
      importedIds.add(sessionId);
      imported++;
      journal.importedIds = [...importedIds];
      await writeJournal(journal);

      const chatFile = chatPathsById.get(sessionId);
      const agentFile = agentPathsById.get(sessionId);
      if (chatFile && (await exists(chatFile))) {
        await quarantine(chatFile);
        quarantined++;
      }
      if (agentFile && (await exists(agentFile))) {
        await quarantine(agentFile);
        quarantined++;
      }
    } catch {
      // Leave this original in place; it retries next launch.
      continue;
    }
  }

  // Remove the workspace chat dir once it holds no remaining session files.
  const remainingChat = await listLegacyChatFiles(deps.workspaceRoot);
  if (remainingChat.length === 0) {
    try {
      await fs.rm(path.join(deps.workspaceRoot, '.ty-code', 'sessions'), { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  }

  const remainingAgent = await listLegacyAgentFiles();
  if (remainingAgent.length === 0 && remainingChat.length === 0) {
    journal.phase = 'done';
    await writeJournal(journal);
  }

  return { aborted: false, preservedActiveId: journal.preservedActiveId, imported, quarantined, alreadyDone: false };
}

/** Purge quarantined originals older than the TTL. Wired to a manual action too. */
export async function purgeQuarantine(olderThanMs = QUARANTINE_TTL_MS): Promise<number> {
  let files: string[];
  try {
    files = (await fs.readdir(QUARANTINE_DIR)).map((f) => path.join(QUARANTINE_DIR, f));
  } catch {
    return 0;
  }
  const cutoff = Date.now() - olderThanMs;
  let removed = 0;
  for (const file of files) {
    try {
      const stat = await fs.stat(file);
      if (stat.mtimeMs < cutoff) {
        await fs.unlink(file);
        removed++;
      }
    } catch {
      /* ignore */
    }
  }
  return removed;
}

export const migrationPaths = { SESSIONS_ROOT, JOURNAL_PATH, QUARANTINE_DIR };
