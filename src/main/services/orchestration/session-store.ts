import { app } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { ChatMessage, ProposedDiff } from '../../../preload/types';
import type { AgentMode } from './tools/types';

function getUserDataPath(): string {
  try {
    if (app && typeof app.getPath === 'function') {
      return app.getPath('userData');
    }
  } catch {
    // fallback if app is not yet initialized
  }
  return process.env.APPDATA
    ? path.join(process.env.APPDATA, 'Ty-Code')
    : path.join(process.env.HOME || os.homedir(), '.ty-code');
}

function isAppOrSystemDir(dirPath: string): boolean {
  if (!dirPath || typeof dirPath !== 'string') return true;
  const normalized = path.resolve(dirPath).toLowerCase();
  const programFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase();
  const programFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase();
  if (normalized.startsWith(programFiles) || normalized.startsWith(programFilesX86)) {
    return true;
  }
  try {
    if (app && typeof app.getAppPath === 'function') {
      const appPath = path.resolve(app.getAppPath()).toLowerCase();
      if (normalized === appPath || normalized.startsWith(appPath)) return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function resolveSafeSessionsDir(workspaceRoot: string): string {
  if (!workspaceRoot || isAppOrSystemDir(workspaceRoot)) {
    return path.join(getUserDataPath(), 'sessions');
  }
  return path.join(workspaceRoot, '.ty-code', 'sessions');
}

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

export class SessionStore {
  private sessionsDir: string;

  constructor(private workspaceRoot: string) {
    this.sessionsDir = resolveSafeSessionsDir(workspaceRoot);
  }

  public setWorkspaceRoot(workspaceRoot: string): void {
    this.workspaceRoot = workspaceRoot;
    this.sessionsDir = resolveSafeSessionsDir(workspaceRoot);
  }

  private async ensureDir(): Promise<void> {
    try {
      await fs.mkdir(this.sessionsDir, { recursive: true });
    } catch {
      // Ignore if directory already exists
    }
  }

  private getSessionPath(sessionId: string): string {
    const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.sessionsDir, `${safeId}.json`);
  }

  public async saveSession(session: SessionData): Promise<void> {
    session.metadata.updatedAt = Date.now();
    try {
      await this.ensureDir();
      const filePath = this.getSessionPath(session.metadata.id);
      const tempPath = `${filePath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
      const serialized = JSON.stringify(session, null, 2);
      await fs.writeFile(tempPath, serialized, 'utf-8');
      await fs.rename(tempPath, filePath);
    } catch (primaryErr) {
      console.warn('[SessionStore] Could not save session to target dir, trying userData fallback:', primaryErr);
      try {
        const fallbackDir = path.join(getUserDataPath(), 'sessions');
        await fs.mkdir(fallbackDir, { recursive: true });
        const fallbackPath = path.join(fallbackDir, `${session.metadata.id.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
        const tempPath = `${fallbackPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
        await fs.writeFile(tempPath, JSON.stringify(session, null, 2), 'utf-8');
        await fs.rename(tempPath, fallbackPath);
      } catch (fallbackErr) {
        console.error('[SessionStore] Failed to save session to both target dir and userData fallback:', fallbackErr);
        // CRITICAL: NEVER throw an exception here. Session history write failure must never abort the active task or user stream!
      }
    }
  }

  public async loadSession(sessionId: string): Promise<SessionData | null> {
    try {
      const filePath = this.getSessionPath(sessionId);
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content) as SessionData;
    } catch {
      try {
        const fallbackPath = path.join(getUserDataPath(), 'sessions', `${sessionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.json`);
        const content = await fs.readFile(fallbackPath, 'utf-8');
        return JSON.parse(content) as SessionData;
      } catch {
        return null;
      }
    }
  }

  public async getOrCreateSession(
    sessionId?: string,
    initialOptions?: {
      title?: string;
      agentMode?: AgentMode;
      contextLimit?: number;
    }
  ): Promise<SessionData> {
    const id = sessionId || `session_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const existing = await this.loadSession(id);
    if (existing) {
      if (initialOptions?.agentMode && existing.metadata.agentMode !== initialOptions.agentMode) {
        existing.metadata.agentMode = initialOptions.agentMode;
      }
      return existing;
    }

    const newSession: SessionData = {
      metadata: {
        id,
        title: initialOptions?.title || 'New Coding Session',
        workspacePath: this.workspaceRoot,
        agentMode: initialOptions?.agentMode || 'build',
        createdAt: Date.now(),
        updatedAt: Date.now(),
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
    await this.ensureDir();
    try {
      const entries = await fs.readdir(this.sessionsDir, { withFileTypes: true });
      const sessions: SessionMetadata[] = [];
      for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.json')) {
          try {
            const raw = await fs.readFile(path.join(this.sessionsDir, entry.name), 'utf-8');
            const data = JSON.parse(raw) as SessionData;
            if (data?.metadata) {
              sessions.push(data.metadata);
            }
          } catch {
            // Skip invalid session files
          }
        }
      }
      return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  public async deleteSession(sessionId: string): Promise<boolean> {
    try {
      const filePath = this.getSessionPath(sessionId);
      await fs.unlink(filePath);
      return true;
    } catch {
      return false;
    }
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
    const session = await this.loadSession(sessionId);
    if (!session) return;

    if (!session.metadata.modifiedFiles.includes(filePath)) {
      session.metadata.modifiedFiles.push(filePath);
    }

    session.metadata.changeHistory.push({
      timestamp: Date.now(),
      filePath,
      diffId,
      description: description || `Modified ${filePath}`
    });

    await this.saveSession(session);
  }

  /**
   * Check if token usage approaches or exceeds the 95% threshold.
   */
  public checkAutoCompact(
    session: SessionData,
    additionalTokens = 0
  ): {
    shouldCompact: boolean;
    ratio: number;
    currentTokens: number;
    limit: number;
  } {
    const currentTokens = session.metadata.totalTokensUsed + additionalTokens;
    const limit = session.metadata.contextLimit || 128_000;
    const ratio = currentTokens / limit;
    return {
      shouldCompact: ratio >= 0.95,
      ratio,
      currentTokens,
      limit
    };
  }

  /**
   * Auto-compact conversation history when approaching 95% context window usage.
   * Compresses older turns and bulky tool outputs while preserving critical context.
   */
  public async autoCompactSession(session: SessionData): Promise<SessionData> {
    const { currentTokens, limit } = this.checkAutoCompact(session);
    const msgs = session.messages;

    if (msgs.length <= 3) {
      // Under minimum threshold to prune dialogue turns; condense tool outputs
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

    // Retain initial task description (first message) and last 3 active turns
    const firstMsg = msgs[0];
    const recentMsgs = msgs.slice(-3);

    // Prune bulky tool outputs in preserved messages
    for (const msg of recentMsgs) {
      if (msg.role === 'tool' && msg.content && msg.content.length > 400) {
        msg.content = msg.content.slice(0, 250) + '\n[Tool output compacted: operation verified]';
      }
    }

    const modifiedSummary = session.metadata.modifiedFiles.length > 0
      ? `\nActive modified files: ${session.metadata.modifiedFiles.join(', ')}`
      : '';

    const compactMarker: ChatMessage = {
      id: `compact_${Date.now()}`,
      role: 'system',
      content: `[Auto-compacted session history: context window reached 95% limit (${currentTokens}/${limit} tokens). Retaining key objective and recent turns.${modifiedSummary}]`,
      timestamp: Date.now()
    };

    session.messages = [firstMsg, compactMarker, ...recentMsgs];
    session.metadata.compacted = true;
    session.metadata.compactCount++;
    // Re-estimate token usage down to ~35% of context window
    session.metadata.totalTokensUsed = Math.floor(limit * 0.35);

    await this.saveSession(session);
    return session;
  }
}
