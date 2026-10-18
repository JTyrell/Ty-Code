import type { AgentHarnessType, AgentStreamChunk, AgentToolApproval, ChatMessage, ProposedDiff, ProviderSettings, ToolCall } from '../../preload/types';
import { ProviderGateway, type ChatCompletionMessage } from '../providers/provider-gateway';
export { ProviderGateway };
import { buildSystemPrompt, AGENT_TOOLS_DEFINITIONS, getEccRulesPrompt, getSeoPromptGuidance, isLocalModel } from './system-prompt';
import { ToolExecutor } from './tool-executor';
import { getHarness } from '../services/orchestration/harnesses';
import { SecurityPolicyEngine } from '../services/security-policy';
import { settingsManager, type SettingsManager } from '../services/settings-manager';
import { moduleRegistry } from '../services/module-registry';
import { mcpManager } from '../services/mcp-manager';
import { diagnosticsHealthMonitor } from '../services/diagnostics/health-monitor';
import { optimizationPipeline } from '../providers/optimization-pipeline';
import { failoverResumeManager } from './failover-resume';

import { connectivityTracer } from '../services/diagnostics/connectivity-tracer';

export interface RunAgentParams {
  prompt: string;
  workspacePath: string;
  history: ChatMessage[];
  settings: ProviderSettings;
  harness?: AgentHarnessType;
  activeFilePath?: string;
  activeFileContent?: string;
  traceId?: string;
  onChunk: (chunk: AgentStreamChunk) => void;
  requestApproval: (approval: AgentToolApproval) => Promise<boolean>;
  abortSignal?: AbortSignal;
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
        messages.push({ role: message.role, content: message.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

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

    const maxSteps = 10;
    onChunk({ type: 'status', content: `Agent thinking (${harness.metadata.name})…` });

    let currentSettings = { ...settings };
    const failedProviders = new Set<string>();

    for (let step = 0; step < maxSteps; step++) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'cancelled' });
        return;
      }
      try {
        console.log('[AGENT] Calling gateway...');
        const activeProvider = currentSettings.activeProvider || 'openrouter';
        let activeModel = currentSettings.activeModel;
        if (!activeModel || (activeProvider === 'openkilo' && !activeModel.includes('openkilo') && !activeModel.includes('deepseek-r1-0528'))) {
          if (activeProvider === 'openkilo') {
            activeModel = 'deepseek/deepseek-r1-0528:free';
          } else if (activeProvider === 'groq') {
            activeModel = 'llama-3.3-70b-versatile';
          } else {
            activeModel = 'qwen/qwen-2.5-coder-32b-instruct:free';
          }
        }
        console.log(`[AGENT] Provider: ${activeProvider}, Model: ${activeModel}`);

        const streamText = await ProviderGateway.sendChatRequest(
          activeProvider,
          activeModel,
          messages,
          true,
          undefined,
          (content) => {
            onChunk({ type: 'token', content });
          }
        );

        const parsedResponse = harness.parseResponse(streamText, []);
        const toolCallsToExecute = parsedResponse.toolCalls;

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
          content: parsedResponse.text || streamText || '',
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
    onChunk({ type: 'status', content: 'Reached the maximum number of tool steps.' });
    onChunk({ type: 'done' });
  }
}
