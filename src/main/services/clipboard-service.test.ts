/**
 * Clipboard service contract tests (Prompt 3: Copy Pipeline).
 *
 * Proves the "never silent" rule: a copy either verifies or returns a
 * concrete reason. Runs in pure Node — no Electron, no fixtures.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  CLIPBOARD_MAX_CHARS,
  ClipboardWritePayloadSchema,
  clearClipboardAuditTrail,
  createInMemoryClipboard,
  getClipboardAuditTrail,
  readClipboardText,
  registerClipboardBackend,
  writeClipboardText
} from './clipboard-service';

describe('clipboard service (Prompt 3)', () => {
  beforeEach(() => {
    clearClipboardAuditTrail();
    registerClipboardBackend(createInMemoryClipboard());
  });

  afterEach(() => {
    registerClipboardBackend(null);
  });

  describe('payload validation', () => {
    it('accepts exact text and preserves whitespace verbatim', () => {
      const exact = '  line one\n\tline two  \n';
      const result = writeClipboardText(exact, 'code-block');

      expect(result.ok).toBe(true);
      expect(result.verified).toBe(true);
      expect(result.chars).toBe(exact.length);
      // No trimming, no normalisation: the transport layer is exact.
      expect(readClipboardText('assert').text).toBe(exact);
    });

    it('accepts an empty string (clearing the clipboard is a valid write)', () => {
      const result = writeClipboardText('', 'clear');

      expect(result.ok).toBe(true);
      expect(result.chars).toBe(0);
    });

    it('rejects non-string payloads with invalid_payload, not a throw', () => {
      const result = writeClipboardText({ not: 'a string' } as unknown, 'message-footer');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('invalid_payload');
      expect(result.error).toBeTruthy();
    });

    it('rejects payloads above the bound', () => {
      const oversized = 'x'.repeat(CLIPBOARD_MAX_CHARS + 1);

      expect(ClipboardWritePayloadSchema.safeParse({ text: oversized }).success).toBe(false);
      expect(writeClipboardText(oversized, 'bulk').ok).toBe(false);
    });
  });

  describe('never-silent failure modes', () => {
    it('reports write_threw when the backend throws', () => {
      registerClipboardBackend(createInMemoryClipboard({ failWrites: true }));

      const result = writeClipboardText('payload', 'terminal-selection');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('write_threw');
      expect(result.error).toContain('Simulated clipboard write failure');
    });

    it('reports unverified when the write silently did not land', () => {
      registerClipboardBackend(createInMemoryClipboard({ ignoreWrites: true }));

      const result = writeClipboardText('payload', 'message-footer');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('unverified');
      expect(result.verified).toBe(false);
    });

    it('succeeds with verified:false when writes work but read-back is blocked', () => {
      registerClipboardBackend(createInMemoryClipboard({ failReads: true }));

      const result = writeClipboardText('payload', 'remote-session');

      // Write did not throw; a blocked read must not be reported as failure,
      // but must not claim verification either.
      expect(result.ok).toBe(true);
      expect(result.verified).toBe(false);
      expect(result.reason).toBe('read_threw');
    });

    it('reports no_backend when nothing is registered', () => {
      registerClipboardBackend(null);

      const result = writeClipboardText('payload', 'boot-race');

      expect(result.ok).toBe(false);
      expect(result.reason).toBe('no_backend');
    });

    it('readClipboardText returns ok:false with a reason instead of throwing', () => {
      registerClipboardBackend(createInMemoryClipboard({ failReads: true }));

      const result = readClipboardText('key-input');

      expect(result.ok).toBe(false);
      expect(result.text).toBe('');
      expect(result.reason).toBe('read_threw');
    });
  });

  describe('audit ring', () => {
    it('records outcomes without storing clipboard content', () => {
      writeClipboardText('super-secret-api-key', 'byok-wizard');
      registerClipboardBackend(createInMemoryClipboard({ failWrites: true }));
      writeClipboardText('another-secret', 'diagnostics');

      const trail = getClipboardAuditTrail();

      expect(trail.length).toBe(2);
      // Newest first.
      expect(trail[0].ok).toBe(false);
      expect(trail[0].reason).toBe('write_threw');
      expect(trail[1].ok).toBe(true);
      expect(trail[1].source).toBe('byok-wizard');
      expect(trail[1].chars).toBe('super-secret-api-key'.length);

      // PRIVACY: no entry may contain the copied text.
      const serialized = JSON.stringify(trail);
      expect(serialized).not.toContain('super-secret-api-key');
      expect(serialized).not.toContain('another-secret');
    });

    it('stays bounded under repeated copies', () => {
      for (let i = 0; i < 200; i++) writeClipboardText(`copy-${i}`, 'loop');

      expect(getClipboardAuditTrail().length).toBeLessThanOrEqual(24);
      expect(getClipboardAuditTrail()[0].source).toBe('loop');
    });

    it('clears on demand', () => {
      writeClipboardText('payload', 'x');
      clearClipboardAuditTrail();

      expect(getClipboardAuditTrail()).toEqual([]);
    });
  });
});
