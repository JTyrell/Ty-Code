/**
 * Unified Model Selection State (Prompt 2: Fix Routing & Ensure Models Work Across All Features)
 *
 * Manages the globally selected model across Chat Sidecar, Omni-Debugger, and M3E Canvas.
 * Synchronizes with ProviderGateway in the Main Process via IPC.
 *
 * Echo suppression (Prompt: Break the Model-Sync Echo Loop):
 * - `lastPushed` remembers the last triple sent to main; identical re-pushes
 *   (store mirrors, hook re-runs, rehydration) are skipped via PRIMITIVE
 *   string comparison — never object identity.
 * - On window boot (including late-opening Canvas/Debugger popouts) the store
 *   ADOPTS main's persisted lock via a one-shot getSettings pull and marks it
 *   as already-pushed, so hydration never re-emits set-active-model.
 * - The reactive push paths (module subscribe + useActiveModelSync hook) stay
 *   gated until that boot pull settles; explicit user actions always push.
 *
 * Brand: Ty-Code
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { useEffect } from 'react';
import type { VerifiedModelConfig } from '../../../preload/types';
import type { ModelLockMode } from '../../../shared/types/settings';

/** Lock mode adopted when main has not yet reported one (schema default). */
export const DEFAULT_LOCK_MODE: ModelLockMode = 'resilient';

export interface ActiveModelState {
  providerId: string;
  modelId: string;
  modelConfig: VerifiedModelConfig | null;
  isAutoMode: boolean; // For "Auto (FCC decides)"
  /** Requested lock mode: 'strict' never deviates, 'resilient' may on health. */
  mode: ModelLockMode;

  // Actions
  setActiveModel: (providerId: string, modelId: string, modelConfig?: VerifiedModelConfig | null) => Promise<void>;
  setAutoMode: (enabled: boolean) => Promise<void>;
  /** Change only the lock mode (strict/resilient) and re-sync to main. */
  setLockMode: (mode: ModelLockMode) => Promise<void>;
  syncToMainProcess: () => Promise<void>;
}

interface PushTriple {
  providerId: string;
  modelId: string;
  isAutoMode: boolean;
  mode: ModelLockMode;
}

/** Last triple pushed to main (primitive comparison only). */
let lastPushed: PushTriple | null = null;
/** Settles after the one-shot boot pull; gates the REACTIVE push paths only. */
let bootPullSettled = false;
/** A user-driven push happened before the boot pull resolved — pull must not clobber it. */
let userPushedSinceBoot = false;

function samePush(a: PushTriple, b: PushTriple): boolean {
  return (
    a.providerId === b.providerId &&
    a.modelId === b.modelId &&
    a.isAutoMode === b.isAutoMode &&
    a.mode === b.mode
  );
}

export const useActiveModelStore = create<ActiveModelState>()(
  persist(
    (set, get) => ({
      providerId: 'ty-code-free',
      modelId: 'google/gemma-4-31b-it:free',
      modelConfig: null,
      isAutoMode: true,
      mode: DEFAULT_LOCK_MODE,

      setActiveModel: async (providerId: string, modelId: string, modelConfig: VerifiedModelConfig | null = null) => {
        set({
          providerId,
          modelId,
          modelConfig,
          isAutoMode: false
        });
        await get().syncToMainProcess();
      },

      setAutoMode: async (enabled: boolean) => {
        set({
          isAutoMode: enabled,
          ...(enabled ? { providerId: 'auto', modelId: '', modelConfig: null } : {})
        });
        await get().syncToMainProcess();
      },

      setLockMode: async (mode: ModelLockMode) => {
        if (get().mode === mode) return;
        set({ mode });
        await get().syncToMainProcess();
      },

      syncToMainProcess: async () => {
        const { providerId, modelId, isAutoMode, mode } = get();
        const next: PushTriple = { providerId, modelId, isAutoMode, mode };
        // Compare-before-push: identical re-pushes are silent no-ops.
        if (lastPushed && samePush(lastPushed, next)) return;
        lastPushed = next;
        userPushedSinceBoot = true;
        try {
          if (window.electronAPI?.updateActiveModelConfig) {
            await window.electronAPI.updateActiveModelConfig(next);
          }
        } catch (err: unknown) {
          // Allow a later retry once the failure settles.
          lastPushed = null;
          console.warn('[ACTIVE-MODEL-STORE] Failed to sync model to main process:', err);
        }
      }
    }),
    {
      name: 'ty-code-active-model',
      partialize: (state) => ({
        providerId: state.providerId,
        modelId: state.modelId,
        isAutoMode: state.isAutoMode,
        mode: state.mode
      })
    }
  )
);

/**
 * Custom React Hook that watches for active model changes and immediately syncs
 * to ProviderGateway via window.electronAPI.updateActiveModelConfig.
 * Gated until the boot pull settles so window mount never re-emits the
 * adopted lock (hydrate-with-suppress).
 */
export function useActiveModelSync(): void {
  const providerId = useActiveModelStore((s) => s.providerId);
  const modelId = useActiveModelStore((s) => s.modelId);
  const isAutoMode = useActiveModelStore((s) => s.isAutoMode);
  const mode = useActiveModelStore((s) => s.mode);

  useEffect(() => {
    if (!bootPullSettled) return;
    const next: PushTriple = { providerId, modelId, isAutoMode, mode };
    if (lastPushed && samePush(lastPushed, next)) return;
    lastPushed = next;
    userPushedSinceBoot = true;
    if (window.electronAPI?.updateActiveModelConfig) {
      window.electronAPI.updateActiveModelConfig(next).catch((err) => {
        lastPushed = null;
        console.warn('[ACTIVE-MODEL-SYNC] Error synchronizing active model:', err);
      });
    }
  }, [providerId, modelId, isAutoMode, mode]);
}

