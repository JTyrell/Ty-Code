/**
 * Renderer clipboard client (Prompt 3: Copy Pipeline)
 *
 * ONE copy path for the whole renderer. Every copy surface — message footer,
 * code block, Agent Activity raw tool result, terminal selection, diagnostics,
 * settings — calls `copyText` instead of touching `navigator.clipboard` or
 * `document.execCommand` directly.
 *
 * Resolution order:
 *   1. `navigator.clipboard.writeText` — fast, in-renderer, no IPC.
 *   2. Main-process `clipboard.writeText` via `copyToClipboard` — the fallback
 *      that works when the async API is missing, the document is not focused,
 *      permission is denied, or the window is a popout with a restricted
 *      clipboard permission policy.
 *
 * Contract: this NEVER fails silently. `copyText` resolves to a result object
 * carrying `ok`, the path that landed the copy, and a concrete `error` when
 * both paths failed. Callers surface that error inline and allow retry.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from '../state/toast-store';

/** Which path actually landed the copy. */
export type ClipboardPath = 'async' | 'main';

export interface CopyResult {
  ok: boolean;
  via: ClipboardPath;
  /** Length of the payload that was accepted. 0 on failure. */
  chars: number;
  /** True only when main confirmed the write by reading it back. */
  verified: boolean;
  /** Concrete failure detail. Absent on success. */
  error?: string;
}

export interface ReadResult {
  ok: boolean;
  text: string;
  error?: string;
}

interface TrailEntry {
  timestamp: number;
  op: 'write' | 'read';
  source: string;
  ok: boolean;
  via: ClipboardPath;
  chars: number;
  error?: string;
}

const TRAIL_LIMIT = 20;
const trail: TrailEntry[] = [];

function record(entry: TrailEntry): void {
  trail.push(entry);
  if (trail.length > TRAIL_LIMIT) trail.splice(0, trail.length - TRAIL_LIMIT);
}

/**
 * Newest-first record of clipboard attempts made from THIS window, including
 * the async path that never reaches main. Metadata only — never content.
 */
export function getClipboardClientTrail(): TrailEntry[] {
  return trail.slice().reverse();
}

/** Test seam / diagnostics reset. */
export function clearClipboardClientTrail(): void {
  trail.length = 0;
}

function failure(source: string, error: string): CopyResult {
  record({ timestamp: Date.now(), op: 'write', source, ok: false, via: 'main', chars: 0, error });
  return { ok: false, via: 'main', chars: 0, verified: false, error };
}

async function copyViaMain(text: string, source: string): Promise<CopyResult> {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.copyToClipboard) {
    return failure(source, 'Clipboard bridge unavailable in this window.');
  }
  try {
    const response = await api.copyToClipboard({ text, source });
    if (response?.success) {
      const outcome = response.data;
      record({
        timestamp: Date.now(),
        op: 'write',
        source,
        ok: true,
        via: 'main',
        chars: outcome?.chars ?? text.length
      });
      return {
        ok: true,
        via: 'main',
        chars: outcome?.chars ?? text.length,
        verified: outcome?.verified ?? false
      };
    }
    return failure(source, response?.error || outcomeError(response) || 'Main-process clipboard write failed.');
  } catch (err: unknown) {
    return failure(source, err instanceof Error ? err.message : String(err));
  }
}

function outcomeError(response: unknown): string | undefined {
  const data = (response as { data?: { error?: string } } | null)?.data;
  return typeof data?.error === 'string' ? data.error : undefined;
}

/**
 * Copy exact text to the system clipboard.
 *
 * The payload is transported verbatim: no trimming, no fence stripping, no
 * normalisation. Callers pass the already-final content they want copied
 * (finalised markdown source for a message, raw code without the language
 * fence for a block, raw tool-result JSON for Agent Activity).
 */
export async function copyText(text: unknown, source = 'unspecified'): Promise<CopyResult> {
  if (typeof text !== 'string') {
    return failure(source, 'Nothing to copy: expected text.');
  }

  // Path 1: the async clipboard API. Rejections (missing API, unfocused
  // document, denied permission) fall through to main rather than surfacing.
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      record({ timestamp: Date.now(), op: 'write', source, ok: true, via: 'async', chars: text.length });
      return { ok: true, via: 'async', chars: text.length, verified: false };
    } catch {
      // Deliberately swallowed: main is the authority on whether the copy
      // ultimately failed, and it is the path that verifies.
    }
  }

  // Path 2: main-process clipboard (works in every window, including popouts).
  return copyViaMain(text, source);
}

