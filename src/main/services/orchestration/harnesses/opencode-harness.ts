/**
 * OpenCode Autonomous Coding Agent Harness
 * Supports Build Agent (default full-access), Plan Agent (read-only), and General Subagent.
 */

import type { AgentHarness, HarnessMetadata } from './types';
import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';
import { OPENCODE_TOOL_DEFINITIONS } from '../tools';
import { TEXTUAL_TOOL_PROTOCOL } from './tool-protocol';

export class OpenCodeHarness implements AgentHarness {
  public readonly metadata: HarnessMetadata = {
    id: 'opencode',
    name: 'OpenCode Framework',
    cliName: 'opencode',
    description: 'Autonomous coding framework with Build and Plan agent modes, LSP, and MCP support',
    defaultModel: 'deepseek/deepseek-chat',
    promptFormat: 'opencode-standard',
    toolProtocol: 'json-function',
    systemPromptRole: 'Autonomous OpenCode Engineer',
    supportedFeatures: ['build-mode', 'plan-mode', 'lsp-diagnostics', 'auto-compact-95', 'unified-patch']
  };

  public formatSystemPrompt(workspacePath: string, activeFilePath?: string, activeFileContent?: string): string {
    return [
      `You are OpenCode, an autonomous coding agent operating in workspace "${workspacePath}".`,
      'You are equipped with 10 production-grade tools: view, write, edit, patch, bash, grep, glob, ls, fetch, diagnostics.',
      'Always inspect existing code before applying edits, generate clean diffs, and verify diagnostics.',
      TEXTUAL_TOOL_PROTOCOL,
      activeFilePath ? `Active file: "${activeFilePath}".` : '',
      activeFileContent ? `Active file preview:\n\`\`\`\n${activeFileContent.slice(0, 3000)}\n\`\`\`` : ''
    ].filter(Boolean).join('\n\n');
  }

  public formatMessages(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return messages;
  }

  public formatTools(_tools: unknown[]): unknown[] {
    return OPENCODE_TOOL_DEFINITIONS;
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
