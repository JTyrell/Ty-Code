import fs from 'fs/promises';
import path from 'path';
import type { TaskClass } from './prompt-assembler/schemas';

export enum AgentMode {
  Plan = 'plan',
  Execute = 'execute',
  Hybrid = 'hybrid'
}

export interface TodoItem {
  id: string;
  task: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  priority: 'high' | 'medium' | 'low';
  context?: string;
}

export interface ToolCallRecord {
  tool: string;
  args: Record<string, unknown>;
  result: unknown;
  timestamp: number;
}

export interface VerificationEvidence {
  command: string;
  result: string;
  success: boolean;
  editRevision: number;
  timestamp: number;
}

export interface CompletionContractState {
  originalObjective: string;
  taskClass: TaskClass;
  informational: boolean;
  approval: {
    explicitlyApproved: boolean;
    approvedAt?: number;
  };
  packageScripts: Record<string, string>;
  changedArtifacts: string[];
  editRevision: number;
  verification?: VerificationEvidence;
  verificationFailures: string[];
  continuationInjections: number;
}

export interface CompletionAssessment {
  complete: boolean;
  unmetEvidence: string[];
}

const DEFAULT_MAX_ITERATIONS = 70;
const EPIC_MAX_ITERATIONS = 80;
const MAX_CONTINUATION_INJECTIONS = 3;
const MAX_VERIFICATION_FAILURES = 3;
const MUTATING_TOOLS = new Set(['write_file', 'replace_file_content', 'edit_file', 'generate_presentation']);
const VERIFICATION_SCRIPT_NAME = /^(?:test|typecheck|lint|check|verify|build|audit)(?::|$)/i;
const VERIFICATION_SCRIPT_BODY = /\b(?:vitest|jest|mocha|playwright|pytest|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\w*\s+test|tsc\b|eslint\b|biome\b|esbuild\b|vite\s+build|electron-builder\b|npm\s+audit)\b/i;
const DIRECT_VERIFICATION_COMMAND = /\b(?:vitest(?:\.cmd)?\s+run|jest(?:\.cmd)?\b|mocha(?:\.cmd)?\b|playwright(?:\.cmd)?\s+test|pytest\b|cargo\s+test|go\s+test|dotnet\s+test|mvn\s+test|gradle\w*\s+test|tsc(?:\.cmd)?\s+--noEmit|eslint(?:\.cmd)?\b|biome(?:\.cmd)?\s+check)\b/i;

function cloneCompletionState(state: CompletionContractState): CompletionContractState {
  return {
    ...state,
    approval: { ...state.approval },
    packageScripts: { ...state.packageScripts },
    changedArtifacts: [...state.changedArtifacts],
    verification: state.verification ? { ...state.verification } : undefined,
    verificationFailures: [...state.verificationFailures]
  };
}

function commandScriptName(command: string): string | null {
  const segments = command.split(/&&|;/).map((segment) => segment.trim()).filter(Boolean);
  for (const segment of segments) {
    const npmMatch = segment.match(/^npm(?:\s+--[\w-]+)*\s+(?:run\s+)?([\w:.-]+)/i);
    if (npmMatch) return npmMatch[1] === 'run' ? null : npmMatch[1];
    const packageManagerMatch = segment.match(/^(?:pnpm|yarn)(?:\s+--[\w-]+)*\s+(?:run\s+)?([\w:.-]+)/i);
    if (packageManagerMatch) return packageManagerMatch[1];
  }
  return null;
}

export async function discoverPackageScripts(workspacePath: string): Promise<Record<string, string>> {
  try {
    const raw = await fs.readFile(path.join(workspacePath, 'package.json'), 'utf-8');
    const parsed = JSON.parse(raw) as { scripts?: unknown };
    if (!parsed.scripts || typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts)) return {};
    return Object.fromEntries(
      Object.entries(parsed.scripts)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
        .slice(0, 200)
    );
  } catch {
    return {};
  }
}

