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

  checkApproval(toolName: string, args: any): Promise<boolean> {
    this.pruneExpired();
    const normalized = TOOL_ALIASES[String(toolName)] || String(toolName);
    let matched: ApprovalRule | null = null;
    for (const rule of this.rules) {
      const ruleTool = TOOL_ALIASES[rule.toolName] || rule.toolName;
      if (ruleTool !== normalized) continue;
      if (rule.pattern) {
        try {
          const probe = JSON.stringify(args ?? {});
          if (!new RegExp(rule.pattern).test(probe)) continue;
        } catch {
          continue;
        }
      }
      matched = rule;
      break;
    }
    if (!matched) return this.requestUserApproval(String(toolName), args ?? {});
    if (matched.action === 'auto_deny') return Promise.resolve(false);
    if (matched.action === 'auto_approve') return Promise.resolve(true);
    return this.requestUserApproval(String(toolName), args ?? {});
  }

  hasRuleWithAction(toolName: string, args: any, action: ApprovalRule['action']): boolean {
    const normalized = TOOL_ALIASES[String(toolName)] || String(toolName);
    for (const rule of this.rules) {
      const ruleTool = TOOL_ALIASES[rule.toolName] || rule.toolName;
      if (ruleTool !== normalized || rule.action !== action) continue;
      if (rule.pattern) {
        try {
          if (!new RegExp(rule.pattern).test(JSON.stringify(args ?? {}))) continue;
        } catch {
          continue;
        }
      }
      return true;
    }
    return false;
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
