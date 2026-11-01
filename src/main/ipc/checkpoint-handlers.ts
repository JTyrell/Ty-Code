/**
 * Phase 3 — Checkpoint IPC.
 *
 * Zod-guarded channels for listing, capturing (used by the agent loop through
 * the service directly, exposed here for tooling/tests), previewing a restore,
 * committing a restore with a conflict mode, and purging. All file contents
 * cross only as opaque encrypted bundles inside the service; nothing here
 * returns plaintext transcript/bundle bytes.
 */

import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import {
  CHECKPOINT_CHANNELS,
  ListCheckpointsRequestSchema,
  CaptureCheckpointRequestSchema,
  RestoreCheckpointRequestSchema,
  PurgeCheckpointsRequestSchema,
  type CheckpointManifest,
  type RestoreResult
} from '../../shared/types/checkpoint';
import { checkpointService } from '../services/checkpoints/checkpoint-service';

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
    const data = await fn();
    return { success: true, data } as IpcResponse<T>;
  } catch (err) {
    return {
      success: false,
      error: `${label}: ${err instanceof Error ? err.message : String(err)}`
    } as IpcResponse<T>;
  }
}

export function registerCheckpointHandlers(deps: HandlerDeps): void {
  ipcMain.handle(
    CHECKPOINT_CHANNELS.list,
    async (event, payload: unknown): Promise<IpcResponse<CheckpointManifest[]>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = ListCheckpointsRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`checkpoint:list: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('listing checkpoints failed', async () =>
        checkpointService.list(parsed.data.workspaceRoot, parsed.data.taskId)
      );
    }
  );

  ipcMain.handle(
    CHECKPOINT_CHANNELS.capture,
    async (event, payload: unknown): Promise<IpcResponse<CheckpointManifest>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = CaptureCheckpointRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`checkpoint:capture: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('capturing checkpoint failed', async () =>
        checkpointService.capture(parsed.data.workspaceRoot, parsed.data.taskId, parsed.data.edits, parsed.data.summary)
      );
    }
  );

  ipcMain.handle(
    CHECKPOINT_CHANNELS.restorePreview,
    async (event, payload: unknown): Promise<IpcResponse<RestoreResult>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = RestoreCheckpointRequestSchema.safeParse({ ...parsed_safe(payload), mode: 'review' });
      if (!parsed.success) return fail(`checkpoint:restorePreview: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('previewing restore failed', async () =>
        checkpointService.restorePreview(parsed.data.workspaceRoot, parsed.data.checkpointId)
      );
    }
  );

  ipcMain.handle(
    CHECKPOINT_CHANNELS.restore,
    async (event, payload: unknown): Promise<IpcResponse<RestoreResult>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = RestoreCheckpointRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`checkpoint:restore: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('restoring checkpoint failed', async () =>
        checkpointService.restore(parsed.data.workspaceRoot, parsed.data.checkpointId, parsed.data.mode)
      );
    }
  );

  ipcMain.handle(
    CHECKPOINT_CHANNELS.purgeOlderThan,
    async (event, payload: unknown): Promise<IpcResponse<number>> => {
      if (!deps.isTrustedSender(event)) return untrusted();
      const parsed = PurgeCheckpointsRequestSchema.safeParse(payload);
      if (!parsed.success) return fail(`checkpoint:purge: ${parsed.error.issues[0]?.message ?? 'invalid'}`);
      return guardJson('purging checkpoints failed', async () =>
        checkpointService.purgeOlderThan(parsed.data.workspaceRoot, parsed.data.olderThanMs)
      );
    }
  );
}

/** restorePreview reuses the restore schema but forces mode='review'. */
function parsed_safe(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : {};
}
