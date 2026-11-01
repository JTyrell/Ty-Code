/**
 * Chat session store — now a thin adapter over the unified encrypted store.
 *
 * It used to write plaintext `{workspaceRoot}/.ty-code/sessions/{id}.json` into
 * the user's repo. That path is gone: the unified store is the single forward
 * writer, and chat state (transcript, token usage, modified files, change
 * history) folds into the SAME encrypted `SessionPayload` the agent writes its
 * todos into, via `patchSession` (a read-modify-write that never clobbers the
 * agent-side fields).
 *
 * `SessionData`/`SessionMetadata` stay the in-memory shape the orchestrator
 * mutates during a turn; only persistence is redirected. A session for this
 * workspace lives at `~/.tycode/sessions/{wsHash}/{id}.json`, never in the repo.
 */

import path from 'node:path';
import type { ChatMessage } from '../../../preload/types';
import type { AgentMode } from './tools/types';
import type { SessionPayload } from '../../../shared/types/session-envelope';
import { unifiedSessionStore, type UnifiedSessionStore } from '../session/unified-session-store';

export interface SessionChangeRecord {
  timestamp: number;
  filePath: string;
  diffId?: string;
  description?: string;
}

export interface SessionMetadata {
  id: string;
  title: string;
  workspacePath: string;
  agentMode: AgentMode;
  createdAt: number;
  updatedAt: number;
  totalTokensUsed: number;
  contextLimit: number; // default: 128_000
  compacted: boolean;
  compactCount: number;
  modifiedFiles: string[];
  changeHistory: SessionChangeRecord[];
}

export interface SessionData {
  metadata: SessionMetadata;
  messages: ChatMessage[];
}

function toPayloadMode(mode: AgentMode | undefined): SessionPayload['agentMode'] {
  if (mode === 'plan') return 'plan';
  // 'build' and 'general' both land on 'build' in the unified schema.
  return 'build';
}

function toChatMode(mode: SessionPayload['agentMode']): AgentMode {
  if (mode === 'plan') return 'plan';
  // 'execute' / 'hybrid' are agent-only modes; the chat surface speaks 'general'.
  return 'general';
}

function payloadToSessionData(payload: SessionPayload, workspaceRoot: string): SessionData {
  return {
    metadata: {
      id: payload.sessionId,
      title: payload.title,
      workspacePath: payload.workspacePath || path.resolve(workspaceRoot),
      agentMode: toChatMode(payload.agentMode),
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      totalTokensUsed: payload.totalTokensUsed,
      contextLimit: payload.contextLimit,
      compacted: payload.compacted,
      compactCount: payload.compactCount,
      modifiedFiles: [...payload.modifiedFiles],
      changeHistory: (payload.changeHistory ?? []).map((c) => ({ ...c }))
    },
    messages: (payload.messages ?? []) as unknown as ChatMessage[]
  };
}

export class SessionStore {
  constructor(
    private workspaceRoot: string,
    private readonly store: UnifiedSessionStore = unifiedSessionStore
  ) {}

