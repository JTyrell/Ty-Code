import { create } from 'zustand';
import { toast } from './toast-store';
import type { ActiveProviderConfigSummary, ProviderType } from '../../../preload/types';
import type { ModelLockMode } from '../../../shared/types/settings';

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
  /**
   * Requested model-lock mode. 'strict' never deviates from the locked route;
   * 'resilient' may deviate only when the health board marks it unusable.
   * Main's persisted settings are the authority; this mirrors them.
   */
  lockMode: ModelLockMode;
  communityKeyStatus: CommunityKeyStatus;
  /** Set once the persisted selection has been read at boot. */
  hydrated: boolean;
  syncing: boolean;
  /** Last sync failure message for debug surfaces; empty when all is well. */
  lastSyncError: string;
  hydrate: () => Promise<void>;
  setActiveProvider: (providerId: string, modelId?: string) => void;
  setActiveModel: (modelId: string) => void;
  setLockMode: (mode: ModelLockMode) => Promise<void>;
  setCommunityKeyStatus: (status: CommunityKeyStatus) => void;
}

export const TY_CODE_FREE_PROVIDER = 'ty-code-free';
export const TY_CODE_FREE_MODEL = 'google/gemma-4-31b-it:free';
export const DEFAULT_LOCK_MODE: ModelLockMode = 'resilient';

const DEFAULTS = {
  activeProviderId: TY_CODE_FREE_PROVIDER,
  activeModelId: TY_CODE_FREE_MODEL,
  lockMode: DEFAULT_LOCK_MODE,
  communityKeyStatus: 'active' as CommunityKeyStatus
};

function normalizeLockMode(mode: unknown): ModelLockMode {
  return mode === 'strict' ? 'strict' : DEFAULT_LOCK_MODE;
}

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
  lockMode: DEFAULTS.lockMode,
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
        const nextProviderId = response.data.activeProvider || DEFAULTS.activeProviderId;
        const nextModelId = response.data.activeModel || '';
        const nextLockMode = normalizeLockMode(response.data.modelLock?.mode);
        const current = get();
        // Echo suppression (Prompt: Break the Model-Sync Echo Loop): apply
        // ONLY on a primitive string difference. An identical hydration must
        // not flip state (which would re-arm the sync watcher) — this is the
        // hydrate-with-suppress path that lets late-opening popout windows
        // adopt the locked model WITHOUT pushing set-active-model back.
        if (
          current.activeProviderId !== nextProviderId ||
          current.activeModelId !== nextModelId ||
          current.lockMode !== nextLockMode
        ) {
          // The value CAME from main's persisted settings: record it as the
          // synced signature so the watcher does not echo it straight back.
          lastSyncedSignature = configSignature(nextProviderId, nextModelId);
          set({
            activeProviderId: nextProviderId,
            activeModelId: nextModelId,
            lockMode: nextLockMode,
            hydrated: true
          });
        } else if (!current.hydrated) {
          set({ hydrated: true });
        }
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

  /**
   * Change ONLY the lock mode. Pushes straight to main (explicit origin) so
   * the requested lock is re-persisted; the pair itself is untouched, which
   * keeps the watcher's signature stable and avoids a redundant sync.
   */
  setLockMode: async (mode) => {
    const normalized = normalizeLockMode(mode);
    if (get().lockMode === normalized) return;
    set({ lockMode: normalized });
    const { activeProviderId, activeModelId } = get();
    try {
      const response = await window.electronAPI.updateActiveProviderConfig({
        providerId: activeProviderId,
        modelId: activeModelId,
        mode: normalized,
        origin: 'explicit'
      });
      if (!response.success) throw new Error(response.error || 'Model lock mode sync failed');
      lastSyncedSignature = configSignature(activeProviderId, activeModelId);
      set({ lastSyncError: '' });
    } catch (err) {
      // Revert so the UI never shows a mode main did not accept. Re-read
      // main's persisted value rather than guessing the previous one.
      const persisted = await window.electronAPI.getSettings().catch(() => null);
      set({ lockMode: normalizeLockMode(persisted?.data?.modelLock?.mode) });
      const message = err instanceof Error ? err.message : String(err);
      set({ lastSyncError: message });
      toast.error('Model Lock Not Applied', message);
    }
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
    // The lock mode travels with the pair so main re-persists a complete lock;
    // read via getState() to stay current without re-arming this watcher.
    const mode = useSettingsStore.getState().lockMode;
    const response = await window.electronAPI.updateActiveProviderConfig({ providerId, modelId, mode, origin });
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

    // Persistence is owned by main: the providers:update-active-config handler
    // persists the resolved pair (and only on a genuine change). The renderer
    // previously duplicated that save here, which doubled every saveLayer ->
    // settings:changed cycle and fed the echo loop.

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

/**
 * Cross-window lock adoption (Multi-window integration contract).
 *
 * Settings changes made in ANY window (main, Canvas popout, Debugger popout)
 * reach main first; main is the authority and re-broadcasts the requested
 * lock. Every window adopts it here so the Settings UI never drifts.
 *
 * Echo suppression: `lastSyncedSignature` is advanced BEFORE setState and only
 * primitive differences are applied, so adoption can never re-arm the pair
 * watcher above.
 */
let disposeSettingsRouteListener: (() => void) | null = null;

if (typeof window !== 'undefined' && window.electronAPI?.onActiveRouteChanged) {
  disposeSettingsRouteListener =
    window.electronAPI.onActiveRouteChanged((snapshot) => {
      const lock = snapshot?.modelLock;
      if (!lock || typeof lock !== 'object') return;
      const nextProviderId = lock.providerId || DEFAULTS.activeProviderId;
      const nextModelId = lock.modelId || '';
      const nextLockMode = normalizeLockMode(lock.mode);

      const current = useSettingsStore.getState();
      if (
        current.activeProviderId === nextProviderId &&
        current.activeModelId === nextModelId &&
        current.lockMode === nextLockMode
      ) {
        return;
      }
      lastSyncedSignature = configSignature(nextProviderId, nextModelId);
      useSettingsStore.setState({
        activeProviderId: nextProviderId,
        activeModelId: nextModelId,
        lockMode: nextLockMode
      });
    }) || null;
}

/** Tears down the route listener. Used by tests to avoid leaked IPC handlers. */
export function disposeSettingsRouteAdoption(): void {
  disposeSettingsRouteListener?.();
  disposeSettingsRouteListener = null;
}
