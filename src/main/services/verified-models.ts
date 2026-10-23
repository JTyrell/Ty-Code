/**
 * Live model universe for the chat gateway (legacy sendChatRequest path).
 *
 * Sources, in order:
 *  1. FCC catalog (free-claude-code supply layer; probes verified at sync) — the
 *     primary baked-in supply: OpenRouter, OpenKilo, OpenCode, Groq, Google,
 *     Copilot, and every other curated FCC provider.
 *  2. Dynamically fetched FCC catalog (fcc-catalog-sync): the live FCC sidecar
 *     /v1/models, the local supply facade remapped to real upstream endpoints,
 *     and connected subscription (Copilot/ChatGPT) pro models.
 *  3. Curated OpenKilo Kilo Gateway free models (verified against live /models).
 *  4. OpenCode Zen hosted free models (standard, baked-in — not optional).
 *  5. Ty-Code Free community tier (ZeroFriction-1): baked, zero-user-input.
 *  6. Native preconfigured providers.
 *  7. Local Ollama models detected on this machine.
 *  8. OpenCode free tier (auto-discovery): free models read from the user's
 *     local `~/.config/opencode/*.json` config, served by the installed
 *     `opencode` CLI through the subprocess bridge (never HTTP).
 *
 * Entries are deduped per provider+model. The cache has a 60s TTL so newly
 * synced FCC / Kilo / OpenCode models appear without restarting the app.
 */

import { detectLocalOllamaModels } from './local-model-detector';
import { getAllPreconfiguredProviders } from '../config/provider-registry';
import { fccCatalogSync } from './fcc/catalog-sync';
import { fetchFCCCatalog } from './fcc-catalog-sync';
import { OPENKILO_CURATED_FREE_MODELS } from './orchestration/openkilo-provider';
import { discoverOpenCodeFreeModels } from './opencode-config-manager';

/** Pseudo-endpoint for OpenCode CLI-bridged models; never dialled via HTTP. */
export const OPENCODE_BRIDGE_URL = 'opencode-cli://bridge/chat/completions';
export const OPENCODE_FREE_PROVIDER_ID = 'opencode-free';

export interface VerifiedModelConfig {
  modelId: string;
  name: string;
  url: string;
  requiresKey: boolean;
  providerId: string;
}

/**
 * Autonomous catalog corrections ("provider & models database" self-healing).
 * Produced by the catalog verifier from LIVE /models listings using the
 * user's connected keys, then applied to the baked expectations here.
 */
export interface ModelCatalogCorrection {
  added: VerifiedModelConfig[];
  removed: string[];
  renamed: Array<{ modelId: string; name: string }>;
}

let catalogCorrections: Record<string, ModelCatalogCorrection> = {};

export function setModelCatalogCorrections(
  next: Record<string, ModelCatalogCorrection> | null | undefined
): void {
  catalogCorrections = next || {};
  clearModelCache();
}

export function getModelCatalogCorrections(): Record<string, ModelCatalogCorrection> {
  return catalogCorrections;
}

/**
 * Export the current baked expectations grouped by provider so the verifier
 * can diff them against a live listing for the same provider.
 */
export function exportBakedExpectations(): Record<string, VerifiedModelConfig[]> {
  const grouped: Record<string, VerifiedModelConfig[]> = {};
  for (const m of buildBakedModels()) {
    const pid = (m.providerId || 'unknown').toLowerCase();
    (grouped[pid] ||= []).push(m);
  }
  return grouped;
}

const OPENCODE_ZEN_FREE_MODELS: VerifiedModelConfig[] = [
  {
    modelId: 'grok-code',
    name: 'Grok Code (OpenCode Zen)',
    url: 'https://api.opencode.ai/v1/chat/completions',
    requiresKey: true,
    providerId: 'opencode'
  }
];

