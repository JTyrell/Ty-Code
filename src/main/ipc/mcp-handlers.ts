/**
 * Prompt E (Step 2) — MCP management IPC.
 *
 * Zod-guarded handlers over the live MCP client: list statuses, add stdio or
 * SSE servers, remove, enable/disable (which connects/disconnects for real),
 * reconnect, and the current live-tool surface. Subscribe captures the
 * renderer's WebContents for the pushed status-event stream, with a disposer
 * per window that unwinds when the window is destroyed.
 */

import { ipcMain, type IpcMainInvokeEvent, type WebContents } from 'electron';
import {
  MCP_CHANNELS,
  McpAddSseRequestSchema,
  McpAddStdioRequestSchema,
  McpListRequestSchema,
  McpRemoveRequestSchema,
  McpReconnectRequestSchema,
  McpSetEnabledRequestSchema,
  type McpEvent,
  type McpServerStatus
} from '../../shared/types/mcp';
import { mcpClientService } from '../services/mcp-client-service';

interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

interface HandlerDeps {
  isTrustedSender: (event: IpcMainInvokeEvent) => boolean;
}

function untrusted<T = unknown>(): IpcResponse<T> {
  return { success: false, error: 'untrusted sender' };
}

function fail<T = unknown>(error: string): IpcResponse<T> {
  return { success: false, error };
}

async function guardJson<T>(label: string, fn: () => Promise<T>): Promise<IpcResponse<T>> {
  try {
    return { success: true, data: await fn() } as IpcResponse<T>;
  } catch (err) {
    return { success: false, error: `${label}: ${err instanceof Error ? err.message : String(err)}` } as IpcResponse<T>;
  }
}

export function registerMcpHandlers(deps: HandlerDeps): void {
  const sinks = new Map<WebContents, () => void>();

  ipcMain.handle(
    MCP_CHANNELS.subscribe,
    async (event, payload: unknown): Promise<IpcResponse<McpServerStatus[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = McpListRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`mcp:subscribe: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const wc = event.sender;
      if (!sinks.has(wc)) {
        const sink = (mcpEvent: McpEvent): void => {
          if (wc.isDestroyed()) return;
          try {
            wc.send(MCP_CHANNELS.events, mcpEvent);
          } catch {
            // Window torn down mid-send; the destroyed handler cleans up.
          }
        };
        const dispose = mcpClientService.onEvent(sink);
        sinks.set(wc, dispose);
        wc.once('destroyed', () => {
          const stored = sinks.get(wc);
          if (stored) {
            stored();
            sinks.delete(wc);
          }
        });
      }
      // Opening the panel is intent to see true health: connect every
      // enabled-but-not-yet-live server in the background. The snapshot
      // returns immediately; results arrive on the events channel.
      void (async () => {
        try {
          const statuses = await mcpClientService.listStatuses(parsed.data.workspacePath);
          for (const status of statuses) {
            if (!status.disabled && status.health !== 'connected' && status.health !== 'connecting') {
              await mcpClientService.connect(parsed.data.workspacePath, status.id).catch(() => undefined);
            }
          }
        } catch {
          // Background sync best-effort; the list request below still answers.
        }
      })();
      return guardJson('mcp list failed', () => mcpClientService.listStatuses(parsed.data.workspacePath));
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.unsubscribe,
    (event): IpcResponse => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const stored = sinks.get(event.sender);
      if (stored) {
        stored();
        sinks.delete(event.sender);
      }
      return { success: true };
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.list,
    async (event, payload: unknown): Promise<IpcResponse<McpServerStatus[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = McpListRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`mcp:list: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('mcp list failed', () => mcpClientService.listStatuses(parsed.data.workspacePath));
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.add,
    async (event, payload: unknown): Promise<IpcResponse<McpServerStatus>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const stdio = McpAddStdioRequestSchema.safeParse(payload);
      if (stdio.success) {
        return guardJson('adding MCP server failed', () => mcpClientService.addServer(stdio.data));
      }
      const sse = McpAddSseRequestSchema.safeParse(payload);
      if (!sse.success) {
        return fail(`mcp:add: ${stdio.error.issues[0]?.message ?? sse.error.issues[0]?.message ?? 'invalid request'}`);
      }
      return guardJson('adding MCP server failed', () =>
        mcpClientService.addServer({
          workspacePath: sse.data.workspacePath,
          id: sse.data.id,
          transport: 'sse',
          name: sse.data.name,
          description: sse.data.description,
          url: sse.data.url,
          projectScope: sse.data.projectScope,
          startEnabled: sse.data.startEnabled
        })
      );
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.remove,
    async (event, payload: unknown): Promise<IpcResponse<true>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = McpRemoveRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`mcp:remove: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      const result = await guardJson('removing MCP server failed', async () => {
        await mcpClientService.removeServer(parsed.data.workspacePath, parsed.data.id, parsed.data.scope);
        return true as const;
      });
      return result;
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.setEnabled,
    async (event, payload: unknown): Promise<IpcResponse<McpServerStatus>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = McpSetEnabledRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`mcp:set-enabled: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('toggling MCP server failed', () =>
        mcpClientService.setEnabled(parsed.data.workspacePath, parsed.data.id, parsed.data.enabled)
      );
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.reconnect,
    async (event, payload: unknown): Promise<IpcResponse<McpServerStatus>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = McpReconnectRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`mcp:reconnect: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reconnecting MCP server failed', () => mcpClientService.connect(parsed.data.workspacePath, parsed.data.id));
    }
  );

  ipcMain.handle(
    MCP_CHANNELS.liveTools,
    (event): IpcResponse<Array<{ serverId: string; tool: string }>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      return { success: true, data: mcpClientService.getLiveTools() };
    }
  );
}
