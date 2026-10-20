import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import type { TodoItem } from './agent-state-manager';

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
}

const SESSIONS_DIR = path.join(os.homedir(), '.tycode', 'sessions');
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SAVE_DEBOUNCE_MS = 1_500;
const LIST_LIMIT_DEFAULT = 10;

function sessionFilePath(sessionId: string): string {
  return path.join(SESSIONS_DIR, `${sessionId.replace(/[^\w.-]/g, '_')}.json`);
}

export class SessionStore {
  private writeTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingWrites = new Map<string, AgentSessionState>();
  private readonly bootCleanup: ReturnType<typeof setTimeout>;

  constructor() {
    this.bootCleanup = setTimeout(() => {
      void this.cleanupExpired().catch(() => undefined);
    }, 5_000);
  }

  dispose(): void {
    clearTimeout(this.bootCleanup);
    for (const timer of this.writeTimers.values()) clearTimeout(timer);
    this.writeTimers.clear();
  }

  saveSession(state: AgentSessionState): void {
    this.pendingWrites.set(state.sessionId, state);
    if (this.writeTimers.has(state.sessionId)) return;
    const timer = setTimeout((sessionId: string) => {
      this.writeTimers.delete(sessionId);
      const pending = this.pendingWrites.get(sessionId);
      this.pendingWrites.delete(sessionId);
      if (!pending) return;
      void this.writeSession(pending).catch(() => undefined);
    }, SAVE_DEBOUNCE_MS, state.sessionId);
    this.writeTimers.set(state.sessionId, timer);
  }

  async writeSession(state: AgentSessionState): Promise<void> {
    await fs.mkdir(SESSIONS_DIR, { recursive: true });
    const filePath = sessionFilePath(state.sessionId);
    const tmpPath = `${filePath}.${process.pid}.tmp`;
    await fs.writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tmpPath, filePath);
  }

  async loadSession(sessionId: string): Promise<AgentSessionState | null> {
    try {
      const raw = await fs.readFile(sessionFilePath(sessionId), 'utf-8');
      const parsed = JSON.parse(raw) as AgentSessionState;
      if (!parsed || typeof parsed.sessionId !== 'string' || !Array.isArray(parsed.todos)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  async listSessions(limit: number = LIST_LIMIT_DEFAULT): Promise<AgentSessionState[]> {
    await this.cleanupExpired();
    let entries: string[];
    try {
      entries = await fs.readdir(SESSIONS_DIR);
    } catch {
      return [];
    }
    const sessions: AgentSessionState[] = [];
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      try {
        const raw = await fs.readFile(path.join(SESSIONS_DIR, entry), 'utf-8');
        const parsed = JSON.parse(raw) as AgentSessionState;
        if (parsed && typeof parsed.sessionId === 'string' && typeof parsed.updatedAt === 'number') {
          sessions.push(parsed);
        }
      } catch {
        continue;
      }
    }
    sessions.sort((a, b) => b.updatedAt - a.updatedAt);
    return sessions.slice(0, Math.max(1, limit));
  }

  async deleteSession(sessionId: string): Promise<void> {
    try {
      await fs.unlink(sessionFilePath(sessionId));
    } catch {
      return;
    }
  }

  async cleanupExpired(): Promise<number> {
    let removed = 0;
    let entries: string[];
    try {
      entries = await fs.readdir(SESSIONS_DIR);
    } catch {
      return 0;
    }
    const cutoff = Date.now() - SESSION_TTL_MS;
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const filePath = path.join(SESSIONS_DIR, entry);
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filePath);
          removed++;
        }
      } catch {
        continue;
      }
    }
    return removed;
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
    createdAt: createdAt ?? now,
    updatedAt: now,
    ...(completed === true ? { completed: true } : {})
  };
}

export const sessionStore = new SessionStore();
