/**
 * OpenCode Provider Integration & Synchronization Service (Phase 6.3)
 *
 * Synchronizes providers, API keys, custom endpoints, and model catalogs from OpenCode's
 * configuration (~/.config/opencode/opencode.json), with real-time file watching,
 * automatic free-tier discovery, and seamless merging into Ty-Code.
 *
 * Brand: Ty-Code
 */

import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import type {
  OpenCodeConfig,
  OpenCodeDetectionResult,
  OpenCodeImportResult,
  OpenCodeProviderConfig
} from '../../../shared/types/opencode-sync';
import type { PreConfiguredProvider } from '../../../preload/types';
import { opencodeFreeDetector } from './opencode-free-detector';
import { readStoredCredentials, writeStoredCredentials } from '../../ipc/settings-handlers';
import { settingsManager } from '../settings-manager';
import { getAllPreconfiguredProviders } from '../../config/provider-registry';

export class OpenCodeIntegration {
  private static instance: OpenCodeIntegration;
  private configWatcher: FSWatcher | null = null;
  private lastSyncedTimestamp = 0;
  private cachedConfig: OpenCodeConfig | null = null;

  public static getInstance(): OpenCodeIntegration {
    if (!OpenCodeIntegration.instance) {
      OpenCodeIntegration.instance = new OpenCodeIntegration();
    }
    return OpenCodeIntegration.instance;
  }

  /**
   * Returns candidate paths where OpenCode configs might be located.
   */
  public getConfigCandidates(): string[] {
    const home = os.homedir();
    return [
      path.join(home, '.config', 'opencode', 'opencode.json'),
      path.join(home, '.config', 'opencode', 'config.json'),
      path.join(home, '.config', 'opencode', 'providers.json'),
      path.join(home, '.opencode', 'config.json')
    ];
  }

  /**
   * Finds the primary active OpenCode configuration file path.
   */
  public async findActiveConfigPath(): Promise<string | null> {
    for (const p of this.getConfigCandidates()) {
      try {
        await fs.access(p);
        return p;
      } catch {
        // Try next
      }
    }
    return null;
  }

  /**
   * Reads and parses OpenCode configuration, caching the result.
   */
  public async readConfig(): Promise<OpenCodeConfig | null> {
    const configPath = await this.findActiveConfigPath();
    if (!configPath) {
      this.cachedConfig = null;
      return null;
    }

    try {
      const raw = await fs.readFile(configPath, 'utf8');
      const parsed = JSON.parse(raw) as OpenCodeConfig;
      this.cachedConfig = parsed;
      return parsed;
    } catch {
      return null;
    }
  }

  /**
   * Detects whether OpenCode is installed on the system and counts configured providers.
   */
  public async detectOpenCode(): Promise<OpenCodeDetectionResult> {
    const configPath = await this.findActiveConfigPath();
    if (!configPath) {
      return {
        isInstalled: false,
        providerCount: 0,
        modelCount: 0,
        freeModelCount: 0,
        configuredProviders: []
      };
    }

    const config = await this.readConfig();
    const providers = config?.providers || {};
    const customProviders = config?.customProviders || {};
    const allProviderKeys = Array.from(new Set([
      ...Object.keys(providers),
      ...Object.keys(customProviders)
    ]));

    let totalModels = 0;
    for (const p of Object.values(providers)) {
      if (typeof p === 'object' && p !== null && Array.isArray((p as any).models)) {
        totalModels += (p as any).models.length;
      }
    }
    for (const p of Object.values(customProviders)) {
      if (Array.isArray(p.models)) {
        totalModels += p.models.length;
      }
    }

    const freeSummary = opencodeFreeDetector.analyzeFreeTiers(config);

    return {
      isInstalled: true,
      configPath,
      providerCount: allProviderKeys.length,
      modelCount: totalModels,
      freeModelCount: freeSummary.totalFreeModels,
      configuredProviders: allProviderKeys,
      version: config?.version || '1.0.0',
      lastSyncedAt: this.lastSyncedTimestamp || undefined
    };
  }

