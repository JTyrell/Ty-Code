import { create } from 'zustand';
import { toast } from './toast-store';
import type { ActiveProviderConfigSummary, ProviderType } from '../../../preload/types';

/**
 * Unified UI-facing settings store for the active provider/model pair.
 *
 * Two responsibilities:
 * 1. Single source of truth for the renderer ("AI Providers & Models" tab,
 *    model quick selector, chat sidecar dropdown).
 * 2. Sync with the main process: a zustand subscription watches the pair and
 *    calls `window.electronAPI.updateActiveProviderConfig` whenever it
 *    changes (deduplicated and revertible on failure).
 *
 * SECURITY INVARIANT: this store never touches API key values. Main only
 * replies with masked summaries (e.g. "sk-ant-••••1234").
 */

export type CommunityKeyStatus = 'active' | 'degraded' | 'missing';

interface SettingsStoreState {
  activeProviderId: string;
  activeModelId: string;
  communityKeyStatus: CommunityKeyStatus;
  /** Set once the persisted selection has been read at boot. */
  hydrated: boolean;
  syncing: boolean;
  /** Last sync failure message for debug surfaces; empty when all is well. */
  lastSyncError: string;
  hydrate: () => Promise<void>;
  setActiveProvider: (providerId: string, modelId?: string) => void;
  setActiveModel: (modelId: string) => void;
  setCommunityKeyStatus: (status: CommunityKeyStatus) => void;
}

export const TY_CODE_FREE_PROVIDER = 'ty-code-free';
export const TY_CODE_FREE_MODEL = 'google/gemma-4-31b-it:free';

const DEFAULTS = {
  activeProviderId: TY_CODE_FREE_PROVIDER,
  activeModelId: TY_CODE_FREE_MODEL,
  communityKeyStatus: 'active' as CommunityKeyStatus
};

function configSignature(providerId: string, modelId: string): string {
  return `${providerId}::${modelId}`;
}

/**
 * Origin of the next main-process sync. Only the user-facing setters below
 * flip this to 'explicit'; hydration, store mirrors and window mounts stay
 * 'auto', which main treats as SILENT (no toast, ledger only).
 */
let nextSyncOrigin: 'explicit' | 'auto' = 'auto';

export const useSettingsStore = create<SettingsStoreState>((set, get) => ({
  activeProviderId: DEFAULTS.activeProviderId,
  activeModelId: DEFAULTS.activeModelId,
  communityKeyStatus: DEFAULTS.communityKeyStatus,
  hydrated: false,
  syncing: false,
  lastSyncError: '',

  hydrate: async () => {
    try {
      if (window.electronAPI?.getCommunityKeyStatus) {
        const statusRes = await window.electronAPI.getCommunityKeyStatus();
        if (statusRes?.success && statusRes.data?.status) {
          set({ communityKeyStatus: statusRes.data.status });
        }
      }
      const response = await window.electronAPI.getSettings();
      if (response.success && response.data) {
        set({
          activeProviderId: response.data.activeProvider || DEFAULTS.activeProviderId,
          activeModelId: response.data.activeModel || '',
          hydrated: true
        });
      } else {
        set({ hydrated: true });
      }
    } catch {
      set({ hydrated: true });
    }
  },

  setActiveProvider: (providerId, modelId) => {
    nextSyncOrigin = 'explicit';
    const defaultModel = providerId === TY_CODE_FREE_PROVIDER ? TY_CODE_FREE_MODEL : undefined;
    set({
      activeProviderId: providerId || DEFAULTS.activeProviderId,
      activeModelId: modelId !== undefined ? modelId : (defaultModel || get().activeModelId)
    });
  },

  setActiveModel: (modelId) => {
    nextSyncOrigin = 'explicit';
    set({
      activeModelId: modelId,
      activeProviderId: get().activeProviderId || DEFAULTS.activeProviderId
    });
  },

  setCommunityKeyStatus: (status) => {
    set({ communityKeyStatus: status });
  }
}));

if (typeof window !== 'undefined' && window.electronAPI?.onCommunityKeyStatusChanged) {
  window.electronAPI.onCommunityKeyStatusChanged((data) => {
    if (data?.status) {
      useSettingsStore.setState({ communityKeyStatus: data.status });
    }
  });

  if (window.electronAPI?.getCommunityKeyStatus) {
    void window.electronAPI.getCommunityKeyStatus().then((res) => {
      if (res?.success && res.data?.status) {
        useSettingsStore.setState({ communityKeyStatus: res.data.status });
      }
    }).catch(() => undefined);
  }
}

