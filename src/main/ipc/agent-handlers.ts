import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type {
  AgentStreamChunk,
  ChatMessage,
  IpcResponse,
  ProposedDiff
} from '../../preload/types';
import { getSettings } from './settings-handlers';
import { AgentEngine } from '../agent/agent-engine';

const activeTasks = new Map<string, AbortController>();

export async function startAgentTask(
  mainWindow: BrowserWindow,
  params: {
    prompt: string;
    workspacePath: string;
    history: ChatMessage[];
    activeFilePath?: string;
    activeFileContent?: string;
  }
): Promise<IpcResponse<string>> {
  const taskId = `task_${Date.now()}`;
  const abortController = new AbortController();
  activeTasks.set(taskId, abortController);

  const settingsRes = await getSettings();
  const settings = settingsRes.data!;

  const engine = new AgentEngine(params.workspacePath);

  // Run in background asynchronously so IPC responds immediately with taskId
  (async () => {
    try {
      await engine.run({
        prompt: params.prompt,
        workspacePath: params.workspacePath,
        history: params.history,
        settings,
        activeFilePath: params.activeFilePath,
        activeFileContent: params.activeFileContent,
        abortSignal: abortController.signal,
        onChunk: (chunk: AgentStreamChunk) => {
          if (!mainWindow.isDestroyed()) {
            mainWindow.webContents.send('agent:stream', chunk);
          }
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('agent:stream', {
          type: 'error',
          error: msg
        });
      }
    } finally {
      activeTasks.delete(taskId);
    }
  })();

  return { success: true, data: taskId };
}

export function stopAgentTask(taskId: string): IpcResponse<void> {
  const controller = activeTasks.get(taskId);
  if (controller) {
    controller.abort();
    activeTasks.delete(taskId);
    return { success: true };
  }
  return { success: false, error: 'Task not found or already completed' };
}

export async function applyDiff(
  workspacePath: string,
  diff: ProposedDiff
): Promise<IpcResponse<void>> {
  try {
    const absPath = path.resolve(workspacePath, diff.filePath);
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, diff.proposedContent, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: msg };
  }
}
