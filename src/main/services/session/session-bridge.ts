/**
 * Browser Session Seam & SessionBridge (Phase FCC-5)
 *
 * Defines the canonical SessionBridge interface (start/attach/stream/pause/resume/dispose)
 * and provides a local implementation ready for future Cloudflare-hosted Web-IDE connectivity.
 *
 * Rules:
 * - Clean interface + local implementation + contract tests
 * - Zero web-client code shipped yet (interface seam + contract only)
 *
 * Brand: Ty-Code
 */

import { EventEmitter } from 'node:events';

export type SessionClientType = 'local-ide' | 'web-browser' | 'cli-bridge' | 'external-editor';
export type SessionStatus = 'idle' | 'streaming' | 'paused' | 'disposed';
export type ChunkType = 'token' | 'thought' | 'tool_call' | 'tool_result' | 'notice' | 'error' | 'done';

export interface SessionBridgeOptions {
  sessionId: string;
  workspaceRoot: string;
  clientType?: SessionClientType;
  metadata?: Record<string, unknown>;
}

export interface SessionBridgeInfo {
  sessionId: string;
  workspaceRoot: string;
  clientType: SessionClientType;
  status: SessionStatus;
  subscriberCount: number;
  createdAt: number;
  lastActiveAt: number;
  tokensStreamed: number;
  turnCount: number;
}

export interface SessionStreamChunk {
  type: ChunkType;
  sessionId: string;
  chunkIndex: number;
  content?: string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

export interface SessionStreamOptions {
  model?: string;
  provider?: string;
  systemPrompt?: string;
  temperature?: number;
}

export interface SessionBridge {
  start(options: SessionBridgeOptions): Promise<SessionBridgeInfo>;
  attach(sessionId: string, onChunk: (chunk: SessionStreamChunk) => void): Promise<() => void>;
  stream(sessionId: string, prompt: string, options?: SessionStreamOptions): AsyncIterable<SessionStreamChunk>;
  pause(sessionId: string): Promise<boolean>;
  resume(sessionId: string): Promise<boolean>;
  dispose(sessionId: string): Promise<boolean>;
  getSession(sessionId: string): SessionBridgeInfo | undefined;
  listSessions(): SessionBridgeInfo[];
}

interface InternalSessionState {
  info: SessionBridgeInfo;
  emitter: EventEmitter;
  subscribers: Set<(chunk: SessionStreamChunk) => void>;
  isPaused: boolean;
  pausePromise: Promise<void> | null;
  resumeResolve: (() => void) | null;
  chunkCounter: number;
}

export class LocalSessionBridge implements SessionBridge {
  private static instance: LocalSessionBridge | null = null;
  private sessions: Map<string, InternalSessionState> = new Map();

  public static getInstance(): LocalSessionBridge {
    if (!LocalSessionBridge.instance) {
      LocalSessionBridge.instance = new LocalSessionBridge();
    }
    return LocalSessionBridge.instance;
  }

  /**
   * Initializes a new session
   */
  public async start(options: SessionBridgeOptions): Promise<SessionBridgeInfo> {
    const existing = this.sessions.get(options.sessionId);
    if (existing && existing.info.status !== 'disposed') {
      return { ...existing.info };
    }

    const info: SessionBridgeInfo = {
      sessionId: options.sessionId,
      workspaceRoot: options.workspaceRoot,
      clientType: options.clientType || 'local-ide',
      status: 'idle',
      subscriberCount: 0,
      createdAt: Date.now(),
      lastActiveAt: Date.now(),
      tokensStreamed: 0,
      turnCount: 0
    };

    const state: InternalSessionState = {
      info,
      emitter: new EventEmitter(),
      subscribers: new Set(),
      isPaused: false,
      pausePromise: null,
      resumeResolve: null,
      chunkCounter: 0
    };

    this.sessions.set(options.sessionId, state);
    return { ...info };
  }

  /**
   * Attaches a listener/subscriber to an active session
   */
  public async attach(
    sessionId: string,
    onChunk: (chunk: SessionStreamChunk) => void
  ): Promise<() => void> {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status === 'disposed') {
      throw new Error(`Session ${sessionId} not found or already disposed`);
    }

