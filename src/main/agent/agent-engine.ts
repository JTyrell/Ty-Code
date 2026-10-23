import type { AgentApprovalDecision, AgentHarnessType, AgentStreamChunk, AgentToolApproval, ChatMessage, ProposedDiff, ProviderSettings, ToolCall } from '../../preload/types';
import { ProviderGateway, type ChatCompletionMessage, type GatewayToolCall, type GatewayToolSchema, getVerifiedModels, isFreeModel, providerHasOwnKey } from '../providers/provider-gateway';
export { ProviderGateway };
import { buildSystemPrompt, AGENT_TOOLS_DEFINITIONS, TASK_SCOPING_PROTOCOL, getEccRulesPrompt, getSeoPromptGuidance, isLocalModel } from './system-prompt';
import { ToolExecutor, type ToolExecutionResponse } from './tool-executor';
import { getHarness } from '../services/orchestration/harnesses';
import { getActiveAgentConfig } from './agent-config';
import { SecurityPolicyEngine } from '../services/security-policy';
import { settingsManager, type SettingsManager } from '../services/settings-manager';
import { modelRouter } from '../services/orchestration/model-router';
import { moduleRegistry } from '../services/module-registry';
import { mcpManager } from '../services/mcp-manager';
import { diagnosticsHealthMonitor } from '../services/diagnostics/health-monitor';
import { optimizationPipeline } from '../providers/optimization-pipeline';
import { failoverResumeManager, type TurnSnapshot } from './failover-resume';
import { agentStateManager, AgentMode, type TodoItem } from './agent-state-manager';
import { compactMessages, estimateContextTokens, estimateTokenCount, generateSummary, shouldCompact, buildFallbackSummary, MODEL_CONTEXT_LIMIT } from './context-compactor';
import { fileMemoryManager, extractKeySymbols, extractDependencies } from './file-memory';
import { sessionStore, buildSessionSnapshot, type AgentSessionState } from './session-store';
import { toolApprovalManager, type ApprovalRule } from './tool-approval-manager';
import { backgroundAgentOrchestrator } from './background-agent-orchestrator';
import { ShellSandbox } from './shell-sandbox';
import { agentObservability } from './agent-observability';
import { skillRegistry } from './agent-skills';

import { connectivityTracer } from '../services/diagnostics/connectivity-tracer';
import { getWorkspaceSummary, getOpenFilesContent, buildWorkspaceContextBlock } from '../services/workspace-context-manager';

export interface RunAgentParams {
  prompt: string;
  images?: string[];
  workspacePath: string;
  history: ChatMessage[];
  settings: ProviderSettings;
  harness?: AgentHarnessType;
  activeFilePath?: string;
  activeFileContent?: string;
  openFilePaths?: string[];
  traceId?: string;
  onChunk: (chunk: AgentStreamChunk) => void;
  requestApproval: (approval: AgentToolApproval) => Promise<AgentApprovalDecision>;
  abortSignal?: AbortSignal;
  onProviderHandoff?: (info: { fromProvider: string; toProvider: string; toModel: string }) => void;
  taskId?: string;
  resumeSessionId?: string;
}

/**
 * Picks the next agent provider after a mid-turn provider failure.
 *
 * Uses the SAME unified provider feed as the rest of the app
 * (getVerifiedModels) plus the layered key resolver (providerHasOwnKey), so
 * the agent can hop between paid, free, FCC sidecar, subscription and local
 * providers with zero special-casing. Roadmap order:
 *   1. FCC supply layer (free capacity outranks burning keys)
 *   2. The SAME model on another provider (keeps behaviour consistent)
 *   3. Free pool (keyless or owned free tiers), then any keyed candidate
 */
async function pickNextAgentProvider(
  excludedProviderIds: Set<string>,
  failedModelId: string
): Promise<{ providerId: string; modelId: string } | undefined> {
  try {
    const models = await getVerifiedModels();
    const normId = (id: string): string => (id || '').toLowerCase().trim().replace(/-free$/, '');
    const isFreeCandidate = (m: { modelId: string; providerId: string; requiresKey: boolean }): boolean =>
      isFreeModel(m.modelId, m.providerId) || !m.requiresKey;

    const eligible = models.filter((m) => {
      const pid = normId(m.providerId);
      if (pid && excludedProviderIds.has(pid)) return false;
      return !m.requiresKey || providerHasOwnKey(m.providerId);
    });
    if (eligible.length === 0) return undefined;

    const fccEntry = eligible.find(
      (m) =>
        normId(m.providerId) === 'fcc' ||
        m.providerId.toLowerCase().trim() === 'fcc-proxy' ||
        m.providerId.toLowerCase().trim() === 'anthropic-claude-free'
    );
    if (fccEntry) return { providerId: fccEntry.providerId, modelId: fccEntry.modelId };

    const failedModel = (failedModelId || '').toLowerCase();
    const sameModelElsewhere = eligible.find((m) => m.modelId.toLowerCase() === failedModel);
    if (sameModelElsewhere) return { providerId: sameModelElsewhere.providerId, modelId: sameModelElsewhere.modelId };

    const freePool = eligible.filter(isFreeCandidate);
    const pool = freePool.length > 0 ? freePool : eligible;
    return { providerId: pool[0].providerId, modelId: pool[0].modelId };
  } catch {
    return undefined;
  }
}

/**
 * Resolves the active model's maximum context window in tokens.
 * Accurately determines capacity limits so the 85% Auto-Compaction
 * threshold triggers correctly for all model tiers (8k, 32k, 64k, 128k, 200k, 1M).
 */
async function resolveModelContextLimit(providerId: string, modelId: string): Promise<number> {
  try {
    const models = await getVerifiedModels();
    const match = models.find((m) =>
      m.modelId.toLowerCase() === modelId.toLowerCase() &&
      (!providerId || m.providerId.toLowerCase() === providerId.toLowerCase())
    ) || models.find((m) => m.modelId.toLowerCase() === modelId.toLowerCase());
    if (match && typeof (match as any).contextWindow === 'number' && (match as any).contextWindow > 0) {
      return (match as any).contextWindow;
    }
  } catch {}

  const lower = (modelId || '').toLowerCase();
  if (lower.includes('1m') || lower.includes('gemini-1.5') || lower.includes('gemini-2.0') || lower.includes('gemini-2.5')) return 1_048_576;
  if (lower.includes('claude-3') || lower.includes('claude-3-5') || lower.includes('claude-3-7') || lower.includes('sonnet') || lower.includes('opus')) return 200_000;
  if (lower.includes('llama-3.3') || lower.includes('llama-3.1') || lower.includes('gpt-4o') || lower.includes('o1') || lower.includes('o3') || lower.includes('gpt-4-turbo')) return 128_000;
  if (lower.includes('deepseek-r1') || lower.includes('deepseek-v3')) return 64_000;
  if (lower.includes('qwen-2.5-coder')) return 32_768;
  if (lower.includes('llama-3-8b') || lower.includes('mistral-7b')) return 8_192;

  return MODEL_CONTEXT_LIMIT;
}

