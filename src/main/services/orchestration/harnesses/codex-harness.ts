/**
 * Codex Harness (`codex-cli`)
 * Formats prompts and tools matching the OpenAI Codex CLI harness
 * emphasizing high-speed code generation, diff synthesis, and test suites.
 */

import type { AgentHarness, HarnessMetadata } from './types';
import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';
import { TEXTUAL_TOOL_PROTOCOL } from './tool-protocol';

export class CodexHarness implements AgentHarness {
  public readonly metadata: HarnessMetadata = {
    id: 'codex',
    name: 'Codex CLI',
    cliName: 'codex-cli',
    description: 'High-speed code synthesis and patch execution engine optimized for coding & unit test generation',
    defaultModel: 'gpt-4o',
    promptFormat: 'codex-v2',
    toolProtocol: 'json-function',
    systemPromptRole: 'Principal Coding Specialist',
    supportedFeatures: ['patch-diffs', 'test-generation', 'strict-typing', 'high-throughput']
  };

  public formatSystemPrompt(workspacePath: string, activeFilePath?: string, activeFileContent?: string): string {
    return [
      `You are Codex, an AI coding specialist operating inside the repository at "${workspacePath}".`,
      'Produce production-grade code, unit tests, and minimal diffs. Avoid explanatory fluff; provide immediate, correct code solutions.',
      TEXTUAL_TOOL_PROTOCOL,
      activeFilePath ? `Target file: "${activeFilePath}".` : '',
      activeFileContent ? `Target file context:\n\`\`\`\n${activeFileContent.slice(0, 4000)}\n\`\`\`` : ''
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
    const xmlRegex = /<tool_call>\s*<name>([\s\S]+?)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/g;
    let match: RegExpExecArray | null;
    while ((match = xmlRegex.exec(fullText)) !== null) {
      try {
        finalCalls.push({ id: `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`, name: match[1].trim(), arguments: JSON.parse(match[2].trim()) as Record<string, unknown> });
      } catch {
        // Skip malformed XML tool call
      }
    }
    const cleanText = finalCalls.length ? fullText.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '').trim() : fullText;
    return { text: cleanText || fullText, toolCalls: finalCalls };
  }
}
