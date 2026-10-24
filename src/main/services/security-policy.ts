import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProposedDiff, ToolCall } from '../../preload/types';
import type { SecurityPolicySettings } from '../../shared/types/settings';
import type { SettingsManager } from './settings-manager';
import { policyEngine } from './policy/policy-engine';

export type PolicyDecision = 'allow' | 'ask' | 'block';

export interface FileMutationReview {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  addedLines: number;
  removedLines: number;
  originalExists: boolean;
  originalHash: string;
}

export function buildSanitizedPtyEnv(baseEnv: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const SENSITIVE_PATTERNS = [
    /key/i,
    /token/i,
    /secret/i,
    /password/i,
    /credential/i,
    /auth/i,
    /jwt/i,
    /private/i
  ];

  const SAFE_ALLOWLIST = new Set([
    'SSH_AUTH_SOCK',
    'COLORTERM',
    'TERM',
    'PATH',
    'Path',
    'PATHEXT',
    'SHELL',
    'SystemRoot',
    'SYSTEMROOT',
    'ComSpec',
    'COMSPEC',
    'WINDIR',
    'windir',
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'TMP',
    'TEMP',
    'TMPDIR',
    'LANG',
    'LC_ALL',
    'USER',
    'LOGNAME',
    'HOSTNAME',
    'CI'
  ]);

  const sanitized: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (typeof value !== 'string') continue;
    if (SAFE_ALLOWLIST.has(key)) {
      sanitized[key] = value;
      continue;
    }
    if (SENSITIVE_PATTERNS.some((pat) => pat.test(key))) {
      continue;
    }
    if (key === 'NODE_OPTIONS' || key === 'ELECTRON_RUN_AS_NODE') {
      continue;
    }
    sanitized[key] = value;
  }
  sanitized.TERM = 'xterm-256color';
  return sanitized;
}

const SAFE_COMMANDS = [
  /^(?:ls|dir)(?:\s+(?!\/|[a-z]:|~|.*\.\.)[\w./\\-]+)*$/i,
  /^(?:cat|type)\s+(?!\/|[a-z]:|~|.*\.\.)[\w./\\-]+$/i,
  /^(?:pwd|cd)$/i,
  /^git(?:\.exe)?\s+(?:status|log|diff|branch|show)(?:\s+[^\n;&|`]+)*$/i,
  /^node(?:\.exe)?\s+(?:--version|-v)$/i,
  /^npm(?:\.exe)?\s+(?:--version|-v)$/i,
  /^python(?:\.exe)?\s+(?:--version|-V)$/i,
  /^git(?:\.exe)?\s+--version$/i,
  /^echo\s+[^\n;&|`]+$/i,
  /^npm\s+(?:install|i)(?:\s+--(?:no-audit|no-fund|prefer-offline))*$/i
];

const DESTRUCTIVE_COMMANDS = [
  /\b(?:rm|del|erase|rmdir|rd)\b/i,
  /\bremove-item\b/i,
  /\b(?:kill|pkill|killall|taskkill)\b/i,
  /\b(?:stop-process)\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdd\s+if=/i,
  /\bmkfs\b/i,
  /\b(?:fdisk|diskpart)\b/i,
  /\b(?:shutdown|reboot|init\s+0)\b/i,
  /\bsudo\b/i,
  /\brunas\b/i,
  /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]*\|\s*(?:bash|sh|powershell|pwsh)\b/i,
  /\b(?:invoke-expression|iex)\b/i
];

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function countLineChanges(original: string, proposed: string): { addedLines: number; removedLines: number } {
  const before = original.split(/\r?\n/);
  const after = proposed.split(/\r?\n/);
  let prefix = 0;
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++;
  let suffix = 0;
  while (suffix < before.length - prefix && suffix < after.length - prefix && before[before.length - 1 - suffix] === after[after.length - 1 - suffix]) suffix++;
  return {
    addedLines: Math.max(0, after.length - prefix - suffix),
    removedLines: Math.max(0, before.length - prefix - suffix)
  };
}

export class SecurityPolicyEngine {
  constructor(
    private readonly workspaceRoot: string,
    private readonly settingsManager: Pick<SettingsManager, 'getEffectiveSettings'>
  ) {}

  public async getPolicy(): Promise<SecurityPolicySettings> {
    const effective = await this.settingsManager.getEffectiveSettings();
    return effective.security;
  }

