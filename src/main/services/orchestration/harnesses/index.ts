/**
 * 11 FCC Coding Agent Harnesses Registry
 */

import type { AgentHarness, AgentHarnessType, HarnessMetadata } from './types';
import { ClaudeCodeHarness } from './claude-code-harness';
import { CodexHarness } from './codex-harness';
import type { ChatCompletionMessage } from '../../../providers/provider-gateway';
import type { ToolCall } from '../../../../preload/types';

export * from './types';
export * from './claude-code-harness';
export * from './codex-harness';

class GenericHarness implements AgentHarness {
  constructor(public readonly metadata: HarnessMetadata) {}

  public formatSystemPrompt(workspacePath: string, activeFilePath?: string, activeFileContent?: string): string {
    return [
      `You are ${this.metadata.name} operating within workspace "${workspacePath}".`,
      this.metadata.description,
      activeFilePath ? `Active file: "${activeFilePath}".` : '',
      activeFileContent ? `Active file preview:\n\`\`\`\n${activeFileContent.slice(0, 3000)}\n\`\`\`` : ''
    ].filter(Boolean).join('\n\n');
  }

  public formatMessages(messages: ChatCompletionMessage[]): ChatCompletionMessage[] {
    return messages;
  }

  public formatTools(tools: unknown[]): unknown[] {
    return tools;
  }

  public parseResponse(fullText: string, toolCalls: ToolCall[]): { text: string; toolCalls: ToolCall[] } {
    return { text: fullText, toolCalls };
  }
}

const harnesses: Record<AgentHarnessType, AgentHarness> = {
  'claude-code': new ClaudeCodeHarness(),
  codex: new CodexHarness(),
  opencode: new GenericHarness({
    id: 'opencode',
    name: 'OpenCode CLI',
    cliName: 'opencode-cli',
    description: 'Open-source autonomous CLI harness for multi-provider coding',
    defaultModel: 'deepseek/deepseek-chat',
    promptFormat: 'opencode-standard',
    toolProtocol: 'json-function',
    systemPromptRole: 'Autonomous OpenCode Developer',
    supportedFeatures: ['multi-model', 'local-ollama', 'command-execution']
  }),
  pi: new GenericHarness({
    id: 'pi',
    name: 'Pi CLI Harness',
    cliName: 'pi-cli',
    description: 'High-interactivity dialog coding assistant harness',
    defaultModel: 'llama-3.3-70b-versatile',
    promptFormat: 'pi-v1',
    toolProtocol: 'json-function',
    systemPromptRole: 'Collaborative Pair Programmer',
    supportedFeatures: ['dialogue-turn', 'interactive-hints']
  }),
  cline: new GenericHarness({
    id: 'cline',
    name: 'Cline Autonomous Harness',
    cliName: 'cline',
    description: 'Cline agentic workflow harness with deep workspace planning and browser support',
    defaultModel: 'claude-3-5-sonnet-20241022',
    promptFormat: 'cline-tasks',
    toolProtocol: 'json-function',
    systemPromptRole: 'Full-Stack Agentic Engineer',
    supportedFeatures: ['step-planning', 'subtask-execution', 'permission-gate']
  }),
  aider: new GenericHarness({
    id: 'aider',
    name: 'Aider Chat Harness',
    cliName: 'aider-chat',
    description: 'Git-integrated pair programming with automatic git commits on edits',
    defaultModel: 'deepseek-chat',
    promptFormat: 'aider-diff',
    toolProtocol: 'markdown-patch',
    systemPromptRole: 'Git-Centric Pair Programmer',
    supportedFeatures: ['git-auto-commit', 'repo-map', 'udiff-edits']
  }),
  hermes: new GenericHarness({
    id: 'hermes',
    name: 'Hermes Agent Harness',
    cliName: 'hermes-agent',
    description: 'Reasoning-heavy planning harness for multi-step architecture refactorings',
    defaultModel: 'deepseek-reasoner',
    promptFormat: 'hermes-thought',
    toolProtocol: 'json-function',
    systemPromptRole: 'Architectural Systems Analyst',
    supportedFeatures: ['extended-thinking', 'step-reflection']
  }),
  deepseek: new GenericHarness({
    id: 'deepseek',
    name: 'DeepSeek Native Harness',
    cliName: 'deepseek-harness',
    description: 'DeepSeek V3 & R1 native reasoning and coding harness',
    defaultModel: 'deepseek/deepseek-r1',
    promptFormat: 'deepseek-cot',
    toolProtocol: 'json-function',
    systemPromptRole: 'DeepSeek Algorithmic Engineer',
    supportedFeatures: ['cot-reasoning', 'algorithm-synthesis']
  }),
  'grok-build': new GenericHarness({
    id: 'grok-build',
    name: 'Grok Build Harness',
    cliName: 'grok-build',
    description: 'xAI Grok fast development and project bootstrapping harness',
    defaultModel: 'grok-2',
    promptFormat: 'grok-build-v1',
    toolProtocol: 'json-function',
    systemPromptRole: 'Project Bootstrapper',
    supportedFeatures: ['rapid-prototyping', 'real-time-context']
  }),
  'muse-code': new GenericHarness({
    id: 'muse-code',
    name: 'Muse Code Harness',
    cliName: 'muse-code',
    description: 'Creative and frontend UI design synthesis harness',
    defaultModel: 'gpt-4o',
    promptFormat: 'muse-ui',
    toolProtocol: 'json-function',
    systemPromptRole: 'Creative Frontend Architect',
    supportedFeatures: ['ui-components', 'css-styling', 'animation-design']
  }),
  'vscode-chat': new GenericHarness({
    id: 'vscode-chat',
    name: 'VS Code Chat Harness',
    cliName: 'vscode-chat',
    description: 'VS Code Language Model API compliant conversation harness',
    defaultModel: 'claude-3-5-sonnet-20241022',
    promptFormat: 'vscode-lm-api',
    toolProtocol: 'json-function',
    systemPromptRole: 'VS Code Companion Assistant',
    supportedFeatures: ['editor-selection', 'inline-chat', 'quick-fix']
  })
};

export function getHarness(type: AgentHarnessType = 'claude-code'): AgentHarness {
  return harnesses[type] || harnesses['claude-code'];
}

export function getAllHarnesses(): HarnessMetadata[] {
  return Object.values(harnesses).map((h) => h.metadata);
}
