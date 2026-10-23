/**
 * Unified Model Selection State (Prompt 2: Fix Routing & Ensure Models Work Across All Features)
 *
 * Manages the globally selected model across Chat Sidecar, Omni-Debugger, and M3E Canvas.
 * Synchronizes with ProviderGateway in the Main Process via IPC.
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
        try {
          if (window.electronAPI?.updateActiveModelConfig) {
            await window.electronAPI.updateActiveModelConfig({
              providerId,
              modelId,
              isAutoMode
            });
          }
        } catch (err: unknown) {
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
 */
export function useActiveModelSync(): void {
  const providerId = useActiveModelStore((s) => s.providerId);
  const modelId = useActiveModelStore((s) => s.modelId);
  const isAutoMode = useActiveModelStore((s) => s.isAutoMode);

  useEffect(() => {
    if (window.electronAPI?.updateActiveModelConfig) {
      window.electronAPI.updateActiveModelConfig({
        providerId,
        modelId,
        isAutoMode
      }).catch((err) => {
        console.warn('[ACTIVE-MODEL-SYNC] Error synchronizing active model:', err);
      });
    }
  }, [providerId, modelId, isAutoMode]);
}

// Module-level listener to guarantee sync even on store rehydration or non-React changes
if (typeof window !== 'undefined') {
  useActiveModelStore.subscribe((state, prevState) => {
    if (
      state.providerId !== prevState.providerId ||
      state.modelId !== prevState.modelId ||
      state.isAutoMode !== prevState.isAutoMode
    ) {
      if (window.electronAPI?.updateActiveModelConfig) {
        window.electronAPI.updateActiveModelConfig({
          providerId: state.providerId,
          modelId: state.modelId,
          isAutoMode: state.isAutoMode
        }).catch(() => {});
      }
    }
  });
}
