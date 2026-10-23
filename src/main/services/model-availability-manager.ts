/**
 * Model availability manager (Provider Series Prompt 1).
 *
 * Decides, per model in the live verified catalog, whether the user can
 * actually use it RIGHT NOW:
 *  - requiresKey === false        -> free tier (OpenKilo/OpenCode/FCC 'none'/...)
 *  - providerId 'ty-code-free'    -> rotating Community Key must exist in vault
 *  - providerId 'fcc'/'fcc-proxy' -> FCC sidecar must be running + healthy
 *  - requiresKey === true         -> the provider's own key must be resolvable
 *                                    (credentialStore / vault / env)
 *  - localhost backends           -> the local service must actually answer
 *                                    (Ollama 11434, vLLM, LocalAI, ...)
 *
 * The picker must never show a model as selectable when its key or service is
 * missing, so every entry comes back tagged with availabilityStatus. Key
 * checks never expose key values - only presence.
 */

import { getVerifiedModels, type VerifiedModelConfig } from './verified-models';
import { providerHasOwnKey } from '../providers/provider-gateway';
import { getKey, getAllVaultKeys, hasCommunityKey, getCommunityKey, warmUpCommunityKey, getCommunityKeyCooldownRemainingSec } from './credential-vault';
import { fccManager } from './orchestration/fcc-manager';
import { getAllPreconfiguredProviders } from '../config/provider-registry';
import { opencodeBridge } from './opencode-bridge';
import { credentialStore } from './auth/credential-store';

export type ModelAvailabilityStatus = 'available' | 'key_required' | 'service_unavailable';

export interface AvailableModelConfig extends VerifiedModelConfig {
  availabilityStatus: ModelAvailabilityStatus;
  providerName: string;
  /** True when the model can be selected and used immediately. */
  isSelectable: boolean;
}

export interface ModelAvailabilitySummary {
  total: number;
  available: number;
  locked: number;
  /** Seconds left on the Community-Key rate-limit back-off (429 retry-after). */
  communityKeyCooldownSec: number;
}

const TIER_PROVIDER_DISPLAY: Record<string, string> = {
  'openrouter': 'OpenRouter',
  'openrouter-free': 'OpenRouter (Free Gateway)',
  'openkilo': 'OpenKilo',
  'openkilo-free': 'OpenKilo (Free Gateway)',
  'opencode': 'OpenCode Zen',
  'opencode-free': 'OpenCode CLI',
  'ty-code-free': 'Ty-Code Free (Community Key)',
  'anthropic-claude-free': 'Claude (FCC Proxy)',
  'groq-free': 'Groq',
  'fcc': 'FCC Managed Supply',
  'fcc-proxy': 'FCC Managed Supply'
};

function prettifyProviderId(providerId: string): string {
  const known = TIER_PROVIDER_DISPLAY[providerId];
  if (known) return known;
  return providerId
    .replace(/-free$/, '')
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function buildProviderNameMap(): Map<string, string> {
  const map = new Map<string, string>();
  try {
    for (const provider of getAllPreconfiguredProviders() || []) {
      if (provider.id && provider.name) {
        map.set(String(provider.id).toLowerCase(), String(provider.name));
      }
    }
  } catch {
    // Registry unavailable - curated + prettified fallbacks cover most needs
  }
  return map;
}

const LOCAL_HOST_PATTERN = /https?:\/\/(127\.0\.0\.1|localhost|\[?::1\]?)/i;

/**
 * Short-lived probe cache for local backend reachability (one probe per
 * origin per minute - localhost services are not re-dialed on every open).
 */
const localReachability = new Map<string, { ok: boolean; at: number }>();
const LOCAL_PROBE_TTL_MS = 60_000;

async function probeLocalBackend(url: string): Promise<boolean> {
  const origin = url.replace(/\/v?1?\/?chat\/completions.*$/i, '').replace(/\/chat\/completions.*$/i, '');
  const entry = localReachability.get(origin);
  if (entry && Date.now() - entry.at < LOCAL_PROBE_TTL_MS) return entry.ok;
  let ok = false;
  try {
    const isOllama = origin.includes('11434') || /ollama/i.test(origin);
    const probePath = isOllama ? `${origin}/api/tags` : `${origin}/models`;
    const response = await fetch(probePath, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(1000)
    });
    ok = response.ok;
  } catch {
    ok = false;
  }
  localReachability.set(origin, { ok, at: Date.now() });
  return ok;
}