/**
 * Copy and guarantee the user hears about a failure.
 *
 * Most copy surfaces are one-line handlers with no room for inline error UI;
 * this is the shared "never silent" wrapper for them. It surfaces a toast with
 * a Retry action that replays the exact same payload and source.
 */
export async function copyTextOrNotify(text: unknown, source = 'unspecified'): Promise<CopyResult> {
  const result = await copyText(text, source);
  if (result.ok) return result;
  const message = result.error || 'Copy failed.';
  toast.error('Copy Failed', message, {
    label: 'Retry',
    onClick: () => { void copyTextOrNotify(text, source); }
  });
  return result;
}

/** Read the clipboard, preferring the async API and falling back to main. */
export async function readClipboardText(source = 'unspecified'): Promise<ReadResult> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.readText) {
    try {
      const text = await navigator.clipboard.readText();
      record({ timestamp: Date.now(), op: 'read', source, ok: true, via: 'async', chars: text?.length ?? 0 });
      return { ok: true, text: text ?? '' };
    } catch {
      // Fall through to main.
    }
  }

  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.readFromClipboard) {
    record({ timestamp: Date.now(), op: 'read', source, ok: false, via: 'main', chars: 0, error: 'Clipboard bridge unavailable.' });
    return { ok: false, text: '', error: 'Clipboard bridge unavailable in this window.' };
  }
  try {
    const response = await api.readFromClipboard(source);
    if (response?.success && response.data?.ok) {
      record({ timestamp: Date.now(), op: 'read', source, ok: true, via: 'main', chars: response.data.text.length });
      return { ok: true, text: response.data.text };
    }
    const error = response?.error || response?.data?.error || 'Clipboard read failed.';
    record({ timestamp: Date.now(), op: 'read', source, ok: false, via: 'main', chars: 0, error });
    return { ok: false, text: '', error };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    record({ timestamp: Date.now(), op: 'read', source, ok: false, via: 'main', chars: 0, error });
    return { ok: false, text: '', error };
  }
}

/** Transient "Copied" confirmation window, per the copy-pipeline spec. */
export const COPY_FEEDBACK_MS = 1500;

export interface CopyFeedback {
  /** True for COPY_FEEDBACK_MS after a successful copy. */
  copied: boolean;
  /** Non-empty after a failed copy; cleared on the next attempt. */
  error: string;
  /** Copy and drive the copied/error state. Safe to call from any handler. */
  copy: (text: unknown, source?: string) => Promise<CopyResult>;
  /** Re-run the last failed copy (retry affordance for the inline error). */
  retry: () => Promise<CopyResult | null>;
  /** Drop the inline error without another attempt. */
  dismissError: () => void;
}

/**
 * Shared copy affordance for buttons and context menus.
 *
 * Encapsulates the "Copied" flash and the retryable inline error so all 50+
 * copy surfaces behave identically. All timers are cleared on unmount.
 */
export function useCopyFeedback(): CopyFeedback {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAttempt = useRef<{ text: unknown; source: string } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (flashTimer.current) {
        clearTimeout(flashTimer.current);
        flashTimer.current = null;
      }
    };
  }, []);

  const copy = useCallback(async (text: unknown, source = 'unspecified'): Promise<CopyResult> => {
    lastAttempt.current = { text, source };
    if (flashTimer.current) {
      clearTimeout(flashTimer.current);
      flashTimer.current = null;
    }
    const result = await copyText(text, source);
    if (!mounted.current) return result;
    if (result.ok) {
      setError('');
      setCopied(true);
      flashTimer.current = setTimeout(() => {
        flashTimer.current = null;
        if (mounted.current) setCopied(false);
      }, COPY_FEEDBACK_MS);
    } else {
      setCopied(false);
      // Never silent: the caller renders this inline with a retry affordance.
      setError(result.error || 'Copy failed.');
    }
    return result;
  }, []);

  const retry = useCallback(async (): Promise<CopyResult | null> => {
    const attempt = lastAttempt.current;
    if (!attempt) return null;
    return copy(attempt.text, attempt.source);
  }, [copy]);

  const dismissError = useCallback(() => {
    if (mounted.current) setError('');
  }, []);

  return { copied, error, copy, retry, dismissError };
}