  public async evaluateTerminalCommand(command: string): Promise<{ decision: PolicyDecision; reason: string }> {
    const trimmed = (command || '').trim();

    // Enterprise Policy override (highest precedence in Three-Tier Sandbox)
    const enterpriseTerminalPolicy = policyEngine.getTerminalPolicy();
    if (enterpriseTerminalPolicy === 'disabled') {
      return { decision: 'block', reason: 'Terminal execution is disabled by enterprise policy.' };
    }
    if (enterpriseTerminalPolicy === 'always-ask') {
      return { decision: 'ask', reason: 'Enterprise policy requires user confirmation for all terminal commands.' };
    }

    const policy = await this.getPolicy();

    const enforceWorkspaceOnly = policy.fileAccessPolicy !== 'system-access' || !policy.systemAccessConfirmed;
    if (enforceWorkspaceOnly && this.referencesOutsideWorkspace(trimmed)) {
      return { decision: 'block', reason: 'The command references a path outside the active workspace, which is blocked by Workspace Only access.' };
    }

    const isDestructive = DESTRUCTIVE_COMMANDS.some((pattern) => pattern.test(trimmed));
    const isReadOnly = SAFE_COMMANDS.some((pattern) => pattern.test(trimmed));

    // Restricted Mode: Auto-approves read-only (ls, cat), blocks destructive (rm, kill)
    if (policy.terminalPolicy === 'restricted') {
      if (isDestructive) {
        return { decision: 'block', reason: 'Destructive command is blocked by Restricted Mode security policy.' };
      }
      if (isReadOnly) {
        return { decision: 'allow', reason: 'Command matches the Restricted Mode read-only allowlist.' };
      }
      return { decision: 'ask', reason: 'State-altering command requires user approval in Restricted Mode.' };
    }

    // Always Ask: Halts for state-altering commands and any unconfirmed execution
    if (policy.terminalPolicy === 'always-ask') {
      if (isDestructive) {
        return { decision: 'block', reason: 'Destructive command is blocked. Execute manually in the integrated terminal if required.' };
      }
      return { decision: 'ask', reason: 'Always Ask policy requires explicit approval for all terminal commands.' };
    }

    // Always Proceed
    if (isDestructive) {
      return { decision: 'ask', reason: 'Destructive command requires confirmation even in Always Proceed mode.' };
    }
    return { decision: 'allow', reason: 'Always Proceed is enabled.' };
  }

  public async checkTerminalCommand(command: string): Promise<{
    decision: PolicyDecision;
    status: 'ALLOW' | 'ASK' | 'BLOCK';
    reason: string;
    allowed: boolean;
    blocked: boolean;
    ask: boolean;
    toString: () => string;
    valueOf: () => string;
  }> {
    const res = await this.evaluateTerminalCommand(command);
    const status: 'ALLOW' | 'ASK' | 'BLOCK' = res.decision === 'allow' ? 'ALLOW' : res.decision === 'block' ? 'BLOCK' : 'ASK';
    return {
      decision: res.decision,
      status,
      reason: res.reason,
      allowed: res.decision === 'allow',
      blocked: res.decision === 'block',
      ask: res.decision === 'ask',
      toString: () => status,
      valueOf: () => status
    };
  }

  public async isFileAllowed(filePath: string): Promise<boolean> {
    try {
      await this.resolveFilePath(filePath, true);
      return true;
    } catch {
      return false;
    }
  }

  public async evaluateFileMutation(review: FileMutationReview): Promise<{ decision: PolicyDecision; reason: string }> {
    const policy = await this.getPolicy();
    if (policy.reviewPolicy === 'always-ask') return { decision: 'ask', reason: 'Always Ask is enabled for agent file changes.' };
    const changes = review.addedLines + review.removedLines;
    if (changes <= 5) return { decision: 'allow', reason: `Auto-Apply Safe permits this ${changes}-line change.` };
    return { decision: 'ask', reason: `This change affects ${changes} lines; changes modifying more than 5 lines require DiffEditor review.` };
  }

