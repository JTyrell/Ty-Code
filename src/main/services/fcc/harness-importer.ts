/**
 * FCC Harness Config Detector & Importer Service (Phase FCC-2)
 *
 * Detects existing AI tool configurations on the developer's machine:
 * - ~/.claude, ~/.claude.json, ~/.claude/config.json (Claude Code)
 * - ~/.codex, ~/.codex/config.json (OpenAI Codex CLI)
 * - ~/.config/opencode, ~/.opencode (OpenCode Sync)
 * - ~/.aider.conf.yml, ~/.aider (Aider Chat)
 *
 * Offers automated import of model preferences, custom system prompts, and compatible API keys into safeStorage.
 * Lists the 11 FCC-supported coding agent harnesses Ty-Code can drive.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { AgentHarnessType, HarnessMetadata } from '../orchestration/harnesses/types';
import { getAllHarnesses } from '../orchestration/harnesses';
import { credentialStore } from '../auth/credential-store';

export interface DetectedHarnessConfig {
  id: string; // 'claude' | 'codex' | 'opencode' | 'aider'
  name: string;
  configPath: string;
  harnessType: AgentHarnessType;
  modelPreference?: string;
  hasCredentials: boolean;
  credentialSummary?: string;
  apiKey?: string;
  customInstructions?: string;
  rawPreferences: Record<string, unknown>;
}

export interface HarnessImportResult {
  success: boolean;
  importedHarness?: AgentHarnessType;
  importedModel?: string;
  importedCredentials: string[];
  importedInstructions?: boolean;
  error?: string;
}

export class HarnessImporter {
  private static instance: HarnessImporter | null = null;

  public static getInstance(): HarnessImporter {
    if (!HarnessImporter.instance) {
      HarnessImporter.instance = new HarnessImporter();
    }
    return HarnessImporter.instance;
  }

  /**
   * Returns all 11 supported FCC coding agent harnesses.
   */
  public getSupportedHarnesses(): HarnessMetadata[] {
    return getAllHarnesses();
  }

  /**
   * Scans filesystem for existing AI tool configurations.
   * Accepts an optional customHomeDir for deterministic unit testing.
   */
  public async detectExistingConfigs(customHomeDir?: string): Promise<DetectedHarnessConfig[]> {
    const home = customHomeDir || os.homedir();
    const detected: DetectedHarnessConfig[] = [];

    // 1. Claude Code (~/.claude.json, ~/.claude/config.json, ~/.claude/settings.json)
    const claudeCandidates = [
      path.join(home, '.claude.json'),
      path.join(home, '.claude', 'config.json'),
      path.join(home, '.claude', 'settings.json'),
      path.join(home, '.claude')
    ];

    for (const cPath of claudeCandidates) {
      try {
        if (!fsSync.existsSync(cPath)) continue;
        const stat = await fs.stat(cPath);
        let parsed: Record<string, unknown> = {};

        if (stat.isFile()) {
          const raw = await fs.readFile(cPath, 'utf8');
          try {
            parsed = JSON.parse(raw);
          } catch {
            // If not JSON, parse simple key: value pairs
            parsed = this.parseSimpleKeyValue(raw);
          }
        } else if (stat.isDirectory()) {
          // Look for any json file inside ~/.claude
          const innerConfig = path.join(cPath, 'config.json');
          if (fsSync.existsSync(innerConfig)) {
            const raw = await fs.readFile(innerConfig, 'utf8');
            parsed = JSON.parse(raw);
          }
        }

        const modelPref = (parsed.model || parsed.primaryModel || parsed.preferredModel || parsed.defaultModel) as string | undefined;
        const apiKey = (parsed.apiKey || parsed.anthropicApiKey || parsed.token) as string | undefined;
        const customInstructions = (parsed.customInstructions || parsed.instructions || parsed.systemPrompt) as string | undefined;

        detected.push({
          id: 'claude',
          name: 'Claude Code CLI',
          configPath: cPath,
          harnessType: 'claude-code',
          modelPreference: modelPref || 'claude-3-5-sonnet-20241022',
          hasCredentials: Boolean(apiKey),
          credentialSummary: apiKey ? `Anthropic Key (ending in ...${apiKey.slice(-4)})` : undefined,
          apiKey,
          customInstructions,
          rawPreferences: parsed
        });
        break; // Only register once for Claude
      } catch {
        // Skip unreadable
      }
    }

    // 2. OpenAI Codex (~/.codex/config.json, ~/.codex)
    const codexCandidates = [
      path.join(home, '.codex', 'config.json'),
      path.join(home, '.codex')
    ];

    for (const cPath of codexCandidates) {
      try {
        if (!fsSync.existsSync(cPath)) continue;
        const stat = await fs.stat(cPath);
        let parsed: Record<string, unknown> = {};

        if (stat.isFile()) {
          const raw = await fs.readFile(cPath, 'utf8');
          parsed = JSON.parse(raw);
        } else if (stat.isDirectory()) {
          const innerConfig = path.join(cPath, 'config.json');
          if (fsSync.existsSync(innerConfig)) {
            const raw = await fs.readFile(innerConfig, 'utf8');
            parsed = JSON.parse(raw);
          }
        }

        const modelPref = (parsed.model || parsed.defaultModel) as string | undefined;
        const apiKey = (parsed.apiKey || parsed.openaiApiKey) as string | undefined;

        detected.push({
          id: 'codex',
          name: 'OpenAI Codex CLI',
          configPath: cPath,
          harnessType: 'codex',
          modelPreference: modelPref || 'gpt-4o',
          hasCredentials: Boolean(apiKey),
          credentialSummary: apiKey ? `OpenAI Key (ending in ...${apiKey.slice(-4)})` : undefined,
          apiKey,
          rawPreferences: parsed
        });
        break;
      } catch {
        // Skip
      }
    }

    // 3. OpenCode (~/.config/opencode/opencode.json, ~/.opencode)
    const opencodeCandidates = [
      path.join(home, '.config', 'opencode', 'opencode.json'),
      path.join(home, '.config', 'opencode', 'config.json'),
      path.join(home, '.opencode', 'config.json'),
      path.join(home, '.opencode')
    ];

    for (const cPath of opencodeCandidates) {
      try {
        if (!fsSync.existsSync(cPath)) continue;
        const stat = await fs.stat(cPath);
        let parsed: Record<string, unknown> = {};

        if (stat.isFile()) {
          const raw = await fs.readFile(cPath, 'utf8');
          parsed = JSON.parse(raw);
        } else if (stat.isDirectory()) {
          const inner = path.join(cPath, 'opencode.json');
          if (fsSync.existsSync(inner)) {
            parsed = JSON.parse(await fs.readFile(inner, 'utf8'));
          }
        }

        const modelPref = (parsed.model || parsed.activeModel) as string | undefined;

        detected.push({
          id: 'opencode',
          name: 'OpenCode Workspace Sync',
          configPath: cPath,
          harnessType: 'opencode',
          modelPreference: modelPref || 'claude-3.5-sonnet',
          hasCredentials: Boolean(parsed.apiKey),
          credentialSummary: parsed.apiKey ? 'OpenCode Auth Token' : undefined,
          apiKey: parsed.apiKey as string | undefined,
          rawPreferences: parsed
        });
        break;
      } catch {
        // Skip
      }
    }

    // 4. Aider (~/.aider.conf.yml, ~/.aider, .aider.conf.yml)
    const aiderCandidates = [
      path.join(home, '.aider.conf.yml'),
      path.join(home, '.aider.model.settings.yml'),
      path.join(home, '.aider')
    ];

    for (const cPath of aiderCandidates) {
      try {
        if (!fsSync.existsSync(cPath)) continue;
        let parsed: Record<string, unknown> = {};
        const stat = await fs.stat(cPath);

        if (stat.isFile()) {
          const raw = await fs.readFile(cPath, 'utf8');
          parsed = this.parseSimpleKeyValue(raw);
        }

        const modelPref = (parsed.model || parsed['model-name']) as string | undefined;
        const apiKey = (parsed['openai-api-key'] || parsed['anthropic-api-key']) as string | undefined;

        detected.push({
          id: 'aider',
          name: 'Aider Git Pair Programmer',
          configPath: cPath,
          harnessType: 'aider',
          modelPreference: modelPref || 'deepseek/deepseek-r1',
          hasCredentials: Boolean(apiKey),
          credentialSummary: apiKey ? 'Aider Provider Key' : undefined,
          apiKey,
          rawPreferences: parsed
        });
        break;
      } catch {
        // Skip
      }
    }

    return detected;
  }

  /**
   * Imports preferences and credentials from a detected tool configuration.
   */
  public async importHarnessPreferences(
    detected: DetectedHarnessConfig,
    options?: {
      importModel?: boolean;
      importHarness?: boolean;
      importCredentials?: boolean;
    }
  ): Promise<HarnessImportResult> {
    const importModel = options?.importModel !== false;
    const importHarness = options?.importHarness !== false;
    const importCredentials = options?.importCredentials !== false;

    const importedCredentials: string[] = [];

    try {
      // 1. If credentials present and requested, save to safeStorage
      if (importCredentials && detected.apiKey) {
        let providerKey = 'anthropic';
        if (detected.id === 'codex') providerKey = 'openai';
        else if (detected.id === 'aider') providerKey = 'openrouter';

        try {
          await credentialStore.saveCredential(providerKey, detected.apiKey, `${detected.name} Imported Key`);
          importedCredentials.push(providerKey);
        } catch {
          // Fallback if OS safe storage is unavailable
        }
      }

      return {
        success: true,
        importedHarness: importHarness ? detected.harnessType : undefined,
        importedModel: importModel ? detected.modelPreference : undefined,
        importedCredentials,
        importedInstructions: Boolean(detected.customInstructions)
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        importedCredentials: [],
        error: `Import failed: ${msg}`
      };
    }
  }

  /**
   * Lightweight parser for simple yaml / ini key-value config lines.
   */
  private parseSimpleKeyValue(text: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    const lines = text.split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith('//')) continue;

      const colonIdx = line.indexOf(':');
      const eqIdx = line.indexOf('=');
      const splitIdx = colonIdx !== -1 && eqIdx !== -1 ? Math.min(colonIdx, eqIdx) : colonIdx !== -1 ? colonIdx : eqIdx;

      if (splitIdx > 0) {
        const key = line.slice(0, splitIdx).trim();
        let val = line.slice(splitIdx + 1).trim();
        // Remove quotes if present
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        result[key] = val;
      }
    }

    return result;
  }
}

export const harnessImporter = HarnessImporter.getInstance();
