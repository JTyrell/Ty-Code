import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProposedDiff, ToolCall } from '../../preload/types';
import type { SecurityPolicySettings } from '../../shared/types/settings';
import type { SettingsManager } from './settings-manager';

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

const SAFE_COMMANDS = [
  /^(?:ls|dir)(?:\s+(?!\/|[a-z]:|~|.*\.\.)[\w./\\-]+)?$/i,
  /^cat\s+(?!\/|[a-z]:|~|.*\.\.)[\w./\\-]+$/i,
  /^git(?:\.exe)?\s+status(?:\s+(?:--short|-s|--branch))?$/i,
  /^npm\s+(?:install|i)(?:\s+--(?:no-audit|no-fund|prefer-offline))*$/i
];

const HIGH_RISK_COMMANDS = [
  /\brm\s+-(?:rf|fr)\b/i,
  /\bsudo\b/i,
  /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]*\|\s*(?:bash|sh|powershell|pwsh)\b/i,
  /\b(?:invoke-expression|iex)\b/i,
  /\bremove-item\b[^\n]*-recurse/i,
  /\bdel\s+\/s\s+\/q\b/i,
  /\bformat\s+[a-z]:/i,
  /\bdd\s+if=/i
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
    const policy = await this.getPolicy();
    if (policy.fileAccessPolicy === 'workspace-only' && this.referencesOutsideWorkspace(command)) {
      return { decision: 'block', reason: 'The command references a path outside the active workspace, which is blocked by Workspace Only access.' };
    }
    if (policy.terminalPolicy === 'always-proceed') return { decision: 'allow', reason: 'Always Proceed is enabled.' };
    if (policy.terminalPolicy === 'always-ask') return { decision: 'ask', reason: 'Always Ask requires approval for every command.' };
    if (SAFE_COMMANDS.some((pattern) => pattern.test(command.trim()))) {
      return { decision: 'allow', reason: 'This command matches the Restricted Mode safe-command allowlist.' };
    }
    const highRisk = HIGH_RISK_COMMANDS.some((pattern) => pattern.test(command));
    return {
      decision: 'ask',
      reason: highRisk
        ? 'This command matches a high-risk pattern and requires explicit approval.'
        : 'This command is not on the Restricted Mode safe-command allowlist.'
    };
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
    if (changes < 5) return { decision: 'allow', reason: `Auto-Apply Safe permits this ${changes}-line change.` };
    return { decision: 'ask', reason: `This change affects ${changes} lines; changes of 5 or more lines require review.` };
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
    if (policy.fileAccessPolicy === 'workspace-only' && !isWithin(workspaceRoot, absolute)) {
      throw new Error(`Security Exception: Access denied to path outside workspace: "${filePath}"`);
    }

    try {
      const realPath = await fs.realpath(absolute);
      if (policy.fileAccessPolicy === 'workspace-only' && !isWithin(workspaceRoot, realPath)) {
        throw new Error(`Security Exception: Path resolves outside workspace: "${filePath}"`);
      }
      return realPath;
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      let parent = path.dirname(absolute);
      while (parent !== path.dirname(parent)) {
        try {
          const realParent = await fs.realpath(parent);
          if (policy.fileAccessPolicy === 'workspace-only' && !isWithin(workspaceRoot, realParent)) {
            throw new Error(`Security Exception: Parent path resolves outside workspace: "${filePath}"`);
          }
          return absolute;
        } catch (parentError) {
          if ((parentError as NodeJS.ErrnoException).code !== 'ENOENT') throw parentError;
          parent = path.dirname(parent);
        }
      }
      if (policy.fileAccessPolicy === 'workspace-only' && !isWithin(workspaceRoot, absolute)) {
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
    if (toolName !== 'write_file' && toolName !== 'replace_file_content') throw new Error('Unsupported file mutation review.');
    const requestedPath = String(args.filePath || '');
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
      const targetContent = String(args.targetContent || '');
      if (!targetContent) throw new Error('targetContent is required.');
      const replacementContent = String(args.replacementContent ?? '');
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
