import { ProviderGateway, type ChatCompletionMessage, type GatewayToolCall, type GatewayToolSchema } from '../providers/provider-gateway';
import { ToolExecutor } from './tool-executor';
import { SecurityPolicyEngine } from '../services/security-policy';
import { settingsManager } from '../services/settings-manager';
import type { ProviderSettings } from '../../preload/types';

export interface BackgroundAgent {
  id: string;
  name: string;
  status: 'idle' | 'running' | 'completed' | 'failed';
  task: string;
  progress: number;
  result?: any;
  error?: string;
  startedAt: number;
  completedAt?: number;
}

export interface BackgroundAgentContext {
  workspacePath: string;
  activeFilePath?: string;
  activeFileContent?: string;
  settings?: ProviderSettings;
}

const DEFAULT_MAX_CONCURRENT_AGENTS = 3;
const BACKGROUND_MAX_ITERATIONS = 20;
const AGENT_RETENTION_MS = 15 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30_000;

const READ_ONLY_TOOLS = new Set(['read_file', 'list_dir', 'grep_search', 'git_status', 'git_diff', 'git_log']);
const MUTATING_TOOL_DENIAL = 'Background agents cannot execute mutating tools. Delegate only read-only analysis work such as reading files, listing directories, searching, and git inspection.';

function buildAgentMessages(task: string, context: BackgroundAgentContext): ChatCompletionMessage[] {
  const contextLines = [
    `Workspace root: ${context.workspacePath}`,
    context.activeFilePath ? `Active file: ${context.activeFilePath}` : '',
    context.activeFileContent ? `Active file excerpt:\n${context.activeFileContent.slice(0, 4_000)}` : ''
  ].filter(Boolean).join('\n');
  const systemPrompt = [
    'You are a focused background helper agent inside Ty-Code.',
    contextLines,
    'You were delegated the subtask below and must work autonomously.',
    'Allowed tools are read-only only: read_file, list_dir, grep_search, git_status, git_diff, git_log.',
    'You must never modify files, run commands, or make git mutations.',
    'Do not ask questions; make reasonable deterministic choices from the evidence you find.',
    'When your analysis is complete, reply with a concise final answer in markdown.'
  ].join('\n\n');
  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: task }
  ];
}

function parseToolArguments(call: GatewayToolCall): Record<string, unknown> {
  try {
    return call.arguments && String(call.arguments).trim()
      ? (JSON.parse(call.arguments) as Record<string, unknown>)
      : {};
  } catch {
    return { raw: call.arguments };
  }
}

export class BackgroundAgentOrchestrator {
  agents: Map<string, BackgroundAgent> = new Map();
  maxConcurrentAgents: number = DEFAULT_MAX_CONCURRENT_AGENTS;
  private transcripts = new Map<string, ChatCompletionMessage[]>();
  private pendingStarts = new Map<string, BackgroundAgentContext>();
  private queue: string[] = [];
  private runningCount = 0;
  private waiters = new Map<string, Array<(agent: BackgroundAgent) => void>>();
  private controllers = new Map<string, AbortController>();
  private sweepTimer: ReturnType<typeof setInterval> = setInterval(() => this.sweepCompleted(), SWEEP_INTERVAL_MS);

  dispose(): void {
    clearInterval(this.sweepTimer);
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.queue = [];
    this.pendingStarts.clear();
  }

  spawnAgent(name: string, task: string, context: BackgroundAgentContext): string {
    const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const agent: BackgroundAgent = {
      id,
      name: name && name.trim() ? name.trim() : 'Background Agent',
      status: 'idle',
      task: task || '',
      progress: 0,
      startedAt: Date.now()
    };
    this.agents.set(id, agent);
    if (this.runningCount < this.maxConcurrentAgents) {
      void this.runBackgroundAgent(agent, context);
    } else {
      this.queue.push(id);
      this.pendingStarts.set(id, context);
    }
    return id;
  }

  getAgentStatus(id: string): BackgroundAgent {
    const agent = this.agents.get(id);
    if (!agent) {
      return {
        id,
        name: 'Unknown',
        status: 'failed',
        task: '',
        progress: 0,
        error: 'unknown background agent',
        startedAt: 0,
        completedAt: Date.now()
      };
    }
    return agent;
  }

