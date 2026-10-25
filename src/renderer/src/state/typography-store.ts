import { create } from 'zustand';
import type { CSSProperties } from 'react';

/**
 * Typography & Motion store (Prompt 1)
 *
 * Owns the four user-adjustable chat typography preferences and persists them
 * through the existing settings channel (`settings.editor.*`), so no new
 * persistence mechanism is introduced. The store subscribes to
 * `settings:changed` once (module scope) and re-hydrates idempotently.
 */

export type ChatFontFamily = 'sans' | 'serif' | 'mono' | 'plex';

export const CHAT_FONT_FAMILY_OPTIONS: Array<{ value: ChatFontFamily; label: string }> = [
  { value: 'sans', label: 'System Sans' },
  { value: 'serif', label: 'Serif (Georgia)' },
  { value: 'mono', label: 'Monospace (JetBrains Mono / Cascadia Code)' },
  { value: 'plex', label: 'IBM Plex Sans' }
];

export const CHAT_FONT_FAMILY_STACKS: Record<ChatFontFamily, string> = {
  sans: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  plex: "'IBM Plex Sans', 'Inter', 'Segoe UI', system-ui, sans-serif"
};

export const CHAT_FONT_SIZE_MIN = 12;
export const CHAT_FONT_SIZE_MAX = 18;
export const CHAT_FONT_SIZE_DEFAULT = 14;
export const CHAT_LINE_HEIGHT = 1.65;

interface TypographyState {
  hydrated: boolean;
  chatFontFamily: ChatFontFamily;
  chatFontSize: number;
  matrixDecodeEnabled: boolean;
  ukPunctuationEnabled: boolean;
  hydrate: () => Promise<void>;
  setChatFontFamily: (family: ChatFontFamily) => Promise<void>;
  setChatFontSize: (size: number) => Promise<void>;
  setMatrixDecodeEnabled: (enabled: boolean) => Promise<void>;
  setUkPunctuationEnabled: (enabled: boolean) => Promise<void>;
}

const DEFAULTS = {
  chatFontFamily: 'sans' as ChatFontFamily,
  chatFontSize: CHAT_FONT_SIZE_DEFAULT,
  matrixDecodeEnabled: true,
  ukPunctuationEnabled: true
};

let settingsChangedUnsubscribe: (() => void) | null = null;

async function persist(patch: {
  chatFontFamily?: ChatFontFamily;
  chatFontSize?: number;
  matrixDecodeEnabled?: boolean;
  ukPunctuationEnabled?: boolean;
}): Promise<boolean> {
  try {
    if (!window.electronAPI?.saveSettings) return false;
    const response = await window.electronAPI.saveSettings({ editor: patch });
    return Boolean(response?.success);
  } catch {
    return false;
  }
}

export const useTypographyStore = create<TypographyState>((set) => ({
  hydrated: false,
  chatFontFamily: DEFAULTS.chatFontFamily,
  chatFontSize: DEFAULTS.chatFontSize,
  matrixDecodeEnabled: DEFAULTS.matrixDecodeEnabled,
  ukPunctuationEnabled: DEFAULTS.ukPunctuationEnabled,

  hydrate: async () => {
    try {
      const response = await window.electronAPI.getSettings();
      const editor = (response.success && response.data
        ? (response.data as { editor?: Record<string, unknown> }).editor
        : undefined) || {};
      set({
        hydrated: true,
        chatFontFamily: normalizeFamily(editor.chatFontFamily) ?? DEFAULTS.chatFontFamily,
        chatFontSize: normalizeSize(editor.chatFontSize) ?? DEFAULTS.chatFontSize,
        matrixDecodeEnabled: typeof editor.matrixDecodeEnabled === 'boolean'
          ? editor.matrixDecodeEnabled
          : DEFAULTS.matrixDecodeEnabled,
        ukPunctuationEnabled: typeof editor.ukPunctuationEnabled === 'boolean'
          ? editor.ukPunctuationEnabled
          : DEFAULTS.ukPunctuationEnabled
      });
    } catch {
      set({ hydrated: true });
    }
  },

  setChatFontFamily: async (family) => {
    set({ chatFontFamily: family });
    await persist({ chatFontFamily: family });
  },

  setChatFontSize: async (size) => {
    const clamped = normalizeSize(size);
    if (clamped === undefined) return;
    set({ chatFontSize: clamped });
    await persist({ chatFontSize: clamped });
  },

  setMatrixDecodeEnabled: async (enabled) => {
    set({ matrixDecodeEnabled: enabled });
    await persist({ matrixDecodeEnabled: enabled });
  },

  setUkPunctuationEnabled: async (enabled) => {
    set({ ukPunctuationEnabled: enabled });
    await persist({ ukPunctuationEnabled: enabled });
  }
}));

function normalizeFamily(value: unknown): ChatFontFamily | undefined {
  return value === 'sans' || value === 'serif' || value === 'mono' || value === 'plex' ? value : undefined;
}

function normalizeSize(value: unknown): number | undefined {
  const size = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(size)) return undefined;
  return Math.min(CHAT_FONT_SIZE_MAX, Math.max(CHAT_FONT_SIZE_MIN, Math.round(size)));
}

/**
 * CSS variable bundle placed on the chat message container. Downstream markdown
 * elements read these variables, so a typography change only re-styles the
 * container — worker plumbing and streaming content are untouched.
 */
export function buildChatTypographyStyle(
  chatFontFamily: ChatFontFamily,
  chatFontSize: number
): CSSProperties {
  return {
    '--chat-font-family': CHAT_FONT_FAMILY_STACKS[chatFontFamily],
    '--chat-font-size': `${chatFontSize}px`,
    '--chat-line-height': `${CHAT_LINE_HEIGHT}`
  } as CSSProperties;
}

/**
 * Attach the `settings:changed` listener once from anywhere (App boot). Note we
 * deliberately forward to `hydrate` (non-echoing, idempotent).
 */
export function initTypographyStore(): void {
  if (settingsChangedUnsubscribe || !window.electronAPI?.onSettingsChanged) return;
  settingsChangedUnsubscribe = window.electronAPI.onSettingsChanged(() => {
    void useTypographyStore.getState().hydrate();
  });
}
