import type { AgentToolApproval, ProposedDiff } from '../../../../preload/types';
import type { SecurityPolicyEngine } from '../../security-policy';

export type AgentMode = 'build' | 'plan' | 'general';

export interface ToolContext {
  workspaceRoot: string;
  agentMode: AgentMode;
  securityPolicy?: SecurityPolicyEngine;
  requestApproval?: (approval: AgentToolApproval) => Promise<boolean>;
  trackModifiedFile?: (filePath: string) => void;
  abortSignal?: AbortSignal;
}

export interface OpenCodeToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, unknown>;
      required?: string[];
      additionalProperties?: boolean;
    };
  };
}

export interface ToolExecutionResult {
  output: string;
  isError?: boolean;
  proposedDiff?: ProposedDiff;
  metadata?: Record<string, unknown>;
}

export interface OpenCodeTool {
  name: string;
  description: string;
  definition: OpenCodeToolDefinition;
  execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult>;
}
