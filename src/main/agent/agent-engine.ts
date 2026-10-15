import type { AgentHarnessType, AgentStreamChunk, AgentToolApproval, ChatMessage, ProviderSettings, ToolCall } from '../../preload/types';
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


export interface RunAgentParams {
  prompt: string;
  workspacePath: string;
  history: ChatMessage[];
  settings: ProviderSettings;
  harness?: AgentHarnessType;
  activeFilePath?: string;
  activeFileContent?: string;
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
        const tools = harness.formatTools(AGENT_TOOLS_DEFINITIONS);
        let streamResult;
        const maxRetries = currentSettings.enableFailover !== false ? (currentSettings.maxFailoverRetries ?? 3) : 1;
        let attempt = 0;

        while (attempt < maxRetries) {
          attempt++;
          try {
            streamResult = await ProviderGateway.streamChat(
              currentSettings,
              harness.formatMessages(messages),
              tools,
              {
                onToken: (content) => onChunk({ type: 'token', content }),
                onThought: (content) => onChunk({ type: 'thought', content }),
                onFailoverNotice: (notice) => {
                  const target = notice.nextModel || notice.nextProvider || 'fallback model';
                  const modelLabel = target.split('/').pop() || target;
                  if (notice.error?.includes('429') || notice.error?.toLowerCase().includes('rate limit')) {
                    diagnosticsHealthMonitor.recordRateLimit(notice.failedProvider);
                  } else {
                    diagnosticsHealthMonitor.recordProviderDown(notice.failedProvider);
                  }
                  onChunk({ type: 'status', content: `Switched to ${modelLabel}…` });
                  onChunk({ type: 'token', content: `\n\n*[Switched to ${modelLabel}]*\n\n` });
                }
              },
              abortSignal
            );
            break; // Stream succeeded
          } catch (streamErr: unknown) {
            if (abortSignal?.aborted) {
              onChunk({ type: 'cancelled' });
              return;
            }

            const errorMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
            failedProviders.add(currentSettings.activeProvider);

            if (errorMsg.includes('429') || errorMsg.toLowerCase().includes('rate limit')) {
              diagnosticsHealthMonitor.recordRateLimit(currentSettings.activeProvider);
            } else {
              diagnosticsHealthMonitor.recordProviderDown(currentSettings.activeProvider);
            }

            if (attempt >= maxRetries) {
              throw streamErr;
            }

            // Route to next healthy fallback candidate
            const fallbackCandidate = ProviderGateway.router.route({
              taskType: 'coding',
              excludedProviders: failedProviders
            }, currentSettings);

            if (!fallbackCandidate) {
              throw streamErr;
            }

            const fallbackModel = fallbackCandidate.model.id;
            const modelLabel = fallbackModel.split('/').pop() || fallbackModel;
            onChunk({ type: 'status', content: `Switched to ${modelLabel}…` });
            onChunk({ type: 'token', content: `\n\n*[Switched to ${modelLabel}]*\n\n` });

            currentSettings = {
              ...currentSettings,
              activeProvider: fallbackCandidate.provider.id as any,
              activeModel: fallbackCandidate.model.id
            };
          }
        }

        if (!streamResult) {
          throw new Error('Streaming failed across all available providers.');
        }

        const parsedResponse = harness.parseResponse(streamResult.fullText, streamResult.toolCalls);
        const toolCallsToExecute = parsedResponse.toolCalls;


        if (!toolCallsToExecute.length) {
          onChunk({ type: 'done' });
          return;
        }

        messages.push({
          role: 'assistant',
          content: parsedResponse.text || streamResult.fullText || '',
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
          messages.push({ role: 'tool', name: toolCall.name, tool_call_id: toolCall.id, content: result.output });
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
