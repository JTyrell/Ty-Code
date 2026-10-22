/**
 * Active Agent Configuration (main-process source of truth)
 *
 * Holds the provider/model pair the Agent Engine routes to on every
 * sendChatRequest. The renderer notifies this store through the
 * `providers:update-active-config` IPC channel; main persists the selection
 * via the settings layer and keeps the ProviderGateway override in step.
 *
 * SECURITY INVARIANT: API keys in the clear NEVER leave this module boundary
 * or cross IPC. Reports carry masked summaries only (e.g. "sk-ant-••••1234").
 *
 * CRASH-SAFETY INVARIANT: a selection whose provider has no key falls back to
 * the Ty-Code Free community tier; if even that tier is unreachable, the
 * previous working configuration is kept and the caller receives
 * keyStatus: 'missing' so the renderer can show a UI error instead of a lost
 * chat session.
 */
import { getProviderSettings } from '../ipc/settings-handlers';
import { getCommunityKey, warmUpCommunityKey } from '../services/credential-vault';

export type ActiveConfigKeyStatus = 'own' | 'community' | 'anonymous' | 'missing';

export interface ActiveAgentConfig {
  providerId: string;
  modelId: string;
  updatedAt: number;
}

export interface ActiveProviderConfigSummary {
  providerId: string;
  modelId: string;
  /** How the resolved provider authenticates. */
  keyStatus: ActiveConfigKeyStatus;
  /** Masked preview only (e.g. "sk-ant-••••1234"); never a usable key. */
  maskedKey?: string;
  /** True when the request was downgraded to the Ty-Code Free tier. */
  degraded?: boolean;
  /** Machine-readable context for the renderer toast. */
  reason?: 'MISSING_KEY' | 'UNRESOLVED_COMMUNITY' | undefined;
}

const TY_CODE_FREE_PROVIDER = 'ty-code-free';
export const TY_CODE_FREE_MODEL = 'google/gemma-4-31b-it:free';

/** Providers that route without any stored user credential. */
const ANONYMOUS_PROVIDERS = new Set([
  TY_CODE_FREE_PROVIDER,
  'openkilo',
  'openkilo-free',
  'kilo',
  'ollama',
  'fcc-proxy'
]);

let currentAgentConfig: ActiveAgentConfig = {
  providerId: TY_CODE_FREE_PROVIDER,
  modelId: TY_CODE_FREE_MODEL,
  updatedAt: 0
};

function maskKey(key: string | undefined): string | undefined {
  const trimmed = (key || '').trim();
  if (trimmed.length < 8) return undefined;
  const probe = trimmed.slice(0, 10);
  const cut = probe.lastIndexOf('-');
  const scheme = cut >= 3 ? probe.slice(0, cut + 1) : trimmed.slice(0, 4);
  return `${scheme}••••${trimmed.slice(-4)}`;
}

function normalizeModel(providerId: string, modelId: string): string {
  const trimmed = (modelId || '').trim();
  if (trimmed) return trimmed;
  if (providerId === TY_CODE_FREE_PROVIDER) return TY_CODE_FREE_MODEL;
  if (providerId.includes('kilo')) return 'kilo-auto/free';
  return '';
}

async function resolveOwnKey(providerId: string): Promise<string | undefined> {
  try {
    const response = await getProviderSettings();
    const key = response.data?.apiKeys?.[providerId];
    if (key && key.trim()) return key.trim();
    // Free-flavored registry ids share credentials with their paid aliases.
    const alias = providerId.replace(/-free$/, '');
    const aliasKey = response.data?.apiKeys?.[alias];
    if (aliasKey && aliasKey.trim()) return aliasKey.trim();
  } catch {
    return undefined;
  }
  return undefined;
}

/** Read-only access for the Agent Engine and ProviderGateway routing. */
export function getActiveAgentConfig(): ActiveAgentConfig {
  return currentAgentConfig;
}

/**
 * Fast, IO-free seed used before agent tasks start and at boot. Mirrors the
 * persisted select pair into memory without fallback logic so a temporarily
 * unreachable community tier can not silently rewrite a working selection.
 */
