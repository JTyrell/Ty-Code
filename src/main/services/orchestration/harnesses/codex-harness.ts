/**
 * Codex Harness (`codex-cli`)
 * Formats prompts and tools matching the OpenAI Codex CLI harness
 * emphasizing high-speed code generation, diff synthesis, and test suites.
 */

import type { AgentHarness, HarnessMetadata } from './types';
import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';

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
    return { text: fullText, toolCalls };
  }
}
