import { BrowserWindow } from 'electron';
import fs from 'fs/promises';
import path from 'path';
import type { AgentMode, AgentStreamChunk, AgentToolApproval, ChatMessage, IpcResponse, ProposedDiff, ProviderSettings } from '../../preload/types';
import { getProviderSettings } from './settings-handlers';
import { AgentEngine } from '../agent/agent-engine';
import { OpenCodeAgentManager } from '../services/orchestration/agent-manager';
import { classifyDiagnosticError } from '../services/diagnostics/error-taxonomy';

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

export function handleUserApproveDiff(
  payload: { approvalId?: string; diffId?: string; approved?: boolean } | boolean
): IpcResponse<void> {
  if (typeof payload === 'boolean') {
    const firstKey = pendingApprovals.keys().next().value;
    if (!firstKey) return { success: false, error: 'No pending approvals' };
    return respondAgentApproval(firstKey, payload);
  }
  const targetId = payload.approvalId
    || (payload.diffId ? Array.from(pendingApprovals.keys()).find((k) => k.includes(payload.diffId!)) : undefined)
    || pendingApprovals.keys().next().value;

  if (!targetId) return { success: false, error: 'No pending approvals' };
  return respondAgentApproval(targetId, payload.approved !== false);
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

import { connectivityTracer } from '../services/diagnostics/connectivity-tracer';

export async function startAgentTask(
  mainWindow: BrowserWindow,
  params: {
    taskId?: string;
    traceId?: string;
    prompt: string;
    workspacePath: string;
    history: ChatMessage[];
    agentMode?: AgentMode;
    sessionId?: string;
    activeFilePath?: string;
    activeFileContent?: string;
    providerOverride?: string;
    modelOverride?: string;
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

  const effectiveSettings: ProviderSettings = {
    ...settings,
    ...(params.providerOverride ? { activeProvider: params.providerOverride as any } : {}),
    ...(params.modelOverride ? { activeModel: params.modelOverride } : {})
  };

  const useOpenCode = effectiveSettings.activeHarness === 'opencode';
  let tokenCount = 0;
  const emit = (chunk: AgentStreamChunk) => {
    if (task.finished || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
    mainWindow.webContents.send('agent:stream', { ...chunk, taskId } satisfies AgentStreamChunk);

    // Fine-grained validated stream events
    switch (chunk.type) {
      case 'token':
        mainWindow.webContents.send('agent:stream-token', {
          taskId,
          token: chunk.content || ''
        });
        break;
      case 'thought':
        mainWindow.webContents.send('agent:reasoning-token', {
          taskId,
          token: chunk.content || ''
        });
        break;
      case 'tool_call':
        if (chunk.toolCall) {
          mainWindow.webContents.send('agent:tool-start', {
            taskId,
            toolCall: chunk.toolCall
          });
        }
        break;
      case 'tool_result':
        if (chunk.toolResult) {
          mainWindow.webContents.send('agent:tool-result', {
            taskId,
            toolResult: chunk.toolResult
          });
        }
        break;
      case 'diff':
        if (chunk.diff) {
          mainWindow.webContents.send('agent:diff-proposed', {
            taskId,
            diff: chunk.diff
          });
        }
        break;
      case 'approval_request':
        if (chunk.approvalRequest?.reviewDiff) {
          mainWindow.webContents.send('agent:diff-proposed', {
            taskId,
            diff: chunk.approvalRequest.reviewDiff
          });
        }
        break;
      case 'done':
        mainWindow.webContents.send('agent:done', {
          taskId,
          cancelled: false
        });
        break;
      case 'cancelled':
        mainWindow.webContents.send('agent:done', {
          taskId,
          cancelled: true
        });
        break;
      case 'error': {
        const classified = classifyDiagnosticError(effectiveSettings.activeProvider, chunk.error || 'Agent error');
        mainWindow.webContents.send('agent:error', {
          taskId,
          error: chunk.error || 'Agent execution failed',
          errorCard: {
            taxonomyCode: classified.code,
            message: classified.humanMessage,
            remedy: classified.remedy,
            actionUrl: classified.actionUrl,
            actionLabel: classified.actionLabel,
            suggestedFallback: classified.suggestedFallback,
            retryAfterSec: classified.retryAfterSec,
            providerId: effectiveSettings.activeProvider
          }
        });
        break;
      }
    }

    if (params.traceId && chunk.type === 'token') {
      tokenCount++;
      connectivityTracer.recordHop(params.traceId, 'H8', {
        status: 'PASS',
        payloadSize: chunk.content?.length || 0,
        metadata: {
          tokensForwardedCount: tokenCount,
          lastChunkSnippet: chunk.content?.slice(0, 30)
        }
      });
    }
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
          settings: effectiveSettings,
          agentMode: params.agentMode || 'build',
          sessionId: params.sessionId,
          activeFilePath: params.activeFilePath,
          activeFileContent: params.activeFileContent,
          traceId: params.traceId,
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
          settings: effectiveSettings,
          activeFilePath: params.activeFilePath,
          activeFileContent: params.activeFileContent,
          traceId: params.traceId,
          abortSignal: abortController.signal,
          requestApproval: (approval) => requestTaskApproval(taskId, approval, abortController.signal),
          onChunk: emit,
          onProviderHandoff: (info) => {
            if (mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) return;
            mainWindow.webContents.send('agent:provider-handoff', {
              taskId,
              fromProvider: info.fromProvider,
              toProvider: info.toProvider,
              toModel: info.toModel,
              newModel: info.toModel
            });
          }
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
    task.window.webContents.send('agent:done', { taskId, cancelled: true });
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
    const tempPath = `${absPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
    try {
      await fs.writeFile(tempPath, diff.proposedContent, 'utf-8');
      await fs.rename(tempPath, absPath);
    } catch (err) {
      await fs.unlink(tempPath).catch(() => undefined);
      throw err;
    }
    return { success: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