let lastSyncedSignature = '';
let syncInFlight = false;
let pendingSync: { providerId: string; modelId: string } | null = null;

async function syncActiveConfigToMain(providerId: string, modelId: string): Promise<boolean> {
  if (syncInFlight) {
    pendingSync = { providerId, modelId };
    return true;
  }
  syncInFlight = true;
  useSettingsStore.setState({ syncing: true });
  try {
    const origin = nextSyncOrigin;
    nextSyncOrigin = 'auto';
    const response = await window.electronAPI.updateActiveProviderConfig({ providerId, modelId, origin });
    if (!response.success) throw new Error(response.error || 'Active provider sync failed');
    const summary = (response.data || {}) as ActiveProviderConfigSummary;

    // Main may have downgraded the pair (missing key -> Ty-Code Free).
    if (summary.providerId && (summary.providerId !== providerId || summary.modelId !== modelId)) {
      lastSyncedSignature = configSignature(summary.providerId, summary.modelId);
      useSettingsStore.setState({
        activeProviderId: summary.providerId,
        activeModelId: summary.modelId
      });
    } else {
      lastSyncedSignature = configSignature(providerId, modelId);
    }

    // Main's RouteEventPolicy owns emission. `degraded`/`reason` alone never
    // toast; a notice exists only for ACTIONABLE (once per provider) or the
    // once-per-session info hint. No notice means stay silent.
    if (summary.notice) {
      const { severity, title, message } = summary.notice;
      if (severity === 'warning') toast.warning(title, message);
      else toast.info(title, message);
    }

    // Persist to main settings layer
    try {
      if (window.electronAPI?.saveSettings) {
        await window.electronAPI.saveSettings({
          activeProvider: summary.providerId as any,
          activeModel: summary.modelId
        });
      }
    } catch {
      // Optional persistence
    }

    // Mirror into the active model store
    try {
      const { useActiveModelStore } = await import('./active-model-store');
      await useActiveModelStore.getState().setActiveModel(summary.providerId, summary.modelId);
    } catch {
      // Ignore if not loaded
    }

    // Mirror into the chat sidecar store so its dropdown reflects the change.
    try {
      const { useChatStore } = await import('./chat-store');
      const chatState = useChatStore.getState();
      if (chatState.settings) {
        useChatStore.setState({
          settings: {
            ...chatState.settings,
            activeProvider: summary.providerId as unknown as ProviderType,
            activeModel: summary.modelId
          }
        });
      }
    } catch {
      // Chat sidecar not mounted yet; next hydrate picks the pair up.
    }

    useSettingsStore.setState({ lastSyncError: '' });
    return true;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    useSettingsStore.setState({ lastSyncError: message });
    toast.error('Provider selection not synced', message);
    return false;
  } finally {
    syncInFlight = false;
    useSettingsStore.setState({ syncing: false });
    if (pendingSync) {
      const next = pendingSync;
      pendingSync = null;
      void syncActiveConfigToMain(next.providerId, next.modelId);
    }
  }
}

/** Guards against re-entrancy when reverting a failed sync to its old pair. */
let reverting = false;

function armSettingsSyncWatcher(): void {
  useSettingsStore.subscribe((state, prevState) => {
    if (reverting) return;
    const changed =
      state.activeProviderId !== prevState.activeProviderId || state.activeModelId !== prevState.activeModelId;
    if (!changed || !state.hydrated) return;

    const signature = configSignature(state.activeProviderId, state.activeModelId);
    if (signature === lastSyncedSignature) return;

    const revertPair = {
      providerId: prevState.activeProviderId,
      modelId: prevState.activeModelId
    };

    void (async () => {
      const ok = await syncActiveConfigToMain(state.activeProviderId, state.activeModelId);
      if (!ok && !pendingSync) {
        const previousSignature = configSignature(revertPair.providerId, revertPair.modelId);
        if (previousSignature !== lastSyncedSignature) {
          reverting = true;
          useSettingsStore.setState({
            activeProviderId: revertPair.providerId,
            activeModelId: revertPair.modelId || ''
          });
          reverting = false;
        }
      }
    })();
  });
}

armSettingsSyncWatcher();
