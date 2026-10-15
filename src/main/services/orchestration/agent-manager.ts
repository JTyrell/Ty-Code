import type {
  AgentStreamChunk,
  AgentToolApproval,
  ChatMessage,
  ProviderSettings,
  ToolCall
} from '../../../preload/types';
import { ProviderGateway, type ChatCompletionMessage } from '../../providers/provider-gateway';
import { OPENCODE_TOOL_DEFINITIONS, executeOpenCodeTool } from './tools';
import type { AgentMode, ToolContext } from './tools/types';
import { SessionStore, type SessionData } from './session-store';
import { SecurityPolicyEngine } from '../security-policy';
import { settingsManager, type SettingsManager } from '../settings-manager';
import { getEccRulesPrompt, isLocalModel } from '../../agent/system-prompt';
import { moduleRegistry } from '../module-registry';

export interface RunOpenCodeAgentParams {
  prompt: string;
  workspacePath: string;
  history: ChatMessage[];
  settings: ProviderSettings;
  agentMode?: AgentMode;
  sessionId?: string;
  activeFilePath?: string;
  activeFileContent?: string;
  onChunk: (chunk: AgentStreamChunk) => void;
  requestApproval?: (approval: AgentToolApproval) => Promise<boolean>;
  abortSignal?: AbortSignal;
}

export interface AgentInfo {
  mode: AgentMode;
  name: string;
  description: string;
  readOnly: boolean;
  capabilities: string[];
}

export const AGENT_MODES: Record<AgentMode, AgentInfo> = {
  build: {
    mode: 'build',
    name: 'Build Agent',
    description: 'full-access development engineer for writing code, editing files, and running commands.',
    readOnly: false,
    capabilities: ['file-ops', 'bash-sandbox', 'grep-glob', 'lsp-diagnostics', 'mcp-tools']
  },
  plan: {
    mode: 'plan',
    name: 'Plan Agent',
    description: 'read-only code intelligence analyst for architecture review, code inspection, and project planning.',
    readOnly: true,
    capabilities: ['read-only-inspection', 'architecture-planning', 'search', 'guarded-bash']
  },
  general: {
    mode: 'general',
    name: 'General Subagent',
    description: 'Specialized agent for complex multi-step search, discovery, and dependency research.',
    readOnly: true,
    capabilities: ['multi-step-search', 'deep-exploration', 'web-fetch', 'code-indexing']
  }
};

export class OpenCodeAgentManager {
  private sessionStore: SessionStore;
  private securityPolicy: SecurityPolicyEngine;

  constructor(
    private workspacePath: string,
    settingsSource: Pick<SettingsManager, 'getEffectiveSettings'> = settingsManager
  ) {
    this.sessionStore = new SessionStore(workspacePath);
    this.securityPolicy = new SecurityPolicyEngine(workspacePath, settingsSource);
  }

  public getSessionStore(): SessionStore {
    return this.sessionStore;
  }

  public getAgentInfo(mode: AgentMode = 'build'): AgentInfo {
    return AGENT_MODES[mode] || AGENT_MODES.build;
  }

  public getSystemPrompt(
    agentMode: AgentMode = 'build',
    workspacePath: string = this.workspacePath,
    options?: { isEccEnabled?: boolean; isLocal?: boolean; settings?: any }
  ): string {
    return this.buildSystemPrompt(agentMode, workspacePath, undefined, undefined, options);
  }

  public getToolsForMode(mode: AgentMode): { name: string; description: string }[] {
    const excluded = mode === 'plan' ? ['write', 'edit', 'patch'] : [];
    return OPENCODE_TOOL_DEFINITIONS
      .filter((t) => !excluded.includes(t.function.name))
      .map((t) => ({
        name: t.function.name,
        description: t.function.description
      }));
  }

