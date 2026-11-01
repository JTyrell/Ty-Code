/**
 * Chat Session Bus — the authoritative, per-workspace "which chat session is
 * active right now" register, and the seam that keeps it in sync across every
 * window without echo loops.
 *
 * Why this is separate from the WorkspaceSessionManager: that manager owns the
 * workspace/surface lifecycle under a strict schema with its own contract tests.
 * The active *chat session id* is a different, faster-moving concern shared by
 * the session store, the migration's in-flight preservation, and the sidecar
 * tabs. Coupling it into the surface schema would churn unrelated tests, so it
 * lives here and is broadcast over its own `chat-session:changed` channel.
 *
 * No-echo contract: `setActive` records state and notifies main-side listeners,
 * but it never itself talks to renderers. The IPC layer broadcasts the change to
 * every OTHER window while excluding the sender (it already knows), which is how
 * a rename in one window lands in another without bouncing back.
 */

import { EventEmitter } from 'node:events';

export interface ActiveSessionRecord {
  workspaceRoot: string;
  sessionId: string | null;
}

type Listener = (record: ActiveSessionRecord) => void;

export class ChatSessionBus {
  private emitter = new EventEmitter();
  private activeByWorkspace = new Map<string, string | null>();

  constructor() {
    // A workspace can have many concurrent subscribers (migration, IPC handlers).
    this.emitter.setMaxListeners(0);
  }

  getActive(workspaceRoot: string): string | null {
    return this.activeByWorkspace.get(workspaceRoot) ?? null;
  }

  /**
   * Set the active session for a workspace. Returns true only when the id
   * actually changed, so the IPC layer knows whether a broadcast is warranted.
   */
  setActive(workspaceRoot: string, sessionId: string | null): boolean {
    const normalizedRoot = (workspaceRoot || '').trim();
    if (!normalizedRoot) return false;
    const previous = this.activeByWorkspace.get(normalizedRoot) ?? null;
    if (previous === sessionId) return false;
    this.activeByWorkspace.set(normalizedRoot, sessionId);
    const record: ActiveSessionRecord = { workspaceRoot: normalizedRoot, sessionId };
    this.emitter.emit('changed', record);
    return true;
  }

  /** Main-side subscription (migration capture, watchers). Returns unsubscribe. */
  onChanged(listener: Listener): () => void {
    this.emitter.on('changed', listener);
    return () => this.emitter.off('changed', listener);
  }

  clear(workspaceRoot: string): void {
    this.activeByWorkspace.delete(workspaceRoot);
  }

  /** Test hook: drop all state + listeners between runs. */
  reset(): void {
    this.activeByWorkspace.clear();
    this.emitter.removeAllListeners();
  }
}

let defaultBus: ChatSessionBus | null = null;

export function getChatSessionBus(): ChatSessionBus {
  if (!defaultBus) defaultBus = new ChatSessionBus();
  return defaultBus;
}

export function resetChatSessionBusForTests(): void {
  defaultBus?.reset();
  defaultBus = null;
}