  private referencesOutsideWorkspace(command: string): boolean {
    if (/(?:^|[\s"'=])\.\.(?:\\|\/)/.test(command) || /(?:%USERPROFILE%|\$HOME|\$env:USERPROFILE|~[\\/])/i.test(command)) return true;
    const candidates = command.match(/(?:^|[\s"'])(?:[A-Za-z]:[\\/][^\s"';&|`]*|\/(?!\/)[^\s"';&|`]*|~[\\/][^\s"';&|`]*)/g) || [];
    const root = path.resolve(this.workspaceRoot);
    return candidates.some((candidate) => {
      const target = candidate.trim().replace(/^['"]|['"]$/g, '');
      if (target.startsWith('~/') || target.startsWith('~\\')) return true;
      const absolute = path.isAbsolute(target) || path.win32.isAbsolute(target);
      if (!absolute) return false;
      const resolved = path.resolve(target);
      return !isWithin(root, resolved);
    });
  }

  public async resolveFilePath(filePath: string, allowMissing = false): Promise<string> {
    if (!filePath || typeof filePath !== 'string') throw new Error('A valid file path is required.');
    const policy = await this.getPolicy();
    if (policy.fileAccessPolicy === 'system-access' && !policy.systemAccessConfirmed) {
      throw new Error('System Access is disabled until explicitly confirmed in Global Settings.');
    }

    const workspaceRoot = await fs.realpath(this.workspaceRoot);
    const absolute = path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(workspaceRoot, filePath);
    const enforceWorkspaceOnly = policy.fileAccessPolicy !== 'system-access' || !policy.systemAccessConfirmed;
    if (enforceWorkspaceOnly && !isWithin(workspaceRoot, absolute)) {
      throw new Error(`Security Exception: Access denied to path outside workspace: "${filePath}"`);
    }

    try {
      const realPath = await fs.realpath(absolute);
      if (enforceWorkspaceOnly && !isWithin(workspaceRoot, realPath)) {
        throw new Error(`Security Exception: Path resolves outside workspace: "${filePath}"`);
      }
      return realPath;
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let parent = path.dirname(absolute);
      while (parent !== path.dirname(parent)) {
        try {
          const realParent = await fs.realpath(parent);
          if (enforceWorkspaceOnly && !isWithin(workspaceRoot, realParent)) {
            throw new Error(`Security Exception: Parent path resolves outside workspace: "${filePath}"`);
          }
          return absolute;
        } catch (parentError) {
          if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError;
          parent = path.dirname(parent);
        }
      }
      if (enforceWorkspaceOnly && !isWithin(workspaceRoot, absolute)) {
        throw new Error(`Security Exception: Access denied to path outside workspace: "${filePath}"`);
      }
      return absolute;
    }
  }

  public async createFileMutationReview(filePath: string, proposedContent: string): Promise<FileMutationReview> {
    const absolutePath = await this.resolveFilePath(filePath, true);
    let originalContent = '';
    let originalExists = false;
    try {
      originalContent = await fs.readFile(absolutePath, 'utf8');
      originalExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    return {
      filePath,
      originalContent,
      proposedContent,
      ...countLineChanges(originalContent, proposedContent),
      originalExists,
      originalHash: createHash('sha256').update(originalContent, 'utf8').digest('hex')
    };
  }

  public async verifyFileMutationSnapshot(review: FileMutationReview): Promise<string> {
    const absolutePath = await this.resolveFilePath(review.filePath, true);
    let currentContent = '';
    let exists = false;
    try {
      currentContent = await fs.readFile(absolutePath, 'utf8');
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const hash = createHash('sha256').update(currentContent, 'utf8').digest('hex');
    if (exists !== review.originalExists || hash !== review.originalHash) {
      throw new Error(`File ${review.filePath} changed after approval. Review the updated file before applying this change.`);
    }
    return absolutePath;
  }

  public async previewFileMutation(toolName: string, args: Record<string, unknown>): Promise<FileMutationReview> {
    if (toolName !== 'write_file' && toolName !== 'replace_file_content' && toolName !== 'edit_file') throw new Error('Unsupported file mutation review.');
    const requestedPath = String(args.filePath || args.path || '');
    if (!requestedPath) throw new Error('filePath is required.');
    const absolutePath = await this.resolveFilePath(requestedPath, true);
    let originalContent = '';
    let originalExists = false;
    try {
      originalContent = await fs.readFile(absolutePath, 'utf8');
      originalExists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }

    let proposedContent: string;
    if (toolName === 'write_file') {
      if (originalContent && args.overwrite !== true) throw new Error(`File ${requestedPath} already exists. Set overwrite: true to replace it.`);
      proposedContent = String(args.content ?? '');
    } else {
      const targetContent = String(args.targetContent || args.oldString || args.old_str || args.oldContent || '');
      if (!targetContent) throw new Error('targetContent is required.');
      const replacementContent = String(args.replacementContent ?? args.newString ?? args.new_str ?? args.newContent ?? '');
      const occurrences = originalContent.split(targetContent).length - 1;
      if (occurrences !== 1) throw new Error(occurrences === 0
        ? `targetContent was not found in ${requestedPath}.`
        : `targetContent matched ${occurrences} occurrences in ${requestedPath}.`);
      proposedContent = originalContent.replace(targetContent, () => replacementContent);
    }
    return {
      filePath: requestedPath,
      originalContent,
      proposedContent,
      ...countLineChanges(originalContent, proposedContent),
      originalExists,
      originalHash: createHash('sha256').update(originalContent, 'utf8').digest('hex')
    };
  }

  public createFileMutationToolCall(tool: ToolCall, review: FileMutationReview): ProposedDiff {
    return {
      id: `review_${tool.id}`,
      filePath: review.filePath,
      originalContent: review.originalContent,
      proposedContent: review.proposedContent,
      description: `Review changes proposed by ${tool.name}`,
      status: 'pending'
    };
  }
}
