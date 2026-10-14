import type {
  AgentStreamChunk,
  ChatMessage,
  ProviderSettings,
  ProposedDiff
} from '../../preload/types';
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
    const { prompt, workspacePath, history, settings, activeFilePath, onChunk, abortSignal } = params;

    const systemPrompt = buildSystemPrompt(workspacePath, activeFilePath);

    // Build chat completion messages
    const messages: ChatCompletionMessage[] = [
      { role: 'system', content: systemPrompt }
    ];

    // Append prior history (compacted)
    for (const msg of history.slice(-10)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({
          role: msg.role,
          content: msg.content
        });
      }
    }

    // Append current user prompt
    messages.push({
      role: 'user',
      content: prompt
    });

    const MAX_STEPS = 10;
    let stepCount = 0;

    onChunk({ type: 'status', content: 'Agent thinking...' });

    while (stepCount < MAX_STEPS) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'status', content: 'Task aborted by user.' });
        return;
      }

      stepCount++;

      try {
        const streamResult = await ProviderGateway.streamChat(
          settings,
          messages,
          AGENT_TOOLS_DEFINITIONS,
          {
            onToken: (token) => onChunk({ type: 'token', content: token }),
            onThought: (thought) => onChunk({ type: 'thought', content: thought })
          },
          abortSignal
        );

        // If the model did not make any tool calls, the task turn is complete
        if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
          onChunk({ type: 'done' });
          return;
        }

        // Add assistant turn with tool calls to conversation history
        messages.push({
          role: 'assistant',
          content: streamResult.fullText || '',
          tool_calls: streamResult.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: {
              name: tc.name,
              arguments: JSON.stringify(tc.arguments)
            }
          }))
        });

        // Execute each tool call sequentially
        for (const tc of streamResult.toolCalls) {
          if (abortSignal?.aborted) return;

          onChunk({
            type: 'tool_call',
            toolCall: {
              id: tc.id,
              name: tc.name,
              arguments: tc.arguments
            }
          });

          onChunk({ type: 'status', content: `Running ${tc.name}...` });

          const execResult = await this.toolExecutor.execute(tc.name, tc.arguments);

          onChunk({
            type: 'tool_result',
            toolResult: {
              toolCallId: tc.id,
              name: tc.name,
              output: execResult.output,
              isError: execResult.isError
            }
          });

          if (execResult.proposedDiff) {
            onChunk({
              type: 'diff',
              diff: execResult.proposedDiff
            });
          }

          // Append tool response to message history for next model step
          messages.push({
            role: 'tool',
            name: tc.name,
            tool_call_id: tc.id,
            content: execResult.output
          });
        }
      } catch (err: unknown) {
        if (abortSignal?.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        onChunk({ type: 'error', error: msg });
        return;
      }
    }

    onChunk({ type: 'done' });
  }
}
