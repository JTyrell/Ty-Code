/**
 * OpenCode Config Manager — free-model auto-discovery (Prompt 1).
 *
 * Reads the LOCAL OpenCode configuration file(s) written by the user's own
 * `opencode` CLI (`~/.config/opencode/opencode.json` and friends) and extracts
 * every FREE model the user has synced there. Nothing is ever invented here:
 * only model ids that literally exist in the config are surfaced.
 *
 * Free detection (defensive, tolerant of both config shapes):
 *  - model id ends with `:free`
 *  - model descriptor carries `free: true` / `isFree: true`
 *  - `cost` is exactly 0 (numeric, stringified "0"/"0.00", or an object whose
 *    numeric fields — input/output/cacheRead/… — are all 0)
 *  - the whole provider block is marked free (`provider.isFree === true`)
 *
 * Discovered supply is served by the local `opencode` CLI through the
 * subprocess bridge (opencode-bridge.ts) — never through HTTP.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { saveKey, getAllVaultKeys } from './credential-vault';

export interface OpenCodeFreeDiscoveryResult {
  models: string[];
  configPath: string | null;
  checkedAt: number;
}

let discoveryCache: OpenCodeFreeDiscoveryResult | null = null;
const DISCOVERY_TTL_MS = 60_000;

/** Preferred + fallback config locations (same precedence as the sync integration). */
export function getOpenCodeConfigCandidates(): string[] {
  const home = os.homedir();
  const dir = path.join(home, '.config', 'opencode');
  return [
    path.join(dir, 'opencode.json'),
    path.join(dir, 'config.json'),
    path.join(dir, 'providers.json')
  ];
}

/** True when the id itself signals a zero-cost free tier on the upstream router. */
function isFreeModelId(modelId: string): boolean {
  return (modelId || '').toLowerCase().endsWith(':free');
}

/** A model descriptor may declare cost numerically, as text, or per-token-type. */
function isZeroCostDescriptor(descriptor: Record<string, unknown>): boolean {
  const freeFlag = descriptor.free ?? descriptor.isFree;
  if (freeFlag === true) return true;

  if (!('cost' in descriptor)) return false;
  const cost = descriptor.cost;
  if (cost === 0) return true;
  if (typeof cost === 'string') {
    const numeric = Number(cost.trim());
    return Number.isFinite(numeric) && numeric === 0;
  }
  if (typeof cost === 'number') return cost === 0;
  if (cost && typeof cost === 'object') {
    for (const value of Object.values(cost as Record<string, unknown>)) {
      if (typeof value === 'number' && value !== 0) return false;
      if (typeof value === 'string') {
        const numeric = Number(value.trim());
        if (Number.isFinite(numeric) && numeric !== 0) return false;
      }
    }
    return true;
  }
  return false;
}

/** Reads and parses the first existing OpenCode config candidate. */
async function readOpenCodeConfig(): Promise<{ config: Record<string, unknown> | null; configPath: string | null }> {
  for (const candidatePath of getOpenCodeConfigCandidates()) {
    try {
      const raw = await fs.readFile(candidatePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { config: parsed as Record<string, unknown>, configPath: candidatePath };
      }
    } catch {
      // Missing or malformed candidate — try the next one.
    }
  }
  return { config: null, configPath: null };
}

/**
 * Collects free model ids from a block of OpenCode provider entries. The
 * `provider` block of a real opencode config, plus the `providers` /
 * `customProviders` shapes kept for the older sync formats, all funnel here.
 */
