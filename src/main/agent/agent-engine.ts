import type { AgentHarnessType, AgentStreamChunk, AgentToolApproval, ChatMessage, ProposedDiff, ProviderSettings, ToolCall } from '../../preload/types';
import { ProviderGateway, type ChatCompletionMessage, type GatewayToolCall, type GatewayToolSchema } from '../providers/provider-gateway';
export { ProviderGateway };
import { buildSystemPrompt, AGENT_TOOLS_DEFINITIONS, getEccRulesPrompt, getSeoPromptGuidance, isLocalModel } from './system-prompt';
import { ToolExecutor } from './tool-executor';
import { getHarness } from '../services/orchestration/harnesses';
import { SecurityPolicyEngine } from '../services/security-policy';
import { settingsManager, type SettingsManager } from '../services/settings-manager';
import { modelRouter } from '../services/orchestration/model-router';
import { moduleRegistry } from '../services/module-registry';
import { mcpManager } from '../services/mcp-manager';
import { diagnosticsHealthMonitor } from '../services/diagnostics/health-monitor';
import { optimizationPipeline } from '../providers/optimization-pipeline';
import { failoverResumeManager } from './failover-resume';

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
  requestApproval: (approval: AgentToolApproval) => Promise<boolean>;
  abortSignal?: AbortSignal;
  onProviderHandoff?: (info: { fromProvider: string; toProvider: string; toModel: string }) => void;
}

export class AgentEngine {
  private toolExecutor: ToolExecutor;
  private securityPolicy: SecurityPolicyEngine;

  constructor(private workspacePath: string = process.cwd(), settingsSource: Pick<SettingsManager, 'getEffectiveSettings'> = settingsManager) {
    this.securityPolicy = new SecurityPolicyEngine(this.workspacePath, settingsSource);
    this.toolExecutor = new ToolExecutor(this.workspacePath, this.securityPolicy);
  }

  async run(params: RunAgentParams): Promise<void> {
    const { prompt, workspacePath, history, settings, activeFilePath, activeFileContent, onChunk, requestApproval, abortSignal } = params;
    const harnessType = params.harness || settings.activeHarness || 'claude-code';
    const harness = getHarness(harnessType);

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
    const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
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

    // Universal tool schema: every model receives the same function-calling
    // palette (the gateway converts to OpenAI `tools[].function` and Anthropic
    // `tools[].input_schema` wire shapes). The harness textual protocol remains
    // the fallback parser for models without native function calling.
    const toolSchemas: GatewayToolSchema[] = AGENT_TOOLS_DEFINITIONS.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters
    }));

    // Workspace ground-truth: every model is told the open workspace, its
    // folder structure (as the Explorer shows it) and the open/active files.
    const workspaceSummary = getWorkspaceSummary(workspacePath);
    const openFilePaths = params.openFilePaths?.length ? params.openFilePaths : activeFilePath ? [activeFilePath] : [];
    const openFiles = getOpenFilesContent(workspacePath, openFilePaths, activeFilePath);
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

    let currentSettings = { ...settings };
    const failedProviders = new Set<string>();

    /** Executes an agent task as a robust while-loop. */
    const MAX_ITERATIONS = 40;
    let iteration = 0;
    onChunk({ type: 'status', content: 'Thinking…' });

    while (iteration < MAX_ITERATIONS) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'cancelled' });
        return;
      }
      try {
        console.log(`[AGENT] Iteration ${iteration + 1}/${MAX_ITERATIONS} — calling gateway...`);
        // "Auto" binding: FCC decides. When no explicit provider is configured
        // (unset or literally 'auto'), the FCC router picks the best FREE model
        // for this task across the entire managed free pool — never a paid
        // provider without its own stored credentials.
        const rawActiveProvider = currentSettings.activeProvider || '';
        const isAutoBinding = !rawActiveProvider || rawActiveProvider === 'auto';
        let activeProvider: string;
        let activeModel: string;

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
          activeModel = currentSettings.activeModel || '';
          if (!activeModel || (activeProvider === 'openkilo' && !activeModel.endsWith(':free') && !activeModel.endsWith('/free'))) {
            if (activeProvider === 'openkilo') {
              activeModel = 'kilo-auto/free';
            } else if (activeProvider === 'groq') {
              activeModel = 'llama-3.3-70b-versatile';
            } else {
              activeModel = 'qwen/qwen-2.5-coder-32b-instruct:free';
            }
          }
        }
        console.log(`[AGENT] Provider: ${activeProvider}, Model: ${activeModel}`);

        // Reasoning models (Kilo Auto / DeepSeek R1) return chain-of-thought in
        // a dedicated stream field; it must be echoed on the assistant turn for
        // every follow-up request of this task.
        let streamThought = '';
        // Structured tool calls captured from the wire (delta.tool_calls or
        // Anthropic tool_use blocks) via the gateway callback.
        let structuredCalls: GatewayToolCall[] = [];
        const streamText = await ProviderGateway.sendChatRequest(
          activeProvider,
          activeModel,
          messages,
          true,
          undefined,
          (chunk: string) => {
            onChunk({ type: 'token', content: chunk });
          },
          0,
          abortSignal,
          params.onProviderHandoff,
          (thought: string) => {
            streamThought += thought;
          },
          toolSchemas,
          (calls: GatewayToolCall[]) => {
            structuredCalls.push(...calls);
          }
        );

        // Merge the two tool-call channels before executing:
        //  1) structured tool_calls from native function calling (ground truth)
        //  2) textual `` blocks parsed by the harness protocol (fallback
        // for models without native function calling).
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

        if (!toolCallsToExecute.length) {
          if (params.traceId) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-var-requires
              const { connectivityTracer } = require('../services/diagnostics/connectivity-tracer');
              connectivityTracer.recordHop(params.traceId, 'H9', {
                status: 'PASS',
                metadata: {
                  toolExecutorReady: true,
                  toolCallsCount: 0,
                  note: 'Zero tool calls required for prompt; tool executor verified intact'
                }
              });
            } catch {
              // ignore
            }
          }
          onChunk({ type: 'done' });
          return;
        }

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

        for (const toolCall of toolCallsToExecute) {
          if (abortSignal?.aborted) {
            onChunk({ type: 'cancelled' });
            return;
          }
          const tool: ToolCall = { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments };
          onChunk({ type: 'tool_call', toolCall: tool });

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
            const approved = await requestApproval?.(approval);
            if (abortSignal?.aborted) {
              onChunk({ type: 'cancelled' });
              return;
            }
            if (!approved) {
              const output = 'The user did not approve this operation. It was not executed.';
              onChunk({ type: 'tool_result', toolResult: { toolCallId: toolCall.id, name: toolCall.name, output, isError: true } });
              messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: output });
              continue;
            }
          }

          onChunk({ type: 'status', content: `Running ${toolCall.name}…` });
          const result = await this.toolExecutor.execute(toolCall.name, approvedExecutionArgs, abortSignal);
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

        // mutate the conversation and re-enter the loop: the LLM sees the
        // original assistant turn + the tool result on the next request and
        // can continue the task chain.
        iteration++;
      } catch (err: unknown) {
        if (abortSignal?.aborted) {
          onChunk({ type: 'cancelled' });
          return;
        }
        const message = err instanceof Error ? err.message : String(err);
        onChunk({ type: 'error', error: message });
        return;
      }
    }
    onChunk({ type: 'status', content: `Reached the tool-execution limit (${MAX_ITERATIONS} iterations).` });
    onChunk({ type: 'done' });
  }
}
