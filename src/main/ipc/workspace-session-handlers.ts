import { ipcMain } from 'electron';
import type { IpcResponse } from '../../preload/types';
import type { WorkspaceSessionState } from '../services/workspace-session-manager';
import {
  WorkspaceSessionSetRootPayloadSchema,
  WorkspaceSessionSurfacePayloadSchema,
  getWorkspaceSessionManager
} from '../services/workspace-session-manager';

function validationFailure(message: string): IpcResponse<WorkspaceSessionState> {
  return { success: false, error: message };
}

function invokeSessionOperation(operation: () => WorkspaceSessionState): IpcResponse<WorkspaceSessionState> {
  try {
    return { success: true, data: operation() };
  } catch (err: unknown) {
    return validationFailure(err instanceof Error ? err.message : String(err));
  }
}

export function registerWorkspaceSessionHandlers(): void {
  const session = () => getWorkspaceSessionManager();

  ipcMain.handle('workspace:session:get', () => {
    try {
      return { success: true, data: session().getSession() };
    } catch (err: unknown) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('workspace:session:set-active', (_event, payload: unknown) => {
    const parsed = WorkspaceSessionSetRootPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return validationFailure(`Workspace session payload failed validation: ${parsed.error.issues[0]?.message || 'invalid payload'}`);
    }
    return invokeSessionOperation(() => session().setActiveWorkspace(parsed.data.rootPath));
  });

  ipcMain.handle('workspace:session:attach', (_event, payload: unknown) => {
    const parsed = WorkspaceSessionSurfacePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return validationFailure(`Surface payload failed validation: ${parsed.error.issues[0]?.message || 'invalid payload'}`);
    }
    return invokeSessionOperation(() => session().attachSurface(parsed.data.id));
  });

  ipcMain.handle('workspace:session:detach', (_event, payload: unknown) => {
    const parsed = WorkspaceSessionSurfacePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      return validationFailure(`Surface payload failed validation: ${parsed.error.issues[0]?.message || 'invalid payload'}`);
    }
    return invokeSessionOperation(() => session().detachSurface(parsed.data.id));
  });

  ipcMain.handle('workspace:session:close', () =>
    invokeSessionOperation(() => session().closeSession())
  );
}
