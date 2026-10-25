/**
 * FCC Model Discovery & Mapping Service (Step 3)
 *
 * Queries the FCC sidecar for available models across all 11 supported harnesses,
 * validates against Zod schemas, and maps them to Ty-Code's VerifiedModelConfig interface.
 * Merges discovered models into the model catalog under the FCC Free Tier.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import { fccSidecarManager, FCCModelListSchema, type FCCModelListResponse } from './fcc-sidecar-manager';
import type { VerifiedModelConfig } from './verified-models';

export interface FCCModelEntry extends VerifiedModelConfig {
  harness: string;
  contextLength?: number;
}

const STATIC_FALLBACK_FCC_MODELS: FCCModelEntry[] = [
  {
    modelId: 'fcc:claude-3-5-sonnet-20241022',
    name: 'Claude 3.5 Sonnet (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'claude-code',
    contextLength: 200000
  },
  {
    modelId: 'fcc:claude-3-5-haiku-20241022',
    name: 'Claude 3.5 Haiku (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'claude-code',
    contextLength: 200000
  },
  {
    modelId: 'fcc:claude-3-opus-20240229',
    name: 'Claude 3 Opus (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'claude-code',
    contextLength: 200000
  },
  {
    modelId: 'fcc:gpt-4o',
    name: 'GPT-4o (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'codex',
    contextLength: 128000
  },
  {
    modelId: 'fcc:gpt-4o-mini',
    name: 'GPT-4o Mini (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'codex',
    contextLength: 128000
  },
  {
    modelId: 'fcc:o1-preview',
    name: 'o1 Preview (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'codex',
    contextLength: 128000
  },
  {
    modelId: 'fcc:o3-mini',
    name: 'o3 Mini (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'codex',
    contextLength: 200000
  },
  {
    modelId: 'fcc:github-copilot',
    name: 'GitHub Copilot Chat (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'vscode',
    contextLength: 128000
  },
  {
    modelId: 'fcc:pi-coder',
    name: 'Pi Coder (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'pi',
    contextLength: 64000
  },
  {
    modelId: 'fcc:opencode-zen',
    name: 'OpenCode Zen (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'opencode',
    contextLength: 64000
  },
  {
    modelId: 'fcc:cline-v1',
    name: 'Cline Autonomous (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'cline',
    contextLength: 128000
  },
  {
    modelId: 'fcc:aider-v1',
    name: 'Aider Diff Engine (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'aider',
    contextLength: 128000
  },
  {
    modelId: 'fcc:hermes-v1',
    name: 'Hermes Agent (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'hermes',
    contextLength: 64000
  },
  {
    modelId: 'fcc:deepseek-coder',
    name: 'DeepSeek Coder V2 (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'deepseek',
    contextLength: 128000
  },
  {
    modelId: 'fcc:grok-build',
    name: 'Grok Build (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'grok-build',
    contextLength: 128000
  },
  {
    modelId: 'fcc:muse-code',
    name: 'Muse Code (via FCC)',
    url: 'http://localhost:8765/v1/chat/completions',
    requiresKey: false,
    providerId: 'fcc',
    harness: 'muse-code',
    contextLength: 64000
  }
];

export class FCCModelMapper {
  private static instance: FCCModelMapper | null = null;
  private cachedModels: FCCModelEntry[] | null = null;
  private lastFetchTime = 0;
  private readonly CACHE_TTL_MS = 60_000;

  public static getInstance(): FCCModelMapper {
    if (!FCCModelMapper.instance) {
      FCCModelMapper.instance = new FCCModelMapper();
    }
    return FCCModelMapper.instance;
  }

  /**
   * Discovers models from the live FCC sidecar or returns cached/fallback models
   */
  public async getDiscoveredModels(): Promise<FCCModelEntry[]> {
    const isFresh = this.cachedModels && Date.now() - this.lastFetchTime < this.CACHE_TTL_MS;
    if (isFresh) {
      return this.cachedModels!;
    }

    const sidecarBaseUrl = fccSidecarManager.getBaseUrl();
    const chatUrl = `${sidecarBaseUrl}/chat/completions`;

    try {
      const response = await fetch(`${sidecarBaseUrl}/models`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(3000)
      });

      if (response.ok) {
        const json = await response.json();
        const parsed: FCCModelListResponse = FCCModelListSchema.parse(json);

        const mapped: FCCModelEntry[] = parsed.data.map((m) => {
          const modelId = m.id.startsWith('fcc:') ? m.id : `fcc:${m.id}`;
          const harness = m.harness || 'claude-code';
          const name = m.name || `${m.id} (via FCC)`;
          return {
            modelId,
            name,
            url: chatUrl,
            requiresKey: false,
            providerId: 'fcc',
            harness,
            contextLength: m.context_length || 128000
          };
        });

        this.cachedModels = mapped;
        this.lastFetchTime = Date.now();
        console.log(`[FCC-MODELS] Discovered ${mapped.length} FCC models from live sidecar.`);
        return mapped;
      }
    } catch {
      // Sidecar query timed out or unavailable; fallback to static catalog
    }

    // Adapt static fallback URLs to the active sidecar port
    const adjustedFallback = STATIC_FALLBACK_FCC_MODELS.map((m) => ({
      ...m,
      url: chatUrl
    }));
    this.cachedModels = adjustedFallback;
    this.lastFetchTime = Date.now();
    return adjustedFallback;
  }

  public async getModel(modelId: string): Promise<FCCModelEntry | undefined> {
    const models = await this.getDiscoveredModels();
    const cleanId = (modelId || '').toLowerCase();
    return models.find((m) => m.modelId.toLowerCase() === cleanId || m.modelId.toLowerCase() === `fcc:${cleanId}`);
  }

  public getHarnessForModel(modelId: string, requestedHarness?: string): string {
    if (requestedHarness && requestedHarness !== 'auto') {
      return requestedHarness;
    }
    const cleanId = (modelId || '').toLowerCase();
    if (cleanId.includes('claude')) return 'claude-code';
    if (cleanId.includes('gpt') || cleanId.includes('o1') || cleanId.includes('o3') || cleanId.includes('codex')) return 'codex';
    if (cleanId.includes('copilot') || cleanId.includes('vscode')) return 'vscode';
    if (cleanId.includes('pi')) return 'pi';
    if (cleanId.includes('opencode')) return 'opencode';
    if (cleanId.includes('cline')) return 'cline';
    if (cleanId.includes('aider')) return 'aider';
    if (cleanId.includes('hermes')) return 'hermes';
    if (cleanId.includes('deepseek')) return 'deepseek';
    if (cleanId.includes('grok')) return 'grok-build';
    if (cleanId.includes('muse')) return 'muse-code';
    return 'claude-code';
  }

  public clearCache(): void {
    this.cachedModels = null;
    this.lastFetchTime = 0;
  }
}

export const fccModelMapper = FCCModelMapper.getInstance();
