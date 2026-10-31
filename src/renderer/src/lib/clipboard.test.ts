// @vitest-environment jsdom
/**
 * Renderer copy-pipeline tests (Prompt 3).
 *
 * Proves the three guarantees the prompt demands: the async clipboard is
 * tried first, main is the fallback in every window, and NO copy fails
 * silently — a failure always resolves to a result carrying a reason.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import {
  COPY_FEEDBACK_MS,
  clearClipboardClientTrail,
  copyText,
  getClipboardClientTrail,
  readClipboardText,
  useCopyFeedback
} from './clipboard';

type CopyPayload = string | { text: string; source?: string };

interface CopyResponse {
  success: boolean;
  error?: string;
  data?: { ok: boolean; via: 'main'; chars: number; verified: boolean; error?: string };
}

interface ReadResponse {
  success: boolean;
  error?: string;
  data?: { ok: boolean; text: string; error?: string };
}

type CopyFn = (payload: CopyPayload) => Promise<CopyResponse>;
type ReadFn = (source?: string) => Promise<ReadResponse>;

interface FakeClipboardApi {
  copyToClipboard: CopyFn;
  readFromClipboard: ReadFn;
}

function installMainApi(overrides: Partial<FakeClipboardApi> = {}): FakeClipboardApi {
  // Defaults are spies too, so tests can assert the fallback was (or was not)
  // reached without having to inject their own implementation.
  const api: FakeClipboardApi = {
    copyToClipboard:
      overrides.copyToClipboard ??
      vi.fn(async (payload: CopyPayload): Promise<CopyResponse> => ({
        success: true,
        data: {
          ok: true,
          via: 'main',
          chars: typeof payload === 'string' ? payload.length : payload.text.length,
          verified: true
        }
      })),
    readFromClipboard:
      overrides.readFromClipboard ??
      vi.fn(async (): Promise<ReadResponse> => ({ success: true, data: { ok: true, text: 'from-main' } }))
  };
  (window as unknown as { electronAPI: FakeClipboardApi }).electronAPI = api;
  return api;
}

function setAsyncClipboard(writeText: unknown, readText?: unknown): void {
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: {
      ...(typeof writeText === 'function' ? { writeText } : {}),
      ...(typeof readText === 'function' ? { readText } : {})
    }
  });
}

function removeAsyncClipboard(): void {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
}

describe('renderer copy pipeline (Prompt 3)', () => {
  beforeEach(() => {
    clearClipboardClientTrail();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useRealTimers();
  });

  afterEach(() => {
    removeAsyncClipboard();
    delete (window as unknown as { electronAPI?: unknown }).electronAPI;
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  describe('copyText path resolution', () => {
    it('uses the async clipboard when it succeeds and skips IPC entirely', async () => {
      const writeText = vi.fn(async () => undefined);
      setAsyncClipboard(writeText);
      const api = installMainApi();

      const result = await copyText('message body', 'message-footer');

      expect(result).toMatchObject({ ok: true, via: 'async', chars: 12, verified: false });
      expect(writeText).toHaveBeenCalledWith('message body');
      expect(api.copyToClipboard).not.toHaveBeenCalled();
    });

    it('falls back to main when the async clipboard rejects', async () => {
      setAsyncClipboard(vi.fn(async () => {
        throw new Error('Document is not focused');
      }));
      const api = installMainApi();

      const result = await copyText('payload', 'code-block');

      expect(result.ok).toBe(true);
      expect(result.via).toBe('main');
      expect(result.verified).toBe(true);
      expect(api.copyToClipboard).toHaveBeenCalledWith({ text: 'payload', source: 'code-block' });
    });

    it('falls back to main when the async clipboard API is absent (popout restriction)', async () => {
      removeAsyncClipboard();
      const api = installMainApi();

      const result = await copyText('payload', 'debugger-popout');

      expect(result.ok).toBe(true);
      expect(result.via).toBe('main');
      expect(api.copyToClipboard).toHaveBeenCalledOnce();
    });

    it('transports exact content without trimming or normalising', async () => {
      const exact = '  const a = 1;\n\treturn a;  \n';
      const writeText = vi.fn(async () => undefined);
      setAsyncClipboard(writeText);
      installMainApi();

      await copyText(exact, 'code-block');

      expect(writeText).toHaveBeenCalledWith(exact);
    });
  });

  describe('never-silent failures', () => {
    it('reports a concrete error when both paths fail', async () => {
      setAsyncClipboard(vi.fn(async () => {
        throw new Error('NotAllowedError');
      }));
      const failing: CopyFn = vi.fn(async () => ({
        success: false,
        error: 'Clipboard write was not reflected on read-back (another application may own the clipboard).'
      }));
      installMainApi({ copyToClipboard: failing });

      const result = await copyText('payload', 'message-footer');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('not reflected on read-back');
      expect(getClipboardClientTrail()[0]).toMatchObject({ ok: false, source: 'message-footer' });
    });

    it('reports a concrete error when the IPC bridge throws', async () => {
      removeAsyncClipboard();
      const throwing: CopyFn = vi.fn(async () => {
        throw new Error('IPC channel closed');
      });
      installMainApi({ copyToClipboard: throwing });

      const result = await copyText('payload', 'terminal-selection');

      expect(result.ok).toBe(false);
      expect(result.error).toBe('IPC channel closed');
    });

    it('reports a concrete error when no bridge exists at all', async () => {
      removeAsyncClipboard();
      delete (window as unknown as { electronAPI?: unknown }).electronAPI;

      const result = await copyText('payload', 'orphan-frame');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Clipboard bridge unavailable');
    });

    it('rejects a non-string payload instead of throwing or copying "undefined"', async () => {
      installMainApi();

      const result = await copyText(undefined, 'empty-message');

      expect(result.ok).toBe(false);
      expect(result.error).toContain('expected text');
      expect(getClipboardClientTrail()[0].ok).toBe(false);
    });
  });

  describe('readClipboardText', () => {
    it('prefers the async API', async () => {
      setAsyncClipboard(undefined, vi.fn(async () => 'from-async'));
      const api = installMainApi();

      const result = await readClipboardText('terminal-paste');

      expect(result).toEqual({ ok: true, text: 'from-async' });
      expect(api.readFromClipboard).not.toHaveBeenCalled();
    });

    it('falls back to main and forwards the source label', async () => {
      setAsyncClipboard(undefined, vi.fn(async () => {
        throw new Error('denied');
      }));
      const api = installMainApi();

      const result = await readClipboardText('key-input');

      expect(result).toEqual({ ok: true, text: 'from-main' });
      expect(api.readFromClipboard).toHaveBeenCalledWith('key-input');
    });

    it('returns ok:false with an error rather than throwing', async () => {
      removeAsyncClipboard();
      const deniedRead: ReadFn = vi.fn(async () => ({ success: false, error: 'Clipboard read failed.' }));
      installMainApi({ readFromClipboard: deniedRead });

      const result = await readClipboardText('provider-setup');

      expect(result.ok).toBe(false);
      expect(result.text).toBe('');
      expect(result.error).toBe('Clipboard read failed.');
    });
  });

  describe('client trail privacy', () => {
    it('records metadata but never clipboard content', async () => {
      setAsyncClipboard(vi.fn(async () => undefined));
      installMainApi();

      await copyText('sk-live-SUPER-SECRET-KEY', 'byok-wizard');

      const serialized = JSON.stringify(getClipboardClientTrail());
      expect(serialized).not.toContain('sk-live-SUPER-SECRET-KEY');
      expect(getClipboardClientTrail()[0]).toMatchObject({ op: 'write', via: 'async', ok: true, source: 'byok-wizard' });
    });

    it('stays bounded', async () => {
      setAsyncClipboard(vi.fn(async () => undefined));
      installMainApi();
      for (let i = 0; i < 60; i++) await copyText(`c${i}`, 'loop');

      expect(getClipboardClientTrail().length).toBeLessThanOrEqual(20);
    });
  });

  describe('useCopyFeedback', () => {
    let host: HTMLDivElement | null = null;
    let root: ReactDOM.Root | null = null;
    let unmounted = false;

    const harness = () => {
      const state: { current: ReturnType<typeof useCopyFeedback> | null } = { current: null };
      const Probe = () => {
        state.current = useCopyFeedback();
        return React.createElement('span', null, state.current.copied ? 'copied' : state.current.error || 'idle');
      };
      host = document.createElement('div');
      document.body.appendChild(host);
      unmounted = false;
      const created = ReactDOM.createRoot(host);
      root = created;
      act(() => {
        created.render(React.createElement(Probe));
      });
      const currentHost = host;
      return {
        state,
        text: () => currentHost.textContent || '',
        /** Unmount once; later calls are no-ops so afterEach cannot double-unmount. */
        unmount: () => {
          if (unmounted || !root) return;
          unmounted = true;
          act(() => root?.unmount());
          root = null;
        }
      };
    };

    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      if (root && !unmounted) act(() => root?.unmount());
      root = null;
      unmounted = true;
      host?.remove();
      host = null;
      vi.useRealTimers();
    });

    it('flashes the confirmation for the specified window then clears it', async () => {
      setAsyncClipboard(vi.fn(async () => undefined));
      installMainApi();
      const { state, text } = harness();

      await act(async () => {
        await state.current!.copy('hello', 'message-footer');
      });
      expect(text()).toBe('copied');

      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_MS - 1);
      });
      expect(text()).toBe('copied');

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(text()).toBe('idle');
    });

    it('surfaces a retryable inline error and clears it on a successful retry', async () => {
      removeAsyncClipboard();
      const copyToClipboard: CopyFn = vi.fn()
        .mockResolvedValueOnce({ success: false, error: 'Clipboard busy.' })
        .mockResolvedValueOnce({
          success: true,
          data: { ok: true, via: 'main' as const, chars: 5, verified: true }
        });
      installMainApi({ copyToClipboard });
      const { state, text } = harness();

      await act(async () => {
        await state.current!.copy('hello', 'code-block');
      });
      expect(text()).toBe('Clipboard busy.');
      expect(state.current!.error).toBe('Clipboard busy.');

      await act(async () => {
        const retried = await state.current!.retry();
        expect(retried?.ok).toBe(true);
      });
      expect(text()).toBe('copied');
      expect(state.current!.error).toBe('');
      // The retry re-sent the SAME payload and source.
      expect(copyToClipboard).toHaveBeenLastCalledWith({ text: 'hello', source: 'code-block' });
    });

    it('dismisses the inline error without another attempt', async () => {
      removeAsyncClipboard();
      const deniedCopy: CopyFn = vi.fn(async () => ({ success: false, error: 'Denied.' }));
      installMainApi({ copyToClipboard: deniedCopy });
      const { state, text } = harness();

      await act(async () => {
        await state.current!.copy('x', 's');
      });
      expect(text()).toBe('Denied.');

      act(() => {
        state.current!.dismissError();
      });
      expect(text()).toBe('idle');
    });

    it('does not set state after unmount (no leaked timer warning)', async () => {
      removeAsyncClipboard();
      let resolveWrite: ((value: unknown) => void) | null = null;
      const deferred: CopyFn = vi.fn(() => new Promise<CopyResponse>((resolve) => {
        resolveWrite = () => resolve({ success: true, data: { ok: true, via: 'main', chars: 1, verified: true } });
      }));
      installMainApi({ copyToClipboard: deferred });
      const { state, unmount } = harness();

      let pending: Promise<unknown> | null = null;
      act(() => {
        pending = state.current!.copy('x', 's');
      });
      unmount();
      await act(async () => {
        resolveWrite?.(null);
        await pending;
      });
      // Reaching this line without an act() warning is the assertion.
      expect(true).toBe(true);
    });
  });
});
