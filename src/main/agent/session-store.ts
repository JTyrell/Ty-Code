/**
 * Agent session state — now a thin adapter over the unified encrypted store.
 *
 * Historically this wrote a plaintext `~/.tycode/sessions/{id}.json`. The unified
 * store is the single forward writer, so agent runtime state (todos, mode,
 * iteration, recent tool calls, completion contract) is folded into the SAME
 * encrypted `SessionPayload` the chat writes to — via `patchSession`, a
 * read-modify-write that never clobbers the other subsystem's fields.
 *
 * There is NO plaintext path here anymore. If secure storage is unavailable the
 * unified store refuses to write and records a failure; agent state simply stays
 * in memory for the run rather than leaking to disk in the clear.
 *
 * `loadSession`/`deleteSession` take a `workspaceRoot` because the unified store
 * shards by `wsHash(workspaceRoot)`. `listSummaries` reads only sidecars, so it
 * enumerates sessions (title/mode/todo count/updated) without a single decrypt.
 */

import path from 'node:path';
import type { CompletionContractState, TodoItem } from './agent-state-manager';
import { unifiedSessionStore, type UnifiedSessionStore } from '../services/session/unified-session-store';
import type { SessionPayload } from '../../shared/types/session-envelope';

export type AgentSessionMode = 'plan' | 'execute' | 'hybrid';

export interface AgentSessionState {
  sessionId: string;
  workspacePath: string;
  mode: AgentSessionMode;
  todos: TodoItem[];
  iterationCount: number;
  recentToolCalls: Array<{ tool: string; timestamp: number }>;
  createdAt: number;
  updatedAt: number;
  completed?: boolean;
  completionContract?: CompletionContractState;
}

export interface AgentSessionSummary {
  sessionId: string;
  workspacePath: string;
  mode: AgentSessionMode;
  todoCount: number;
  updatedAt: number;
}

function toAgentMode(mode: SessionPayload['agentMode']): AgentSessionMode {
  if (mode === 'plan' || mode === 'hybrid' || mode === 'execute') return mode;
  return 'execute';
}

function toSessionMode(mode: AgentSessionMode): SessionPayload['agentMode'] {
  // 'build' is a chat-side default; agent modes map onto plan/execute/hybrid.
  return mode;
}

function payloadToAgentState(payload: SessionPayload, workspaceRoot: string): AgentSessionState {
  return {
    sessionId: payload.sessionId,
    workspacePath: payload.workspacePath || path.resolve(workspaceRoot),
    mode: toAgentMode(payload.agentMode),
    todos: (payload.todos ?? []) as unknown as TodoItem[],
    iterationCount: payload.agentIterationCount ?? 0,
    recentToolCalls: (payload.agentToolCalls ?? []).map((t) => ({ tool: t.tool, timestamp: t.timestamp })),
    createdAt: payload.createdAt,
    updatedAt: payload.updatedAt,
    completed: payload.completed,
    completionContract: payload.completionContract as CompletionContractState | undefined
  };
}

export class SessionStore {
  constructor(private readonly store: UnifiedSessionStore = unifiedSessionStore) {}

  /** No timers/intervals to unwind now that persistence is delegated. */
  dispose(): void {
    /* intentionally empty — the unified store owns the debounce timers. */
  }

  /** Fold an agent snapshot into the encrypted payload; never writes plaintext. */
  saveSession(state: AgentSessionState): void {
    void this.store
      .patchSession(
        state.workspacePath,
        state.sessionId,
        (payload) => {
          payload.todos = state.todos as unknown as Record<string, unknown>[];
          payload.agentMode = toSessionMode(state.mode);
          payload.agentIterationCount = state.iterationCount;
          payload.agentToolCalls = state.recentToolCalls.map((t) => ({ tool: t.tool, timestamp: t.timestamp }));
          if (state.completionContract) {
            payload.completionContract = state.completionContract as unknown as Record<string, unknown>;
          }
          if (state.completed) payload.completed = true;
          if (state.updatedAt) payload.updatedAt = state.updatedAt;
        },
        { agentMode: toSessionMode(state.mode) }
      )
      .catch(() => undefined);
  }

