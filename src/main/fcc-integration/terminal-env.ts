/**
 * FCC Terminal Environment Builder
 * Builds the child-shell environment for Ty-Code terminals so FCC agent
 * wrappers (fcc-claude / fcc-codex / fcc-cline) resolve immediately and the
 * FCC loopback proxy is discoverable.
 *
 * Security: third-party API keys stay sealed in the OS keychain (safeStorage)
 * and are NEVER exported into terminal environments.
 */

import path from 'path';
import { fccServiceManager } from './fcc-service-manager';
import { fccManager } from '../services/orchestration/fcc-manager';

export interface FccTerminalEnvOptions {
  model?: string | null;
}

export function buildFccTerminalEnv(
  baseEnv: Record<string, string>,
  options: FccTerminalEnvOptions = {}
): void {
  const status = fccServiceManager.getStatus();

  if (status.binaryPath) {
    const binDir = path.dirname(status.binaryPath);
    const separator = process.platform === 'win32' ? ';' : ':';
    baseEnv.PATH = baseEnv.PATH ? `${binDir}${separator}${baseEnv.PATH}` : binDir;
  }

  const server = fccManager.getStatus();
  if (server.running) {
    baseEnv.FCC_PROXY_URL = `http://127.0.0.1:${server.port}`;
    baseEnv.FCC_PROXY_PORT = String(server.port);
  }

  if (options.model) {
    baseEnv.FCC_MODEL = options.model;
  }

  baseEnv.FCC_SESSION = 'tycode';
}
