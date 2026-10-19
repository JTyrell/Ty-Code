/**
 * FCC Harness Driver Service (Phase FCC-3)
 *
 * Implements Ty-Code as a Driver for external agent harnesses:
 * - Detects which of the 11 FCC-supported harnesses are installed on the user's PATH
 * - "Run session in <harness>" spawns the agent CLI in an integrated terminal/panel
 *   with injected credentials from the operating-system safeStorage vault and local supply endpoint.
 * - Parses session output into Ty-Code's tool-card and unified diff-review UI.
 * - Provides per-harness status for Settings > Integrations.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { credentialStore } from '../auth/credential-store';
import { localSupplyEndpoint } from './local-supply-endpoint';
import type { AgentHarnessType } from '../../../preload/types';

const execAsync = promisify(exec);

export interface HarnessInstallStatus {
  id: AgentHarnessType;
  name: string;
  cliName: string;
  installed: boolean;
  binaryPath?: string;
  version?: string;
  configSnippet: string;
}

export interface StructuredDiffBlock {
  filePath?: string;
  diff: string;
  additions: number;
  deletions: number;
}

export interface StructuredToolEvent {
  toolName: string;
  arguments: Record<string, unknown> | string;
  status: 'started' | 'completed' | 'error';
  result?: string;
}

export interface HarnessSessionInfo {
  sessionId: string;
  harnessId: AgentHarnessType;
  pid?: number;
  status: 'running' | 'completed' | 'error';
  logs: string[];
  parsedDiffs: StructuredDiffBlock[];
  parsedToolEvents: StructuredToolEvent[];
  startedAt: number;
}

const HARNESS_DEFINITIONS: {
  id: AgentHarnessType;
  name: string;
  cliName: string;
  commandSnippet: string;
}[] = [
  { id: 'claude-code', name: 'Claude Code', cliName: 'claude', commandSnippet: 'claude' },
  { id: 'codex', name: 'OpenAI Codex', cliName: 'codex', commandSnippet: 'codex' },
  { id: 'opencode', name: 'OpenCode', cliName: 'opencode', commandSnippet: 'opencode' },
  { id: 'pi', name: 'Pi Agent', cliName: 'pi', commandSnippet: 'pi-cli' },
  { id: 'cline', name: 'Cline', cliName: 'cline', commandSnippet: 'cline' },
  { id: 'aider', name: 'Aider', cliName: 'aider', commandSnippet: 'aider' },
  { id: 'hermes', name: 'Hermes', cliName: 'hermes', commandSnippet: 'hermes-agent' },
  { id: 'deepseek', name: 'DeepSeek CLI', cliName: 'deepseek', commandSnippet: 'deepseek-cli' },
  { id: 'grok-build', name: 'Grok Build', cliName: 'grok', commandSnippet: 'grok-build' },
  { id: 'muse-code', name: 'Muse Code', cliName: 'muse', commandSnippet: 'muse-code' },
  { id: 'vscode-chat', name: 'VS Code Chat', cliName: 'code', commandSnippet: 'code' }
];

export class HarnessDriverService {
  private static instance: HarnessDriverService | null = null;
  private activeSessions: Map<string, HarnessSessionInfo> = new Map();
  private childProcesses: Map<string, ChildProcess> = new Map();
  private sessionListeners: Array<(session: HarnessSessionInfo) => void> = [];

  public static getInstance(): HarnessDriverService {
    if (!HarnessDriverService.instance) {
      HarnessDriverService.instance = new HarnessDriverService();
    }
    return HarnessDriverService.instance;
  }

  /**
   * Scans PATH and common locations to detect which harnesses are installed.
   */
  public async detectInstalledHarnesses(): Promise<HarnessInstallStatus[]> {
    const results: HarnessInstallStatus[] = [];
    const isWin = process.platform === 'win32';
    const whichCmd = isWin ? 'where.exe' : 'which';

    for (const def of HARNESS_DEFINITIONS) {
      let installed = false;
      let binaryPath: string | undefined;
      let version: string | undefined;

      try {
        const { stdout } = await execAsync(`${whichCmd} ${def.cliName}`, { timeout: 1500 });
        const firstPath = stdout.trim().split(/\r?\n/)[0];
        if (firstPath && fsSync.existsSync(firstPath)) {
          installed = true;
          binaryPath = firstPath;
        }
      } catch {
        // Not on PATH; check common global npm / local bin paths
        const home = os.homedir();
        const altCandidates = isWin
          ? [
              path.join(home, 'AppData', 'Roaming', 'npm', `${def.cliName}.cmd`),
              path.join(home, '.local', 'bin', `${def.cliName}.exe`)
            ]
          : [
              path.join(home, '.local', 'bin', def.cliName),
              path.join('/usr', 'local', 'bin', def.cliName)
            ];

        for (const cand of altCandidates) {
          if (fsSync.existsSync(cand)) {
            installed = true;
            binaryPath = cand;
            break;
          }
        }
      }

      if (installed && binaryPath) {
        try {
          const { stdout: vOut } = await execAsync(`"${binaryPath}" --version`, { timeout: 2000 });
          version = vOut.trim().split(/\r?\n/)[0].slice(0, 30);
        } catch {
          version = 'Installed';
        }
      }

      results.push({
        id: def.id,
        name: def.name,
        cliName: def.cliName,
        installed,
        binaryPath,
        version,
        configSnippet: `OPENAI_API_BASE=http://127.0.0.1:52140/v1 ${def.commandSnippet}`
      });
    }

    return results;
  }

  /**
   * Starts a new session with the specified harness, injecting credentials
   * from safeStorage and pointing at Ty-Code's local supply endpoint.
   */
  public async runHarnessSession(params: {
    harnessId: AgentHarnessType;
    workspacePath?: string;
    initialPrompt?: string;
    customArgs?: string[];
  }): Promise<HarnessSessionInfo> {
    const sessionId = `harness_session_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const def = HARNESS_DEFINITIONS.find((h) => h.id === params.harnessId) || HARNESS_DEFINITIONS[0];

    // Ensure local supply server is up
    const supplyStatus = localSupplyEndpoint.getStatus();
    if (!supplyStatus.running) {
      await localSupplyEndpoint.start();
    }

    const localBaseUrl = localSupplyEndpoint.getStatus().baseUrl;
    const localToken = localSupplyEndpoint.getAuthToken();

    // Prepare injected environment variables
    const injectedEnv: Record<string, string> = {
      ...process.env as Record<string, string>,
      OPENAI_API_BASE: localBaseUrl,
      OPENAI_API_KEY: localToken,
      ANTHROPIC_BASE_URL: localBaseUrl,
      ANTHROPIC_API_KEY: credentialStore.getDecryptedKey('anthropic') || localToken,
      DEEPSEEK_API_BASE: localBaseUrl,
      DEEPSEEK_API_KEY: localToken,
      TY_CODE_WORKSPACE: params.workspacePath || process.cwd(),
      TY_CODE_SESSION_ID: sessionId
    };

    const session: HarnessSessionInfo = {
      sessionId,
      harnessId: params.harnessId,
      status: 'running',
      logs: [
        `[Ty-Code Driver] Initializing ${def.name} session...`,
        `[Ty-Code Driver] Injected supply endpoint: ${localBaseUrl}`,
        `[Ty-Code Driver] Shared credentials loaded from operating-system safeStorage.`
      ],
      parsedDiffs: [],
      parsedToolEvents: [],
      startedAt: Date.now()
    };

    this.activeSessions.set(sessionId, session);
    this.notifyListeners(session);

    const args = params.customArgs || [];
    if (params.initialPrompt) {
      args.push(params.initialPrompt);
    }

    try {
      const child = spawn(def.cliName, args, {
        cwd: params.workspacePath || process.cwd(),
        env: injectedEnv,
        shell: true
      });

      session.pid = child.pid;
      this.childProcesses.set(sessionId, child);

      child.stdout?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        session.logs.push(text);
        this.parseOutput(session, text);
        this.notifyListeners(session);
      });

      child.stderr?.on('data', (data: Buffer) => {
        const text = data.toString('utf8');
        session.logs.push(`[STDERR] ${text}`);
        this.notifyListeners(session);
      });

      child.on('close', (code: number) => {
        session.status = code === 0 ? 'completed' : 'error';
        session.logs.push(`[Ty-Code Driver] Session process terminated with code ${code}.`);
        this.childProcesses.delete(sessionId);
        this.notifyListeners(session);
      });

      child.on('error', (err: Error) => {
        // Never fabricate session output. If the harness CLI is missing, the
        // session fails with an actionable message instead of synthetic diffs.
        session.status = 'error';
        session.logs.push(
          `[Error] Harness CLI "${def.cliName}" could not start: ${err.message}. Install the CLI (it must be on PATH) and rerun the session.`
        );
        this.notifyListeners(session);
      });
    } catch (err: unknown) {
      session.status = 'error';
      session.logs.push(`[Error] Spawning harness failed: ${err instanceof Error ? err.message : String(err)}`);
      this.notifyListeners(session);
    }

    return session;
  }

  /**
   * Parses streaming output from harness CLI for unified diffs and tool cards.
   */
  private parseOutput(session: HarnessSessionInfo, chunk: string): void {
    const normalized = chunk.replace(/\r\n/g, '\n');
    // 1. Unified Diff parsing (--- a/... +++ b/...)
    const diffRegex = /(?:^|\n)(--- [^\n]+\n\+\+\+ [^\n]+\n@@ [^\n]+ @@[\s\S]*?)(?=\n--- |\n\n|$)/g;
    let match: RegExpExecArray | null;

    while ((match = diffRegex.exec(normalized)) !== null) {
      const diffText = match[1];
      const fileMatch = diffText.match(/\+\+\+ b\/([^\s]+)/);
      const filePath = fileMatch ? fileMatch[1] : undefined;
      const additions = (diffText.match(/^\+[^+]/gm) || []).length;
      const deletions = (diffText.match(/^-[^-]/gm) || []).length;

      session.parsedDiffs.push({
        filePath,
        diff: diffText,
        additions,
        deletions
      });
    }

    // 2. Tool-card event parsing ([Tool: name(...)])
    const toolRegex = /\[(?:Tool|Action):\s*([a-zA-Z0-9_-]+)\((.*?)\)\]/g;
    while ((match = toolRegex.exec(normalized)) !== null) {
      const toolName = match[1];
      const argsRaw = match[2];
      session.parsedToolEvents.push({
        toolName,
        arguments: argsRaw,
        status: 'started'
      });
    }
  }

  public parseStructuredDiffs(chunk: string): StructuredDiffBlock[] {
    const normalized = chunk.replace(/\r\n/g, '\n');
    const diffs: StructuredDiffBlock[] = [];
    const diffRegex = /(?:^|\n)(--- [^\n]+\n\+\+\+ [^\n]+\n@@ [^\n]+ @@[\s\S]*?)(?=\n--- |\n\n|$)/g;
    let match: RegExpExecArray | null;
    while ((match = diffRegex.exec(normalized)) !== null) {
      const diffText = match[1].trim();
      const fileMatch = diffText.match(/\+\+\+ b\/([^\s]+)/);
      const filePath = fileMatch ? fileMatch[1] : undefined;
      const additions = (diffText.match(/^\+[^+]/gm) || []).length;
      const deletions = (diffText.match(/^-[^-]/gm) || []).length;
      diffs.push({
        filePath,
        diff: diffText,
        additions,
        deletions
      });
    }
    return diffs;
  }

  public parseStructuredToolEvents(chunk: string): StructuredToolEvent[] {
    const tools: StructuredToolEvent[] = [];
    const toolRegex = /\[(?:Tool|Action):\s*([a-zA-Z0-9_-]+)\((.*?)\)\]/g;
    let match: RegExpExecArray | null;
    while ((match = toolRegex.exec(chunk)) !== null) {
      const toolName = match[1];
      const argsRaw = match[2];
      tools.push({
        toolName,
        arguments: argsRaw,
        status: 'started'
      });
    }
    return tools;
  }

  public getSession(sessionId: string): HarnessSessionInfo | undefined {
    return this.activeSessions.get(sessionId);
  }

  public onSessionUpdate(listener: (session: HarnessSessionInfo) => void): () => void {
    this.sessionListeners.push(listener);
    return () => {
      this.sessionListeners = this.sessionListeners.filter((l) => l !== listener);
    };
  }

  private notifyListeners(session: HarnessSessionInfo): void {
    for (const listener of this.sessionListeners) {
      try {
        listener(session);
      } catch {}
    }
  }
}

export const harnessDriverService = HarnessDriverService.getInstance();