    session.subscribers.add(onChunk);
    session.info.subscriberCount = session.subscribers.size;

    return () => {
      session.subscribers.delete(onChunk);
      session.info.subscriberCount = session.subscribers.size;
    };
  }

  /**
   * Streams an AI turn through the session bridge
   */
  public async *stream(
    sessionId: string,
    prompt: string,
    options?: SessionStreamOptions
  ): AsyncIterable<SessionStreamChunk> {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status === 'disposed') {
      throw new Error(`Session ${sessionId} is not active`);
    }

    session.info.status = 'streaming';
    session.info.lastActiveAt = Date.now();
    session.info.turnCount++;

    const broadcastChunk = (type: ChunkType, content?: string, metadata?: Record<string, unknown>): SessionStreamChunk => {
      session.chunkCounter++;
      const chunk: SessionStreamChunk = {
        type,
        sessionId,
        chunkIndex: session.chunkCounter,
        content,
        metadata,
        timestamp: Date.now()
      };

      for (const subscriber of session.subscribers) {
        try {
          subscriber(chunk);
        } catch {
          // non-blocking
        }
      }

      return chunk;
    };

    // Notice chunk
    const startNotice = broadcastChunk('notice', undefined, {
      message: `Session streaming turn ${session.info.turnCount} via ${options?.model || 'auto'}`
    });
    yield startNotice;

    // Simulate/generate token chunks with pause checks
    const responseWords = `Ty-Code SessionBridge response for workspace "${session.info.workspaceRoot}". Processed prompt: "${prompt}". Ready for future Cloudflare Web-IDE integration.`.split(' ');

    for (let i = 0; i < responseWords.length; i++) {
      // Check pause gate
      if (session.isPaused && session.pausePromise) {
        session.info.status = 'paused';
        yield broadcastChunk('notice', undefined, { state: 'paused' });
        await session.pausePromise;
        session.info.status = 'streaming';
        yield broadcastChunk('notice', undefined, { state: 'resumed' });
      }

      const word = (i === 0 ? '' : ' ') + responseWords[i];
      const tokenChunk = broadcastChunk('token', word);
      session.info.tokensStreamed += Math.max(1, Math.round(word.length / 3.8));
      yield tokenChunk;

      // Small async tick
      await new Promise((r) => setTimeout(r, 8));
    }

    // Done chunk
    const doneChunk = broadcastChunk('done', undefined, {
      tokensStreamed: session.info.tokensStreamed,
      turn: session.info.turnCount
    });
    session.info.status = 'idle';
    session.info.lastActiveAt = Date.now();
    yield doneChunk;
  }

  /**
   * Pauses an in-progress stream
   */
  public async pause(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status === 'disposed') return false;

    if (!session.isPaused) {
      session.isPaused = true;
      session.info.status = 'paused';
      session.pausePromise = new Promise((resolve) => {
        session.resumeResolve = resolve;
      });
      return true;
    }
    return false;
  }

  /**
   * Resumes a paused stream
   */
  public async resume(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || session.info.status === 'disposed') return false;

    if (session.isPaused && session.resumeResolve) {
      session.isPaused = false;
      session.info.status = 'streaming';
      session.resumeResolve();
      session.pausePromise = null;
      session.resumeResolve = null;
      return true;
    }
    return false;
  }

  /**
   * Disposes of an active session and unsubscribes all listeners
   */
  public async dispose(sessionId: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session) return false;

    session.info.status = 'disposed';
    session.info.lastActiveAt = Date.now();
    session.subscribers.clear();
    session.info.subscriberCount = 0;

    if (session.isPaused && session.resumeResolve) {
      session.resumeResolve();
    }

    this.sessions.delete(sessionId);
    return true;
  }

  public getSession(sessionId: string): SessionBridgeInfo | undefined {
    const session = this.sessions.get(sessionId);
    return session ? { ...session.info } : undefined;
  }

  public listSessions(): SessionBridgeInfo[] {
    return Array.from(this.sessions.values()).map((s) => ({ ...s.info }));
  }
}

export const localSessionBridge = LocalSessionBridge.getInstance();
