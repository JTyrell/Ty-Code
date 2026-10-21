// Tool Approval Manager (Harness Controller)
//
// This policy is deliberately PROVIDER-AGNOSTIC: `checkApproval` receives only
// (toolName, args), never a provider or model id, so every tool execution is
// gated identically whether the agent was driven by a paid model, an FCC free
// model, a subscription bridge or a local Ollama build. Auto-approve is
// reserved for read-only, workspace-bound operations; everything that mutates
// the workspace or escapes it (writes, replacements, terminal commands) always
// asks. Workspace containment itself is enforced separately in the Main
// process by SecurityPolicyEngine + ShellSandbox, again with no knowledge of
// the driving provider.

import type { AgentApprovalDecision } from '../../preload/types';

export interface ApprovalRule {
  id: string;
  toolName: string;
  pattern?: string;
  action: 'always_ask' | 'auto_approve' | 'auto_deny';
  scope: 'workspace' | 'system' | 'network';
  expiresAt?: number;
}

export const DEFAULT_RULES: ApprovalRule[] = [
  { id: 'read-only', toolName: 'read_file', action: 'auto_approve', scope: 'workspace' },
  { id: 'list-dir', toolName: 'list_directory', action: 'auto_approve', scope: 'workspace' },
  { id: 'grep', toolName: 'grep_search', action: 'auto_approve', scope: 'workspace' },
  { id: 'write-ask', toolName: 'write_file', action: 'always_ask', scope: 'workspace' },
  { id: 'terminal-ask', toolName: 'run_terminal_command', action: 'always_ask', scope: 'system' },
  { id: 'replace-ask', toolName: 'replace_file_content', action: 'always_ask', scope: 'workspace' },
  { id: 'git-read-status', toolName: 'git_status', action: 'auto_approve', scope: 'workspace' },
  { id: 'git-read-diff', toolName: 'git_diff', action: 'auto_approve', scope: 'workspace' },
  { id: 'git-read-log', toolName: 'git_log', action: 'auto_approve', scope: 'workspace' },
  { id: 'list-dir-alias', toolName: 'list_dir', action: 'auto_approve', scope: 'workspace' },
  { id: 'run-command-ask', toolName: 'run_command', action: 'always_ask', scope: 'system' }
];

const TOOL_ALIASES: Record<string, string> = {
  run_terminal_command: 'run_command',
  list_directory: 'list_dir'
};

const USER_APPROVAL_TIMEOUT_MS = 120_000;

const pendingApprovalTimers = new Map<string, ReturnType<typeof setTimeout>>();

const sharedRules: ApprovalRule[] = [...DEFAULT_RULES];

function makeRuleId(): string {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export class ToolApprovalManager {
  rules: ApprovalRule[];
  pendingApprovals: Map<string, { resolve: Function; reject: Function }> = new Map();
  private userApprovalDelegate: ((toolName: string, args: Record<string, unknown>) => Promise<AgentApprovalDecision>) | null = null;

  constructor(rules: ApprovalRule[] = sharedRules) {
    this.rules = rules;
    this.pruneExpired();
  }

  setUserApprovalDelegate(delegate: (toolName: string, args: Record<string, unknown>) => Promise<AgentApprovalDecision>): void {
    this.userApprovalDelegate = delegate;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (let i = this.rules.length - 1; i >= 0; i--) {
      const expiresAt = this.rules[i].expiresAt;
      if (typeof expiresAt === 'number' && expiresAt <= now) this.rules.splice(i, 1);
    }
  }

  /**
   * Finds the first rule matching a tool call. Tool names are normalized
   * through TOOL_ALIASES on both sides so harnesses that use different names
   * resolve to exactly the same policy. Pattern rules are matched against
   * the serialized arguments so per-argument rules (e.g. "allow git status
   * but not git commit") evaluate the same way everywhere.
   */
  private matchRule(toolName: string, args: any): ApprovalRule | null {
    this.pruneExpired();
    const normalized = TOOL_ALIASES[String(toolName)] || String(toolName);
    for (const rule of this.rules) {
      const ruleTool = TOOL_ALIASES[rule.toolName] || rule.toolName;
      if (ruleTool !== normalized) continue;
      if (rule.pattern) {
        try {
          if (!new RegExp(rule.pattern).test(JSON.stringify(args ?? {}))) continue;
        } catch {
          continue;
        }
      }
      return rule;
    }
    return null;
  }

  checkApproval(toolName: string, args: any): Promise<boolean> {
    const matched = this.matchRule(toolName, args);
    if (!matched) return this.requestUserApproval(String(toolName), args ?? {});
    if (matched.action === 'auto_deny') return Promise.resolve(false);
    if (matched.action === 'auto_approve') return Promise.resolve(true);
    return this.requestUserApproval(String(toolName), args ?? {});
  }

  hasRuleWithAction(toolName: string, args: any, action: ApprovalRule['action']): boolean {
    const matched = this.matchRule(toolName, args);
    return Boolean(matched && matched.action === action);
  }

  addRule(rule: ApprovalRule): void {
    const normalized: ApprovalRule = {
      id: rule.id && rule.id.length > 0 ? rule.id : makeRuleId(),
      toolName: String(rule.toolName),
      action: rule.action,
      scope: rule.scope,
      ...(rule.pattern ? { pattern: rule.pattern } : {}),
      ...(typeof rule.expiresAt === 'number' ? { expiresAt: rule.expiresAt } : {})
    };
    const index = this.rules.findIndex((existing) => existing.id === normalized.id
      || (existing.toolName === normalized.toolName && !existing.pattern && !normalized.pattern));
    if (index >= 0) this.rules.splice(index, 1);
    this.rules.push(normalized);
    this.pruneExpired();
  }

  removeRule(id: string): void {
    const index = this.rules.findIndex((rule) => rule.id === id);
    if (index >= 0) this.rules.splice(index, 1);
  }

  getStandingApprovals(): ApprovalRule[] {
    this.pruneExpired();
    return this.rules.slice();
  }

  requestUserApproval(toolName: string, args: any): Promise<boolean> {
    if (!this.userApprovalDelegate) return Promise.resolve(false);
    const approvalId = `rule_approval_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<boolean>((resolve) => {
      const settle = (value: boolean) => {
        if (!this.pendingApprovals.has(approvalId)) return;
        this.pendingApprovals.delete(approvalId);
        resolve(value);
      };
      const timer = setTimeout(() => settle(false), USER_APPROVAL_TIMEOUT_MS);
      pendingApprovalTimers.set(approvalId, timer);
      this.pendingApprovals.set(approvalId, {
        resolve: (value: boolean) => settle(Boolean(value)),
        reject: (reason?: unknown) => settle(false)
      });
      void this.userApprovalDelegate!(String(toolName), args ?? {})
        .then((decision) => {
          clearTimeout(timer);
          pendingApprovalTimers.delete(approvalId);
          settle(Boolean(decision?.approved));
        })
        .catch(() => {
          clearTimeout(timer);
          pendingApprovalTimers.delete(approvalId);
          settle(false);
        });
    });
  }

  rejectAllPending(): void {
    for (const [id, pending] of Array.from(this.pendingApprovals.entries())) {
      pending.reject(new Error('Demand rejected'));
      this.pendingApprovals.delete(id);
    }
    for (const timer of pendingApprovalTimers.values()) clearTimeout(timer);
    pendingApprovalTimers.clear();
  }
}

export const toolApprovalManager = new ToolApprovalManager(sharedRules);
export { makeRuleId as createApprovalRuleId };
