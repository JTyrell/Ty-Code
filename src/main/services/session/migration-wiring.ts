/**
 * Migration wiring — binds the pure `runSessionMigration` to the real Electron
 * world. Kept out of `session-migration.ts` so that module stays Node-pure and
 * testable with injected fakes, and out of `index.ts` so boot stays readable.
 *
 * The two dependencies migration needs from live main are:
 *
 *  - getActiveSessionId: the active chat session for this workspace. On a fresh
 *    boot the Chat Session Bus is empty, so this returns null and migration simply
 *    imports every legacy record (Step 2), which already preserves agent todos
 *    verbatim. A non-null id only appears when migration runs against a live
 *    session (hot upgrade), and then Step 1 captures it FIRST and gates the rest.
 *
 *  - captureLiveSession: reads the LEGACY PLAINTEXT files directly from disk (the
 *    agent flat store and the workspace chat store) and assembles a full unified
 *    payload — todos, mode, messages, token usage — so an in-progress task's state
 *    survives the upgrade as a real payload, not a sidecar hint. It deliberately
 *    does NOT go through the (now encrypted) store adapters, because at migration
 *    time the only durable legacy state is the pre-upgrade plaintext. These reads
 *    are importers, never forward writers.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { SessionPayload } from '../../../shared/types/session-envelope';
import { getChatSessionBus } from './chat-session-bus';
import type { MigrationDeps, MigrationResult } from './session-migration';
import { runSessionMigration } from './session-migration';

const LEGACY_AGENT_ROOT = path.join(os.homedir(), '.tycode', 'sessions');

async function readJson(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Assemble a unified payload from the pre-upgrade plaintext for `activeSessionId`.
 * Returns null when neither legacy file exists (nothing live to preserve — not a
 * failure). Only throws if a record exists but is unreadable in a way that would
 * risk data loss, which aborts migration and leaves the legacy writers serving.
 */
async function captureLiveSessionFor(activeSessionId: string, workspaceRoot: string): Promise<SessionPayload | null> {
  const agentSafe = activeSessionId.replace(/[^\w.-]/g, '_');
  const chatSafe = activeSessionId.replace(/[^a-zA-Z0-9_-]/g, '_');

  const agentRec = await readJson(path.join(LEGACY_AGENT_ROOT, `${agentSafe}.json`));
  const chatRec =
    (await readJson(path.join(workspaceRoot, '.ty-code', 'sessions', `${chatSafe}.json`))) ??
    (await readJson(path.join(os.homedir(), '.ty-code', 'sessions', `${chatSafe}.json`)));

  if (!agentRec && !chatRec) return null;

  const now = Date.now();
  const chatMeta = (chatRec?.metadata ?? {}) as Record<string, unknown>;
  const createdAt = Number(chatMeta.createdAt ?? agentRec?.createdAt ?? now);
  const updatedAt = Math.max(Number(chatMeta.updatedAt ?? 0), Number(agentRec?.updatedAt ?? 0)) || now;

  const payload: SessionPayload = {
    sessionId: activeSessionId,
    workspacePath: String(chatMeta.workspacePath ?? agentRec?.workspacePath ?? path.resolve(workspaceRoot)),
    title: String(chatMeta.title ?? 'Restored Session'),
    agentMode: normalizeMode(String(chatMeta.agentMode ?? agentRec?.mode ?? 'build')),
    messages: Array.isArray(chatRec?.messages) ? (chatRec!.messages as SessionPayload['messages']) : [],
    todos: Array.isArray(agentRec?.todos) ? (agentRec!.todos as SessionPayload['todos']) : [],
    routeTrail: Array.isArray(agentRec?.recentToolCalls)
      ? (agentRec!.recentToolCalls as Array<Record<string, unknown>>)
      : [],
    checkpointRefs: [],
    subConversations: [],
    lockRouteId: null,
    totalTokensUsed: Number(chatMeta.totalTokensUsed ?? 0),
    contextLimit: Number(chatMeta.contextLimit ?? 128_000),
    compacted: Boolean(chatMeta.compacted ?? false),
    compactCount: Number(chatMeta.compactCount ?? 0),
    modifiedFiles: Array.isArray(chatMeta.modifiedFiles) ? (chatMeta.modifiedFiles as string[]) : [],
    createdAt,
    updatedAt,
    completed: agentRec?.completed === true ? true : undefined,
    agentIterationCount: Number(agentRec?.iterationCount ?? 0) || undefined,
    completionContract:
      agentRec?.completionContract && typeof agentRec.completionContract === 'object'
        ? (agentRec.completionContract as Record<string, unknown>)
        : undefined
  };
  return payload;
}

function normalizeMode(mode: string): SessionPayload['agentMode'] {
  if (mode === 'plan' || mode === 'build' || mode === 'execute' || mode === 'hybrid') return mode;
  return 'build';
}

export interface RunRealMigrationOptions {
  workspaceRoot: string;
}

export interface RealMigrationOutcome extends MigrationResult {
  skipped?: string;
}

/**
 * Kick off migration for a workspace. Safe to call on every boot: it is
 * idempotent (journal-gated) and aborts without touching originals if in-flight
 * capture fails.
 */
export async function runRealSessionMigration(opts: RunRealMigrationOptions): Promise<RealMigrationOutcome> {
  if (!opts.workspaceRoot) {
    return { aborted: false, imported: 0, quarantined: 0, alreadyDone: false, preservedActiveId: null, skipped: 'no-workspace' };
  }
  const bus = getChatSessionBus();
  const deps: MigrationDeps = {
    workspaceRoot: opts.workspaceRoot,
    getActiveSessionId: () => bus.getActive(opts.workspaceRoot),
    captureLiveSession: (activeSessionId: string) => captureLiveSessionFor(activeSessionId, opts.workspaceRoot)
  };
  return runSessionMigration(deps);
}
