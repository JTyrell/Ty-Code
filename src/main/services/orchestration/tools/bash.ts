import { exec } from 'node:child_process';
import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import type { AgentToolApproval } from '../../../../preload/types';

export const bashTool: OpenCodeTool = {
  name: 'bash',
  description: 'Execute a shell command with security sandboxing, timeout enforcement, and captured output.',
  definition: {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a shell command with security sandboxing, timeout enforcement, and captured output.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The shell command to execute.'
          },
          timeoutMs: {
            type: 'number',
            description: 'Execution timeout in milliseconds (default: 30000).'
          },
          cwd: {
            type: 'string',
            description: 'Optional working directory relative to workspace root.'
          }
        },
        required: ['command']
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    const command = String(args.command || '');
    if (!command.trim()) {
      return { output: 'Error: "command" parameter is required.', isError: true };
    }

    // Dangerous destructive pattern check
    if (/\b(?:rm\s+-(?:rf|fr)\s+(?:\/|\.\.|\*)|del\s+\/[sq]\s+[a-z]:\\|format\s+[a-z]:)/i.test(command)) {
      return {
        output: 'Blocked by security policy: Destructive command detected that could compromise root or system files.',
        isError: true
      };
    }

    // In Plan mode: Plan agent MUST ask permission before executing bash
    if (context.agentMode === 'plan') {
      const approvalReason = 'Plan Agent requires explicit user confirmation before executing shell commands.';
      if (context.requestApproval) {
        const approval: AgentToolApproval = {
          id: `approval_bash_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          toolCall: {
            id: `call_${Date.now()}`,
            name: 'bash',
            arguments: { command }
          },
          reason: approvalReason,
          affectedPaths: [command]
        };
        const approved = await context.requestApproval(approval);
        if (!approved) {
          return {
            output: 'Command execution denied by user (Plan Agent permission gate).',
            isError: true,
            metadata: { approvalDenied: true }
          };
        }
      } else {
        return {
          output: 'Plan Agent requires explicit user confirmation before executing shell commands.',
          isError: true,
          metadata: { requiresApproval: true }
        };
      }
    }

    const workingDir = args.cwd
      ? path.resolve(context.workspaceRoot, String(args.cwd))
      : context.workspaceRoot;
    const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : 30_000;

    return new Promise((resolve) => {
      const child = exec(
        command,
        {
          cwd: workingDir,
          timeout: timeoutMs,
          maxBuffer: 1024 * 1024,
          env: { ...process.env, CI: 'true', TERM: 'dumb' },
          windowsHide: true
        },
        (error, stdout, stderr) => {
          const outStr = (stdout || '').trim();
          const errStr = (stderr || '').trim();
          const exitCode = error && typeof error.code === 'number' ? error.code : error ? 1 : 0;

          const formatted = [
            outStr ? `Stdout:\n${outStr}` : '',
            errStr ? `Stderr:\n${errStr}` : '',
            `Exit code: ${exitCode}`
          ].filter(Boolean).join('\n\n');

          resolve({
            output: formatted || `Command completed with exit code ${exitCode}`,
            isError: exitCode !== 0,
            metadata: { exitCode, command }
          });
        }
      );

      if (context.abortSignal) {
        context.abortSignal.addEventListener(
          'abort',
          () => {
            try { child.kill('SIGTERM'); } catch {}
            resolve({
              output: 'Command execution cancelled by abort signal.',
              isError: true
            });
          },
          { once: true }
        );
      }
    });
  }
};