  /** Immediate (non-debounced) persist, used at task-completion boundaries. */
  async persistNow(state: AgentSessionState): Promise<void> {
    await this.store.patchSession(
      state.workspacePath,
      state.sessionId,
      (payload) => {
        payload.todos = state.todos as unknown as Record<string, unknown>[];
        payload.agentMode = toSessionMode(state.mode);
        payload.agentIterationCount = state.iterationCount;
        payload.agentToolCalls = state.recentToolCalls.map((t) => ({ tool: t.tool, timestamp: t.timestamp }));
        if (state.completionContract) {
          payload.completionContract = state.completionContract as unknown as Record<string, unknown>;
        }
        if (state.completed) payload.completed = true;
      },
      { agentMode: toSessionMode(state.mode) }
    );
    // Force the debounced write to land now.
    await this.store.flushOnExit();
  }

  async loadSession(sessionId: string, workspaceRoot: string): Promise<AgentSessionState | null> {
    if (!workspaceRoot) return null;
    const opened = await this.store.secureOpen(workspaceRoot, sessionId);
    if (!opened || opened.locked) return null;
    return payloadToAgentState(opened.payload, workspaceRoot);
  }

  /** Enumerate a workspace's sessions from sidecars only — zero decryption. */
  async listSummaries(workspaceRoot: string, limit = 20): Promise<AgentSessionSummary[]> {
    if (!workspaceRoot) return [];
    const sidecars = await this.store.listSidecars(workspaceRoot);
    return sidecars.slice(0, Math.max(1, limit)).map((s) => ({
      sessionId: s.sessionId,
      workspacePath: path.resolve(workspaceRoot),
      mode: toAgentMode(s.agentMode ?? 'execute'),
      todoCount: s.todoCount ?? 0,
      updatedAt: s.updatedAt
    }));
  }

  /** Back-compat shim: returns state-shaped rows built from sidecars (no transcript). */
  async listSessions(limit: number = 20, workspaceRoot?: string): Promise<AgentSessionState[]> {
    if (!workspaceRoot) return [];
    const summaries = await this.listSummaries(workspaceRoot, limit);
    return summaries.map((s) => ({
      sessionId: s.sessionId,
      workspacePath: s.workspacePath,
      mode: s.mode,
      todos: new Array(s.todoCount) as unknown as TodoItem[],
      iterationCount: 0,
      recentToolCalls: [],
      createdAt: s.updatedAt,
      updatedAt: s.updatedAt
    }));
  }

  async deleteSession(sessionId: string, workspaceRoot: string): Promise<void> {
    if (!workspaceRoot) return;
    await this.store.deleteSession(workspaceRoot, sessionId);
  }

  /** No-op: TTL cleanup is obsolete now that originals are quarantined by migration. */
  async cleanupExpired(): Promise<number> {
    return 0;
  }
}

export function buildSessionSnapshot(
  sessionId: string,
  workspacePath: string,
  state: {
    currentMode: AgentSessionMode;
    todos: TodoItem[];
    iterationCount: number;
    toolCallHistory: Array<{ tool: string; timestamp: number }>;
    completionContract?: CompletionContractState | null;
  },
  createdAt?: number,
  completed?: boolean
): AgentSessionState {
  const now = Date.now();
  return {
    sessionId,
    workspacePath,
    mode: state.currentMode,
    todos: state.todos,
    iterationCount: state.iterationCount,
    recentToolCalls: state.toolCallHistory.slice(-20),
    ...(state.completionContract ? { completionContract: state.completionContract } : {}),
    createdAt: createdAt ?? now,
    updatedAt: now,
    ...(completed === true ? { completed: true } : {})
  };
}

export const sessionStore = new SessionStore();
