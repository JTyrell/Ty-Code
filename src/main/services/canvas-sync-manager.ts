/**
 * Canvas Sync Manager (M3E Canvas overhaul)
 *
 * Shared context bridge between the dedicated M3E Canvas window and the main
 * IDE window:
 * - activePlatform: target UI framework for generated layouts
 * - canvasComponents: JSON tree of UI nodes sketched in the canvas
 * - sharedConversationHistory: chat history shared by both windows
 *
 * All IPC payloads are validated with Zod. Handlers:
 * - 'canvas:update-state'  Canvas window pushes state edits -> broadcast to Main
 * - 'canvas:request-state' A (re)opened Canvas window pulls the current state
 * - 'main:sync-message'    Either side appends a chat message -> history + broadcast
 */

import type { IpcMainInvokeEvent } from 'electron';
import type { WebContents } from 'electron';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const CanvasPlatformSchema = z.enum(['react', 'flutter', 'swiftui', 'web', 'other']);
export type CanvasPlatform = z.infer<typeof CanvasPlatformSchema>;

const CanvasComponentNodeSchema: z.ZodType<CanvasComponentNode> = z.lazy(() =>
  z.object({
    id: z.string().min(1),
    type: z.string().min(1).max(64),
    name: z.string().max(120).optional(),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(CanvasComponentNodeSchema).optional()
  })
);

export interface CanvasComponentNode {
  id: string;
  type: string;
  name?: string;
  props?: Record<string, unknown>;
  children?: CanvasComponentNode[];
}

export const CanvasMessageSchema = z.object({
  id: z.string().min(1),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string().max(100_000),
  timestamp: z.number().int().nonnegative(),
  origin: z.enum(['canvas', 'main']).default('canvas')
});
export type CanvasMessage = z.infer<typeof CanvasMessageSchema>;

export const CanvasUpdateStatePayloadSchema = z.object({
  activePlatform: CanvasPlatformSchema.optional(),
  canvasComponents: z.array(CanvasComponentNodeSchema).max(2_000).optional(),
  reason: z.string().max(200).optional()
});
export type CanvasUpdateStatePayload = z.infer<typeof CanvasUpdateStatePayloadSchema>;

export const CanvasSendMessagePayloadSchema = z.object({
  message: CanvasMessageSchema
});
export type CanvasSendMessagePayload = z.infer<typeof CanvasSendMessagePayloadSchema>;

export interface CanvasSnapshot {
  activePlatform: CanvasPlatform;
  canvasComponents: CanvasComponentNode[];
  sharedConversationHistory: CanvasMessage[];
  updatedAt: number;
}

export interface CanvasAgentEventPayload {
  runId: string;
  type: 'token' | 'status' | 'done' | 'error';
  content?: string;
}

export interface CanvasUpdateNotificationPayload {
  action: string;
  codeSnippet?: string;
  platform?: string;
  updatedAt?: number;
}

export interface IpcResult<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export type TrustedSenderCheck = (event: IpcMainInvokeEvent) => boolean;

const HISTORY_CAP = 500;

export class CanvasSyncManager {
  private activePlatform: CanvasPlatform = 'react';
  private canvasComponents: CanvasComponentNode[] = [];
  private sharedConversationHistory: CanvasMessage[] = [];
  private updatedAt = Date.now();
  private windowResolver: (() => WebContents[]) | null = null;
  private isTrustedSender: TrustedSenderCheck | null = null;
  private registered = false;

  attachWindowResolver(resolver: () => WebContents[]): void {
    this.windowResolver = resolver;
  }

  setTrustedSenderCheck(check: TrustedSenderCheck): void {
    this.isTrustedSender = check;
  }

  getSnapshot(): CanvasSnapshot {
    return {
      activePlatform: this.activePlatform,
      canvasComponents: this.canvasComponents,
      sharedConversationHistory: [...this.sharedConversationHistory],
      updatedAt: this.updatedAt
    };
  }

  applyUpdate(payload: CanvasUpdateStatePayload): void {
    if (payload.activePlatform !== undefined) this.activePlatform = payload.activePlatform;
    if (payload.canvasComponents !== undefined) this.canvasComponents = payload.canvasComponents;
    this.updatedAt = Date.now();
  }

  /**
   * Main-process convenience (used by the canvas agent engine): apply an
   * update and broadcast the fresh snapshot to every listening window.
   * Equivalent to a renderer calling 'canvas:update-state'.
   */
  pushStateUpdate(payload: CanvasUpdateStatePayload, exclude?: WebContents): CanvasSnapshot {
    this.applyUpdate(payload);
    const snapshot = this.getSnapshot();
    this.broadcast('canvas:state-synced', snapshot, exclude);
    return snapshot;
  }