// Module-level listener to guarantee sync even on store rehydration or non-React changes.
// Gated until the boot pull settles (rehydration must not echo the adopted lock).
if (typeof window !== 'undefined') {
  useActiveModelStore.subscribe((state, prevState) => {
    if (!bootPullSettled) return;
    if (
      state.providerId !== prevState.providerId ||
      state.modelId !== prevState.modelId ||
      state.isAutoMode !== prevState.isAutoMode ||
      state.mode !== prevState.mode
    ) {
      const next: PushTriple = {
        providerId: state.providerId,
        modelId: state.modelId,
        isAutoMode: state.isAutoMode,
        mode: state.mode
      };
      if (lastPushed && samePush(lastPushed, next)) return;
      lastPushed = next;
      userPushedSinceBoot = true;
      if (window.electronAPI?.updateActiveModelConfig) {
        window.electronAPI.updateActiveModelConfig(next).catch(() => {
          lastPushed = null;
        });
      }
    }
  });

  // One-shot boot pull (hydrate-with-suppress): adopt main's persisted lock
  // WITHOUT pushing it back. Late-opening popouts therefore hydrate the
  // current locked model with ZERO set-active-model traffic.
  if (window.electronAPI?.getSettings) {
    void window.electronAPI
      .getSettings()
      .then((res) => {
        if (userPushedSinceBoot) {
          // A user action already pushed a fresher selection — keep it.
          bootPullSettled = true;
          return;
        }
        if (res?.success && res.data) {
          const providerId = res.data.activeProvider || 'ty-code-free';
          const modelId = res.data.activeModel || 'google/gemma-4-31b-it:free';
          const isAutoMode = providerId === 'auto' || !providerId;
          const mode: ModelLockMode = res.data.modelLock?.mode === 'strict' ? 'strict' : DEFAULT_LOCK_MODE;
          const adopted: PushTriple = { providerId, modelId, isAutoMode, mode };
          // Mark as already-pushed BEFORE touching state so the reactive
          // paths treat the adoption as settled (no echo to main).
          lastPushed = adopted;
          const current = useActiveModelStore.getState();
          if (!samePush({ providerId: current.providerId, modelId: current.modelId, isAutoMode: current.isAutoMode, mode: current.mode }, adopted)) {
            useActiveModelStore.setState({
              providerId: adopted.providerId,
              modelId: adopted.modelId,
              isAutoMode: adopted.isAutoMode,
              mode: adopted.mode,
              modelConfig: null
            });
          }
        }
        bootPullSettled = true;
      })
      .catch(() => {
        bootPullSettled = true;
      });
  } else {
    bootPullSettled = true;
  }
}

/**
 * Cross-window lock adoption (Multi-window integration contract).
 *
 * Main is the single authority for the requested lock. Whenever it changes —
 * from Settings in the main window, a popout, or an auto-return after a
 * resilient deviation — every window adopts it here. The adoption marks the
 * triple as ALREADY PUSHED before touching state, so the reactive paths stay
 * silent: no echo back to main, no sync-loop storm.
 *
 * Only `modelLock` is adopted, never `activeRoute`: a temporary deviation is
 * surfaced by the route badge, not by mutating the user's chosen lock.
 */
let disposeActiveRouteListener: (() => void) | null = null;

function adoptRequestedLock(modelLock: { providerId?: string; modelId?: string; mode?: ModelLockMode } | null | undefined): void {
  if (!modelLock || typeof modelLock !== 'object') return;
  const providerId = modelLock.providerId || 'ty-code-free';
  const modelId = modelLock.modelId || 'google/gemma-4-31b-it:free';
  const isAutoMode = providerId === 'auto' || !providerId;
  const mode: ModelLockMode = modelLock.mode === 'strict' ? 'strict' : DEFAULT_LOCK_MODE;
  const adopted: PushTriple = { providerId, modelId, isAutoMode, mode };

  const current = useActiveModelStore.getState();
  const live: PushTriple = {
    providerId: current.providerId,
    modelId: current.modelId,
    isAutoMode: current.isAutoMode,
    mode: current.mode
  };

  // Suppress BEFORE setState so this adoption can never round-trip to main.
  lastPushed = adopted;
  bootPullSettled = true;
  if (samePush(live, adopted)) return;
  useActiveModelStore.setState({
    providerId: adopted.providerId,
    modelId: adopted.modelId,
    isAutoMode: adopted.isAutoMode,
    mode: adopted.mode,
    modelConfig: null
  });
}

if (typeof window !== 'undefined' && window.electronAPI?.onActiveRouteChanged) {
  disposeActiveRouteListener = window.electronAPI.onActiveRouteChanged((snapshot) => {
    adoptRequestedLock(snapshot?.modelLock);
  }) || null;
}

/** Tears down the route listener. Used by tests to avoid leaked IPC handlers. */
export function disposeActiveRouteAdoption(): void {
  disposeActiveRouteListener?.();
  disposeActiveRouteListener = null;
}

/** Test seam: apply an authoritative lock exactly as a route event would. */
export function adoptRequestedLockFromMain(
  modelLock: { providerId?: string; modelId?: string; mode?: ModelLockMode } | null | undefined
): void {
  adoptRequestedLock(modelLock);
}
