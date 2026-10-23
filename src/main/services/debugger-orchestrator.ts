import { Worker } from 'node:worker_threads';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { BrowserWindow, ipcMain } from 'electron';
import { runDynamicAnalysis, mapDynamicResultToFindings } from './debugger-engines/dynamic-engine';
import { generateRoleBasedReport } from './debugger-engines/ai-analyst';
import { debuggerModelRouter } from './debugger-engines/debugger-model-router';
import type { ArchProjectReport } from './debugger-engines/arch-engine';
import { resolveWorkerRuntimeFile } from './debugger-engines/runtime-paths';
import type { AnalysisResult, AnalysisRole, AnalysisSeverity } from '../windows/debugger-window';
import type { VerifiedModelConfig } from './verified-models';

export type DebuggerEngineName = 'static' | 'dynamic' | 'arch';

export interface EngineErrorRecord {
  engine: DebuggerEngineName;
  error: string;
}

export interface FullAnalysisPayload {
  runId: string;
  targetFile: string | null;
  projectRoot: string;
  startedAt: number;
  durationMs: number;
  results: AnalysisResult[];
  engineErrors: EngineErrorRecord[];
  arch?: ArchProjectReport;
  selectedModels?: Record<'static' | 'dynamic' | 'arch' | 'ai_reasoning', { modelId: string; providerId: string }>;
}

export interface FullAnalysisOptions {
  broadcast?: boolean;
  projectRoot?: string;
  /** Persona for the post-engine AI analyst pass ('dev' by default). */
  role?: AnalysisRole;
  /**
   * Streaming relay for AI tokens — called with ({ runId, role, phase, chunk })
   * while the model is still generating, so the renderer never blocks.
   */
  onRoleReportToken?: (frame: { runId: string; role: AnalysisRole; phase: 'token' | 'done' | 'error'; chunk?: string; parseMode?: string }) => void;
  /**
   * Called when the engine findings are ready (before the AI pass) and again
   * when the AI items are appended, so hosts can push results into their
   * state snapshot twice (UI shows engines instantly, AI live afterwards).
   */
  onResultsSnapshot?: (results: AnalysisResult[], stage: 'engines' | 'complete') => void;
}

export const STATIC_ENGINE_BUDGET_MS = 20000;
export const ARCH_ENGINE_BUDGET_MS = 30000;

const SEVERITY_RANK: Record<AnalysisSeverity, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1
};

interface WorkerOutcome<TResult> {
  ok: true;
  result: TResult;
}

interface WorkerFailure {
  ok: false;
  error: string;
}

function runWorkerJob<TResult>(
  workerFileName: string,
  job: Record<string, unknown>,
  budgetMs: number
): Promise<WorkerOutcome<TResult> | WorkerFailure> {
  return new Promise((resolve) => {
    let settled = false;
    let worker: Worker;
    try {
      worker = new Worker(resolveWorkerRuntimeFile(workerFileName));
    } catch (error) {
      resolve({ ok: false, error: error instanceof Error ? error.message : String(error) });
      return;
    }

    const finish = (outcome: WorkerOutcome<TResult> | WorkerFailure): void => {
      if (settled) return;
      settled = true;
      clearTimeout(budgetTimer);
      void worker.terminate();
      resolve(outcome);
    };

    const budgetTimer = setTimeout(() => {
      finish({ ok: false, error: `${workerFileName} exceeded its ${budgetMs}ms budget and was terminated` });
    }, budgetMs);

    worker.on('message', (message: unknown) => {
      if (typeof message !== 'object' || message === null) {
        finish({ ok: false, error: 'invalid worker message' });
        return;
      }
      const frame = message as { ok?: unknown; result?: unknown; error?: unknown };
      if (frame.ok === true) {
        finish(frame as WorkerOutcome<TResult>);
        return;
      }
      finish({ ok: false, error: typeof frame.error === 'string' ? frame.error : 'unknown worker error' });
    });

    worker.on('error', (error) => {
      finish({ ok: false, error: error.message });
    });

    worker.on('messageerror', (error) => {
      finish({ ok: false, error: `worker serialization error: ${error.message}` });
    });

    worker.on('exit', (code) => {
      finish({ ok: false, error: `worker exited before answering (code ${code ?? 1})` });
    });

    worker.postMessage(job);
  });
}

function isAnalysisResultArray(value: unknown): value is AnalysisResult[] {
  if (!Array.isArray(value)) return false;
  return value.every((entry) => typeof entry === 'object' && entry !== null && typeof (entry as AnalysisResult).message === 'string');
}

function isArchReport(value: unknown): value is ArchProjectReport {
  if (typeof value !== 'object' || value === null) return false;
  const report = value as { graph?: unknown; warnings?: unknown; debtScore?: unknown };
  return typeof report.graph === 'object' && Array.isArray(report.warnings) && typeof report.debtScore === 'object';
}

