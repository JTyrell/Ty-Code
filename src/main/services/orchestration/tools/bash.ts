import { exec } from 'node:child_process';
import path from 'node:path';
import { resolveToolPath } from './view';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { approveTerminalCommand } from './policy';

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

    const { cwd, denied } = await approveTerminalCommand(
      command,
      typeof args.cwd === 'string' ? args.cwd : undefined,
      context,
      context.agentMode === 'plan'
    );
    if (denied) return denied;
    const workingDir = cwd || (args.cwd
      ? await resolveToolPath(context, String(args.cwd))
      : context.workspaceRoot);
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