export class AgentEngine {
  private toolExecutor: ToolExecutor;
  private securityPolicy: SecurityPolicyEngine;
  private shellSandbox: ShellSandbox;
  private fileMemoryRefreshInFlight = new Set<string>();

  constructor(private workspacePath: string = process.cwd(), settingsSource: Pick<SettingsManager, 'getEffectiveSettings'> = settingsManager) {
    this.securityPolicy = new SecurityPolicyEngine(this.workspacePath, settingsSource);
    this.toolExecutor = new ToolExecutor(this.workspacePath, this.securityPolicy);
    this.shellSandbox = new ShellSandbox(this.workspacePath);
  }

  get approvalRules(): ApprovalRule[] {
    return toolApprovalManager.getStandingApprovals();
  }

  private async refreshFileMemory(filePath: string, content: string, provider: string, model: string): Promise<void> {
    try {
      if (this.fileMemoryRefreshInFlight.has(filePath)) return;
      this.fileMemoryRefreshInFlight.add(filePath);
      const excerpt = content.slice(0, 4_000);
      let summary = '';
      try {
        const response = await ProviderGateway.sendChatRequest(provider, model, [
          { role: 'system', content: 'Summarize the purpose of the provided source file in one concise sentence mentioning its main responsibility. Output only that sentence.' },
          { role: 'user', content: excerpt }
        ], false);
        const cleaned = (response || '').trim();
        if (cleaned.length >= 10 && cleaned.length <= 300 && !cleaned.startsWith('{')) summary = cleaned;
      } catch {
        summary = '';
      }
      const symbols = extractKeySymbols(excerpt);
      fileMemoryManager.updateMemory(filePath, {
        ...(summary ? { summary } : {}),
        ...(symbols.length ? { keySymbols: symbols.slice(0, 12) } : {}),
        dependencies: extractDependencies(excerpt)
      });
    } catch {
      return;
    } finally {
      this.fileMemoryRefreshInFlight.delete(filePath);
    }
  }

  private async executeWithSandbox(
    toolCall: ToolCall,
    approvedExecutionArgs: Record<string, unknown>,
    abortSignal?: AbortSignal
  ): Promise<ToolExecutionResponse> {
    if (toolCall.name === 'run_command' || toolCall.name === 'run_terminal_command') {
      const toolStartedAt = Date.now();
      const command = String(approvedExecutionArgs.command ?? toolCall.arguments.command ?? '');
      const shellResult = await this.shellSandbox.executeCommand(command, { abortSignal });
      const sections = [
        shellResult.stdout ? `--- stdout ---\n${shellResult.stdout}` : '',
        shellResult.stderr ? `--- stderr ---\n${shellResult.stderr}` : ''
      ].filter(Boolean);
      const output = shellResult.blocked
        ? `Sandbox: ${shellResult.blocked}`
        : [...sections, sections.length ? `Exit code: ${shellResult.exitCode} (${shellResult.duration}ms)` : '(no output)'].join('\n');
      agentObservability.recordEvent({
        type: 'tool_call',
        toolName: toolCall.name,
        args: toolCall.arguments,
        duration: Date.now() - toolStartedAt,
        success: shellResult.success
      });
      return { output, isError: !shellResult.success };
    }
    const executorStartedAt = Date.now();
    const executorResult = await this.toolExecutor.execute(toolCall.name, approvedExecutionArgs, abortSignal);
    agentObservability.recordEvent({
      type: 'tool_call',
      toolName: toolCall.name,
      args: toolCall.arguments,
      duration: Date.now() - executorStartedAt,
      success: !executorResult.isError
    });
    return executorResult;
  }