// 3.5 Ty-Code Free Tier (ZeroFriction-1): all free supply aggregated into a
// single zero-friction virtual provider. Requires no user input — requests
// route to OpenRouter's OpenAI-compatible endpoint and authenticate with the
// rotating Community Key bootstrapped via credential-vault (or the user's own
// OpenRouter key when one is stored). requiresKey stays true because the
// upstream genuinely needs a key; the key is simply never supplied by the
// user and never lives in source code.
//
// Every entry below was verified live on 2026-10-21 (~19:05 UTC) via
// single-shot chat/completions probes against OpenRouter using the rotating
// Community Key fetched fresh from the community Worker. Of the 18 slugs in
// OpenRouter's live :free catalog, 14 answered 200; the ones excluded here are
// "only available on agentic harnesses"-failed gateway-side. Newly retired
// since the previous bake (do not re-add without a fresh probe): deepseek/
// deepseek-v4.1-flash:free, z-ai/glm-5.3-flash:free, meituan/longcat-2.0:free
// and nvidia/nemotron-3-super-120b-a12b:free (404 "unavailable for free"),
// xingchen-agi/xing4.0-29b-a4b:free (persistent 429 from upstream provider).
// Also live but deliberately excluded: nvidia/nemotron-3.5-content-safety
// (single-purpose safety classifier) and nvidia/nemotron-3-nano-omni-30b
// (audio/video omni variant, unreliable for text-only agent payloads).
const TY_CODE_FREE_MODELS: VerifiedModelConfig[] = [
  {
    modelId: 'google/gemma-4-31b-it:free',
    name: 'Gemma 4 31B (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'google/gemma-4-26b-a4b-it:free',
    name: 'Gemma 4 26B A4B (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'cohere/north-mini-code:free',
    name: 'North Mini Code (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'poolside/laguna-s-2.1:free',
    name: 'Poolside Laguna S (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'poolside/laguna-xs-2.1:free',
    name: 'Poolside Laguna XS (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'minimax/minimax-m3.1-flash:free',
    name: 'MiniMax M3.1 Flash (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'nvidia/nemotron-3.5-lightning:free',
    name: 'Nemotron 3.5 Lightning (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'nvidia/nemotron-3-ultra-550b-a55b:free',
    name: 'Nemotron 3 Ultra 550B (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'nvidia/nemotron-3.5-super-vl:free',
    name: 'Nemotron 3.5 Super VL (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'dots-studio/dots-3-note-preview:free',
    name: 'Dots 3 Note Preview (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'recursive/flint-v1.0:free',
    name: 'Flint 1.0 (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  },
  {
    modelId: 'liquid/lfm-2.5-2.6b:free',
    name: 'Liquid LFM 2.5 2.6B (Ty-Code Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'ty-code-free'
  }
];

// 3.6 One-Key Premium (ZeroFriction-2): a single OpenRouter key unlocks every
// premium model through the unified OpenRouter API. These entries surface in
// the model dropdown's Premium section only when that key is stored
// (filterRoutableFreeFirst keeps them out of the free-first default pool).
// Qwen and DeepSeek intentionally appear in BOTH tiers: the free variants
// above serve zero-configuration users, these paid flagships serve One-Key users.
const OPENROUTER_PREMIUM_MODELS: VerifiedModelConfig[] = [
  {
    modelId: 'openai/gpt-4o',
    name: 'GPT-4o (Premium)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  },
  {
    modelId: 'anthropic/claude-3.5-sonnet',
    name: 'Claude 3.5 Sonnet (Premium)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  },
  {
    modelId: 'qwen/qwen-max',
    name: 'Qwen Max (Premium)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  },
  {
    modelId: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3 (Premium)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  }
];

function joinUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, '');
  if (cleanBase.endsWith('/chat/completions')) return cleanBase;
  return `${cleanBase}/${path}`;
}

function buildBakedModels(): VerifiedModelConfig[] {
  const baked: VerifiedModelConfig[] = [];

  // 1. FCC catalog — every enabled provider's models (incl. OpenKilo + OpenCode supply)
  try {
    for (const provider of fccCatalogSync.getCatalog() || []) {
      if (!provider.enabled || !provider.defaultEndpoint) continue;
      const chatUrl = joinUrl(provider.defaultEndpoint, 'chat/completions');
      const needsKey = provider.authMethod !== 'none';
      for (const model of provider.models || []) {
        baked.push({
          modelId: model.id,
          name: model.name,
          url: chatUrl,
          requiresKey: needsKey,
          providerId: provider.id
        });
      }
    }
  } catch {
    // FCC service unavailable — the other baked sources still supply models
  }

  // 2. Curated OpenKilo Kilo Gateway free models (verified against live /models)
  const kiloUrl = joinUrl('https://api.kilo.ai/api/gateway', 'chat/completions');
  for (const model of OPENKILO_CURATED_FREE_MODELS) {
    baked.push({
      modelId: model.id,
      name: model.name,
      url: kiloUrl,
      requiresKey: false,
      providerId: 'openkilo'
    });
  }

  // 3. OpenCode Zen hosted free models (standard baked-in supply)
  baked.push(...OPENCODE_ZEN_FREE_MODELS);

  // 3.5 Ty-Code Free Tier: zero-friction community-served free models
  baked.push(...TY_CODE_FREE_MODELS);

  // 3.6 One-Key Premium: unlockable with a single OpenRouter key
  baked.push(...OPENROUTER_PREMIUM_MODELS);

  // 4. Native preconfigured providers (works even if FCC catalog sync is cold)
  for (const provider of getAllPreconfiguredProviders() || []) {
    if (!provider.baseUrl || !provider.defaultModel) continue;
    // Local Ollama is dynamic-only: detectLocalOllamaModels() adds verified
    // local models at runtime. Baking the registry's suggestion model
    // (qwen2.5-coder:latest) here would surface a dead localhost entry on
    // machines without Ollama.
    if ((provider.id || '').toLowerCase() === 'ollama') continue;
    baked.push({
      modelId: provider.defaultModel,
      name: provider.name,
      url: joinUrl(provider.baseUrl, 'chat/completions'),
      requiresKey: provider.setupType === 'api_key',
      providerId: provider.id
    });
  }

  return baked;
}

let cachedModels: VerifiedModelConfig[] | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export async function getVerifiedModels(): Promise<VerifiedModelConfig[]> {
  const fresh = cachedModels && Date.now() - cacheTimestamp < CACHE_TTL_MS;
  if (fresh) {
    return cachedModels!;
  }

  const [baked, localModels, fccModels] = await Promise.all([
    Promise.resolve(buildBakedModels()),
    detectLocalOllamaModels().catch(() => [] as VerifiedModelConfig[]),
    fetchFCCCatalog().catch(() => [] as VerifiedModelConfig[])
  ]);

  const merged = new Map<string, VerifiedModelConfig>();
  for (const model of [...baked, ...fccModels, ...localModels]) {
    if (!model.modelId || !model.url) continue;
    const key = `${(model.providerId || '').toLowerCase()}::${model.modelId}`;
    if (merged.has(key)) continue;
    merged.set(key, model);
  }

  // OpenCode free tier (auto-discovery): free models present in the user's
  // local opencode config, served by the real installed CLI through the
  // subprocess bridge. Only ids that exist BOTH in the config AND when the
  // CLI is actually runnable are surfaced — nothing is invented. Ids already
  // covered by another provider (FCC community pool, Ollama, …) stay with
  // their first source, so a synced id never double-lists in the UI. The
  // availability check is the expensive part (one cached subprocess probe),
  // so discovery is only touched when the CLI may still be missing.
  const opencodeFreeIds = await discoverOpenCodeFreeModels().catch(() => [] as string[]);
  if (opencodeFreeIds.length > 0) {
    const { opencodeBridge } = await import('./opencode-bridge');
    const cliAvailable = await opencodeBridge.isCliAvailable();
    if (cliAvailable) {
      const presentModelIds = new Set([...merged.values()].map((m) => m.modelId));
      for (const modelId of opencodeFreeIds) {
        if (!modelId || presentModelIds.has(modelId)) continue;
        presentModelIds.add(modelId);
        merged.set(`${OPENCODE_FREE_PROVIDER_ID}::${modelId}`, {
          modelId,
          name: modelId,
          url: OPENCODE_BRIDGE_URL,
          requiresKey: false,
          providerId: OPENCODE_FREE_PROVIDER_ID
        });
      }
    }
  }

  // Apply live catalog corrections: strip models no longer offered, update
  // names/titles to live values, and append newly offered models.
  let entries = [...merged.values()];
  for (const [pid, corr] of Object.entries(catalogCorrections)) {
    const removed = new Set(corr.removed || []);
    if (removed.size > 0) {
      entries = entries.filter((m) => !((m.providerId || '').toLowerCase() === pid && removed.has(m.modelId)));
    }
    for (const ren of corr.renamed || []) {
      const target = entries.find((m) => (m.providerId || '').toLowerCase() === pid && m.modelId === ren.modelId);
      if (target && ren.name) target.name = ren.name;
    }
    for (const add of corr.added || []) {
      if (!add?.modelId || !add?.url) continue;
      const key = `${pid}::${add.modelId}`;
      if (merged.has(key)) continue;
      merged.set(key, {
        modelId: add.modelId,
        name: add.name || add.modelId,
        url: add.url,
        requiresKey: Boolean(add.requiresKey),
        providerId: pid
      });
      entries.push(merged.get(key)!);
    }
  }

  cachedModels = entries;
  cacheTimestamp = Date.now();
  return cachedModels;
}

export function clearModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
}
