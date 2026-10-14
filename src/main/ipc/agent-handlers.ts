import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { AgentStreamChunk, ChatMessage, IpcResponse, ProposedDiff, ProviderSettings } from '../../preload/types';
import { getProviderSettings } from './settings-handlers';
import { AgentEngine } from '../agent/agent-engine';

interface ActiveTask {
  controller: AbortController;
  window: BrowserWindow;
  finished: boolean;
}

const activeTasks = new Map<string, ActiveTask>();

export async function startAgentTask(
  mainWindow: BrowserWindow,
  params: {
    taskId?: string;
    prompt: string;
    workspacePath: string;
    history: ChatMessage[];
    activeFilePath?: string;
    activeFileContent?: string;
  }
): Promise<IpcResponse<string>> {
  const taskId = params.taskId || `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const abortController = new AbortController();
  const task: ActiveTask = { controller: abortController, window: mainWindow, finished: false };
  activeTasks.set(taskId, task);

  const settingsResponse = await getProviderSettings();
  const settings: ProviderSettings | undefined = settingsResponse.data;
  if (!settingsResponse.success || !settings) {
    activeTasks.delete(taskId);
    return { success: false, error: settingsResponse.error || 'Provider settings are unavailable.' };
  }
  const engine = new AgentEngine(params.workspacePath);
  const emit = (chunk: AgentStreamChunk) => {
    if (task.finished || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('agent:stream', { ...chunk, taskId } satisfies AgentStreamChunk);
    if (chunk.type === 'done' || chunk.type === 'cancelled' || chunk.type === 'error') task.finished = true;
  };

  void (async () => {
    try {
      await engine.run({
        prompt: params.prompt,
        workspacePath: params.workspacePath,
        history: params.history,
        settings,
        activeFilePath: params.activeFilePath,
        activeFileContent: params.activeFileContent,
        abortSignal: abortController.signal,
        onChunk: emit
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: abortController.signal.aborted ? 'cancelled' : 'error', error: message });
    } finally {
      activeTasks.delete(taskId);
    }
  })();

  return { success: true, data: taskId };
}

export function stopAgentTask(taskId: string): IpcResponse<void> {
  const task = activeTasks.get(taskId);
  if (!task) return { success: false, error: 'Task not found or already completed' };
  task.controller.abort();
  if (!task.finished && !task.window.isDestroyed() && !task.window.webContents.isDestroyed()) {
    task.window.webContents.send('agent:stream', { type: 'cancelled', taskId } satisfies AgentStreamChunk);
  }
  task.finished = true;
  activeTasks.delete(taskId);
  return { success: true };
}

export async function applyDiff(workspacePath: string, diff: ProposedDiff): Promise<IpcResponse<void>> {
  try {
    const absPath = path.resolve(workspacePath, diff.filePath);
    const relativePath = path.relative(workspacePath, absPath);
    if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
      return { success: false, error: 'Security Exception: Access outside workspace is not allowed.' };
    }
    await fs.mkdir(path.dirname(absPath), { recursive: true });
    await fs.writeFile(absPath, diff.proposedContent, 'utf-8');
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