export async function hasSavedKeyForProvider(providerId: string): Promise<boolean> {
  const p = (providerId || '').toLowerCase().trim();
  if (providerHasOwnKey(p)) return true;
  try {
    const key = await getKey(p);
    if (key && key.trim()) return true;
  } catch {}
  try {
    const all = getAllVaultKeys();
    if (all[p] && all[p].trim()) return true;
  } catch {}
  try {
    const stored = credentialStore.getDecryptedKey(p);
    if (stored && stored.trim()) return true;
  } catch {}
  return false;
}

let availabilityCache: { models: AvailableModelConfig[]; at: number } | null = null;
const AVAILABILITY_TTL_MS = 15_000;

async function classify(model: VerifiedModelConfig, providerIdLower: string): Promise<ModelAvailabilityStatus> {
  // 1. Localhost backends (Ollama, local models) must actually answer
  const isLocal = providerIdLower === 'ollama' || providerIdLower === 'ollama-free' || LOCAL_HOST_PATTERN.test(model.url);
  if (isLocal) {
    const running = await probeLocalBackend(model.url);
    return running ? 'available' : 'service_unavailable';
  }

  // 2. Ty-Code Free (Community Key tier)
  if (providerIdLower === 'ty-code-free' || providerIdLower === 'tycode-free') {
    if (hasCommunityKey()) return 'available';
    try {
      const commKey = await getCommunityKey();
      if (commKey && commKey.trim()) return 'available';
    } catch {}
    const hasOwnOpenRouter = await hasSavedKeyForProvider('openrouter');
    return hasOwnOpenRouter ? 'available' : 'key_required';
  }

  // 3. FCC sidecar managed models
  if (providerIdLower === 'fcc' || providerIdLower === 'fcc-proxy') {
    const status = fccManager.getStatus();
    return (status.running && status.health !== 'stopped') ? 'available' : 'service_unavailable';
  }

  // 4. OpenCode CLI bridged models
  if (providerIdLower === 'opencode-free') {
    try {
      return (await opencodeBridge.isCliAvailable()) ? 'available' : 'key_required';
    } catch {
      return 'key_required';
    }
  }

  // 5. Explicit free models (requiresKey === false)
  if (!model.requiresKey) {
    return 'available';
  }

  // 6. Keyed models (requiresKey === true)
  const hasKey = await hasSavedKeyForProvider(providerIdLower);
  return hasKey ? 'available' : 'key_required';
}

export async function getAvailableModels(onlyAvailable: boolean = false): Promise<AvailableModelConfig[]> {
  const models = await getModelsAvailability();
  if (onlyAvailable) {
    return models.filter((m) => m.availabilityStatus === 'available' && m.isSelectable);
  }
  return models;
}

export async function getModelsAvailability(): Promise<AvailableModelConfig[]> {
  if (availabilityCache && Date.now() - availabilityCache.at < AVAILABILITY_TTL_MS) {
    return availabilityCache.models;
  }

  const all = await getVerifiedModels();
  const names = buildProviderNameMap();
  const models: AvailableModelConfig[] = [];

  // Kick a non-blocking warm-up when the Community Key card is missing so the
  // tier can appear on the NEXT refresh without blocking the picker.
  if (!hasCommunityKey()) {
    try {
      warmUpCommunityKey();
    } catch {
      // Warm-up failure is fine: classification re-runs on refresh.
    }
  }

  for (const model of all) {
    const providerIdLower = (model.providerId || 'unknown').toLowerCase().trim();
    try {
      const status = await classify(model, providerIdLower);
      models.push({
        ...model,
        availabilityStatus: status,
        isSelectable: status === 'available',
        providerName:
          names.get(providerIdLower) || TIER_PROVIDER_DISPLAY[providerIdLower] || prettifyProviderId(providerIdLower)
      });
    } catch {
      // Classification failure must never drop the model silently into an
      // "available" bucket - tag it as locked instead.
      models.push({
        ...model,
        availabilityStatus: 'service_unavailable',
        isSelectable: false,
        providerName:
          names.get(providerIdLower) || TIER_PROVIDER_DISPLAY[providerIdLower] || prettifyProviderId(providerIdLower)
      });
    }
  }

  availabilityCache = { models, at: Date.now() };
  return models;
}

export async function getModelAvailabilitySummary(): Promise<ModelAvailabilitySummary> {
  const models = await getModelsAvailability();
  const available = models.filter((m) => m.availabilityStatus === 'available').length;
  return {
    total: models.length,
    available,
    locked: models.length - available,
    communityKeyCooldownSec: getCommunityKeyCooldownRemainingSec()
  };
}

export function clearAvailabilityCache(): void {
  availabilityCache = null;
  localReachability.clear();
}