export function classifyVerificationCommand(
  command: string,
  packageScripts: Record<string, string>
): { isVerification: boolean; scriptName?: string } {
  const scriptName = commandScriptName(command);
  if (scriptName) {
    const body = packageScripts[scriptName];
    return {
      isVerification: typeof body === 'string'
        && (VERIFICATION_SCRIPT_NAME.test(scriptName) || VERIFICATION_SCRIPT_BODY.test(body)),
      scriptName
    };
  }
  return { isVerification: DIRECT_VERIFICATION_COMMAND.test(command) };
}

function normalizeArtifact(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/^\.\//, '');
}

export class AgentStateManager {
  currentMode: AgentMode = AgentMode.Hybrid;
  todos: TodoItem[] = [];
  iterationCount = 0;
  maxIterations = DEFAULT_MAX_ITERATIONS;
  toolCallHistory: ToolCallRecord[] = [];
  private estimatedTokenUsage = 0;
  private completionContract: CompletionContractState | null = null;

  addTodo(task: string, priority: 'high' | 'medium' | 'low' = 'medium'): string {
    const id = `todo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.todos.push({ id, task, status: 'pending', priority, context: '' });
    return id;
  }

  addTodos(tasks: Array<{ task: string; priority?: 'high' | 'medium' | 'low' }>): string[] {
    return tasks.map(({ task, priority = 'medium' }) => this.addTodo(task, priority));
  }

  restoreTodos(tasks: TodoItem[]): void {
    const validStatuses = new Set<TodoItem['status']>(['pending', 'in_progress', 'completed', 'failed']);
    const validPriorities = new Set<TodoItem['priority']>(['high', 'medium', 'low']);
    this.todos = Array.isArray(tasks)
      ? tasks
          .filter((task) => task && typeof task.id === 'string' && typeof task.task === 'string')
          .map((task) => ({
            ...task,
            status: validStatuses.has(task.status) ? task.status : 'pending',
            priority: validPriorities.has(task.priority) ? task.priority : 'medium'
          }))
      : [];
  }

  updateTodoStatus(id: string, status: TodoItem['status']): void {
    const todo = this.todos.find((item) => item.id === id);
    if (todo) todo.status = status;
  }

  updateTodoFromTool(id: string, toolName: string, succeeded: boolean, verificationCommand = false): boolean {
    if (!succeeded) return false;
    const todo = this.todos.find((item) => item.id === id);
    if (!todo) return false;
    const isDiscoveryTool = ['read_file', 'list_dir', 'list_directory', 'grep_search'].includes(toolName)
      && /\b(discover|inspect|read|review|analy[sz]e|search|locate|find)\b/i.test(todo.task);
    if (!MUTATING_TOOLS.has(toolName) && !(toolName === 'run_command' && verificationCommand) && !isDiscoveryTool) {
      return false;
    }
    todo.status = 'completed';
    return true;
  }

  getNextPendingTodo(): TodoItem | null {
    const pending = this.todos.filter((todo) => todo.status === 'pending');
    if (pending.length === 0) return null;
    pending.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
    return pending[0];
  }

  getActiveTodo(): TodoItem | null {
    return this.todos.find((todo) => todo.status === 'in_progress') || null;
  }

  getCompletedTodos(): TodoItem[] {
    return this.todos.filter((todo) => todo.status === 'completed');
  }

  getFailedTodos(): TodoItem[] {
    return this.todos.filter((todo) => todo.status === 'failed');
  }

  initializeCompletionContract(input: {
    originalObjective: string;
    taskClass: TaskClass;
    informational: boolean;
    packageScripts?: Record<string, string>;
  }): void {
    this.maxIterations = DEFAULT_MAX_ITERATIONS;
    this.completionContract = {
      originalObjective: input.originalObjective.slice(0, 8_000),
      taskClass: input.taskClass,
      informational: input.informational,
      approval: { explicitlyApproved: false },
      packageScripts: { ...(input.packageScripts || {}) },
      changedArtifacts: [],
      editRevision: 0,
      verificationFailures: [],
      continuationInjections: 0
    };
  }

  restoreCompletionContract(state: CompletionContractState | null | undefined): void {
    if (!state || typeof state.originalObjective !== 'string') return;
    this.completionContract = cloneCompletionState({
      ...state,
      approval: state.approval || { explicitlyApproved: false },
      packageScripts: state.packageScripts || {},
      changedArtifacts: Array.isArray(state.changedArtifacts) ? state.changedArtifacts.slice(0, 100) : [],
      editRevision: Number.isInteger(state.editRevision) ? Math.max(0, state.editRevision) : 0,
      verificationFailures: Array.isArray(state.verificationFailures)
        ? state.verificationFailures.slice(-MAX_VERIFICATION_FAILURES)
        : [],
      continuationInjections: Number.isInteger(state.continuationInjections)
        ? Math.min(MAX_CONTINUATION_INJECTIONS, Math.max(0, state.continuationInjections))
        : 0
    });
    this.maxIterations = this.completionContract.taskClass === 'Epic'
      && this.completionContract.approval.explicitlyApproved
      ? EPIC_MAX_ITERATIONS
      : DEFAULT_MAX_ITERATIONS;
  }

  getCompletionContractSnapshot(): CompletionContractState | null {
    return this.completionContract ? cloneCompletionState(this.completionContract) : null;
  }

  recordExplicitApproval(approved: boolean): void {
    if (!this.completionContract || !approved) return;
    this.completionContract.approval = { explicitlyApproved: true, approvedAt: Date.now() };
    if (this.completionContract.taskClass === 'Epic') this.maxIterations = EPIC_MAX_ITERATIONS;
  }

  recordToolCall(tool: string, args: Record<string, unknown>, result: unknown): void {
    this.toolCallHistory.push({ tool, args, result, timestamp: Date.now() });
  }

  recordSuccessfulEdit(toolName: string, args: Record<string, unknown>): boolean {
    if (!this.completionContract || !MUTATING_TOOLS.has(toolName)) return false;
    const rawPath = String(args.filePath || args.path || args.outputPath || '');
    const artifact = normalizeArtifact(rawPath);
    if (!artifact) return false;
    if (!this.completionContract.changedArtifacts.includes(artifact)) {
      this.completionContract.changedArtifacts.push(artifact);
    }
    this.completionContract.editRevision++;
    this.completionContract.verification = undefined;
    return true;
  }

  recordVerification(command: string, result: string, success: boolean): boolean {
    if (!this.completionContract) return false;
    const classification = classifyVerificationCommand(command, this.completionContract.packageScripts);
    if (!classification.isVerification) return false;
    this.completionContract.verification = {
      command: command.trim().slice(0, 1_000),
      result: result.trim().slice(0, 4_000),
      success,
      editRevision: this.completionContract.editRevision,
      timestamp: Date.now()
    };
    if (!success) {
      const failure = `${command.trim()}\n${result.trim()}`.slice(0, 1_500);
      this.completionContract.verificationFailures = [
        ...this.completionContract.verificationFailures,
        failure
      ].slice(-MAX_VERIFICATION_FAILURES);
    }
    return true;
  }

  assessCompletion(finalText: string): CompletionAssessment {
    const state = this.completionContract;
    if (!state || state.informational) return { complete: true, unmetEvidence: [] };
    const unmetEvidence: string[] = [];
    if (!state.approval.explicitlyApproved) unmetEvidence.push('explicit approval for the implementation plan');
    if (this.todos.length === 0) unmetEvidence.push('a non-empty approved todo list');
    else if (!this.allTodosComplete()) {
      const remaining = this.todos.filter((todo) => todo.status !== 'completed').map((todo) => todo.task);
      unmetEvidence.push(`completed todos (${remaining.slice(0, 5).join('; ')})`);
    }
    if (state.changedArtifacts.length === 0) unmetEvidence.push('at least one successful changed artifact');
    const verification = state.verification;
    if (!verification?.success) unmetEvidence.push('a successful real verification command');
    else if (verification.editRevision !== state.editRevision) unmetEvidence.push('successful verification after the latest edit');

    const normalizedFinal = finalText.toLowerCase().replace(/\\/g, '/');
    if (state.changedArtifacts.length > 0) {
      const namesArtifact = state.changedArtifacts.some((artifact) => {
        const normalized = artifact.toLowerCase();
        const basename = path.posix.basename(normalized);
        return normalizedFinal.includes(normalized) || (basename.length >= 4 && normalizedFinal.includes(basename));
      });
      if (!namesArtifact) unmetEvidence.push('a final summary naming a real changed artifact');
    }
    if (verification?.success && verification.editRevision === state.editRevision) {
      if (!normalizedFinal.includes(verification.command.toLowerCase())) {
        unmetEvidence.push('the verification command in the final summary');
      }
      if (!/\b(?:pass(?:ed|ing)?|success(?:ful|fully)?|exit\s*code\s*:?\s*0|no\s+errors?|completed)\b/i.test(finalText)) {
        unmetEvidence.push('the verification result in the final summary');
      }
    }
    return { complete: unmetEvidence.length === 0, unmetEvidence };
  }

  consumeContinuationInjection(): boolean {
    if (!this.completionContract) return false;
    if (this.completionContract.continuationInjections >= MAX_CONTINUATION_INJECTIONS) return false;
    this.completionContract.continuationInjections++;
    return true;
  }

  getContinuationInjectionCount(): number {
    return this.completionContract?.continuationInjections || 0;
  }

  getPinnedTaskContext(): string {
    const state = this.completionContract;
    if (!state) return '';
    const verification = state.verification
      ? `${state.verification.success ? 'PASS' : 'FAIL'} at edit revision ${state.verification.editRevision}: ${state.verification.command}\n${state.verification.result.slice(0, 800)}`
      : 'none';
    const failures = state.verificationFailures.length
      ? state.verificationFailures.map((failure) => `- ${failure.slice(0, 500)}`).join('\n')
      : '- none';
    return [
      '## Pinned Task Contract',
      `Original objective: ${state.originalObjective}`,
      `Task class: ${state.taskClass}`,
      `Explicit approval: ${state.approval.explicitlyApproved ? 'yes' : 'no'}`,
      `Todo state:\n${this.todos.length ? this.todos.map((todo) => `- [${todo.status}] ${todo.task}`).join('\n') : '- none'}`,
      `Changed artifacts (edit revision ${state.editRevision}):\n${state.changedArtifacts.length ? state.changedArtifacts.map((artifact) => `- ${artifact}`).join('\n') : '- none'}`,
      `Latest verification: ${verification}`,
      `Bounded verification failures:\n${failures}`
    ].join('\n');
  }

  updateTokenUsage(tokens: number): void {
    this.estimatedTokenUsage = tokens;
  }

  shouldCompactContext(): boolean {
    return this.estimatedTokenUsage > 85_000;
  }

  getCompactSummary(): string {
    const completed = this.getCompletedTodos();
    const failed = this.getFailedTodos();
    const recentTools = this.toolCallHistory.slice(-10);
    let summary = '## Context Summary\n';
    if (completed.length > 0) {
      summary += `### Completed Tasks (${completed.length})\n`;
      completed.forEach((todo) => { summary += `- ${todo.task}\n`; });
      summary += '\n';
    }
    if (failed.length > 0) {
      summary += `### Failed Tasks (${failed.length})\n`;
      failed.forEach((todo) => { summary += `- ${todo.task} (FAILED)\n`; });
      summary += '\n';
    }
    if (recentTools.length > 0) {
      summary += '### Recent Tool Activity\n';
      recentTools.forEach((record) => {
        summary += `- ${record.tool}(${JSON.stringify(record.args).slice(0, 80)}) -> ${JSON.stringify(record.result).slice(0, 100)}\n`;
      });
    }
    const pinned = this.getPinnedTaskContext();
    return pinned ? `${summary}\n${pinned}` : summary;
  }

  resetRun(): void {
    this.todos = [];
    this.iterationCount = 0;
    this.maxIterations = DEFAULT_MAX_ITERATIONS;
    this.toolCallHistory = [];
    this.estimatedTokenUsage = 0;
    this.completionContract = null;
  }

  reset(): void {
    this.resetRun();
    this.currentMode = AgentMode.Hybrid;
  }

  allTodosComplete(): boolean {
    return this.todos.length > 0 && this.todos.every((todo) => todo.status === 'completed');
  }

  hasPendingTodos(): boolean {
    return this.todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress' || todo.status === 'failed');
  }

  getPendingCount(): number {
    return this.todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress').length;
  }
}

export function createAgentStateManager(): AgentStateManager {
  return new AgentStateManager();
}

export const agentStateManager = new AgentStateManager();
