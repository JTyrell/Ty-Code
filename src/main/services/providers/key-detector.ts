/**
 * Automatic API Key Detector (Phase 6.2)
 *
 * Scans the local environment, existing config files, git credentials,
 * and local inference runtimes to automatically discover API keys and
 * available local endpoints with zero friction.
 *
 * Sources:
 * 1. Environment variables (OPENAI_API_KEY, ANTHROPIC_API_KEY, OPENROUTER_API_KEY, etc.)
 * 2. Git credential helper (GitHub Copilot / github.com personal tokens)
 * 3. Existing config files (~/.config/opencode, ~/.ty-code, ~/.openkilo, ~/.claude, ~/.config/huggingface)
 * 4. Browser/CLI caches (~/.cache/huggingface/token)
 * 5. Local Ollama & LM Studio instances (localhost:11434, localhost:1234)
 *
 * Brand: Ty-Code
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DetectedApiKey } from '../../../shared/types/byok';

const execFileAsync = promisify(execFile);

export function maskKey(rawKey: string): string {
  if (!rawKey || typeof rawKey !== 'string') return '';
  const trimmed = rawKey.trim();
  if (trimmed.length <= 8) return '••••••••';
  const prefix = trimmed.slice(0, Math.min(6, Math.floor(trimmed.length / 4)));
  const suffix = trimmed.slice(-4);
  return `${prefix}••••••••${suffix}`;
}

const ENV_KEY_MAPPINGS: Array<{
  envVar: string;
  providerId: string;
  providerName: string;
}> = [
  { envVar: 'OPENROUTER_API_KEY', providerId: 'openrouter', providerName: 'OpenRouter' },
  { envVar: 'ANTHROPIC_API_KEY', providerId: 'anthropic', providerName: 'Anthropic' },
  { envVar: 'OPENAI_API_KEY', providerId: 'openai', providerName: 'OpenAI' },
  { envVar: 'GROQ_API_KEY', providerId: 'groq', providerName: 'Groq' },
  { envVar: 'GEMINI_API_KEY', providerId: 'google-ai-studio-free', providerName: 'Google AI Studio' },
  { envVar: 'GOOGLE_API_KEY', providerId: 'google-ai-studio-free', providerName: 'Google AI Studio' },
  { envVar: 'DEEPSEEK_API_KEY', providerId: 'deepseek', providerName: 'DeepSeek' },
  { envVar: 'TOGETHER_API_KEY', providerId: 'together-ai-free', providerName: 'Together AI' },
  { envVar: 'TOGETHERAI_API_KEY', providerId: 'together-ai-free', providerName: 'Together AI' },
  { envVar: 'FIREWORKS_API_KEY', providerId: 'fireworks-ai-free', providerName: 'Fireworks AI' },
  { envVar: 'HUGGINGFACE_API_KEY', providerId: 'huggingface-free', providerName: 'Hugging Face' },
  { envVar: 'HF_TOKEN', providerId: 'huggingface-free', providerName: 'Hugging Face' },
  { envVar: 'OPENKILO_API_KEY', providerId: 'openkilo', providerName: 'OpenKilo' },
  { envVar: 'KILO_API_KEY', providerId: 'openkilo', providerName: 'OpenKilo' },
  { envVar: 'OPENCODE_API_KEY', providerId: 'opencode', providerName: 'OpenCode' },
  { envVar: 'OPENCODE_ZEN_API_KEY', providerId: 'opencode', providerName: 'OpenCode' },
  { envVar: 'MISTRAL_API_KEY', providerId: 'mistral', providerName: 'Mistral AI' },
  { envVar: 'COHERE_API_KEY', providerId: 'cohere', providerName: 'Cohere' }
];

export class KeyDetector {
  private static instance: KeyDetector;
  private lastDetectedKeys: Map<string, DetectedApiKey> = new Map();

  public static getInstance(): KeyDetector {
    if (!KeyDetector.instance) {
      KeyDetector.instance = new KeyDetector();
    }
    return KeyDetector.instance;
  }

  /**
   * Scans all supported sources and returns a consolidated list of detected API keys and local runtimes.
   */
  public async detectAllKeys(): Promise<DetectedApiKey[]> {
    const results: DetectedApiKey[] = [];
    const seen = new Set<string>();

    // 1. Scan Environment Variables
    const envKeys = this.detectFromEnvironment();
    for (const k of envKeys) {
      const keySignature = `${k.providerId}:${k.rawKey}`;
      if (!seen.has(keySignature)) {
        seen.add(keySignature);
        results.push(k);
      }
    }

    // 2. Scan Local Config Files
    const configKeys = await this.detectFromConfigFiles();
    for (const k of configKeys) {
      const keySignature = `${k.providerId}:${k.rawKey}`;
      if (!seen.has(keySignature)) {
        seen.add(keySignature);
        results.push(k);
      }
    }

    // 3. Scan Git Credentials (GitHub Copilot / tokens)
    const gitKeys = await this.detectFromGitCredentials();
    for (const k of gitKeys) {
      const keySignature = `${k.providerId}:${k.rawKey}`;
      if (!seen.has(keySignature)) {
        seen.add(keySignature);
        results.push(k);
      }
    }

    // 4. Scan Local Inference Runtimes (Ollama & LM Studio)
    const localRuntimes = await this.detectLocalRuntimes();
    for (const runtime of localRuntimes) {
      results.push(runtime);
    }

    // Cache results for fast lookup during import
    this.lastDetectedKeys.clear();
    for (const item of results) {
      this.lastDetectedKeys.set(item.id, item);
    }

    return results;
  }

  /**
   * Retrieves a cached detected key by ID (including rawKey for secure import).
   */
  public getDetectedKeyById(id: string): DetectedApiKey | undefined {
    return this.lastDetectedKeys.get(id);
  }

  /**
   * Scans process.env for standard AI provider keys.
   */
  public detectFromEnvironment(): DetectedApiKey[] {
    const found: DetectedApiKey[] = [];
    for (const mapping of ENV_KEY_MAPPINGS) {
      const raw = process.env[mapping.envVar];
      if (raw && typeof raw === 'string' && raw.trim().length > 4) {
        const trimmed = raw.trim();
        found.push({
          id: `env-${mapping.envVar.toLowerCase()}`,
          providerId: mapping.providerId,
          providerName: mapping.providerName,
          source: 'env',
          sourceDescription: `Environment variable: ${mapping.envVar}`,
          maskedKey: maskKey(trimmed),
          rawKey: trimmed
        });
      }
    }
    return found;
  }

  /**
   * Scans text content (such as a .env file or config snippet) for API keys.
   */
  public detectFromText(content: string, sourceName = '.env'): DetectedApiKey[] {
    const found: DetectedApiKey[] = [];
    const lines = content.split('\n');
    const seen = new Set<string>();

    for (const line of lines) {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith('#')) continue;
      const match = trimmedLine.match(/^([A-Za-z0-9_]+)\s*=\s*(["']?)(.*)\2$/);
      if (match) {
        const [, varName, , value] = match;
        const trimmedVal = value ? value.trim() : '';
        if (trimmedVal.length < 5) continue;

        // Check against known mappings
        const mapping = ENV_KEY_MAPPINGS.find((m) => m.envVar === varName);
        if (mapping) {
          const keySig = `${mapping.providerId}:${trimmedVal}`;
          if (!seen.has(keySig)) {
            seen.add(keySig);
            found.push({
              id: `text-${varName.toLowerCase()}`,
              providerId: mapping.providerId === 'openrouter' ? 'openrouter-free' : mapping.providerId === 'groq' ? 'groq-free' : mapping.providerId,
              providerName: mapping.providerName,
              source: 'env',
              sourceDescription: `${sourceName}: ${varName}`,
              maskedKey: maskKey(trimmedVal),
              rawKey: trimmedVal
            });
          }
        } else if (varName === 'GITHUB_TOKEN' || varName === 'GH_TOKEN') {
          const keySig = `github-copilot:${trimmedVal}`;
          if (!seen.has(keySig)) {
            seen.add(keySig);
            found.push({
              id: `text-${varName.toLowerCase()}`,
              providerId: 'github-copilot',
              providerName: 'GitHub Copilot (GitHub)',
              source: 'git_credential',
              sourceDescription: `${sourceName}: ${varName}`,
              maskedKey: maskKey(trimmedVal),
              rawKey: trimmedVal
            });
          }
        }
      }
    }
    return found;
  }

  /**
   * Scans standard config directories for previously saved keys or tokens.
   */
  public async detectFromConfigFiles(): Promise<DetectedApiKey[]> {
    const found: DetectedApiKey[] = [];
    const home = os.homedir();

    const configTargets = [
      {
        path: path.join(home, '.config', 'opencode', 'config.json'),
        providerId: 'opencode',
        providerName: 'OpenCode'
      },
      {
        path: path.join(home, '.config', 'opencode', 'keys.json'),
        providerId: 'opencode',
        providerName: 'OpenCode'
      },
      {
        path: path.join(home, '.openkilo', 'auth.json'),
        providerId: 'openkilo',
        providerName: 'OpenKilo'
      },
      {
        path: path.join(home, '.claude', 'settings.json'),
        providerId: 'anthropic',
        providerName: 'Anthropic'
      },
      {
        path: path.join(home, '.config', 'huggingface', 'token'),
        providerId: 'huggingface-free',
        providerName: 'Hugging Face',
        isRawToken: true
      },
      {
        path: path.join(home, '.cache', 'huggingface', 'token'),
        providerId: 'huggingface-free',
        providerName: 'Hugging Face',
        isRawToken: true
      }
    ];

    for (const target of configTargets) {
      try {
        const content = await fs.readFile(target.path, 'utf8');
        if (target.isRawToken) {
          const token = content.trim();
          if (token.length > 5) {
            found.push({
              id: `config-${target.providerId}-${path.basename(target.path)}`,
              providerId: target.providerId,
              providerName: target.providerName,
              source: target.path.includes('.cache') ? 'browser_token' : 'config_file',
              sourceDescription: `Config token: ${target.path}`,
              maskedKey: maskKey(token),
              rawKey: token
            });
          }
        } else {
          const parsed = JSON.parse(content);
          if (parsed && typeof parsed === 'object') {
            const possibleKeys = [
              parsed.apiKey,
              parsed.api_key,
              parsed.token,
              parsed.anthropic_api_key,
              parsed.openai_api_key,
              parsed.openrouter_api_key
            ].filter((k) => typeof k === 'string' && k.trim().length > 5);

            for (const key of possibleKeys) {
              found.push({
                id: `config-${target.providerId}-${found.length}`,
                providerId: target.providerId,
                providerName: target.providerName,
                source: 'config_file',
                sourceDescription: `Config file: ${target.path}`,
                maskedKey: maskKey(key),
                rawKey: key
              });
            }
          }
        }
      } catch {
        // Silently ignore missing or unreadable config files
      }
    }

    return found;
  }

  /**
   * Scans Git credential helper for GitHub credentials (usable for GitHub Copilot models).
   */
  public async detectFromGitCredentials(): Promise<DetectedApiKey[]> {
    const found: DetectedApiKey[] = [];

    // First check process.env.GITHUB_TOKEN or GH_TOKEN
    const envGh = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (envGh && envGh.trim().length > 6) {
      found.push({
        id: 'git-env-github-token',
        providerId: 'github-copilot',
        providerName: 'GitHub Copilot (GitHub)',
        source: 'git_credential',
        sourceDescription: 'Git environment token ($GITHUB_TOKEN)',
        maskedKey: maskKey(envGh.trim()),
        rawKey: envGh.trim()
      });
      return found;
    }

    // Next check git credential helper safely with a short timeout
    try {
      const child = execFile('git', ['credential', 'fill'], { timeout: 1500 });
      if (child.stdin) {
        child.stdin.write('protocol=https\nhost=github.com\n\n');
        child.stdin.end();
      }
      const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        let out = '';
        let err = '';
        child.stdout?.on('data', (d) => { out += d; });
        child.stderr?.on('data', (d) => { err += d; });
        child.on('close', (code) => {
          if (code === 0) resolve({ stdout: out, stderr: err });
          else reject(new Error(`git credential exited with code ${code}`));
        });
        child.on('error', reject);
      });

      const passwordMatch = stdout.match(/^password=(.+)$/m);
      if (passwordMatch && passwordMatch[1]) {
        const token = passwordMatch[1].trim();
        if (token.length > 8 && (token.startsWith('ghp_') || token.startsWith('gho_') || token.startsWith('github_pat_') || token.length > 20)) {
          found.push({
            id: 'git-credential-github',
            providerId: 'github-copilot',
            providerName: 'GitHub Copilot (Git Credential)',
            source: 'git_credential',
            sourceDescription: 'Git Credential Helper (github.com)',
            maskedKey: maskKey(token),
            rawKey: token
          });
        }
      }
    } catch {
      // Git credential helper not configured or timed out
    }

    return found;
  }

  /**
   * Pings localhost inference engines (Ollama & LM Studio).
   */
  public async detectLocalRuntimes(): Promise<DetectedApiKey[]> {
    const runtimes: DetectedApiKey[] = [];

    // 1. Ollama (port 11434)
    try {
      const ollamaRes = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        signal: AbortSignal.timeout(1200)
      });
      if (ollamaRes.ok) {
        const data = await ollamaRes.json() as { models?: Array<{ name: string }> };
        const modelsCount = Array.isArray(data.models) ? data.models.length : 0;
        runtimes.push({
          id: 'local-ollama-runtime',
          providerId: 'ollama',
          providerName: 'Ollama (Local Engine)',
          source: 'local_instance',
          sourceDescription: `Active Ollama server on http://localhost:11434 (${modelsCount} local model${modelsCount === 1 ? '' : 's'})`,
          maskedKey: 'No Key Required (Zero-Config)',
          endpoint: 'http://localhost:11434/v1',
          isLocalInstance: true,
          modelCount: modelsCount
        });
      }
    } catch {
      // Ollama not currently running
    }

    // 2. LM Studio (port 1234)
    try {
      const lmRes = await fetch('http://127.0.0.1:1234/v1/models', {
        method: 'GET',
        signal: AbortSignal.timeout(1200)
      });
      if (lmRes.ok) {
        const data = await lmRes.json() as { data?: Array<{ id: string }> };
        const modelsCount = Array.isArray(data.data) ? data.data.length : 0;
        runtimes.push({
          id: 'local-lmstudio-runtime',
          providerId: 'custom',
          providerName: 'LM Studio (Local Engine)',
          source: 'local_instance',
          sourceDescription: `Active LM Studio server on http://localhost:1234 (${modelsCount} loaded model${modelsCount === 1 ? '' : 's'})`,
          maskedKey: 'No Key Required (Local Server)',
          endpoint: 'http://localhost:1234/v1',
          isLocalInstance: true,
          modelCount: modelsCount
        });
      }
    } catch {
      // LM Studio not currently running
    }

    return runtimes;
  }
}

export const keyDetector = KeyDetector.getInstance();
