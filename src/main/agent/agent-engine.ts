import type { AgentStreamChunk, ChatMessage, ProviderSettings } from '../../preload/types';
import { ProviderGateway, type ChatCompletionMessage } from '../providers/provider-gateway';
import { buildSystemPrompt, AGENT_TOOLS_DEFINITIONS } from './system-prompt';
import { ToolExecutor } from './tool-executor';

export interface RunAgentParams {
  prompt: string;
  workspacePath: string;
  history: ChatMessage[];
  settings: ProviderSettings;
  activeFilePath?: string;
  activeFileContent?: string;
  onChunk: (chunk: AgentStreamChunk) => void;
  abortSignal?: AbortSignal;
}

export class AgentEngine {
  private toolExecutor: ToolExecutor;

  constructor(private workspacePath: string) {
    this.toolExecutor = new ToolExecutor(workspacePath);
  }

  async run(params: RunAgentParams): Promise<void> {
    const { prompt, workspacePath, history, settings, activeFilePath, activeFileContent, onChunk, abortSignal } = params;
    const systemPrompt = buildSystemPrompt(workspacePath, activeFilePath, activeFileContent);
    const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const message of history.slice(-10)) {
      if (message.role === 'user' || message.role === 'assistant') {
        messages.push({ role: message.role, content: message.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    const maxSteps = 10;
    onChunk({ type: 'status', content: 'Agent thinking…' });

    for (let step = 0; step < maxSteps; step++) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'cancelled' });
        return;
      }
      try {
        const streamResult = await ProviderGateway.streamChat(
          settings,
          messages,
          AGENT_TOOLS_DEFINITIONS,
          {
            onToken: (content) => onChunk({ type: 'token', content }),
            onThought: (content) => onChunk({ type: 'thought', content })
          },
          abortSignal
        );

        if (!streamResult.toolCalls.length) {
          onChunk({ type: 'done' });
          return;
        }

        messages.push({
          role: 'assistant',
          content: streamResult.fullText || '',
          tool_calls: streamResult.toolCalls.map((toolCall) => ({
            id: toolCall.id,
            type: 'function',
            function: { name: toolCall.name, arguments: JSON.stringify(toolCall.arguments) }
          }))
        });

        for (const toolCall of streamResult.toolCalls) {
          if (abortSignal?.aborted) {
            onChunk({ type: 'cancelled' });
            return;
          }
          onChunk({
            type: 'tool_call',
            toolCall: { id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments }
          });
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
