/**
 * FCC Catalog Sync for the Unified ProviderGateway (Prompt 1)
 *
 * Dynamically fetches the free-claude-code (FCC) supply-layer model catalog as
 * VerifiedModelConfig entries so the unified gateway feed is built from live
 * sources instead of a hardcoded list:
 *  1. FCC sidecar  — GET {sidecar}/v1/models (genuine free-claude-code binary
 *     promotes it to the primary FCC chat route in ProviderGateway).
 *  2. Local supply endpoint — GET {supply}/v1/models, an OpenAI-compatible
 *     facade over Ty-Code's FCC fleet. Every model is resolved to its REAL
 *     upstream chat endpoint through the orchestration provider registry;
 *     the facade itself is never used as a completion route.
 *  3. Subscription bridge — connected GitHub Copilot / ChatGPT subscriptions
 *     expose pro-class models "via your subscription" (their tokens are
 *     injected from credential-vault at request time by the gateway).
 *
 * Entries are deduped by providerId::modelId and cached for 30s. No model
 * catalog is hardcoded in this module: if no live source answers, the result
 * is empty and callers fall back to their static sources.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import type { VerifiedModelConfig } from './verified-models';
import { fccManager } from './orchestration/fcc-manager';
import { providerRegistry } from './orchestration/provider-registry';
import { localSupplyEndpoint } from './fcc/local-supply-endpoint';
import { subscriptionOAuthService } from './fcc/subscription-oauth';

const CACHE_TTL_MS = 30_000;
const FETCH_TIMEOUT_MS = 6_000;
const SUPPLY_OWNER_COPILOT = 'copilot-subscription';
const SUPPLY_OWNER_PREFIX = 'ty-code-';

function joinUrl(base: string, path: string): string {
  const cleanBase = base.replace(/\/+$/, '');
  if (cleanBase.endsWith('/chat/completions')) return cleanBase;
  return `${cleanBase}/${path}`;
}

function sidecarBase(): string {
  const envPort = Number.parseInt(process.env.FCC_SIDECAR_PORT || '', 10);
  const port = Number.isFinite(envPort) && envPort > 0 ? envPort : 8082;
  return `http://127.0.0.1:${port}`;
}

/** Source 1: the FCC sidecar's own model list. */
async function fetchSidecarModels(): Promise<VerifiedModelConfig[]> {
  const base = sidecarBase();
  const res = await fetch(`${base}/v1/models`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
  const list = Array.isArray(data.data) ? data.data : [];
  const url = `${base}/v1/chat/completions`;
  const entries: VerifiedModelConfig[] = [];
  for (const model of list) {
    const id = typeof model?.id === 'string' ? model.id : '';
    if (!id) continue;
    entries.push({
      modelId: id,
      name: id,
      url,
      requiresKey: false,
      providerId: 'fcc'
    });
  }
  return entries;
}

/** Source 2: the local supply endpoint facade, remapped to real upstream endpoints. */
async function fetchSupplyEndpointModels(): Promise<VerifiedModelConfig[]> {
  const status = localSupplyEndpoint.getStatus();
  if (!status.running) return [];
  const res = await fetch(`${status.baseUrl}/models`, {
    headers: { Authorization: `Bearer ${localSupplyEndpoint.getAuthToken()}` },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!res.ok) return [];
  const data = (await res.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
  const list = Array.isArray(data.data) ? data.data : [];
  const entries: VerifiedModelConfig[] = [];

  for (const model of list) {
    const id = typeof model?.id === 'string' ? model.id : '';
    const ownedBy = typeof model?.owned_by === 'string' ? model.owned_by : '';
    if (!id) continue;

    if (ownedBy === SUPPLY_OWNER_COPILOT) {
      const copilot = providerRegistry.getProvider('github-copilot');
      if (!copilot?.defaultEndpoint) continue;
      entries.push({
        modelId: id,
        name: id,
        url: joinUrl(copilot.defaultEndpoint, 'chat/completions'),
        requiresKey: true,
        providerId: 'copilot'
      });
      continue;
    }

    if (!ownedBy.startsWith(SUPPLY_OWNER_PREFIX)) continue;
    const ownerId = ownedBy.slice(SUPPLY_OWNER_PREFIX.length);
    if (!ownerId || ownerId === 'fcc') continue;
    const registered = providerRegistry.getProvider(ownerId);
    if (!registered?.defaultEndpoint) continue;
    entries.push({
      modelId: id,
      name: id,
      url: joinUrl(registered.defaultEndpoint, 'chat/completions'),
      requiresKey: registered.authMethod !== 'none',
      providerId: registered.id
    });
  }
  return entries;
}

/** Source 3: subscription bridge (connected Copilot / ChatGPT pro models). */
async function fetchSubscriptionModels(): Promise<VerifiedModelConfig[]> {
  const subs = await subscriptionOAuthService.getSubscriptions().catch(() => []);
  const entries: VerifiedModelConfig[] = [];
  for (const sub of subs) {
    if (!sub?.connected) continue;
    // Only surfaces subscriptions that map to a registered real endpoint;
    // a subscription without a routable upstream is never fabricated.
    const regProviderId = sub.id === 'copilot' ? 'github-copilot' : sub.id === 'chatgpt' ? 'chatgpt-subscription' : sub.id;
    const registered = providerRegistry.getProvider(regProviderId);
    if (!registered?.defaultEndpoint) continue;
    for (const model of sub.models || []) {
      if (!model?.id) continue;
      entries.push({
        modelId: model.id.includes('/') ? model.id.slice(model.id.indexOf('/') + 1) : model.id,
        name: model.name || model.id,
        url: joinUrl(registered.defaultEndpoint, 'chat/completions'),
        requiresKey: true,
        providerId: sub.id === 'copilot' ? 'copilot' : regProviderId
      });
    }
  }
  return entries;
}

let cachedCatalog: VerifiedModelConfig[] | null = null;
let cacheTimestamp = 0;
let refreshInFlight: Promise<VerifiedModelConfig[]> | null = null;

/**
 * Fetches the FCC supply-layer catalog from live sources, deduped and cached.
 * Returns an empty array when no FCC source is live; callers keep their own
 * static fallbacks in that case.
 */
export async function fetchFCCCatalog(force: boolean = false): Promise<VerifiedModelConfig[]> {
  if (!force && cachedCatalog && Date.now() - cacheTimestamp < CACHE_TTL_MS) {
    return cachedCatalog;
  }
  if (refreshInFlight) {
    return refreshInFlight;
  }

  refreshInFlight = (async () => {
    const [sidecarModels, supplyModels, subscriptionModels] = await Promise.all([
      fetchSidecarModels().catch(() => [] as VerifiedModelConfig[]),
      fetchSupplyEndpointModels().catch(() => [] as VerifiedModelConfig[]),
      fetchSubscriptionModels().catch(() => [] as VerifiedModelConfig[])
    ]);

    const merged = new Map<string, VerifiedModelConfig>();
    for (const entry of [...sidecarModels, ...supplyModels, ...subscriptionModels]) {
      if (!entry.modelId || !entry.url) continue;
      const key = `${(entry.providerId || '').toLowerCase()}::${entry.modelId}`;
      if (merged.has(key)) continue;
      merged.set(key, entry);
    }

    cachedCatalog = [...merged.values()];
    cacheTimestamp = Date.now();
    console.log(`[FCC][CATALOG-SYNC] fetched FCC catalog from live sources: sidecar=${sidecarModels.length}, supply=${supplyModels.length}, subscriptions=${subscriptionModels.length}, total=${cachedCatalog.length}`);
    return cachedCatalog;
  })().finally(() => {
    refreshInFlight = null;
  });

  return refreshInFlight;
}

/** Whether the FCC sidecar reports as running (fetched catalog stays fresh regardless). */
export function isFccSidecarRunning(): boolean {
  try {
    return Boolean(fccManager.getStatus().running);
  } catch {
    return false;
  }
}

/** True only when a genuine free-claude-code binary backs the sidecar chat route. */
export function canFccServeCompletions(): boolean {
  try {
    return fccManager.isGenuineBinaryRunning();
  } catch {
    return false;
  }
}

export function clearFccCatalogCache(): void {
  cachedCatalog = null;
  cacheTimestamp = 0;
}
