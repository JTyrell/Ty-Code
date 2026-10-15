import type { AgentHarnessType, AgentStreamChunk, AgentToolApproval, ChatMessage, ProviderSettings, ToolCall } from '../../preload/types';
import { ProviderGateway, type ChatCompletionMessage } from '../providers/provider-gateway';
import { buildSystemPrompt, AGENT_TOOLS_DEFINITIONS } from './system-prompt';
import { ToolExecutor } from './tool-executor';
import { getHarness } from '../services/orchestration/harnesses';

export interface RunAgentParams {
  prompt: string;
  workspacePath: string;
  history: ChatMessage[];
  settings: ProviderSettings;
  harness?: AgentHarnessType;
  activeFilePath?: string;
  activeFileContent?: string;
  onChunk: (chunk: AgentStreamChunk) => void;
  requestApproval?: (approval: AgentToolApproval) => Promise<boolean>;
  abortSignal?: AbortSignal;
}

export class AgentEngine {
  private toolExecutor: ToolExecutor;

  constructor(private workspacePath: string) {
    this.toolExecutor = new ToolExecutor(workspacePath);
  }

  async run(params: RunAgentParams): Promise<void> {
    const { prompt, workspacePath, history, settings, activeFilePath, activeFileContent, onChunk, requestApproval, abortSignal } = params;
    const harnessType = params.harness || settings.activeHarness || 'claude-code';
    const harness = getHarness(harnessType);
    const systemPrompt = harness.formatSystemPrompt(workspacePath, activeFilePath, activeFileContent) || buildSystemPrompt(workspacePath, activeFilePath, activeFileContent);
    const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const message of history.slice(-10)) {
      if (message.role === 'user' || message.role === 'assistant') {
        messages.push({ role: message.role, content: message.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const maxSteps = 10;
    onChunk({ type: 'status', content: `Agent thinking (${harness.metadata.name})…` });

    for (let step = 0; step < maxSteps; step++) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'cancelled' });
        return;
      }
      try {
        const tools = harness.formatTools(AGENT_TOOLS_DEFINITIONS);
        const streamResult = await ProviderGateway.streamChat(
          settings,
          harness.formatMessages(messages),
          tools,
          {
            onToken: (content) => onChunk({ type: 'token', content }),
            onThought: (content) => onChunk({ type: 'thought', content })
          },
          abortSignal
        );

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
          const approvalReason = toolCall.name === 'git_commit'
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
              affectedPaths
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
          const result = await this.toolExecutor.execute(toolCall.name, toolCall.arguments, abortSignal);
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
