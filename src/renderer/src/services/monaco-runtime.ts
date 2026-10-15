import { useSyncExternalStore } from 'react';
import { loader } from '@monaco-editor/react';
export type MonacoRuntimeSnapshot = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  monaco: typeof import('monaco-editor') | null;
  error: string | null;
};

let snapshot: MonacoRuntimeSnapshot = { status: 'idle', monaco: null, error: null };
let loadPromise: Promise<typeof import('monaco-editor')> | null = null;
const listeners = new Set<() => void>();

function updateSnapshot(next: MonacoRuntimeSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMonacoRuntime(): MonacoRuntimeSnapshot {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Load Monaco and its local workers only when a feature first needs an editor. */
export function ensureMonaco(): Promise<typeof import('monaco-editor')> {
  if (snapshot.monaco) return Promise.resolve(snapshot.monaco);
  if (loadPromise) return loadPromise;

  updateSnapshot({ status: 'loading', monaco: null, error: null });
  loadPromise = (async () => {
    try {
      await import('./monaco-workers');
      const monaco = await import('monaco-editor');
      loader.config({ monaco });
      updateSnapshot({ status: 'ready', monaco, error: null });
      return monaco;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateSnapshot({ status: 'error', monaco: null, error: message });
      loadPromise = null;
      throw error;
    }
  })();
  return loadPromise;
}

