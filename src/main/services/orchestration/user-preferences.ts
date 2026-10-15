/**
 * Router User Preferences Service (Phase 6.4)
 *
 * Manages user preference overrides for intelligent model routing:
 * - auto: System automatically chooses best model per task (default)
 * - fastest: Prioritizes latency, always using fastest healthy endpoint
 * - most_capable: Prioritizes intelligence and reasoning depth (Tier S/A)
 * - preferred_provider: Always uses models from designated provider
 * - manual: User manually selects model for each session
 *
 * Brand: Ty-Code
 */

import type {
  RouterUserPreferences,
  RoutingPreferenceMode
} from '../../../shared/types/model-router';
import { settingsManager } from '../settings-manager';

export const DEFAULT_ROUTER_PREFERENCES: RouterUserPreferences = {
  mode: 'auto',
  preferredProviderId: undefined,
  manualModelId: undefined,
  manualProviderId: undefined,
  autoFailoverEnabled: true,
  maxFailoverAttempts: 3,
  preferFreeModels: true
};

export class UserPreferencesService {
  private static instance: UserPreferencesService;
  private inMemoryPreferences: RouterUserPreferences = { ...DEFAULT_ROUTER_PREFERENCES };
  private isLoaded = false;

  public static getInstance(): UserPreferencesService {
    if (!UserPreferencesService.instance) {
      UserPreferencesService.instance = new UserPreferencesService();
    }
    return UserPreferencesService.instance;
  }

  /**
   * Retrieves current routing user preferences, loading from persistent settings if needed.
   */
  public async getPreferences(): Promise<RouterUserPreferences> {
    if (!this.isLoaded) {
      await this.loadPersistedPreferences();
    }
    return { ...this.inMemoryPreferences };
  }

  /**
   * Updates user preferences and persists changes to disk.
   */
  public async updatePreferences(updates: Partial<RouterUserPreferences>): Promise<RouterUserPreferences> {
    if (!this.isLoaded) {
      await this.loadPersistedPreferences();
    }

    this.inMemoryPreferences = {
      ...this.inMemoryPreferences,
      ...updates
    };

    await this.persistPreferences();
    return { ...this.inMemoryPreferences };
  }

  /**
   * Sets the routing mode directly.
   */
  public async setMode(mode: RoutingPreferenceMode): Promise<RouterUserPreferences> {
    return this.updatePreferences({ mode });
  }

  /**
   * Sets manual model override.
   */
  public async setManualModel(modelId: string, providerId?: string): Promise<RouterUserPreferences> {
    return this.updatePreferences({
      mode: 'manual',
      manualModelId: modelId,
      manualProviderId: providerId
    });
  }

  /**
   * Sets preferred provider override.
   */
  public async setPreferredProvider(providerId: string): Promise<RouterUserPreferences> {
    return this.updatePreferences({
      mode: 'preferred_provider',
      preferredProviderId: providerId
    });
  }

  /**
   * Resets all routing preferences to factory defaults.
   */
  public async resetToDefaults(): Promise<RouterUserPreferences> {
    this.inMemoryPreferences = { ...DEFAULT_ROUTER_PREFERENCES };
    await this.persistPreferences();
    return { ...this.inMemoryPreferences };
  }

  private async loadPersistedPreferences(): Promise<void> {
    try {
      const settings = await settingsManager.getEffectiveSettings();
      const stored = (settings as any).routerPreferences as Partial<RouterUserPreferences> | undefined;
      if (stored && typeof stored === 'object') {
        this.inMemoryPreferences = {
          ...DEFAULT_ROUTER_PREFERENCES,
          ...stored
        };
      }
      this.isLoaded = true;
    } catch {
      this.inMemoryPreferences = { ...DEFAULT_ROUTER_PREFERENCES };
      this.isLoaded = true;
    }
  }

  private async persistPreferences(): Promise<void> {
    try {
      await settingsManager.saveLayer('global', {
        routerPreferences: this.inMemoryPreferences
      } as any);
    } catch {
      // Ignore persistence errors in headless test runners
    }
  }
}

export const userPreferences = UserPreferencesService.getInstance();
