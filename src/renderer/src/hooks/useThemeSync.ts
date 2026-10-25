import { useEffect, useState } from 'react';

export type AppTheme =
  | 'dark' | 'light' | 'high-contrast'
  | 'obsidian-night' | 'glacial-graphite' | 'sapphire-deep' | 'emerald-deep' | 'amethyst-deep'
  | 'reuben-ruby' | 'simeon-topaz' | 'levi-emerald' | 'judah-turquoise' | 'dan-sapphire'
  | 'naphtali-jacynth' | 'gad-agate' | 'asher-beryl' | 'issachar-lapis' | 'zebulun-diamond'
  | 'joseph-onyx' | 'benjamin-jasper';

export interface AppThemeMeta {
  id: AppTheme;
  label: string;
  group: 'Dark' | 'Light' | 'High contrast';
  swatch: string;
}

export const APP_THEMES: AppThemeMeta[] = [
  { id: 'dark', label: 'Midnight (default)', group: 'Dark', swatch: '#8b5cf6' },
  { id: 'obsidian-night', label: 'Obsidian Night', group: 'Dark', swatch: '#38bdf8' },
  { id: 'glacial-graphite', label: 'Glacial Graphite', group: 'Dark', swatch: '#7dd3fc' },
  { id: 'sapphire-deep', label: 'Sapphire Deep', group: 'Dark', swatch: '#60a5fa' },
  { id: 'emerald-deep', label: 'Emerald Deep', group: 'Dark', swatch: '#34d399' },
  { id: 'amethyst-deep', label: 'Amethyst Deep', group: 'Dark', swatch: '#a78bfa' },
  { id: 'reuben-ruby', label: 'Reuben · Ruby', group: 'Light', swatch: '#9f1239' },
  { id: 'simeon-topaz', label: 'Simeon · Topaz', group: 'Light', swatch: '#a16207' },
  { id: 'levi-emerald', label: 'Levi · Emerald', group: 'Light', swatch: '#047857' },
  { id: 'judah-turquoise', label: 'Judah · Turquoise', group: 'Light', swatch: '#0e7490' },
  { id: 'dan-sapphire', label: 'Dan · Sapphire', group: 'Light', swatch: '#1d4ed8' },
  { id: 'naphtali-jacynth', label: 'Naphtali · Jacynth', group: 'Light', swatch: '#6d28d9' },
  { id: 'gad-agate', label: 'Gad · Agate', group: 'Light', swatch: '#9a4a26' },
  { id: 'asher-beryl', label: 'Asher · Beryl', group: 'Light', swatch: '#0d9488' },
  { id: 'issachar-lapis', label: 'Issachar · Lapis', group: 'Light', swatch: '#3730a3' },
  { id: 'zebulun-diamond', label: 'Zebulun · Diamond', group: 'Light', swatch: '#0284c7' },
  { id: 'joseph-onyx', label: 'Joseph · Onyx', group: 'Light', swatch: '#1f2937' },
  { id: 'benjamin-jasper', label: 'Benjamin · Jasper', group: 'Light', swatch: '#9a3412' },
  { id: 'high-contrast', label: 'High Contrast', group: 'High contrast', swatch: '#ffff00' }
];

export const normalizeAppTheme = (value: string | null | undefined): AppTheme =>
  APP_THEMES.some((t) => t.id === value) ? (value as AppTheme) : 'dark';

export const applyAppTheme = (theme: AppTheme, persist = true): void => {
  if (typeof document === 'undefined') return;
  for (const t of APP_THEMES) {
    document.body.classList.remove(`theme-${t.id}`);
  }
  document.body.classList.add(`theme-${theme}`);

  const meta = APP_THEMES.find((t) => t.id === theme);
  document.body.classList.remove('theme-group-dark', 'theme-group-light', 'theme-group-hc');
  if (meta?.group === 'Light') {
    document.body.classList.add('theme-group-light');
  } else if (meta?.group === 'High contrast') {
    document.body.classList.add('theme-group-hc');
  } else {
    document.body.classList.add('theme-group-dark');
  }

  if (persist && typeof localStorage !== 'undefined') {
    try {
      localStorage.setItem('ty_claude_theme', theme);
    } catch {
      // quota or private mode fallback
    }
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('ty-theme-change', { detail: theme }));
    if (window.electronAPI?.debuggerSyncState) {
      void window.electronAPI.debuggerSyncState({ theme });
    }
  }
};

export const getMonacoTheme = (theme: AppTheme): 'vs' | 'vs-dark' | 'hc-black' => {
  const meta = APP_THEMES.find((t) => t.id === theme);
  if (meta?.group === 'Light') return 'vs';
  if (meta?.group === 'High contrast') return 'hc-black';
  return 'vs-dark';
};

export const getStoredTheme = (): AppTheme => {
  if (typeof localStorage === 'undefined') return 'dark';
  try {
    return normalizeAppTheme(localStorage.getItem('ty_claude_theme'));
  } catch {
    return 'dark';
  }
};

/**
 * Universal theme synchronization hook.
 * Works across both the main workbench window and standalone popout windows (such as Omni-Debugger).
 * Automatically responds to:
 * - Direct intra-window theme changes ('ty-theme-change')
 * - Cross-window storage events ('storage')
 * - Window focus events (picks up theme changed while window was unfocused)
 * - IPC debugger:state-synced payloads carrying the active theme
 */
export const useThemeSync = (): AppTheme => {
  const [theme, setTheme] = useState<AppTheme>(getStoredTheme);

  useEffect(() => {
    // 1. Initial application on mount
    const initial = getStoredTheme();
    applyAppTheme(initial, false);
    setTheme(initial);

    // 2. Cross-window storage listener
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'ty_claude_theme' && e.newValue) {
        const next = normalizeAppTheme(e.newValue);
        applyAppTheme(next, false);
        setTheme(next);
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Intra-window custom event listener
    const handleCustomEvent = (e: Event) => {
      const customEvent = e as CustomEvent<AppTheme>;
      // NOTE: applyAppTheme() dispatches 'ty-theme-change' on every
      // application, so re-applying here would echo the event back and
      // recurse forever (blank window via RangeError). The dispatcher
      // already applied the body classes - just adopt the new value.
      if (customEvent.detail) {
        const next = normalizeAppTheme(customEvent.detail);
        setTheme(next);
      }
    };
    window.addEventListener('ty-theme-change', handleCustomEvent);

    // 4. Focus sync listener
    const handleFocus = () => {
      const current = getStoredTheme();
      applyAppTheme(current, false);
      setTheme(current);
    };
    window.addEventListener('focus', handleFocus);

    // 5. IPC listener for debugger:state-synced
    const unsubscribeIpc = window.electronAPI?.onDebuggerStateSynced?.((state: any) => {
      if (state?.theme) {
        const next = normalizeAppTheme(state.theme);
        applyAppTheme(next, true);
        setTheme(next);
      }
    });

    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener('ty-theme-change', handleCustomEvent);
      window.removeEventListener('focus', handleFocus);
      unsubscribeIpc?.();
    };
  }, []);

  return theme;
};