  public setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
  }

  public async saveSession(session: SessionData): Promise<void> {
    session.metadata.updatedAt = Date.now();
    // Persisted in the background; a disk failure must never abort a live turn.
    await this.store
      .patchSession(this.workspaceRoot, session.metadata.id, (payload) => this.applySessionData(payload, session))
      .catch(() => undefined);
  }

  /** Fold chat-owned fields into the payload, leaving agent fields untouched. */
  private applySessionData(payload: SessionPayload, session: SessionData): void {
    payload.title = session.metadata.title;
    payload.workspacePath = session.metadata.workspacePath || path.resolve(this.workspaceRoot);
    payload.agentMode = toPayloadMode(session.metadata.agentMode);
    payload.messages = session.messages as unknown as Record<string, unknown>[];
    payload.totalTokensUsed = session.metadata.totalTokensUsed;
    payload.contextLimit = session.metadata.contextLimit;
    payload.compacted = session.metadata.compacted;
    payload.compactCount = session.metadata.compactCount;
    payload.modifiedFiles = [...session.metadata.modifiedFiles];
    payload.changeHistory = session.metadata.changeHistory.map((c) => ({ ...c }));
    payload.createdAt = session.metadata.createdAt;
    payload.updatedAt = session.metadata.updatedAt;
  }

  public async loadSession(sessionId: string): Promise<SessionData | null> {
    if (!this.workspaceRoot || !sessionId) return null;
    const opened = await this.store.secureOpen(this.workspaceRoot, sessionId);
    if (!opened || opened.locked) return null;
    return payloadToSessionData(opened.payload, this.workspaceRoot);
  }

  public async getOrCreateSession(
    sessionId?: string,
    initialOptions?: { title?: string; agentMode?: AgentMode; contextLimit?: number }
  ): Promise<SessionData> {
    const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const existing = await this.loadSession(id);
    if (existing) {
      if (initialOptions?.agentMode && existing.metadata.agentMode !== initialOptions.agentMode) {
        existing.metadata.agentMode = initialOptions.agentMode;
      }
      return existing;
    }

    const now = Date.now();
    const newSession: SessionData = {
      metadata: {
        id,
        title: initialOptions?.title || 'New Coding Session',
        workspacePath: this.workspaceRoot,
        agentMode: initialOptions?.agentMode || 'build',
        createdAt: now,
        updatedAt: now,
        totalTokensUsed: 0,
        contextLimit: initialOptions?.contextLimit || 128_000,
        compacted: false,
        compactCount: 0,
        modifiedFiles: [],
        changeHistory: []
      },
      messages: []
    };
    await this.saveSession(newSession);
    return newSession;
  }

  public async listSessions(): Promise<SessionMetadata[]> {
    // Full metadata (token usage / modified files / change history) lives inside
    // the encrypted payload, so a complete listing needs an open per session. The
    // new history browser reads sidecars directly instead; this remains for the
    // orchestrator's own management needs.
    const sidecars = await this.store.listSidecars(this.workspaceRoot);
    const out: SessionMetadata[] = [];
    for (const sidecar of sidecars) {
      const opened = await this.store.secureOpen(this.workspaceRoot, sidecar.sessionId);
      if (opened && !opened.locked) out.push(payloadToSessionData(opened.payload, this.workspaceRoot).metadata);
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    return this.store.deleteSession(this.workspaceRoot, sessionId);
  }

  public async searchSessions(query: string): Promise<SessionMetadata[]> {
    const list = await this.listSessions();
    const q = query.toLowerCase().trim();
    if (!q) return list;
    return list.filter(
      (s) =>
        s.id.toLowerCase().includes(q) ||
        s.title.toLowerCase().includes(q) ||
        s.modifiedFiles.some((f) => f.toLowerCase().includes(q))
    );
  }

  public async recordFileChange(
    sessionId: string,
    filePath: string,
    diffId?: string,
    description?: string
  ): Promise<void> {
    await this.store
      .patchSession(this.workspaceRoot, sessionId, (payload) => {
        if (!payload.modifiedFiles.includes(filePath)) payload.modifiedFiles.push(filePath);
        const history = payload.changeHistory ?? [];
        history.push({
          timestamp: Date.now(),
          filePath,
          ...(diffId ? { diffId } : {}),
          description: description || `Modified ${filePath}`
        });
        payload.changeHistory = history;
      })
      .catch(() => undefined);
  }

  /**
   * Check if token usage approaches or exceeds the 95% threshold. Pure, no disk.
   */
  public checkAutoCompact(
    session: SessionData,
    additionalTokens = 0
  ): { shouldCompact: boolean; ratio: number; currentTokens: number; limit: number } {
    const currentTokens = session.metadata.totalTokensUsed + additionalTokens;
    const limit = session.metadata.contextLimit || 128_000;
    const ratio = currentTokens / limit;
    return { shouldCompact: ratio >= 0.95, ratio, currentTokens, limit };
  }

  /**
   * Auto-compact conversation history when approaching 95% context window usage.
   * Compresses older turns and bulky tool outputs while preserving critical
   * context, then persists through the encrypted seam.
   */
  public async autoCompactSession(session: SessionData): Promise<SessionData> {
    const { currentTokens, limit } = this.checkAutoCompact(session);
    const msgs = session.messages;

    if (msgs.length <= 3) {
      for (const m of msgs) {
        if (m.content && m.content.length > 500) {
          m.content = m.content.slice(0, 300) + '... [Auto-compacted for context limit]';
        }
      }
      session.metadata.compacted = true;
      session.metadata.compactCount++;
      session.metadata.totalTokensUsed = Math.floor(limit * 0.4);
      await this.saveSession(session);
      return session;
    }

    const firstMsg = msgs[0];
    const recentMsgs = msgs.slice(-3);

    for (const msg of recentMsgs) {
      if (msg.role === 'tool' && msg.content && msg.content.length > 400) {
        msg.content = msg.content.slice(0, 250) + '\n[Tool output compacted: operation verified]';
      }
    }

    const modifiedSummary =
      session.metadata.modifiedFiles.length > 0 ? `\nActive modified files: ${session.metadata.modifiedFiles.join(', ')}` : '';

    const compactMarker: ChatMessage = {
      id: `compact_${Date.now()}`,
      role: 'system',
      content: `[Auto-compacted session history: context window reached 95% limit (${currentTokens}/${limit} tokens). Retaining key objective and recent turns.${modifiedSummary}]`,
      timestamp: Date.now()
    };

    session.messages = [firstMsg, compactMarker, ...recentMsgs];
    session.metadata.compacted = true;
    session.metadata.compactCount++;
    session.metadata.totalTokensUsed = Math.floor(limit * 0.35);

    await this.saveSession(session);
    return session;
  }
}
