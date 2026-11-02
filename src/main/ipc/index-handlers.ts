/**
 * Prompt C Step 3 — Semantic index IPC channels.
 *
 * Zod-guarded handlers backing the semantic code index: status, rebuild (with build
 * progress streamed back to the invoking window), and search. Everything is strictly
 * local — embeddings come from the local provider chain (Ollama → WASM → token) and
 * the index persists under the project-local `.tycode/index/` directory. No cloud hop.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  INDEX_CHANNELS,
  IndexStatusRequestSchema,
  RebuildIndexRequestSchema,
  SemanticSearchRequestSchema,
  type IndexStatus,
  type RebuildIndexResult,
  type SemanticHit
} from '../../shared/types/semantic';
import { semanticIndexService } from '../services/knowledge/semantic-index-service';

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

export function registerIndexHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    INDEX_CHANNELS.status,
    async (event, payload: unknown): Promise<IpcResponse<IndexStatus>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = IndexStatusRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`index:status: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading index status failed', () => semanticIndexService.status(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    INDEX_CHANNELS.rebuild,
    async (event, payload: unknown): Promise<IpcResponse<RebuildIndexResult>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = RebuildIndexRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`index:rebuild: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('index rebuild failed', () =>
        semanticIndexService.rebuild(parsed.data.workspaceRoot, {
          force: parsed.data.force,
          onProgress: (progress) => {
            try {
              event.sender.send(INDEX_CHANNELS.progress, { workspaceRoot: parsed.data.workspaceRoot, ...progress });
            } catch {
              /* window may have closed mid-build */
            }
          }
        })
      );
    }
  );

  ipcMain.handle(
    INDEX_CHANNELS.search,
    async (event, payload: unknown): Promise<IpcResponse<SemanticHit[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SemanticSearchRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`index:search: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('semantic search failed', () =>
        semanticIndexService.search(parsed.data.workspaceRoot, parsed.data.query, parsed.data.limit)
      );
    }
  );
}
