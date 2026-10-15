/**
 * FCC Coding Agent Harnesses Types
 * Defines the contract for all 11 FCC coding agent harnesses.
 */

import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';

export type AgentHarnessType =
  | 'claude-code'
  | 'codex'
  | 'opencode'
  | 'pi'
  | 'cline'
  | 'aider'
  | 'hermes'
  | 'deepseek'
  | 'grok-build'
  | 'muse-code'
  | 'vscode-chat';

export interface HarnessMetadata {
  id: AgentHarnessType;
  name: string;
  cliName: string;
  description: string;
  defaultModel: string;
  promptFormat: string;
  toolProtocol: 'json-function' | 'xml-tags' | 'markdown-patch' | 'cli-invocations';
  systemPromptRole: string;
  supportedFeatures: string[];
}

export interface AgentHarness {
  readonly metadata: HarnessMetadata;
  formatSystemPrompt(workspacePath: string, activeFilePath?: string, activeFileContent?: string): string;
  formatMessages(messages: ChatCompletionMessage[]): ChatCompletionMessage[];
  formatTools(tools: unknown[]): unknown[];
  parseResponse(
    fullText: string,
    toolCalls: ToolCall[]
  ): { text: string; toolCalls: ToolCall[] };
}
