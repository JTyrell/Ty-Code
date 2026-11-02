/**
 * Prompt C Step 1 — Wiki IPC channels.
 *
 * Zod-guarded handlers for wiki status, on-demand regeneration (with progress
 * streamed back to the invoking window), reading a section, and section-level
 * search used by the `@wiki` mention. Generation calls the locked route through
 * the service; nothing here returns fabricated docs.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  WIKI_CHANNELS,
  GenerateWikiRequestSchema,
  WikiStatusRequestSchema,
  ReadWikiSectionRequestSchema,
  SearchWikiRequestSchema,
  type GenerateWikiResult,
  type WikiStatus,
  type WikiSearchHit
} from '../../shared/types/wiki';
import { wikiService } from '../services/knowledge/wiki-service';

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

export function registerWikiHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    WIKI_CHANNELS.status,
    async (event, payload: unknown): Promise<IpcResponse<WikiStatus>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = WikiStatusRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`wiki:status: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading wiki status failed', () => wikiService.status(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    WIKI_CHANNELS.generate,
    async (event, payload: unknown): Promise<IpcResponse<GenerateWikiResult>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = GenerateWikiRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`wiki:generate: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('wiki generation failed', () =>
        wikiService.generate(parsed.data.workspaceRoot, {
          force: parsed.data.force,
          onProgress: (progress) => {
            try {
              event.sender.send(WIKI_CHANNELS.progress, { workspaceRoot: parsed.data.workspaceRoot, ...progress });
            } catch {
              /* window may have closed mid-generation */
            }
          }
        })
      );
    }
  );

  ipcMain.handle(
    WIKI_CHANNELS.read,
    async (event, payload: unknown): Promise<IpcResponse<{ section: string; content: string | null }>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = ReadWikiSectionRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`wiki:read: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading wiki section failed', async () => {
        const content = await wikiService.readSection(parsed.data.workspaceRoot, parsed.data.section);
        return { section: parsed.data.section, content };
      });
    }
  );

  ipcMain.handle(
    WIKI_CHANNELS.search,
    async (event, payload: unknown): Promise<IpcResponse<WikiSearchHit[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = SearchWikiRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`wiki:search: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('wiki search failed', () =>
        wikiService.search(parsed.data.workspaceRoot, parsed.data.query, parsed.data.limit)
      );
    }
  );
}