  getAllAgents(): BackgroundAgent[] {
    this.sweepCompleted();
    return Array.from(this.agents.values());
  }

  getAgentDetails(id: string): { agent: BackgroundAgent; transcript: Array<{ role: string; content: string }> } {
    const agent = this.getAgentStatus(id);
    const transcript = (this.transcripts.get(id) || [])
      .filter((entry) => typeof entry.content === 'string')
      .map((entry) => ({ role: entry.role, content: entry.content as string }));
    return { agent, transcript };
  }

  cancelAgent(id: string): void {
    const agent = this.agents.get(id);
    if (!agent || agent.status === 'completed' || agent.status === 'failed') return;
    const controller = this.controllers.get(id);
    if (controller) {
      controller.abort();
      return;
    }
    const queuedIndex = this.queue.indexOf(id);
    if (queuedIndex >= 0) {
      this.queue.splice(queuedIndex, 1);
      this.pendingStarts.delete(id);
      agent.status = 'failed';
      agent.error = 'Cancelled by user before start';
      agent.completedAt = Date.now();
      this.resolveWaiters(agent);
    }
  }

  waitForAgent(id: string): Promise<any> {
    const agent = this.agents.get(id);
    if (agent && (agent.status === 'completed' || agent.status === 'failed')) {
      return Promise.resolve(agent.status === 'completed' ? agent.result : agent.error);
    }
    return new Promise<any>((resolve) => {
      const waiters = this.waiters.get(id) || [];
      waiters.push(resolve);
      this.waiters.set(id, waiters);
    });
  }

  private resolveWaiters(agent: BackgroundAgent): void {
    const waiters = this.waiters.get(agent.id) || [];
    this.waiters.delete(agent.id);
    for (const waiter of waiters) {
      waiter(agent.status === 'completed' ? agent.result : agent.error);
    }
  }

  private updateProgress(agent: BackgroundAgent, progress: number): void {
    agent.progress = Math.max(0, Math.min(100, Math.round(progress)));
  }

  private finalize(agent: BackgroundAgent, outcome: { status: 'completed' | 'failed'; result?: any; error?: string }): void {
    agent.status = outcome.status;
    if (outcome.status === 'completed') {
      agent.result = outcome.result;
    } else {
      agent.error = outcome.error;
    }
    agent.progress = 100;
    agent.completedAt = Date.now();
    this.controllers.delete(agent.id);
    this.runningCount = Math.max(0, this.runningCount - 1);
    this.resolveWaiters(agent);
    this.startNextQueued();
  }

  private sweepCompleted(): void {
    const now = Date.now();
    for (const [id, agent] of Array.from(this.agents.entries())) {
      if (agent.status !== 'completed' && agent.status !== 'failed') continue;
      if (this.waiters.has(id)) continue;
      const completedAt = agent.completedAt ?? 0;
      if (now - completedAt > AGENT_RETENTION_MS) {
        this.agents.delete(id);
        this.transcripts.delete(id);
        this.controllers.delete(id);
        this.pendingStarts.delete(id);
      }
    }
  }

  private startNextQueued(): void {
    while (this.runningCount < this.maxConcurrentAgents && this.queue.length > 0) {
      const nextId = this.queue.shift()!;
      const context = this.pendingStarts.get(nextId);
      this.pendingStarts.delete(nextId);
      const agent = this.agents.get(nextId);
      if (!agent || context === undefined) continue;
      if (agent.status === 'completed' || agent.status === 'failed') continue;
      void this.runBackgroundAgent(agent, context);
    }
  }