  async run(params: RunAgentParams): Promise<void> {
    const { prompt, workspacePath, history, settings, activeFilePath, activeFileContent, onChunk, requestApproval, abortSignal } = params;
    const harnessType = params.harness || settings.activeHarness || 'claude-code';
    const harness = getHarness(harnessType);

    // Initialize Agent State Manager (shared singleton so IPC can inspect live state)
    const stateManager = agentStateManager;
    stateManager.resetRun();
    stateManager.currentMode = AgentMode.Plan;
    stateManager.maxIterations = 70;

    let restoredSession: AgentSessionState | null = null;
    if (params.resumeSessionId) {
      try {
        restoredSession = await sessionStore.loadSession(params.resumeSessionId);
      } catch {
        restoredSession = null;
      }
    }
    if (restoredSession) {
      stateManager.currentMode = restoredSession.mode === 'execute' ? AgentMode.Execute : AgentMode.Plan;
      stateManager.restoreTodos(restoredSession.todos || []);
    }

    const sessionId = params.taskId || `session_${Date.now().toString(36)}`;
    const sessionStartedAt = Date.now();
    const persistSessionState = (completed = false): void => {
      sessionStore.saveSession(buildSessionSnapshot(sessionId, workspacePath, {
        currentMode: stateManager.currentMode,
        todos: stateManager.todos,
        iterationCount: stateManager.iterationCount,
        toolCallHistory: stateManager.toolCallHistory
      }, sessionStartedAt, completed));
    };
    persistSessionState();

    const approvalState: { userApproved: boolean } = { userApproved: false };
    toolApprovalManager.setUserApprovalDelegate(async (delegatedToolName, delegatedArgs) => {
      if (approvalState.userApproved) return { approved: true };
      const approval: AgentToolApproval = {
        id: `approval_rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
        toolCall: {
          id: `rule_tool_${Date.now().toString(36)}`,
          name: delegatedToolName,
          arguments: (delegatedArgs && typeof delegatedArgs === 'object') ? { ...delegatedArgs } : {}
        },
        reason: `Standing approval rules require confirmation for ${delegatedToolName}.`,
        approvalKind: 'tool_permission'
      };
      onChunk({ type: 'status', content: 'Waiting for your approval…' });
      const decision = (await requestApproval?.(approval)) || { approved: false };
      if (decision.approved) approvalState.userApproved = true;
      return decision;
    });

    // Emit initial todo state to renderer
    onChunk({ type: 'agent_state', state: { todos: stateManager.todos, mode: stateManager.currentMode, iteration: 0, maxIterations: stateManager.maxIterations } });

    const isEccEnabled = Boolean(
      settings?.integrations?.['ecc-rules'] ?? moduleRegistry.getModule('ecc-rules')?.isEnabled
    );
    const isSeoEnabled = Boolean(
      settings?.integrations?.['seo-analytics-mcp'] ?? await mcpManager.isSeoServerEnabled(workspacePath)
    );
    const isLocal = isLocalModel(settings?.activeProvider, settings?.activeModel);

    let systemPrompt = harness.formatSystemPrompt(workspacePath, activeFilePath, activeFileContent) ||
      buildSystemPrompt(workspacePath, activeFilePath, activeFileContent, {
        isEccEnabled,
        isSeoEnabled,
        isLocal,
        activeProvider: settings?.activeProvider,
        activeModel: settings?.activeModel,
        settings
      });

    if (isEccEnabled && !systemPrompt.includes('ADVANCED AGENT WORKFLOWS (ECC')) {
      systemPrompt += `\n\n${getEccRulesPrompt(isLocal)}`;
    }
    if (isSeoEnabled && !systemPrompt.includes('OPEN SEO & ANALYTICS MCP')) {
      systemPrompt += `\n\n${getSeoPromptGuidance(isLocal)}`;
    }
    if (!systemPrompt.includes('TASK SCOPING PROTOCOL')) {
      systemPrompt += `\n\n## TASK SCOPING PROTOCOL (MANDATORY)\n\n${TASK_SCOPING_PROTOCOL}`;
    }

    await skillRegistry.ensureSkillsLoaded(workspacePath);
    const activeSkill = skillRegistry.detectSkill(prompt);
    if (activeSkill) {
      systemPrompt += skillRegistry.activateSkill(activeSkill);
    }

    // Build initial messages
    let messages: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const message of history.slice(-10)) {
      if (message.role === 'user' || message.role === 'assistant') {
        messages.push(
          message.role === 'user' && Array.isArray((message as any).images) && (message as any).images.length > 0
            ? ({ role: 'user', content: message.content, images: (message as any).images } as ChatCompletionMessage)
            : { role: message.role, content: message.content }
        );
      }
    }
    messages.push(
      Array.isArray(params.images) && params.images.length > 0
        ? ({ role: 'user', content: prompt, images: params.images } as ChatCompletionMessage)
        : { role: 'user', content: prompt }
    );

    if (params.traceId) {
      connectivityTracer.recordHop(params.traceId, 'H4', {
        status: 'PASS',
        payloadSize: systemPrompt.length,
        metadata: {
          systemPromptLength: systemPrompt.length,
          toolsCount: AGENT_TOOLS_DEFINITIONS.length,
          toolNames: AGENT_TOOLS_DEFINITIONS.map((t) => t.function.name),
          harness: harness.metadata.name
        }
      });
    }

    // Universal tool schema
    const toolSchemas: GatewayToolSchema[] = AGENT_TOOLS_DEFINITIONS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }));

    // Workspace ground-truth (asynchronous, non-blocking)
    const workspaceSummary = await getWorkspaceSummary(workspacePath);
    const openFilePaths = params.openFilePaths?.length ? params.openFilePaths : activeFilePath ? [activeFilePath] : [];
    const openFiles = await getOpenFilesContent(workspacePath, openFilePaths, activeFilePath);
    const workspaceContextBlock = buildWorkspaceContextBlock({
      rootPath: workspacePath,
      workspaceSummary,
      openFiles,
      activeFilePath,
      activeFileContent
    });
    if (!systemPrompt.includes('WORKSPACE GROUND TRUTH')) {
      systemPrompt = `${systemPrompt}\n\n=== WORKSPACE GROUND TRUTH (live context) ===\n${workspaceContextBlock}\n=== END WORKSPACE GROUND TRUTH ===`;
    }

    const isFileMemoryEnabled = settings?.integrations?.['file-memory'] === true;
    if (isFileMemoryEnabled) {
      await fileMemoryManager.ensureLoaded();
      const relevantMemories = fileMemoryManager.getRelevantFiles(prompt, 6);
      if (relevantMemories.length > 0) {
        const memoryLines = relevantMemories.map((memory) =>
          `- ${memory.path}${memory.summary ? `: ${memory.summary}` : ''}${memory.keySymbols.length ? ` [${memory.keySymbols.slice(0, 6).join(', ')}]` : ''}`
        );
        systemPrompt += `\n\n=== FILE MEMORY (recently traversed files) ===\n${memoryLines.join('\n')}\n=== END FILE MEMORY ===`;
      }
    }

    let currentSettings = { ...settings };
    const failedProviders = new Set<string>();

    // ===== Seamless Mid-Turn Failover state (Harness Controller) =====
    // Once a provider throttles or goes down mid-run, the engine pins the next
    // eligible provider from getVerifiedModels() for the remainder of the run
    // and resumes the loop with the Todo state fully preserved.
    const providerSwitch: { provider: string; model: string; active: boolean } = { provider: '', model: '', active: false };
    const MAX_PROVIDER_SWITCHES = 3;
    let providerSwitchesUsed = 0;
    let runProvider = '';
    let runModel = '';
    let savedPartialStream = '';
    let currentTurnSnapshot: TurnSnapshot | null = null;

    onChunk({ type: 'status', content: 'Thinking…' });

    // Helper: Build messages with todo context injected
    const buildMessagesWithTodos = (msgs: ChatCompletionMessage[], todos: TodoItem[]): ChatCompletionMessage[] => {
      if (todos.length === 0) return msgs;
      
      const todoContext = `\n\n## Active Tasks\n${todos.map(t => 
        `- [${t.status.toUpperCase()}] ${t.task} (Priority: ${t.priority})${t.context ? ` — ${t.context}` : ''}`
      ).join('\n')}\n`;
      
      // Find the last system message and append todo context
      const newMessages = [...msgs];
      let lastSystemIdx = -1;
      for (let i = newMessages.length - 1; i >= 0; i--) {
        if (newMessages[i].role === 'system') { lastSystemIdx = i; break; }
      }
      if (lastSystemIdx >= 0) {
        newMessages[lastSystemIdx] = {
          ...newMessages[lastSystemIdx],
          content: newMessages[lastSystemIdx].content + todoContext + '\n\nUpdate task status as you complete them. If all tasks are done, provide a final summary.'
        };
      }
      return newMessages;
    };

    // Helper: Parse todos from LLM response (plan mode)
    const parseTodosFromResponse = (content: string): Array<{ task: string; priority: 'high' | 'medium' | 'low' }> => {
      const todos: Array<{ task: string; priority: 'high' | 'medium' | 'low' }> = [];
      const lines = content.split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        // Match patterns like: "- [ ] Task", "1. Task", "- Task", "TODO: Task"
        const match = trimmed.match(/^[-*•]\s*\[?[ x]?\]?\s*(.+)$/i) ||
                      trimmed.match(/^\d+\.\s*(.+)$/) ||
                      trimmed.match(/^TODO[:\-]\s*(.+)$/i);
        if (match) {
          const task = match[1].trim();
          if (task.length > 5 && task.length < 200) {
            let priority: 'high' | 'medium' | 'low' = 'medium';
            const lower = task.toLowerCase();
            if (/\b(critical|urgent|immediate|blocker|security)\b/i.test(lower)) priority = 'high';
            else if (/\b(low|minor|nice|later)\b/i.test(lower)) priority = 'low';
            todos.push({ task, priority });
          }
        }
      }
      return todos;
    };

    // Helper: Find related todo for a tool call
    const getRelatedTodo = (toolCall: ToolCall, todos: TodoItem[]): TodoItem | null => {
      const lowerTask = toolCall.name.toLowerCase();
      return todos.find(t => 
        t.status === 'pending' && (
          t.task.toLowerCase().includes(lowerTask) ||
          (toolCall.arguments.filePath && t.task.toLowerCase().includes(String(toolCall.arguments.filePath).toLowerCase())) ||
          (toolCall.arguments.path && t.task.toLowerCase().includes(String(toolCall.arguments.path).toLowerCase()))
        )
      ) || todos.find(t => t.status === 'pending') || null;
    };

    // Helper: Populate todos from the approved Execution Plan (Phased) section of the report
    const populateTodosFromPlan = (report: string): void => {
      const lines = report.split('\n');
      const planIdx = lines.findIndex((line) => /Execution Plan\s*\(\s*Phased\s*\)/i.test(line));
      if (planIdx === -1) return;
      for (let i = planIdx + 1; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (trimmed.length === 0) continue;
        if (/^\d+\.\s*\*\*$/.test(trimmed) || (/^\d+\.\s/.test(trimmed) && !/Phase/i.test(trimmed))) break;
        const match = trimmed.match(/^[-*•]\s*\*\*Phase\s*\d+[^*]*\*\*\s*[:\-–—]?\s*(.+)$/i) ||
                      trimmed.match(/^[-*•]\s*\*\*(Discovery|Implementation|Verification)\*\*\s*[:\-–—]?\s*(.+)$/i);
        if (match) {
          const task = match[2].replace(/\*\*/g, '').trim();
          if (task.length > 3 && task.length < 300) stateManager.addTodo(task, 'medium');
        }
      }
    };

    while (stateManager.iterationCount < stateManager.maxIterations) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'cancelled' });
        return;
      }
      // Yield to the Node.js event loop between ReAct iterations to keep IPC and UI non-blocking
      await new Promise<void>((resolve) => setImmediate(resolve));
      try {
        console.log(`[AGENT] Iteration ${stateManager.iterationCount + 1}/${stateManager.maxIterations} — mode: ${stateManager.currentMode}`);

        // Select provider/model. Once a mid-turn failover has pinned a new
        // provider, that override drives every subsequent iteration of this
        // run; the Todo list is untouched by the switch.
        let activeProvider: string;
        let activeModel: string;
        if (providerSwitch.active && providerSwitch.provider) {
          activeProvider = providerSwitch.provider;
          activeModel = providerSwitch.model || 'kilo-auto/free';
          runProvider = activeProvider;
          runModel = activeModel;
          console.log(`[AGENT] Provider (failover override): ${activeProvider}, Model: ${activeModel}`);
        } else {
          // Live active-config read: renderer selections (models:update-active-model-config)
          // land here between iterations without a task restart.
          const globalActive = typeof ProviderGateway.getActiveModel === 'function' ? ProviderGateway.getActiveModel() : null;
          const agentCfg = getActiveAgentConfig();
          const hasLiveOverride = Boolean(
            (globalActive && (globalActive.isAutoMode || (globalActive.providerId && globalActive.modelId))) ||
            (agentCfg.providerId && agentCfg.updatedAt > 0)
          );
          const rawActiveProvider = globalActive?.isAutoMode
            ? 'auto'
            : (globalActive?.providerId || (hasLiveOverride ? agentCfg.providerId : currentSettings.activeProvider) || '');
          const rawConfiguredModel = globalActive?.isAutoMode
            ? 'Auto'
            : (globalActive?.modelId || (hasLiveOverride ? agentCfg.modelId : currentSettings.activeModel));
          const isAutoBinding = !rawActiveProvider || rawActiveProvider === 'auto' || globalActive?.isAutoMode;

          if (isAutoBinding) {
            const lastUserMessage = [...messages].reverse().find((m: any) => m.role === 'user');
            const promptSample = String(lastUserMessage?.content || '').slice(0, 2000) || 'general assistance';
            try {
              const decision = await modelRouter.selectModel(promptSample);
              activeProvider = decision.selectedModel.providerId;
              activeModel = decision.selectedModel.modelId;
            } catch (autoErr: unknown) {
              console.warn('[AGENT] FCC Auto routing unavailable, using free default:', autoErr instanceof Error ? autoErr.message : autoErr);
              activeProvider = 'openkilo';
              activeModel = 'kilo-auto/free';
            }
          } else {
            activeProvider = rawActiveProvider;
            activeModel = rawConfiguredModel || '';
            if (!activeModel || (activeProvider === 'openkilo' && !activeModel.endsWith(':free') && !activeModel.endsWith('/free'))) {
              if (activeProvider === 'openkilo') {
                activeModel = 'kilo-auto/free';
              } else if (activeProvider === 'groq') {
                activeModel = 'llama-3.3-70b-versatile';
              } else {
                activeModel = 'google/gemma-4-31b-it:free';
              }
            }
          }
          runProvider = activeProvider;
          runModel = activeModel;
          console.log(`[AGENT] Provider: ${activeProvider}, Model: ${activeModel}`);
        }

        // 1. Compact context when the estimated token budget crosses 85% capacity of the model limit
        const activeModelLimit = await resolveModelContextLimit(activeProvider, activeModel);
        const preCompactTokens = estimateContextTokens(messages);
        stateManager.updateTokenUsage(preCompactTokens);
        if (shouldCompact(messages, activeModelLimit)) {
          console.log(`[AGENT] Context at ${preCompactTokens}/${activeModelLimit} tokens (${Math.round((preCompactTokens / activeModelLimit) * 100)}% capacity). Triggering auto-compaction pass.`);
          onChunk({ type: 'status', content: 'Compacting context…' });
          let summary = '';
          try {
            summary = await generateSummary(messages, async (summaryMessages) =>
              ProviderGateway.sendChatRequest(activeProvider, activeModel, summaryMessages, false, undefined, undefined, 0, abortSignal));
          } catch {
            summary = '';
          }
          if (!summary) summary = buildFallbackSummary(messages, stateManager.getCompactSummary());
          messages = compactMessages(messages, summary);
          const postCompactTokens = estimateContextTokens(messages);
          stateManager.updateTokenUsage(postCompactTokens);
          agentObservability.recordEvent({ type: 'context_compaction', tokensBefore: preCompactTokens, tokensAfter: postCompactTokens });
          onChunk({ type: 'status', content: `Context compacted. Estimated ${postCompactTokens} tokens in use.` });
        }

        // Stream status
        onChunk({ type: 'status', content: `${stateManager.currentMode === 'plan' ? 'Planning' : 'Executing'}… (iteration ${stateManager.iterationCount + 1}/${stateManager.maxIterations})` });

        // 2. Send to LLM with current todos in system prompt
        const messagesWithTodos = buildMessagesWithTodos(messages, stateManager.todos);

        // Mid-turn failover snapshot: tracks the streamed output of this turn
        // so a throttle mid-stream can pin another provider without losing the
        // text already delivered to the renderer.
        savedPartialStream = '';
        const turnSnapshot = failoverResumeManager.createSnapshot(
          `${sessionId}:iteration:${stateManager.iterationCount}`,
          messagesWithTodos,
          activeProvider,
          activeModel
        );
        currentTurnSnapshot = turnSnapshot;

        let streamThought = '';
        let structuredCalls: GatewayToolCall[] = [];
        const llmCallStartedAt = Date.now();
        const llmTokensIn = estimateContextTokens(messagesWithTodos);
        const streamText = await ProviderGateway.sendChatRequest(
          activeProvider,
          activeModel,
          messagesWithTodos,
          true,
          undefined,
          (chunk: string) => {
            savedPartialStream += chunk;
            failoverResumeManager.recordTokens(turnSnapshot, chunk, undefined);
            onChunk({ type: 'token', content: chunk });
          },
          0,
          abortSignal,
          params.onProviderHandoff,
          (thought: string) => {
            streamThought += thought;
            failoverResumeManager.recordTokens(turnSnapshot, undefined, thought);
          },
          toolSchemas,
          (calls: GatewayToolCall[]) => {
            structuredCalls.push(...calls);
          },
          params.taskId,
          'chat'
        );
        agentObservability.recordEvent({
          type: 'llm_call',
          provider: activeProvider,
          model: activeModel,
          tokensIn: llmTokensIn,
          tokensOut: estimateTokenCount(streamText),
          duration: Date.now() - llmCallStartedAt
        });

        // Merge tool calls
        const harnessToolCalls = harness.parseResponse(streamText, structuredCalls.map((call) => {
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = typeof call.arguments === 'string' && call.arguments.trim()
              ? (JSON.parse(call.arguments) as Record<string, unknown>)
              : {};
          } catch {
            parsedArgs = {};
          }
          return { id: call.id, name: call.name, arguments: parsedArgs } as ToolCall;
        })).toolCalls;

        const deduped: ToolCall[] = [];
        const seenNames = new Set<string>();
        for (const call of structuredCalls) {
          if (!call.name || seenNames.has(call.name)) continue;
          seenNames.add(call.name);
          let parsedArgs: Record<string, unknown> = {};
          try {
            parsedArgs = call.arguments && String(call.arguments).trim()
              ? (JSON.parse(call.arguments) as Record<string, unknown>)
              : {};
          } catch {
            parsedArgs = { raw: call.arguments };
          }
          deduped.push({ id: call.id, name: call.name, arguments: parsedArgs });
        }
        const toolCallsToExecute: ToolCall[] = [...deduped];
        for (const textual of harnessToolCalls) {
          if (seenNames.has(textual.name)) continue;
          seenNames.add(textual.name);
          toolCallsToExecute.push(textual);
        }

        // SELF-CORRECTION: Detect "intent without action"
        const hasToolCalls = toolCallsToExecute.length > 0;
        const looksLikeIntentWithoutAction = !hasToolCalls &&
          (streamText || '').trim().length > 0 &&
          /\b(let me|i'll|i will|now i need to|i need to|let's|allow me to|i'm going to|i am going to|going to)\s+(read|check|search|run|execute|inspect|view|open|look at|examine|find|grep|list)\b/i.test(streamText || '');

        if (looksLikeIntentWithoutAction) {
          const nudgeMessage = 'You stated an intent but did not call a tool. Please execute the tool call now.';
          messages.push({ role: 'system', content: nudgeMessage });
          onChunk({ type: 'status', content: 'Self-correction: requesting tool execution…' });
          stateManager.iterationCount++;
          continue;
        }

        // 4. If no tool calls, check if all todos are complete
        if (!hasToolCalls && !looksLikeIntentWithoutAction) {
          if (stateManager.allTodosComplete()) {
            if (params.traceId) {
              try {
                const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
                connectivityTracer.recordHop(params.traceId, 'H9', {
                  status: 'PASS',
                  metadata: {
                    toolExecutorReady: true,
                    toolCallsCount: 0,
                    note: 'All tasks completed; task executor verified intact'
                  }
                });
              } catch {
                // ignore
              }
            }
            onChunk({ type: 'done' });
            persistSessionState(true);
            return;
          }

          // 5. Plan mode: route report text into the approval tool instead of auto-todos
          if (stateManager.currentMode === AgentMode.Plan && stateManager.todos.length === 0) {
            const looksLikeScopingReport = /Complexity & Resource Gauge|Execution Plan\s*\(\s*Phased\s*\)|Task Scoping Report/i.test(streamText || '');
            if (looksLikeScopingReport) {
              messages.push({ role: 'system', content: 'You generated the report but did not call the request_approval tool. Call request_approval with your Ty-Code Task Scoping Report now to pause for approval.' });
              stateManager.iterationCount++;
              continue;
            }
            const parsedTodos = parseTodosFromResponse(streamText);
            if (parsedTodos.length > 0) {
              stateManager.addTodos(parsedTodos);
              onChunk({ type: 'agent_state', state: { todos: stateManager.todos, mode: stateManager.currentMode, iteration: stateManager.iterationCount, maxIterations: stateManager.maxIterations } });
              stateManager.iterationCount++;
              continue;
            }
          }

          // Final response with no tool calls but incomplete todos — nudge
          if (stateManager.hasPendingTodos()) {
            const nudgeContent = stateManager.currentMode === AgentMode.Plan
              ? 'You have pending tasks, but Plan mode locks mutating tools. Call request_approval with your Ty-Code Task Scoping Report to obtain approval and switch to Execute mode.'
              : 'You have pending tasks. Please continue working on them by calling the appropriate tools.';
            messages.push({ role: 'system', content: nudgeContent });
            stateManager.iterationCount++;
            continue;
          }

          // No todos, no tool calls — we're done
          onChunk({ type: 'done' });
          persistSessionState(true);
          return;
        }

        // Push assistant turn with tool calls into conversation
        messages.push({
          role: 'assistant',
          content: streamText || '',
          ...(streamThought ? { reasoning_content: streamThought } : {}),
          tool_calls: toolCallsToExecute.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) }
          }))
        });

        // Execute tool calls
        for (const toolCall of toolCallsToExecute) {
          // Yield to the event loop between tool executions to prevent event loop starvation
          await new Promise<void>((resolve) => setImmediate(resolve));
          approvalState.userApproved = false;
          if (abortSignal?.aborted) {
            onChunk({ type: 'cancelled' });
            return;
          }
          const tool: ToolCall = { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments };
          onChunk({ type: 'tool_call', toolCall: tool });

          // 3a. request_approval: emit the Task Scoping Report and PAUSE for IPC approval
          if (toolCall.name === 'request_approval') {
            const report = String(toolCall.arguments.report || '');
            const summary = String(toolCall.arguments.summary || '').slice(0, 400);
            const checkpoint = String(toolCall.arguments.checkpoint || '');
            const planApproval: AgentToolApproval = {
              id: `plan_${toolCall.id}`,
              toolCall: tool,
              reason: summary || 'Review the Task Scoping Report before execution.',
              approvalKind: 'plan_review',
              planReport: report,
              ...(checkpoint ? { checkpoint } : {})
            };
            onChunk({ type: 'approval_request', approvalRequest: planApproval });
            onChunk({ type: 'status', content: 'Waiting for plan approval…' });
            const decision = (await requestApproval?.(planApproval)) || { approved: false };
            if (abortSignal?.aborted) {
              onChunk({ type: 'cancelled' });
              return;
            }
            stateManager.recordToolCall(toolCall.name, toolCall.arguments, decision.approved ? 'APPROVED' : `REVISION: ${decision.feedback || 'no feedback'}`);
            if (decision.approved) {
              if (stateManager.currentMode === AgentMode.Plan) {
                stateManager.currentMode = AgentMode.Execute;
                if (stateManager.todos.length === 0) populateTodosFromPlan(report);
                onChunk({ type: 'agent_state', state: { todos: stateManager.todos, mode: stateManager.currentMode, iteration: stateManager.iterationCount, maxIterations: stateManager.maxIterations } });
                onChunk({ type: 'status', content: `Plan approved. Executing ${stateManager.todos.length} planned tasks.` });
                messages.push({
                  role: 'tool',
                  name: 'request_approval',
                  tool_call_id: toolCall.id,
                  content: 'APPROVED. Plan mode is lifted: write_file, replace_file_content, run_command, and Git mutations are now allowed. Follow the approved Execution Plan phases in order. Call request_approval again at your proposed checkpoint.'
                });
              } else {
                onChunk({ type: 'status', content: 'Checkpoint approved. Continuing with the Execution Plan.' });
                messages.push({
                  role: 'tool',
                  name: 'request_approval',
                  tool_call_id: toolCall.id,
                  content: 'Checkpoint APPROVED. Continue with the Execution Plan and report progress on remaining tasks.'
                });
              }
              stateManager.iterationCount++;
              continue;
            }
            const revisionFeedback = decision.feedback || 'No feedback provided.';
            messages.push({
              role: 'tool',
              name: 'request_approval',
              tool_call_id: toolCall.id,
              content: `NOT APPROVED. The user sent plan revision feedback: ${revisionFeedback}\n\nRegenerate the Ty-Code Task Scoping Report incorporating this feedback, then call request_approval again. Do not execute any mutating tools yet.`
            });
            onChunk({ type: 'status', content: 'Plan revision requested.' });
            stateManager.iterationCount++;
            continue;
          }

          // 3b. Plan mode lock: mutating tools stay disabled until the plan is approved
          const PLAN_MUTATING_TOOLS = new Set(['write_file', 'replace_file_content', 'run_command', 'git_commit', 'git_merge', 'generate_presentation']);
          const isPlanLockedMutation = stateManager.currentMode === AgentMode.Plan
            && (PLAN_MUTATING_TOOLS.has(toolCall.name)
              || (toolCall.name === 'git_branch' && ['create', 'switch'].includes(String(toolCall.arguments.action || ''))));
          if (isPlanLockedMutation) {
            const output = 'Plan mode lock: mutating tools are disabled until a Task Scoping Report is approved. Call the request_approval tool with your Ty-Code Task Scoping Report (four sections: Complexity & Resource Gauge, Execution Plan (Phased), Failure Risks & Mitigations, Checkpoint Proposal), then wait for APPROVED.';
            onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output, isError: true } });
            messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: output });
            stateManager.recordToolCall(toolCall.name, toolCall.arguments, output);
            stateManager.iterationCount++;
            continue;
          }

          if (toolCall.name === 'delegate_to_background_agent') {
            const delegateName = String(toolCall.arguments.agentName || 'Background Agent');
            const delegateTask = String(toolCall.arguments.task || '');
            if (!delegateTask.trim()) {
              const delegatedOutput = 'Delegation error: the task description is required.';
              onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output: delegatedOutput, isError: true } });
              messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: delegatedOutput });
              stateManager.recordToolCall(toolCall.name, toolCall.arguments, delegatedOutput);
              stateManager.iterationCount++;
              continue;
            }
            const childId = backgroundAgentOrchestrator.spawnAgent(delegateName, delegateTask, {
              workspacePath,
              ...(activeFilePath ? { activeFilePath } : {}),
              ...(activeFileContent ? { activeFileContent } : {}),
              settings
            });
            const delegatedOutput = `Subtask delegated to background agent "${delegateName}" (id: ${childId}). It runs in parallel with fully isolated state; continue your main flow. Its final report appears in the Background Agents panel when it completes.`;
            onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output: delegatedOutput, isError: false } });
            messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: delegatedOutput });
            stateManager.recordToolCall(toolCall.name, toolCall.arguments, delegatedOutput);
            stateManager.iterationCount++;
            continue;
          }

          const referencedPath = String(toolCall.arguments.filePath || toolCall.arguments.path || toolCall.arguments.directoryPath || '');
          if (isFileMemoryEnabled && referencedPath) {
            fileMemoryManager.accessFile(referencedPath);
          }

          const action = String(toolCall.arguments.action || '');
          const command = String(toolCall.arguments.command || '');
          const containsGitCommand = /\bgit(?:\.exe)?\b/i.test(command);
          const singleReadOnlyGitCommand = !/[;&|`$]/.test(command)
            && /^\s*git(?:\.exe)?\s+(?:status|diff|log|show|blame|rev-parse|remote(?:\s+-v)?|config\s+--get|branch(?:\s+(?:-l|--list|--all|-a|--remotes|-r|--show-current|-vv))?)\b/i.test(command);
          const mutatingGitCommand = toolCall.name === 'run_command' && containsGitCommand && !singleReadOnlyGitCommand;
          const destructiveShellCommand = toolCall.name === 'run_command'
            && /\brm\s+-(?:rf|fr)\b|\bremove-item\b[^\n]*-recurse|\bdel\s+\/s\s+\/q\b|\bformat\s+[a-z]:/i.test(command);
          let policyBlockReason: string | null = null;
          let approvalReason = toolCall.name === 'git_commit'
            ? 'Create a Git commit; review whether this request stages specified paths or all visible changes.'
            : toolCall.name === 'git_merge'
              ? 'Merge another branch into the active branch.'
              : toolCall.name === 'git_branch' && (action === 'create' || action === 'switch')
                ? `${action === 'create' ? 'Create and check out' : 'Switch to'} a Git branch.`
                : mutatingGitCommand
                  ? 'Run a shell command that changes Git state.'
                  : destructiveShellCommand
                    ? 'Run a destructive filesystem or disk command.'
                    : null;
          let fileReview: Awaited<ReturnType<SecurityPolicyEngine['previewFileMutation']>> | undefined;
          let approvedExecutionArgs = toolCall.arguments;
          if (toolCall.name === 'run_command') {
            const decision = await this.securityPolicy.evaluateTerminalCommand(command);
            policyBlockReason = decision.decision === 'block' ? decision.reason : null;
            approvalReason = decision.decision === 'ask' ? decision.reason : null;
          } else if (toolCall.name === 'write_file' || toolCall.name === 'replace_file_content') {
            try {
              fileReview = await this.securityPolicy.previewFileMutation(toolCall.name, toolCall.arguments);
              const policy = await this.securityPolicy.getPolicy();
              if (toolCall.name === 'replace_file_content' && policy.reviewPolicy === 'always-ask') {
                approvalReason = 'Review Policy is set to Always Ask; user confirmation is required before applying diffs to disk.';
              } else {
                const decision = await this.securityPolicy.evaluateFileMutation(fileReview);
                policyBlockReason = decision.decision === 'block' ? decision.reason : null;
                if (decision.decision === 'ask') approvalReason = decision.reason;
                else approvalReason = null;
              }
              approvedExecutionArgs = {
                ...toolCall.arguments,
                __approvedOriginalHash: fileReview.originalHash,
                __approvedOriginalExists: fileReview.originalExists
              };
              if (fileReview.originalExists) {
                const proposedDiff: ProposedDiff = {
                  id: `diff_${toolCall.id}`,
                  filePath: fileReview.filePath,
                  originalContent: fileReview.originalContent,
                  proposedContent: fileReview.proposedContent,
                  description: `Proposed ${toolCall.name} on ${fileReview.filePath}`,
                  status: 'pending'
                };
                onChunk({ type: 'diff', diff: proposedDiff });
              }
            } catch (err: unknown) {
              const msg = err instanceof Error ? err.message : String(err);
              if (msg.includes('Security Exception') || msg.includes('Access denied')) {
                policyBlockReason = msg;
              }
            }
          }
          if (policyBlockReason) {
            const output = `Blocked by security policy: ${policyBlockReason}`;
            onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output, isError: true } });
            messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: output });
            stateManager.recordToolCall(toolCall.name, toolCall.arguments, output);
            continue;
          }
          if (approvalReason) {
            onChunk({ type: 'status', content: 'Waiting for your approval…' });
            let affectedPaths: string[] | undefined;
            if (toolCall.name === 'git_commit') {
              const status = await this.toolExecutor.execute('git_status', {});
              const stageAll = toolCall.arguments.stageAll === true;
              const specifiedPaths = Array.isArray(toolCall.arguments.filePaths) ? toolCall.arguments.filePaths.map(String) : [];
              affectedPaths = specifiedPaths.length
                ? specifiedPaths
                : stageAll
                  ? [...status.output.matchAll(/^  \[[^\]]+\] (.+)$/gm)].map((match) => match[1])
                  : [];
            }
            if (mutatingGitCommand || destructiveShellCommand) affectedPaths = [command];
            const approval: AgentToolApproval = {
              id: `approval_${toolCall.id}`,
              toolCall: tool,
              reason: approvalReason,
              affectedPaths: affectedPaths || (fileReview ? [fileReview.filePath] : undefined),
              ...(fileReview ? {
                reviewDiff: {
                  id: `review_${toolCall.id}`,
                  filePath: fileReview.filePath,
                  originalContent: fileReview.originalContent,
                  proposedContent: fileReview.proposedContent,
                  description: `Review changes proposed by ${toolCall.name}`,
                  status: 'pending' as const
                },
                addedLines: fileReview.addedLines,
                removedLines: fileReview.removedLines
              } : {})
            };
            onChunk({ type: 'approval_request', approvalRequest: approval });
            const decision = (await requestApproval?.(approval)) || { approved: false };
            if (abortSignal?.aborted) {
              onChunk({ type: 'cancelled' });
              return;
            }
            if (!decision.approved) {
              const output = decision.feedback
                ? `The user did not approve this operation and sent feedback: ${decision.feedback}. Adjust your approach accordingly; request approval again before retrying any mutating action.`
                : 'The user did not approve this operation. It was not executed.';
              onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output, isError: true } });
              messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: output });
              stateManager.recordToolCall(toolCall.name, toolCall.arguments, output);
              continue;
            }
            approvalState.userApproved = true;
          }

          const ruleApproved = await toolApprovalManager.checkApproval(toolCall.name, toolCall.arguments);
          if (!ruleApproved) {
            const output = `Tool ${toolCall.name} was denied by approval rules`;
            onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output, isError: true } });
            messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: output });
            stateManager.recordToolCall(toolCall.name, toolCall.arguments, output);
            stateManager.iterationCount++;
            continue;
          }

          onChunk({ type: 'status', content: `Running ${toolCall.name}…` });
          const result: ToolExecutionResponse = await this.executeWithSandbox(toolCall, approvedExecutionArgs, abortSignal);
          
          // Record tool call in state manager
          stateManager.recordToolCall(toolCall.name, toolCall.arguments, result.output);

          if (isFileMemoryEnabled && referencedPath && !result.isError && ['read_file', 'write_file', 'replace_file_content'].includes(toolCall.name)) {
            const memoryContent = toolCall.name === 'write_file'
              ? String(approvedExecutionArgs.content ?? toolCall.arguments.content ?? '')
              : toolCall.name === 'replace_file_content'
                ? String(approvedExecutionArgs.replacementContent ?? toolCall.arguments.replacementContent ?? '')
                : result.output;
            void this.refreshFileMemory(referencedPath, memoryContent, activeProvider, activeModel);
          }

          // Auto-update todos based on tool results
          const relatedTodo = getRelatedTodo(toolCall, stateManager.todos);
          if (relatedTodo && (toolCall.name === 'write_file' || toolCall.name === 'replace_file_content' || toolCall.name === 'read_file' || toolCall.name === 'run_command')) {
            stateManager.updateTodoStatus(relatedTodo.id, 'completed');
            onChunk({ type: 'agent_state', state: { todos: stateManager.todos, mode: stateManager.currentMode, iteration: stateManager.iterationCount, maxIterations: stateManager.maxIterations } });
          }

          onChunk({
            type: 'tool_result',
            toolResult: {
              toolCallId: toolCall.id,
              name: toolCall.name,
              output: result.output,
              isError: result.isError
            }
          });
          if (result.proposedDiff) onChunk({ type: 'diff', diff: result.proposedDiff });
          const compressedResult = optimizationPipeline.compressToolOutput(result.output);
          messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: compressedResult.compressed });
        }

        // Iteration complete
        onChunk({ type: 'status', content: `Iteration ${stateManager.iterationCount + 1}/${stateManager.maxIterations} complete — continuing…` });
        stateManager.iterationCount++;

        // Emit state update to renderer
        onChunk({ type: 'agent_state', state: { todos: stateManager.todos, mode: stateManager.currentMode, iteration: stateManager.iterationCount, maxIterations: stateManager.maxIterations } });

        agentObservability.recordEvent({
          type: 'agent_iteration',
          iteration: stateManager.iterationCount,
          todosCompleted: stateManager.todos.filter((todo) => todo.status === 'completed').length,
          todosRemaining: stateManager.todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress').length
        });

        persistSessionState();

      } catch (err: unknown) {
        if (abortSignal?.aborted) {
          onChunk({ type: 'cancelled' });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);

        // ===== Seamless Mid-Turn Failover =====
        // ProviderGateway raises [RATE_LIMITED]/[PROVIDER_DOWN] (or
        // "Maximum handoffs") when its internal handoff budget burns out.
        // The ReAct loop must never die because of a provider: pin the next
        // eligible provider from getVerifiedModels(), inject the hidden switch
        // instruction, and resume with the Todo state fully intact.
        const providerFailure =
          /\[RATE_LIMITED\]|\[PROVIDER_DOWN\]|\(429\)|\(500\)|\(502\)|\(503\)|\(504\)|Maximum handoffs|KEY_MISSING_ERROR|key required|unavailable/i.test(message);
        if (providerFailure && providerSwitchesUsed < MAX_PROVIDER_SWITCHES) {
          providerSwitchesUsed++;
          const failedProvider = runProvider || currentSettings.activeProvider || '';
          const failedModel = runModel || currentSettings.activeModel || '';
          if (currentTurnSnapshot) {
            try {
              await failoverResumeManager.finalizeSegment(currentTurnSnapshot, message);
            } catch {
              // Ledger recording must never block a failover
            }
          }
          const failedProviderNorm = (failedProvider || '').toLowerCase().trim().replace(/-free$/, '');
          const next = await pickNextAgentProvider(new Set([...failedProviders, failedProviderNorm]), failedModel);
          if (next) {
            if (failedProviderNorm) failedProviders.add(failedProviderNorm);
            providerSwitch.provider = next.providerId;
            providerSwitch.model = next.modelId;
            providerSwitch.active = true;

            // Preserve text already streamed to the renderer, then inject the
            // hidden provider-switch instruction (exact harness format).
            if (savedPartialStream.trim().length > 0) {
              messages.push({ role: 'assistant', content: savedPartialStream });
            }
            const rateLimited = /\[RATE_LIMITED\]|\(429\)|rate limit/i.test(message);
            messages.push({
              role: 'system',
              content: `[SYSTEM: Provider switched to ${next.providerId} due to ${rateLimited ? 'rate limit' : 'provider outage'}. Continue the task.]`
            });

            onChunk({ type: 'status', content: `Provider switched to ${next.providerId}. Continuing the current task.` });
            try {
              params.onProviderHandoff?.({
                fromProvider: failedProvider,
                toProvider: next.providerId,
                toModel: next.modelId
              });
            } catch {
              // Notification callback must never break the failover chain
            }
            agentObservability.recordEvent({
              type: 'provider_failover',
              fromProvider: failedProvider,
              toProvider: next.providerId,
              toModel: next.modelId,
              error: message.slice(0, 300)
            });

            stateManager.iterationCount++;
            persistSessionState();
            savedPartialStream = '';
            currentTurnSnapshot = null;
            continue; // resume the ReAct loop; Todo state untouched
          }
        }

        persistSessionState(false);
        agentObservability.recordEvent({
          type: 'error',
          message,
          ...(err instanceof Error && err.stack ? { stack: err.stack.slice(0, 2000) } : {})
        });
        onChunk({ type: 'error', error: message });
        return;
      }
    }
    onChunk({ type: 'status', content: `Reached the tool-execution limit (${stateManager.maxIterations} iterations).` });
    onChunk({ type: 'done' });
    persistSessionState(true);
  }
}