async function walkUpForPackageJson(startDir: string): Promise<string | null> {
  let directory = path.dirname(startDir);
  for (let depth = 0; depth < 32; depth++) {
    try {
      await fsPromises.stat(path.join(directory, 'package.json'));
      return directory;
    } catch {
      // keep walking
    }
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
  return null;
}

function dedupeAndSort(results: AnalysisResult[]): AnalysisResult[] {
  const seen = new Set<string>();
  const deduped: AnalysisResult[] = [];
  for (const entry of results) {
    const key = `${entry.engine}|${entry.ruleId ?? ''}|${entry.filePath ?? ''}|${entry.line ?? ''}|${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped.sort((left, right) => {
    const severityDelta = (SEVERITY_RANK[right.severity] ?? 0) - (SEVERITY_RANK[left.severity] ?? 0);
    if (severityDelta !== 0) return severityDelta;
    const pathDelta = (left.filePath ?? '').localeCompare(right.filePath ?? '');
    if (pathDelta !== 0) return pathDelta;
    return (left.line ?? 0) - (right.line ?? 0);
  });
}

function failureFinding(engine: DebuggerEngineName, error: string): AnalysisResult {
  return {
    id: `engine-failure:${engine}:${Date.now()}`,
    severity: 'medium',
    engine,
    role: 'dev',
    message: `${engine} engine failed to complete: ${error.slice(0, 200)}`,
    ruleId: `${engine}-engine-failure`,
    suggestedFix: 'Re-run the analysis; if the failure persists, inspect the engine logs in the main process console.',
    timestamp: Date.now()
  };
}

export async function runFullAnalysis(
  requestedPath?: string,
  options?: FullAnalysisOptions
): Promise<FullAnalysisPayload> {
  const startedAt = Date.now();
  const requested = requestedPath?.trim();
  const targetFile = requested && requested !== 'all' && requested !== 'project' ? path.resolve(requested) : null;
  const projectRoot = options?.projectRoot
    ? path.resolve(options.projectRoot)
    : targetFile
      ? (await walkUpForPackageJson(targetFile)) ?? path.dirname(targetFile)
      : (await walkUpForPackageJson(process.cwd())) ?? process.cwd();
  const runId = `run-${startedAt}`;

  // Step 3: Model router selection for each engine/phase (Auto vs Manual)
  const prefs = await debuggerModelRouter.getDebuggerModelPreferences();
  const isAuto = prefs.mode === 'auto' || prefs.auto;
  let staticModel: VerifiedModelConfig;
  let dynamicModel: VerifiedModelConfig;
  let archModel: VerifiedModelConfig;
  let aiModel: VerifiedModelConfig;

  if (isAuto) {
    [staticModel, dynamicModel, archModel, aiModel] = await Promise.all([
      debuggerModelRouter.selectBestModelForTask('static'),
      debuggerModelRouter.selectBestModelForTask('dynamic'),
      debuggerModelRouter.selectBestModelForTask('arch'),
      debuggerModelRouter.selectBestModelForTask('ai_reasoning')
    ]);
  } else {
    // If Manual: Use the user-selected model for all engines.
    const manualModel = await debuggerModelRouter.selectBestModelForTask('ai_reasoning');
    staticModel = manualModel;
    dynamicModel = manualModel;
    archModel = manualModel;
    aiModel = manualModel;
  }

  // Logging requirement: report chosen model for each task phase
  console.log(`[DEBUGGER] Static analysis using model: ${staticModel.modelId} (${staticModel.providerId})`);
  console.log(`[DEBUGGER] Dynamic analysis using model: ${dynamicModel.modelId} (${dynamicModel.providerId})`);
  console.log(`[DEBUGGER] Architectural analysis using model: ${archModel.modelId} (${archModel.providerId})`);
  console.log(`[DEBUGGER] AI reasoning using model: ${aiModel.modelId} (${aiModel.providerId})`);

  const staticStep: Promise<WorkerOutcome<AnalysisResult[]> | WorkerFailure> = targetFile
    ? runWorkerJob<AnalysisResult[]>(
        'static-worker.js',
        { kind: 'static', filePath: targetFile, model: staticModel.modelId, provider: staticModel.providerId },
        STATIC_ENGINE_BUDGET_MS
      )
    : Promise.resolve({ ok: true, result: [] as AnalysisResult[] });

  const dynamicStep: Promise<AnalysisResult[]> = targetFile
    ? (async () => {
        const runtime = await runDynamicAnalysis(targetFile);
        return mapDynamicResultToFindings(runtime, targetFile);
      })()
    : Promise.resolve([]);

  const [staticOutcome, dynamicOutcome, archOutcome] = await Promise.allSettled([
    staticStep,
    dynamicStep,
    runWorkerJob<ArchProjectReport>(
      'arch-worker.js',
      { kind: 'arch', projectRoot, model: archModel.modelId, provider: archModel.providerId },
      ARCH_ENGINE_BUDGET_MS
    )
  ]);

  const results: AnalysisResult[] = [];
  const engineErrors: EngineErrorRecord[] = [];
  let arch: ArchProjectReport | undefined;

  if (staticOutcome.status === 'fulfilled' && staticOutcome.value.ok && isAnalysisResultArray(staticOutcome.value.result)) {
    results.push(...staticOutcome.value.result);
  } else {
    const errorText =
      staticOutcome.status === 'rejected'
        ? String(staticOutcome.reason)
        : staticOutcome.value.ok
          ? 'static engine returned an invalid payload'
          : staticOutcome.value.error;
    engineErrors.push({ engine: 'static', error: errorText });
    results.push(failureFinding('static', errorText));
  }

  if (dynamicOutcome.status === 'fulfilled') {
    results.push(...dynamicOutcome.value);
  } else {
    const errorText = String(dynamicOutcome.reason);
    engineErrors.push({ engine: 'dynamic', error: errorText });
    results.push(failureFinding('dynamic', errorText));
  }

  if (archOutcome.status === 'fulfilled' && archOutcome.value.ok && isArchReport(archOutcome.value.result)) {
    arch = archOutcome.value.result;
    results.push(...arch.warnings);
  } else {
    const errorText =
      archOutcome.status === 'rejected'
        ? String(archOutcome.reason)
        : archOutcome.value.ok
          ? 'arch engine returned an invalid payload'
          : archOutcome.value.error;
    engineErrors.push({ engine: 'arch', error: errorText });
    results.push(failureFinding('arch', errorText));
  }

  const engineResults = dedupeAndSort(results);
  const effectiveRole: AnalysisRole = options?.role ?? 'dev';

  const broadcastUpdate = (snapshot: AnalysisResult[]): void => {
    if (options?.broadcast === false) return;
    ipcMain.emit('debugger:update', snapshot);
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send('debugger:update', snapshot);
    }
  };

  const relayAiFrame = (frame: { runId: string; role: AnalysisRole; phase: 'token' | 'done' | 'error'; chunk?: string; parseMode?: string }): void => {
    options?.onRoleReportToken?.(frame);
    if (options?.broadcast === false) return;
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.isDestroyed() || window.webContents.isDestroyed()) continue;
      window.webContents.send('debugger:ai-stream', frame);
    }
  };

  // Deliver engine findings IMMEDIATELY (before the AI pass) so the UI is
  // never blocked while the model thinks.
  broadcastUpdate(engineResults);
  options?.onResultsSnapshot?.(engineResults, 'engines');

  // Post-engine AI pass: generateRoleBasedReport streams tokens to the
  // renderer in real time via the onToken callback pattern, then appends
  // role-tagged 'info' findings to the analysis payload.
  let aiResults: AnalysisResult[] = [];
  const resultsForAi = engineResults.filter((entry) => entry.severity !== 'info');
  if (resultsForAi.length > 0) {
    relayAiFrame({ runId, role: effectiveRole, phase: 'token' });
    const report = await generateRoleBasedReport(resultsForAi, effectiveRole, {
      targetFile,
      arch,
      modelConfig: { providerId: aiModel.providerId, modelId: aiModel.modelId },
      onToken: (chunk) => relayAiFrame({ runId, role: effectiveRole, phase: 'token', chunk }),
      abortSignal: undefined
    });
    relayAiFrame({ runId, role: effectiveRole, phase: 'done', parseMode: report.parseMode });
    aiResults = report.results.filter(
      (entry) => !engineErrors.some((engineError) => entry.ruleId === `${engineError.engine}-engine-failure`)
    );
  }

  const combinedResults = dedupeAndSort([...engineResults, ...aiResults]);
  options?.onResultsSnapshot?.(combinedResults, 'complete');

  const payload: FullAnalysisPayload = {
    runId,
    targetFile,
    projectRoot,
    startedAt,
    durationMs: Date.now() - startedAt,
    results: combinedResults,
    engineErrors,
    arch,
    selectedModels: {
      static: { modelId: staticModel.modelId, providerId: staticModel.providerId },
      dynamic: { modelId: dynamicModel.modelId, providerId: dynamicModel.providerId },
      arch: { modelId: archModel.modelId, providerId: archModel.providerId },
      ai_reasoning: { modelId: aiModel.modelId, providerId: aiModel.providerId }
    }
  };

  // 'complete' snapshot: engines + AI insights in one authoritative update
  // (the early broadcast already delivered engines-only).
  broadcastUpdate(combinedResults);

  return payload;
}

export const debuggerOrchestrator = {
  runFullAnalysis
};
