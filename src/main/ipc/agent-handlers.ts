import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { AgentMode, AgentStreamChunk, AgentToolApproval, ChatMessage, IpcResponse, ProposedDiff, ProviderSettings } from '../../preload/types';
import { getProviderSettings } from './settings-handlers';
import { AgentEngine } from '../agent/agent-engine';
import { OpenCodeAgentManager } from '../services/orchestration/agent-manager';

interface ActiveTask {
  controller: AbortController;
  window: BrowserWindow;
  finished: boolean;
}

const activeTasks = new Map<string, ActiveTask>();
interface PendingAgentApproval {
  taskId: string;
  resolve: (approved: boolean) => void;
  timer: ReturnType<typeof setTimeout>;
  signal: AbortSignal;
  abortHandler: () => void;
}
const pendingApprovals = new Map<string, PendingAgentApproval>();

function requestTaskApproval(taskId: string, approval: AgentToolApproval, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const finish = (approved: boolean) => {
      const pending = pendingApprovals.get(approval.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      signal.removeEventListener('abort', pending.abortHandler);
      pendingApprovals.delete(approval.id);
      pending.resolve(approved);
    };
    const abortHandler = () => finish(false);
    const timer = setTimeout(() => finish(false), 120_000);
    pendingApprovals.set(approval.id, { taskId, resolve, timer, signal, abortHandler });
    signal.addEventListener('abort', abortHandler, { once: true });
  });
}

export function respondAgentApproval(approvalId: string, approved: boolean): IpcResponse<void> {
  const pending = pendingApprovals.get(approvalId);
  if (!pending) return { success: false, error: 'Approval request expired or is no longer active.' };
  const task = activeTasks.get(pending.taskId);
  if (!task || task.finished) return { success: false, error: 'The agent task has already finished.' };
  pending.resolve(approved);
  clearTimeout(pending.timer);
  pending.signal.removeEventListener('abort', pending.abortHandler);
  pendingApprovals.delete(approvalId);
  return { success: true };
}

function cancelTaskApprovals(taskId: string): void {
  for (const [approvalId, pending] of pendingApprovals) {
    if (pending.taskId !== taskId) continue;
    pending.resolve(false);
    clearTimeout(pending.timer);
    pending.signal.removeEventListener('abort', pending.abortHandler);
    pendingApprovals.delete(approvalId);
  }
}

export async function startAgentTask(
  mainWindow: BrowserWindow,
  params: {
    taskId?: string;
    prompt: string;
    workspacePath: string;
    history: ChatMessage[];
    agentMode?: AgentMode;
    sessionId?: string;
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

  const useOpenCode = Boolean(params.agentMode || settings.activeHarness === 'opencode');
  const emit = (chunk: AgentStreamChunk) => {
    if (task.finished || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('agent:stream', { ...chunk, taskId } satisfies AgentStreamChunk);
    if (chunk.type === 'done' || chunk.type === 'cancelled' || chunk.type === 'error') task.finished = true;
  };

  void (async () => {
    try {
      if (useOpenCode) {
        const opencode = new OpenCodeAgentManager(params.workspacePath);
        await opencode.run({
          prompt: params.prompt,
          workspacePath: params.workspacePath,
          history: params.history,
          settings,
          agentMode: params.agentMode || 'build',
          sessionId: params.sessionId,
          activeFilePath: params.activeFilePath,
          activeFileContent: params.activeFileContent,
          abortSignal: abortController.signal,
          requestApproval: (approval) => requestTaskApproval(taskId, approval, abortController.signal),
          onChunk: emit
        });
      } else {
        const engine = new AgentEngine(params.workspacePath);
        await engine.run({
          prompt: params.prompt,
          workspacePath: params.workspacePath,
          history: params.history,
          settings,
          activeFilePath: params.activeFilePath,
          activeFileContent: params.activeFileContent,
          abortSignal: abortController.signal,
          requestApproval: (approval) => requestTaskApproval(taskId, approval, abortController.signal),
          onChunk: emit
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: abortController.signal.aborted ? 'cancelled' : 'error', error: message });
    } finally {
      cancelTaskApprovals(taskId);
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