export function seedActiveConfig(providerId: string | undefined, modelId: string | undefined): ActiveAgentConfig {
  const id = (providerId || '').trim();
  if (!id) return currentAgentConfig;
  currentAgentConfig = {
    providerId: id,
    modelId: normalizeModel(id, modelId || ''),
    updatedAt: Date.now()
  };
  return currentAgentConfig;
}

/**
 * Validated switch driven by renderer selection changes. Never throws:
 * resolution failures are reported through the summary so the renderer can
 * present a UI error and keep its previous selection.
 */
export async function setActiveAgentConfig(providerId: string, modelId: string): Promise<ActiveProviderConfigSummary> {
  const requestedProvider = (providerId || '').trim();
  const requestedModel = (modelId || '').trim();

  const requested: ActiveProviderConfigSummary = {
    providerId: requestedProvider,
    modelId: requestedModel,
    keyStatus: 'anonymous'
  };

  // 1. Missing/blank provider -> reset to the zero-input Ty-Code Free tier.
  if (!requestedProvider) {
    const communityKey = await getCommunityKey().catch(() => null);
    currentAgentConfig = {
      providerId: TY_CODE_FREE_PROVIDER,
      modelId: TY_CODE_FREE_MODEL,
      updatedAt: Date.now()
    };
    if (communityKey) {
      try {
        warmUpCommunityKey();
      } catch {
        // Warm-up failure is fine: the stream path re-resolves lazily.
      }
    }
    return {
      providerId: TY_CODE_FREE_PROVIDER,
      modelId: TY_CODE_FREE_MODEL,
      keyStatus: 'community',
      maskedKey: maskKey(communityKey || undefined),
      ...(communityKey ? {} : { degraded: true, reason: 'UNRESOLVED_COMMUNITY' as const })
    };
  }

  // 2. Anonymous tier: accepted as-is; the gateway owns key-less routing and
  //    its own community bootstrap for ty-code-free.
  if (ANONYMOUS_PROVIDERS.has(requestedProvider)) {
    currentAgentConfig = {
      providerId: requestedProvider,
      modelId: normalizeModel(requestedProvider, requestedModel),
      updatedAt: Date.now()
    };
    return {
      providerId: currentAgentConfig.providerId,
      modelId: currentAgentConfig.modelId,
      keyStatus: 'anonymous'
    };
  }

  // 3. Keyed provider: resolve the credential from the merged settings layer.
  const ownKey = await resolveOwnKey(requestedProvider);
  if (ownKey) {
    currentAgentConfig = {
      providerId: requestedProvider,
      modelId: normalizeModel(requestedProvider, requestedModel),
      updatedAt: Date.now()
    };
    return {
      providerId: requestedProvider,
      modelId: currentAgentConfig.modelId,
      keyStatus: 'own',
      maskedKey: maskKey(ownKey)
    };
  }

  // 4. No key for the selection: gracefully degrade to Ty-Code Free instead
  //    of letting the next chat request crash into CONFIG_MISSING.
  try {
    warmUpCommunityKey();
  } catch {
    // Warm-up failure is fine: the stream path re-resolves lazily.
  }
  const communityKey = await getCommunityKey().catch(() => null);
  if (communityKey) {
    currentAgentConfig = {
      providerId: TY_CODE_FREE_PROVIDER,
      modelId: TY_CODE_FREE_MODEL,
      updatedAt: Date.now()
    };
    return {
      providerId: TY_CODE_FREE_PROVIDER,
      modelId: TY_CODE_FREE_MODEL,
      keyStatus: 'community',
      maskedKey: maskKey(communityKey),
      degraded: true,
      reason: 'MISSING_KEY'
    };
  }

  // 5. Last resort: keep the previous working configuration untouched and
  //    surface the missing key to the renderer as a UI error.
  return {
    providerId: requestedProvider,
    modelId: requestedModel,
    keyStatus: 'missing'
  };
}
