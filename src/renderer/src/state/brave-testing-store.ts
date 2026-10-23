/**
 * Brave Browser Local Testing State Store
 *
 * Implements atomic Zustand state management for AI-driven local testing sessions.
 * Conforms to the Ty-Code Architecture Guide: atomic selectors, predictable mutations,
 * and automatic IPC synchronization with the Electron main process.
 *
 * Brand: Ty-Code
 */

import { create } from 'zustand';
import { useEffect } from 'react';
import type { BraveTestingState } from '../../../shared/types/brave-testing';

export interface BraveTestingStoreState {
  active: boolean;
  url: string;
  title: string;
  status: number | null;
  isLoading: boolean;
  error: string | null;
  refreshTrigger: number;

  // Actions
  startTesting: (url: string, openVisibleWindow?: boolean) => Promise<void>;
  stopTesting: () => Promise<void>;
  refresh: () => void;
  setUrl: (url: string) => void;
  updateState: (update: Partial<BraveTestingState>) => void;
}

export const useBraveTestingStore = create<BraveTestingStoreState>((set, get) => ({
  active: false,
  url: 'http://localhost:3000',
  title: 'Idle',
  status: null,
  isLoading: false,
  error: null,
  refreshTrigger: 0,

  startTesting: async (targetUrl: string, openVisibleWindow = false) => {
    const trimmed = targetUrl.trim();
    if (!trimmed) return;

    set({ isLoading: true, error: null, url: trimmed });

    try {
      if (window.electronAPI?.startBraveTesting) {
        const res = await window.electronAPI.startBraveTesting(trimmed, { openVisibleWindow });
        if (res.success && res.data) {
          set({
            active: true,
            url: res.data.url,
            title: res.data.title || 'Testing Active',
            status: res.data.status ?? 200,
            isLoading: false
          });
        } else {
          set({
            error: res.error || 'Failed to start testing session',
            isLoading: false
          });
        }
      } else {
        // Fallback for standalone/mock web context
        set({
          active: true,
          url: trimmed,
          title: 'Simulated Local Testing',
          status: 200,
          isLoading: false
        });
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      set({ error, isLoading: false });
    }
  },

  stopTesting: async () => {
    set({ isLoading: true });
    try {
      if (window.electronAPI?.stopBraveTesting) {
        await window.electronAPI.stopBraveTesting();
      }
      set({
        active: false,
        title: 'Testing Stopped',
        status: null,
        isLoading: false,
        error: null
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      set({ error, isLoading: false });
    }
  },

  refresh: () => {
    set((state) => ({ refreshTrigger: state.refreshTrigger + 1 }));
  },

  setUrl: (url: string) => {
    set({ url });
  },

  updateState: (update: Partial<BraveTestingState>) => {
    set((state) => ({
      active: typeof update.active === 'boolean' ? update.active : state.active,
      url: update.url !== undefined ? update.url : state.url,
      title: update.title !== undefined ? update.title : state.title,
      status: update.status !== undefined ? update.status : state.status,
      error: update.error !== undefined ? update.error : state.error
    }));
  }
}));

// Atomic Selectors for component rendering isolation
export const useBraveTestingActive = () => useBraveTestingStore((s) => s.active);
export const useBraveTestingUrl = () => useBraveTestingStore((s) => s.url);
export const useBraveTestingTitle = () => useBraveTestingStore((s) => s.title);
export const useBraveTestingStatus = () => useBraveTestingStore((s) => s.status);
export const useBraveTestingLoading = () => useBraveTestingStore((s) => s.isLoading);
export const useBraveTestingError = () => useBraveTestingStore((s) => s.error);
export const useBraveTestingRefreshTrigger = () => useBraveTestingStore((s) => s.refreshTrigger);

/**
 * Hook to automatically subscribe the renderer to main-process testing state updates.
 */
export function useBraveTestingSync(): void {
  useEffect(() => {
    if (!window.electronAPI?.onBraveTestingUpdate) return;

    const unsubscribe = window.electronAPI.onBraveTestingUpdate((data) => {
      useBraveTestingStore.getState().updateState(data);
    });

    return () => {
      unsubscribe();
    };
  }, []);
}