  public buildSystemPrompt(
    agentMode: AgentMode,
    workspacePath: string,
    activeFilePath?: string,
    activeFileContent?: string,
    options?: { isEccEnabled?: boolean; isLocal?: boolean; settings?: any }
  ): string {
    const info = this.getAgentInfo(agentMode);

    const basePrompt = [
      `You are the Ty-Code ${info.name} operating inside workspace "${workspacePath}".`,
      `Role Description: ${info.description}`,
      '',
      '### Framework Rules & Capabilities:',
      '- Use OpenCode tools to explore, search, and perform development work.',
      '- Available tools: view, write, edit, patch, bash, grep, glob, ls, fetch, diagnostics.',
      '- Always inspect existing files using "view", "grep", or "glob" before proposing modifications.',
      '- Keep code clean, performant, and follow workspace conventions.'
    ];

    if (agentMode === 'plan') {
      basePrompt.push(
        '',
        '### CRITICAL READ-ONLY RESTRICTIONS FOR PLAN AGENT:',
        '- You are strictly in READ-ONLY mode.',
        '- You MUST NOT call "write", "edit", or "patch" tools. If the user asks you to modify code, formulate a detailed plan and instruct them to switch to the Build Agent to apply changes.',
        '- Any "bash" execution requires explicit approval from the user.'
      );
    } else if (agentMode === 'general') {
      basePrompt.push(
        '',
        '### GENERAL SUBAGENT INSTRUCTIONS:',
        '- Focus on deep discovery, cross-referencing information, running grep/glob, and summarizing insights for the user.',
        '- Avoid making filesystem modifications.'
      );
    } else {
      basePrompt.push(
        '',
        '### BUILD AGENT GUIDELINES:',
        '- You have full access to create, edit, and patch workspace files and run shell commands.',
        '- Always verify your edits compile and run tests when appropriate.'
      );
    }

    if (activeFilePath) {
      basePrompt.push('', `Active editor file: "${activeFilePath}".`);
      if (activeFileContent) {
        basePrompt.push(`Active file preview:\n\`\`\`\n${activeFileContent.slice(0, 3000)}\n\`\`\``);
      }
    }

    let isEccEnabled = false;
    if (options && typeof options.isEccEnabled === 'boolean') {
      isEccEnabled = options.isEccEnabled;
    } else if (options?.settings?.integrations && typeof options.settings.integrations['ecc-rules'] === 'boolean') {
      isEccEnabled = options.settings.integrations['ecc-rules'];
    } else {
      try {
        isEccEnabled = Boolean(moduleRegistry.getModule('ecc-rules')?.isEnabled);
      } catch {
        isEccEnabled = false;
      }
    }

    if (isEccEnabled) {
      const isLocal = typeof options?.isLocal === 'boolean'
        ? options.isLocal
        : isLocalModel(options?.settings?.activeProvider, options?.settings?.activeModel);
      basePrompt.push('', getEccRulesPrompt(isLocal));
    }

    return basePrompt.join('\n');
  }

