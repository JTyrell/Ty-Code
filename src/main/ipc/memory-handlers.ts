/**
 * Prompt C Step 4 — Auto-Memory IPC channels.
 *
 * Zod-guarded handlers backing the memory confirmation queue: read pending candidates,
 * run a distillation pass, approve (with scope + optional edit), dismiss, and update a
 * still-pending candidate. Approved memories land in the existing Correction Memory;
 * everything else stays local in `.tycode/memory/`.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  MEMORY_CHANNELS,
  MemoryPendingRequestSchema,
  MemoryApproveRequestSchema,
  MemoryDismissRequestSchema,
  MemoryDistillRequestSchema,
  MemoryUpdateRequestSchema,
  MemoryStoredRequestSchema,
  RemoveStoredMemoryRequestSchema,
  type MemoryCandidate,
  type DistillResult,
  type StoredMemory
} from '../../shared/types/memory';
import { autoMemoryService, GLOBAL_MEMORY_SCOPE } from '../services/knowledge/auto-memory-service';

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

export function registerMemoryHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    MEMORY_CHANNELS.pending,
    async (event, payload: unknown): Promise<IpcResponse<MemoryCandidate[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = MemoryPendingRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:pending: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading pending memory failed', () => autoMemoryService.pending(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    MEMORY_CHANNELS.distill,
    async (event, payload: unknown): Promise<IpcResponse<DistillResult>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = MemoryDistillRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:distill: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('memory distillation failed', () =>
        autoMemoryService.distill(parsed.data.workspaceRoot, parsed.data.prompt, parsed.data.response)
      );
    }
  );

  ipcMain.handle(
    MEMORY_CHANNELS.approve,
    async (event, payload: unknown): Promise<IpcResponse<{ ok: boolean }>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = MemoryApproveRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:approve: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('approving memory failed', async () => {
        const result = await autoMemoryService.approve(
          parsed.data.workspaceRoot,
          parsed.data.candidateId,
          parsed.data.scope,
          parsed.data.editedRule
        );
        if (!result.ok) throw new Error(result.error || 'Approval failed.');
        return { ok: true };
      });
    }
  );

  ipcMain.handle(
    MEMORY_CHANNELS.dismiss,
    async (event, payload: unknown): Promise<IpcResponse<boolean>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = MemoryDismissRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:dismiss: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('dismissing memory failed', () => autoMemoryService.dismiss(parsed.data.workspaceRoot, parsed.data.candidateId));
    }
  );

  ipcMain.handle(
    MEMORY_CHANNELS.update,
    async (event, payload: unknown): Promise<IpcResponse<MemoryCandidate | null>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = MemoryUpdateRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:update: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('updating memory failed', () =>
        autoMemoryService.update(parsed.data.workspaceRoot, parsed.data.candidateId, {
          title: parsed.data.title,
          rule: parsed.data.rule,
          scope: parsed.data.scope,
          category: parsed.data.category
        })
      );
    }
  );

  ipcMain.handle(
    MEMORY_CHANNELS.stored,
    async (event, payload: unknown): Promise<IpcResponse<StoredMemory[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = MemoryStoredRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:stored: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('reading stored memory failed', () => autoMemoryService.listStored(parsed.data.workspaceRoot));
    }
  );

  ipcMain.handle(
    MEMORY_CHANNELS.remove,
    async (event, payload: unknown): Promise<IpcResponse<boolean>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = RemoveStoredMemoryRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`memory:remove: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('deleting memory failed', () => {
        const scopeTarget = parsed.data.scope === 'global' ? GLOBAL_MEMORY_SCOPE : parsed.data.workspaceRoot;
        return autoMemoryService.removeStored(scopeTarget, parsed.data.id);
      });
    }
  );
}