  private async runBackgroundAgent(agent: BackgroundAgent, context: BackgroundAgentContext): Promise<void> {
    this.runningCount++;
    const controller = new AbortController();
    this.controllers.set(agent.id, controller);
    agent.status = 'running';
    const transcripts: ChatCompletionMessage[] = [];
    try {
      const settings = context.settings ?? await settingsManager.getEffectiveSettings();
      const rawActiveProvider = settings.activeProvider || '';
      const activeProvider = !rawActiveProvider || rawActiveProvider === 'auto' ? 'openkilo' : rawActiveProvider;
      let activeModel = settings.activeModel || '';
      if (!activeModel || (activeProvider === 'openkilo' && !activeModel.endsWith(':free') && !activeModel.endsWith('/free'))) {
        if (activeProvider === 'openkilo') activeModel = 'kilo-auto/free';
        else if (activeProvider === 'groq') activeModel = 'openai/gpt-oss-120b';
        else activeModel = 'google/gemma-4-31b-it:free';
      }

      const messages = buildAgentMessages(agent.task, context);
      transcripts.push(...messages.map((entry) => ({ ...entry })));
      this.transcripts.set(agent.id, transcripts);

      const securityPolicy = new SecurityPolicyEngine(context.workspacePath, settingsManager);
      const toolExecutor = new ToolExecutor(context.workspacePath, securityPolicy);
      const readOnlySchemas: GatewayToolSchema[] = [
        { name: 'read_file', description: 'Read the contents of a file from the workspace.', parameters: { type: 'object', properties: { filePath: { type: 'string' }, startLine: { type: 'integer' }, endLine: { type: 'integer' } }, required: ['filePath'] } },
        { name: 'list_dir', description: 'List the files and folders in a directory of the workspace.', parameters: { type: 'object', properties: { directoryPath: { type: 'string' } }, required: ['directoryPath'] } },
        { name: 'grep_search', description: 'Search file contents across the workspace for a regex pattern.', parameters: { type: 'object', properties: { pattern: { type: 'string' }, directoryPath: { type: 'string' } }, required: ['pattern'] } },
        { name: 'git_status', description: 'Query the git repository status of the workspace.', parameters: { type: 'object', properties: {} } },
        { name: 'git_diff', description: 'Show uncommitted changes of the workspace.', parameters: { type: 'object', properties: {} } },
        { name: 'git_log', description: 'Show recent commits of the workspace repository.', parameters: { type: 'object', properties: { count: { type: 'integer' } } } }
      ];

      let finalText = '';
      for (let iteration = 0; iteration < BACKGROUND_MAX_ITERATIONS; iteration++) {
        if (controller.signal.aborted) break;
        this.updateProgress(agent, (iteration / BACKGROUND_MAX_ITERATIONS) * 100);

        const structuredCalls: GatewayToolCall[] = [];
        const responseText = await ProviderGateway.sendChatRequest(
          activeProvider,
          activeModel,
          messages,
          true,
          undefined,
          () => undefined,
          0,
          controller.signal,
          undefined,
          undefined,
          readOnlySchemas,
          (calls: GatewayToolCall[]) => {
            structuredCalls.push(...calls);
          }
        );
        finalText = responseText;
        transcripts.push({ role: 'assistant', content: responseText || '' });

        const deduped = structuredCalls.filter((call, index) => call.name && structuredCalls.findIndex((other) => other.name === call.name) === index);
        if (deduped.length === 0 || controller.signal.aborted) break;

        messages.push({
          role: 'assistant',
          content: responseText || '',
          tool_calls: deduped.map((call) => ({
            id: call.id,
            type: 'function' as const,
            function: { name: call.name, arguments: call.arguments }
          }))
        });

        for (const call of deduped) {
          const toolName = String(call.name);
          const toolArguments = parseToolArguments(call);
          let toolOutput: string;
          if (!READ_ONLY_TOOLS.has(toolName)) {
            toolOutput = MUTATING_TOOL_DENIAL;
          } else {
            const execution = await toolExecutor.execute(toolName, toolArguments, controller.signal);
            toolOutput = execution.output;
          }
          transcripts.push({ role: 'tool', name: toolName, tool_call_id: call.id, content: toolOutput });
          messages.push({ role: 'tool', name: toolName, tool_call_id: call.id, content: toolOutput });
        }
      }

      if (controller.signal.aborted) throw new Error('Cancelled by user');
      const safeFinal = finalText && finalText.trim() ? finalText : 'Background agent finished without a final answer. Inspect the transcript for details.';
      this.finalize(agent, { status: 'completed', result: safeFinal });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      transcripts.push({ role: 'system', content: `Background agent failed: ${message}` });
      this.finalize(agent, { status: 'failed', error: controller.signal.aborted ? 'Cancelled by user' : message });
    }
  }
}

export const backgroundAgentOrchestrator = new BackgroundAgentOrchestrator();
