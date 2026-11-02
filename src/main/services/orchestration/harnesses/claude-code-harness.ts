/**
 * Claude Code Harness (`claude-code-cli`)
 * Formats prompts and tools matching the official Claude Code autonomous CLI harness.
 */

import type { AgentHarness, HarnessMetadata } from './types';
import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';
import { TEXTUAL_TOOL_PROTOCOL, parseClaudeAntmlToolCalls } from './tool-protocol';

export class ClaudeCodeHarness implements AgentHarness {
  public readonly metadata: HarnessMetadata = {
    id: 'claude-code',
    name: 'Claude Code CLI',
    cliName: 'claude-code-cli',
    description: 'Official Claude Code autonomous engineering loop with surgical diffs and bash operations',
    defaultModel: 'claude-3-5-sonnet-20241022',
    promptFormat: 'claude-code-v1',
    toolProtocol: 'json-function',
    systemPromptRole: 'Senior Staff Software Engineer',
    supportedFeatures: ['autonomous-loop', 'bash-pty', 'surgical-replace', 'multi-file-context', 'antml-tool-block-parsing']
  };

  public formatSystemPrompt(workspacePath: string, activeFilePath?: string, activeFileContent?: string): string {
    return [
      `You are Claude Code, an expert autonomous software engineer working directly in the user's workspace at "${workspacePath}".`,
      'You solve coding tasks by reading code, editing files surgically, running shell commands, and verifying tests.',
      'Always prioritize minimal, high-impact edits without gratuitous refactoring or whitespace corruption.',
      TEXTUAL_TOOL_PROTOCOL,
      activeFilePath ? `Currently open file: "${activeFilePath}".` : '',
      activeFileContent ? `Active file contents:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : ''
    ].filter(Boolean).join('\n\n');
  }

  public formatMessages(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return messages.map((m) => ({ ...m }));
  }

  public formatTools(tools: unknown[]): unknown[] {
    return tools;
  }

  public parseResponse(
    fullText: string,
    toolCalls: ToolCall[]
  ): { text: string; toolCalls: ToolCall[] } {
    // Stage 4a-1: parse Anthropic `<antml:function_calls>` blocks natively; falls
    // through to the universal textual parser when no antml markup is present.
    return parseClaudeAntmlToolCalls(fullText, toolCalls);
  }
}