  /** Main-process convenience: append + broadcast a chat message ('main:sync-message' equivalent). */
  pushMessage(message: CanvasMessage, exclude?: WebContents): CanvasMessage {
    const ensured: CanvasMessage = {
      ...message,
      origin: message.origin === 'main' ? 'main' : 'canvas'
    };
    this.appendMessage(ensured);
    this.broadcast('canvas:message-synced', ensured, exclude);
    return ensured;
  }

  /** Agent run streaming event (tokens/status/done/error), broadcast for the Canvas chat UI. */
  pushAgentEvent(event: CanvasAgentEventPayload, exclude?: WebContents): void {
    this.broadcast('canvas:agent-event', event, exclude);
  }

  /** Notify the main IDE window chat that the canvas changed ('canvas:main-chat-update'). */
  pushMainChatUpdate(update: CanvasUpdateNotificationPayload, exclude?: WebContents): void {
    this.broadcast('canvas:main-chat-update', update, exclude);
  }

  appendMessage(message: CanvasMessage): void {
    // Drop exact duplicates (id collision) instead of double-appending echoes.
    if (this.sharedConversationHistory.some((m) => m.id === message.id)) return;
    this.sharedConversationHistory.push(message);
    if (this.sharedConversationHistory.length > HISTORY_CAP) {
      this.sharedConversationHistory = this.sharedConversationHistory.slice(-HISTORY_CAP);
    }
    this.updatedAt = Date.now();
  }

  private broadcast(channel: string, payload: unknown, exclude?: WebContents): void {
    let targets: WebContents[] = [];
    try {
      targets = this.windowResolver ? this.windowResolver() : [];
    } catch {
      targets = [];
    }
    for (const wc of targets) {
      try {
        if (wc.isDestroyed() || wc === exclude) continue;
        wc.send(channel, payload);
      } catch {
        // Window closing mid-broadcast is never fatal
      }
    }
  }

  registerIpcHandlers(
    ipcMain: import('electron').IpcMain,
    options: { isTrustedSender: TrustedSenderCheck }
  ): void {
    if (this.registered) return;
    this.registered = true;
    this.isTrustedSender = options.isTrustedSender;

    // 'canvas:update-state': Canvas window pushes state edits, we broadcast to Main.
    ipcMain.handle(
      'canvas:update-state',
      async (event, rawPayload: unknown): Promise<IpcResult<CanvasSnapshot>> => {
        if (this.isTrustedSender && !this.isTrustedSender(event)) {
          return { success: false, error: 'Untrusted renderer frame.' };
        }
        const parsed = CanvasUpdateStatePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          return { success: false, error: `Invalid canvas state payload: ${parsed.error.issues.slice(0, 3).map(String).join('; ')}` };
        }
        this.applyUpdate(parsed.data);
        const snapshot = this.getSnapshot();
        this.broadcast('canvas:state-synced', snapshot, event.sender);
        return { success: true, data: snapshot };
      }
    );

    // 'canvas:request-state': any opened Canvas window pulls the current state.
    ipcMain.handle(
      'canvas:request-state',
      async (event): Promise<IpcResult<CanvasSnapshot>> => {
        if (this.isTrustedSender && !this.isTrustedSender(event)) {
          return { success: false, error: 'Untrusted renderer frame.' };
        }
        return { success: true, data: this.getSnapshot() };
      }
    );

    // 'main:sync-message': either side appends a chat message, mirrored to both.
    ipcMain.handle(
      'main:sync-message',
      async (event, rawPayload: unknown): Promise<IpcResult<CanvasMessage>> => {
        if (this.isTrustedSender && !this.isTrustedSender(event)) {
          return { success: false, error: 'Untrusted renderer frame.' };
        }
        const parsed = CanvasSendMessagePayloadSchema.safeParse(rawPayload);
        if (!parsed.success) {
          return { success: false, error: `Invalid canvas message payload: ${parsed.error.issues.slice(0, 3).map(String).join('; ')}` };
        }
        const message = parsed.data.message;
        this.appendMessage({ ...message, origin: message.origin === 'main' ? 'main' : 'canvas' });
        this.broadcast('canvas:message-synced', message, event.sender);
        return { success: true, data: message };
      }
    );
  }
}

export const canvasSyncManager = new CanvasSyncManager();