  /**
   * Imports all configured and custom providers from OpenCode into Ty-Code.
   * Encrypts API keys into operating system safeStorage and registers endpoints.
   */
  public async importOpenCodeProviders(): Promise<OpenCodeImportResult> {
    const config = await this.readConfig();
    if (!config) {
      return {
        success: false,
        importedProviders: [],
        importedKeysCount: 0,
        importedModelsCount: 0,
        freeModelsFound: 0,
        message: 'No OpenCode configuration found in ~/.config/opencode.'
      };
    }

    const { keys: storedKeys } = await readStoredCredentials();
    const currentSettings = await settingsManager.getEffectiveSettings();
    const customEndpoints = { ...(currentSettings.customEndpoints || {}) };

    const importedProviders: string[] = [];
    let importedKeysCount = 0;
    let importedModelsCount = 0;

    // 1. Import general keys from config.keys
    if (config.keys && typeof config.keys === 'object') {
      for (const [providerId, rawKey] of Object.entries(config.keys)) {
        if (typeof rawKey === 'string' && rawKey.trim()) {
          const cleanId = providerId.toLowerCase().replace(/_api_key$/i, '');
          storedKeys[cleanId] = rawKey.trim();
          importedKeysCount++;
          if (!importedProviders.includes(cleanId)) importedProviders.push(cleanId);
        }
      }
    }

    // 2. Import standard providers
    if (config.providers && typeof config.providers === 'object') {
      for (const [id, provData] of Object.entries(config.providers)) {
        if (typeof provData === 'object' && provData !== null) {
          const p = provData as OpenCodeProviderConfig;
          if (p.apiKey && typeof p.apiKey === 'string' && p.apiKey.trim()) {
            storedKeys[id] = p.apiKey.trim();
            importedKeysCount++;
          }
          if (p.baseUrl && typeof p.baseUrl === 'string' && p.baseUrl.trim()) {
            customEndpoints[id] = p.baseUrl.trim();
          }
          if (Array.isArray(p.models)) {
            importedModelsCount += p.models.length;
          }
          if (!importedProviders.includes(id)) importedProviders.push(id);
        }
      }
    }

    // 3. Import custom providers
    if (config.customProviders && typeof config.customProviders === 'object') {
      for (const [id, customProv] of Object.entries(config.customProviders)) {
        if (typeof customProv === 'object' && customProv !== null) {
          if (customProv.apiKey && typeof customProv.apiKey === 'string') {
            storedKeys[id] = customProv.apiKey.trim();
            importedKeysCount++;
          }
          if (customProv.baseUrl) {
            customEndpoints[id] = customProv.baseUrl.trim();
          }
          if (Array.isArray(customProv.models)) {
            importedModelsCount += customProv.models.length;
          }
          if (!importedProviders.includes(id)) importedProviders.push(id);
        }
      }
    }

    // Persist encrypted keys and custom endpoints
    await writeStoredCredentials(storedKeys);
    await settingsManager.saveLayer('global', { customEndpoints });

    this.lastSyncedTimestamp = Date.now();
    const freeSummary = opencodeFreeDetector.analyzeFreeTiers(config);

    return {
      success: true,
      importedProviders,
      importedKeysCount,
      importedModelsCount,
      freeModelsFound: freeSummary.totalFreeModels,
      message: `Successfully imported ${importedProviders.length} providers and ${importedKeysCount} keys from OpenCode.`
    };
  }

  /**
   * Merges Ty-Code's built-in providers with providers found in OpenCode.
   */
  public async getMergedProviders(): Promise<PreConfiguredProvider[]> {
    const builtin = getAllPreconfiguredProviders();
    const config = await this.readConfig();
    if (!config) return builtin;

    const merged = [...builtin];
    const existingIds = new Set(builtin.map((p) => p.id));

    const allOpencode = {
      ...(config.providers || {}),
      ...(config.customProviders || {})
    };

    for (const [id, provData] of Object.entries(allOpencode)) {
      if (!existingIds.has(id) && typeof provData === 'object' && provData !== null) {
        const p = provData as OpenCodeProviderConfig;
        merged.push({
          id,
          name: p.name || id.charAt(0).toUpperCase() + id.slice(1),
          baseUrl: p.baseUrl || 'https://api.openai.com/v1',
          setupType: p.apiKey ? 'api_key' : 'zero_config',
          notes: 'Imported from OpenCode configuration',
          defaultModel: p.defaultModel || p.models?.[0]
        });
        existingIds.add(id);
      }
    }

    return merged;
  }

  /**
   * Starts a file watcher on OpenCode's configuration directory to auto-update on changes.
   */
  public async startConfigWatcher(onChange?: (config: OpenCodeConfig | null) => void): Promise<void> {
    this.stopConfigWatcher();
    const activePath = await this.findActiveConfigPath();
    if (!activePath) return;

    try {
      const configDir = path.dirname(activePath);
      this.configWatcher = watch(configDir, { persistent: false }, async () => {
        const updatedConfig = await this.readConfig();
        if (onChange) onChange(updatedConfig);
      });
    } catch {
      // Ignore watcher setup error if directory is restricted
    }
  }

  /**
   * Stops the active configuration watcher.
   */
  public stopConfigWatcher(): void {
    if (this.configWatcher) {
      try {
        this.configWatcher.close();
      } catch {
        // Ignore error
      }
      this.configWatcher = null;
    }
  }
}

export const opencodeIntegration = OpenCodeIntegration.getInstance();
