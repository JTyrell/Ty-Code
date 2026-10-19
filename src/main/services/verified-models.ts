/**
 * Live model universe for the chat gateway (legacy sendChatRequest path).
 *
 * Sources, in order:
 *  1. FCC catalog (free-claude-code supply layer; probes verified at sync) — the
 *     primary baked-in supply: OpenRouter, OpenKilo, OpenCode, Groq, Google,
 *     Copilot, and every other curated FCC provider.
 *  2. Curated OpenKilo Kilo Gateway free models (verified against live /models).
 *  3. OpenCode Zen hosted free models (standard, baked-in — not optional).
 *  4. Native preconfigured providers.
 *  5. Local Ollama models detected on this machine.
 *
 * Entries are deduped per provider+model. The cache has a 60s TTL so newly
 * synced FCC / Kilo / OpenCode models appear without restarting the app.
 */

import { detectLocalOllamaModels } from './local-model-detector';
import { getAllPreconfiguredProviders } from '../config/provider-registry';
import { fccCatalogSync } from './fcc/catalog-sync';
import { OPENKILO_CURATED_FREE_MODELS } from './orchestration/openkilo-provider';

export interface VerifiedModelConfig {
  modelId: string;
  name: string;
  url: string;
  requiresKey: boolean;
  providerId: string;
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

  // 4. Native preconfigured providers (works even if FCC catalog sync is cold)
  for (const provider of getAllPreconfiguredProviders() || []) {
    if (!provider.baseUrl || !provider.defaultModel) continue;
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

  const [baked, localModels] = await Promise.all([
    Promise.resolve(buildBakedModels()),
    detectLocalOllamaModels().catch(() => [] as VerifiedModelConfig[])
  ]);

  const merged = new Map<string, VerifiedModelConfig>();
  for (const model of [...baked, ...localModels]) {
    if (!model.modelId || !model.url) continue;
    const key = `${(model.providerId || '').toLowerCase()}::${model.modelId}`;
    if (merged.has(key)) continue;
    merged.set(key, model);
  }

  cachedModels = [...merged.values()];
  cacheTimestamp = Date.now();
  return cachedModels;
}

export function clearModelCache(): void {
  cachedModels = null;
  cacheTimestamp = 0;
}
