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

export interface ActiveModelState {
  providerId: string;
  modelId: string;
  modelConfig: VerifiedModelConfig | null;
  isAutoMode: boolean; // For "Auto (FCC decides)"

  // Actions
  setActiveModel: (providerId: string, modelId: string, modelConfig?: VerifiedModelConfig | null) => Promise<void>;
  setAutoMode: (enabled: boolean) => Promise<void>;
  syncToMainProcess: () => Promise<void>;
}

interface PushTriple {
  providerId: string;
  modelId: string;
  isAutoMode: boolean;
}

/** Last triple pushed to main (primitive comparison only). */
let lastPushed: PushTriple | null = null;
/** Settles after the one-shot boot pull; gates the REACTIVE push paths only. */
let bootPullSettled = false;
/** A user-driven push happened before the boot pull resolved — pull must not clobber it. */
let userPushedSinceBoot = false;

function samePush(a: PushTriple, b: PushTriple): boolean {
  return a.providerId === b.providerId && a.modelId === b.modelId && a.isAutoMode === b.isAutoMode;
}

export const useActiveModelStore = create<ActiveModelState>()(
  persist(
    (set, get) => ({
      providerId: 'ty-code-free',
      modelId: 'google/gemma-4-31b-it:free',
      modelConfig: null,
      isAutoMode: true,

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

      syncToMainProcess: async () => {
        const { providerId, modelId, isAutoMode } = get();
        const next: PushTriple = { providerId, modelId, isAutoMode };
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
        isAutoMode: state.isAutoMode
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

  useEffect(() => {
    if (!bootPullSettled) return;
    const next: PushTriple = { providerId, modelId, isAutoMode };
    if (lastPushed && samePush(lastPushed, next)) return;
    lastPushed = next;
    userPushedSinceBoot = true;
    if (window.electronAPI?.updateActiveModelConfig) {
      window.electronAPI.updateActiveModelConfig(next).catch((err) => {
        lastPushed = null;
        console.warn('[ACTIVE-MODEL-SYNC] Error synchronizing active model:', err);
      });
    }
  }, [providerId, modelId, isAutoMode]);
}

// Module-level listener to guarantee sync even on store rehydration or non-React changes.
// Gated until the boot pull settles (rehydration must not echo the adopted lock).
if (typeof window !== 'undefined') {
  useActiveModelStore.subscribe((state, prevState) => {
    if (!bootPullSettled) return;
    if (
      state.providerId !== prevState.providerId ||
      state.modelId !== prevState.modelId ||
      state.isAutoMode !== prevState.isAutoMode
    ) {
      const next: PushTriple = {
        providerId: state.providerId,
        modelId: state.modelId,
        isAutoMode: state.isAutoMode
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
          const adopted: PushTriple = { providerId, modelId, isAutoMode };
          // Mark as already-pushed BEFORE touching state so the reactive
          // paths treat the adoption as settled (no echo to main).
          lastPushed = adopted;
          const current = useActiveModelStore.getState();
          if (!samePush({ providerId: current.providerId, modelId: current.modelId, isAutoMode: current.isAutoMode }, adopted)) {
            useActiveModelStore.setState({
              providerId: adopted.providerId,
              modelId: adopted.modelId,
              isAutoMode: adopted.isAutoMode,
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
