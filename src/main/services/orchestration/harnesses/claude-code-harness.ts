/**
 * Claude Code Harness (`claude-code-cli`)
 * Formats prompts and tools matching the official Claude Code autonomous CLI harness.
 */

import type { AgentHarness, HarnessMetadata } from './types';
import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';
import { TEXTUAL_TOOL_PROTOCOL } from './tool-protocol';

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
    supportedFeatures: ['autonomous-loop', 'bash-pty', 'surgical-replace', 'multi-file-context']
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
    const finalCalls = [...toolCalls];

    // Also parse inline XML tool calls if emitted by model
    const xmlRegex = /<tool_call>\s*<name>([^<]+)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/g;
    let match: RegExpExecArray | null;
    while ((match = xmlRegex.exec(fullText)) !== null) {
      try {
        const name = match[1].trim();
        const args = JSON.parse(match[2].trim()) as Record<string, unknown>;
        finalCalls.push({ id: `call_${crypto.randomUUID()}`, name, arguments: args });
      } catch {
        // Skip malformed XML tool call
      }
    }

    const cleanText = fullText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim();
    return { text: cleanText || fullText, toolCalls: finalCalls };
  }
}