function collectFreeModelsFromProviders(
  providerBlock: unknown,
  out: Set<string>
): void {
  if (!providerBlock || typeof providerBlock !== 'object') return;

  for (const entry of Object.values(providerBlock as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const providerEntry = entry as Record<string, unknown>;

    const providerFree = providerEntry.free === true || providerEntry.isFree === true;
    const modelsField = providerEntry.models;
    if (!modelsField) continue;

    // Shape A: string list of model ids.
    if (Array.isArray(modelsField)) {
      for (const modelValue of modelsField) {
        if (typeof modelValue !== 'string') continue;
        const modelId = modelValue.trim();
        if (!modelId) continue;
        if (providerFree || isFreeModelId(modelId)) out.add(modelId);
      }
      continue;
    }

    // Shape B: object map of id -> descriptor (real opencode config shape).
    if (typeof modelsField === 'object') {
      for (const [modelId, descriptor] of Object.entries(modelsField as Record<string, unknown>)) {
        const trimmedId = modelId.trim();
        if (!trimmedId) continue;
        const descriptorBlock =
          descriptor && typeof descriptor === 'object' && !Array.isArray(descriptor)
            ? (descriptor as Record<string, unknown>)
            : null;
        if (
          providerFree ||
          isFreeModelId(trimmedId) ||
          (descriptorBlock && isZeroCostDescriptor(descriptorBlock))
        ) {
          out.add(trimmedId);
        }
      }
    }
  }
}

/**
 * Discovers every FREE model present in the user's local OpenCode config.
 * Returns model ids exactly as written in the config (never fabricated),
 * sorted for stable presentation. Cached for 60s; failures degrade to [].
 */
export async function discoverOpenCodeFreeModels(): Promise<string[]> {
  const now = Date.now();
  if (discoveryCache && now - discoveryCache.checkedAt < DISCOVERY_TTL_MS) {
    return discoveryCache.models;
  }

  let models: string[] = [];
  let configPath: string | null = null;
  try {
    const { config, configPath: foundPath } = await readOpenCodeConfig();
    configPath = foundPath;
    if (config) {
      const found = new Set<string>();
      // Real opencode configs use `provider`; keep the legacy sync shapes tolerant.
      collectFreeModelsFromProviders(config.provider, found);
      collectFreeModelsFromProviders(config.providers, found);
      collectFreeModelsFromProviders(config.customProviders, found);
      models = Array.from(found).sort((a, b) => a.localeCompare(b));
    }
  } catch {
    // Any unexpected read/parse problem degrades to an empty discovery.
    models = [];
  }

  discoveryCache = { models, configPath, checkedAt: now };
  return models;
}

/** Clears the discovery cache (e.g. after the OpenCode config watcher fires). */
export function clearOpenCodeDiscoveryCache(): void {
  discoveryCache = null;
}

/**
 * Manual key configuration for OpenCode's paid/premium models (Prompt 2).
 *
 * A saved key lives in TWO places, both encrypted-at-rest or user-owned:
 *  1. Ty-Code's credential vault (safeStorage/DPAPI, never leaves this process
 *     in plaintext) — the gateway + OpenCode bridge read from here.
 *  2. The user's local OpenCode config file, injected into the canonical
 *     `provider.<id>.options.apiKey` block the opencode CLI itself reads, with
 *     legacy mirrors ONLY for shapes the file already uses. Plain keys must
 *     live in this file or the CLI cannot use them — that mirrors how the
 *     real opencode CLI stores provider keys and is the documented purpose.
 */

export const OPENCODE_PAID_PROVIDERS: Array<{ id: string; name: string }> = [
  { id: 'openai', name: 'OpenAI' },
  { id: 'anthropic', name: 'Anthropic' },
  { id: 'google', name: 'Google (Gemini)' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'groq', name: 'Groq' },
  { id: 'deepseek', name: 'DeepSeek' }
];

export interface OpenCodeApiKeySaveResult {
  provider: string;
  vaultStored: boolean;
  configUpdated: boolean;
  configPath: string | null;
  message?: string;
}

export interface OpenCodeKeyStatus {
  provider: string;
  vaultConfigured: boolean;
  opencodeConfigured: boolean;
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/** Reads the opencode config JSON if present, else null. Reused by save + status. */
async function readExistingOpenCodeObject(): Promise<{ config: Record<string, unknown>; configPath: string | null } | null> {
  for (const candidatePath of getOpenCodeConfigCandidates()) {
    try {
      const raw = await fs.readFile(candidatePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return { config: parsed as Record<string, unknown>, configPath: candidatePath };
      }
    } catch {
      // Missing or malformed — try the next candidate.
    }
  }
  return null;
}

/** True when any recognized OpenCode key block currently holds a value. */
function providerKeyInOpenCodeConfig(config: Record<string, unknown>, providerId: string): boolean {
  const canonical = (config.provider as Record<string, unknown> | undefined)?.[providerId] as Record<string, unknown> | undefined;
  const canonicalOptions = canonical?.options as Record<string, unknown> | undefined;
  const legacyProviders = config.providers as Record<string, Record<string, unknown>> | undefined;
  const legacyCustom = config.customProviders as Record<string, Record<string, unknown>> | undefined;
  const legacyKeys = (config.keys ?? config.api_keys) as Record<string, unknown> | undefined;
  return Boolean(
    (canonicalOptions && typeof canonicalOptions.apiKey === 'string' && canonicalOptions.apiKey.length > 0) ||
    (legacyProviders?.[providerId]?.apiKey as unknown) ||
    (legacyCustom?.[providerId]?.apiKey as unknown) ||
    (legacyKeys?.[providerId] as unknown)
  );
}

function withInjectedApiKey(config: Record<string, unknown>, providerId: string, apiKey: string): void {
  // Canonical opencode CLI schema: provider.<id>.options.apiKey
  const providerBlock =
    config.provider && typeof config.provider === 'object' && !Array.isArray(config.provider)
      ? (config.provider as Record<string, unknown>)
      : null;
  const target = providerBlock ?? (config.provider = {} as Record<string, unknown>) as Record<string, unknown>;
  const providerEntry =
    target[providerId] && typeof target[providerId] === 'object' && !Array.isArray(target[providerId])
      ? (target[providerId] as Record<string, unknown>)
      : null;
  const entry = providerEntry ?? ((target[providerId] = {} as Record<string, unknown>) as Record<string, unknown>);
  const options =
    entry.options && typeof entry.options === 'object' && !Array.isArray(entry.options)
      ? (entry.options as Record<string, unknown>)
      : null;
  const optionsTarget = options ?? ((entry.options = {} as Record<string, unknown>) as Record<string, unknown>);
  optionsTarget.apiKey = apiKey;

  // Legacy sync shapes get mirrored only when the blocks already exist, so the
  // user's file layout is preserved instead of being flattened into ours.
  const legacyProviders = config.providers as Record<string, unknown> | undefined;
  if (legacyProviders && typeof legacyProviders === 'object' && !Array.isArray(legacyProviders) && providerId in legacyProviders) {
    const legacyEntry = legacyProviders[providerId];
    if (legacyEntry && typeof legacyEntry === 'object' && !Array.isArray(legacyEntry)) {
      (legacyEntry as Record<string, unknown>).apiKey = apiKey;
    }
  }
  const legacyCustom = config.customProviders as Record<string, unknown> | undefined;
  if (legacyCustom && typeof legacyCustom === 'object' && !Array.isArray(legacyCustom) && providerId in legacyCustom) {
    const customEntry = legacyCustom[providerId];
    if (customEntry && typeof customEntry === 'object' && !Array.isArray(customEntry)) {
      (customEntry as Record<string, unknown>).apiKey = apiKey;
    }
  }
  const legacyKeys = (config.keys ?? config.api_keys) as Record<string, unknown> | undefined;
  if (legacyKeys && typeof legacyKeys === 'object' && !Array.isArray(legacyKeys)) {
    legacyKeys[providerId] = apiKey;
  }
}

/**
 * Saves a premium-provider API key: encrypted in the Ty-Code credential vault
 * FIRST, then injected into the user's OpenCode config file. Permission and
 * read-only failures never throw to the IPC boundary — the balanced result
 * explains exactly what landed. The key is never echoed back, not even inside
 * error messages.
 */
export async function saveOpenCodeApiKey(
  providerName: string,
  apiKey: string
): Promise<OpenCodeApiKeySaveResult> {
  const provider = (providerName || '').toLowerCase().trim();
  const key = (apiKey || '').trim();

  const result: OpenCodeApiKeySaveResult = {
    provider,
    vaultStored: false,
    configUpdated: false,
    configPath: null
  };

  if (!PROVIDER_ID_PATTERN.test(provider)) {
    result.message = 'Unknown provider name. Choose one of the listed OpenCode premium providers.';
    return result;
  }
  if (key.length < 8) {
    result.message = 'That does not look like a valid API key (too short). Nothing was stored.';
    return result;
  }

  // 1. Encrypted-at-rest storage inside the Ty-Code vault (safeStorage).
  try {
    await saveKey(provider, key);
    result.vaultStored = true;
  } catch (err: unknown) {
    result.message = `Ty-Code vault rejected the key: ${err instanceof Error ? err.message : String(err)}.`;
  }

  // 2. Inject into the user's OpenCode config so the CLI itself can use it.
  const configPath = (await readExistingOpenCodeObject().then((r) => r?.configPath ?? null).catch(() => null))
    ?? getOpenCodeConfigCandidates()[0];
  try {
    const existing = await readExistingOpenCodeObject();
    const config = existing ? existing.config : {};

    withInjectedApiKey(config, provider, key);

    const dir = path.dirname(configPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

    result.configUpdated = true;
    result.configPath = configPath;
    clearOpenCodeDiscoveryCache();
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    const detail = /EACCES|EPERM|EROFS|EBUSY|EACCES|-4094|permission/i.test(reason)
      ? 'the file is read-only or protected'
      : reason;
    result.configPath = configPath;
    result.message = [
      result.message,
      `The OpenCode config file at ${configPath} could not be written: ${detail}. The key remains stored in the Ty-Code vault.`
    ]
      .filter(Boolean)
      .join(' ');
  }

  return result;
}

/**
 * Read-back for the settings UI: booleans only, plaintext never leaves this
 * process. vaultConfigured = the key is in Ty-Code's encrypted vault;
 * opencodeConfigured = the injected block exists in the user's config file.
 */
export async function getOpenCodeKeyStatus(): Promise<OpenCodeKeyStatus[]> {
  const statuses: OpenCodeKeyStatus[] = [];
  let vaultKeys: Record<string, string> = {};
  try {
    vaultKeys = getAllVaultKeys();
  } catch {
    vaultKeys = {};
  }

  let config: Record<string, unknown> | null = null;
  try {
    config = (await readExistingOpenCodeObject())?.config ?? null;
  } catch {
    config = null;
  }

  for (const provider of OPENCODE_PAID_PROVIDERS) {
    let configPresent = false;
    try {
      configPresent = config ? providerKeyInOpenCodeConfig(config, provider.id) : false;
    } catch {
      configPresent = false;
    }
    statuses.push({
      provider: provider.id,
      vaultConfigured: Boolean(vaultKeys[provider.id] && vaultKeys[provider.id].trim()),
      opencodeConfigured: configPresent
    });
  }
  return statuses;
}