  public async run(params: RunOpenCodeAgentParams): Promise<void> {
    const {
      prompt,
      workspacePath,
      history,
      settings,
      onChunk,
      requestApproval,
      abortSignal
    } = params;

    const agentMode: AgentMode = params.agentMode || 'build';
    const agentInfo = this.getAgentInfo(agentMode);

    // Get or initialize persistent session
    const session: SessionData = await this.sessionStore.getOrCreateSession(params.sessionId, {
      title: prompt.slice(0, 60),
      agentMode
    });

    const isEccEnabled = Boolean(
      settings?.integrations?.['ecc-rules'] ?? moduleRegistry.getModule('ecc-rules')?.isEnabled
    );
    const isLocal = isLocalModel(settings?.activeProvider, settings?.activeModel);

    const systemPrompt = this.buildSystemPrompt(
      agentMode,
      workspacePath,
      params.activeFilePath,
      params.activeFileContent,
      { isEccEnabled, isLocal, settings }
    );

    const messages: ChatCompletionMessage[] = [{ role: 'system', content: systemPrompt }];
    for (const msg of history.slice(-10)) {
      if (msg.role === 'user' || msg.role === 'assistant') {
        messages.push({ role: msg.role, content: msg.content });
      }
    }
    messages.push({ role: 'user', content: prompt });

    onChunk({
      type: 'status',
      content: `Ty-Code ${agentInfo.name} active (${agentInfo.readOnly ? 'Read-Only' : 'Full Access'})…`
    });

    const maxSteps = 15;
    const tools = OPENCODE_TOOL_DEFINITIONS;

    const toolContext: ToolContext = {
      workspaceRoot: workspacePath,
      agentMode,
      securityPolicy: this.securityPolicy,
      requestApproval,
      abortSignal,
      trackModifiedFile: (filePath: string) => {
        void this.sessionStore.recordFileChange(session.metadata.id, filePath);
      }
    };

    for (let step = 0; step < maxSteps; step++) {
      if (abortSignal?.aborted) {
        onChunk({ type: 'cancelled' });
        return;
      }

      // Check auto-compact rule at 95% context threshold
      const compactCheck = this.sessionStore.checkAutoCompact(session);
      if (compactCheck.shouldCompact) {
        onChunk({
          type: 'status',
          content: `Context window at ${(compactCheck.ratio * 100).toFixed(1)}% (>= 95%). Auto-compacting session history…`
        });
        await this.sessionStore.autoCompactSession(session);
      }

      try {
        const streamResult = await ProviderGateway.streamChat(
          settings,
          messages,
          tools,
          {
            onToken: (content) => onChunk({ type: 'token', content }),
            onThought: (content) => onChunk({ type: 'thought', content })
          },
          abortSignal
        );

        // Estimate token usage (approx. 4 chars per token)
        const stepChars = (streamResult.fullText?.length || 0) + prompt.length;
        const estTokens = Math.max(100, Math.floor(stepChars / 4));
        session.metadata.totalTokensUsed += estTokens;
        await this.sessionStore.saveSession(session);

        const toolCallsToExecute = streamResult.toolCalls || [];

        if (!toolCallsToExecute.length) {
          onChunk({ type: 'done' });
          return;
        }

        messages.push({
          role: 'assistant',
          content: streamResult.fullText || '',
          tool_calls: toolCallsToExecute.map((tc) => ({
            id: tc.id,
            type: 'function',
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) }
          }))
        });

        for (const toolCall of toolCallsToExecute) {
          if (abortSignal?.aborted) {
            onChunk({ type: 'cancelled' });
            return;
          }

          const tool: ToolCall = {
            id: toolCall.id,
            name: toolCall.name,
            arguments: toolCall.arguments
          };
          onChunk({ type: 'tool_call', toolCall: tool });

          // Plan agent check: Refuse file edits immediately
          if (
            agentMode === 'plan' &&
            ['write', 'edit', 'patch', 'write_file', 'replace_file_content'].includes(toolCall.name)
          ) {
            const refusalMessage =
              'Plan Agent is in read-only exploration mode and cannot modify files. Switch to Build Agent to apply changes.';
            onChunk({
              type: 'tool_result',
              toolResult: {
                toolCallId: toolCall.id,
                name: toolCall.name,
                output: refusalMessage,
                isError: true
              }
            });
            messages.push({
              role: 'tool',
              name: toolCall.name,
              tool_call_id: toolCall.id,
              content: refusalMessage
            });
            continue;
          }


          onChunk({ type: 'status', content: `Running ${toolCall.name}…` });

          const result = await executeOpenCodeTool(toolCall.name, toolCall.arguments, toolContext);

          onChunk({
            type: 'tool_result',
            toolResult: {
              toolCallId: toolCall.id,
              name: toolCall.name,
              output: result.output,
              isError: result.isError
            }
          });

          if (result.proposedDiff) {
            onChunk({ type: 'diff', diff: result.proposedDiff });
          }

          messages.push({
            role: 'tool',
            name: toolCall.name,
            tool_call_id: toolCall.id,
            content: result.output
          });
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

export const agentManager = new OpenCodeAgentManager(process.cwd());
