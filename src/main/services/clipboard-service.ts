/**
 * Clipboard Service (Prompt 3: Copy Pipeline)
 *
 * Single main-process authority for every clipboard write in Ty-Code. The
 * renderer tries `navigator.clipboard` first and falls back here, which is
 * what makes copy work in ALL windows (main, Canvas popout, Debugger popout)
 * and under sandboxed/permission-denied conditions.
 *
 * Design rules enforced here:
 * - NEVER silent. A write either verifies against a read-back or returns a
 *   concrete reason. Electron's `clipboard.writeText` can fail without
 *   throwing (locked workstation, remote session, clipboard owner refusing),
 *   so success is defined as "read back what we wrote".
 * - EXACT content. No trimming, no normalisation, no fence stripping. Callers
 *   decide what the payload is; this layer only transports it.
 * - PRIVACY. The audit ring records metadata (source, length, outcome) and
 *   never clipboard CONTENT — copied text routinely holds secrets.
 *
 * The core is dependency-free with an injectable backend so it unit-tests in
 * pure Node (`vitest.main.config.ts`) without Electron. `src/main/index.ts`
 * registers the real `electron.clipboard` backend.
 */

import { z } from 'zod';

/** Upper bound on a single payload; generous for transcripts, bounded against IPC abuse. */
export const CLIPBOARD_MAX_CHARS = 10_000_000;

/**
 * IPC payload contract. `source` is a short surface label ("message-footer",
 * "code-block", "terminal-selection") used only for diagnostics grouping.
 */
export const ClipboardWritePayloadSchema = z.object({
  text: z.string().max(CLIPBOARD_MAX_CHARS),
  source: z.string().max(64).optional()
});

export const ClipboardReadPayloadSchema = z.object({
  source: z.string().max(64).optional()
});

export type ClipboardWritePayload = z.infer<typeof ClipboardWritePayloadSchema>;
export type ClipboardReadPayload = z.infer<typeof ClipboardReadPayloadSchema>;

/** Minimal clipboard surface; Electron's `clipboard` module satisfies it. */
export interface ClipboardBackend {
  writeText(text: string): void;
  readText(): string;
}

export type ClipboardFailureReason =
  | 'invalid_payload'
  | 'write_threw'
  | 'unverified'
  | 'read_threw'
  | 'no_backend';

export interface ClipboardWriteResult {
  /** True only when the payload round-tripped through the OS clipboard. */
  ok: boolean;
  /** Always 'main' — the renderer lib stamps its own 'async-clipboard' path. */
  via: 'main';
  /** Characters accepted. 0 on failure. */
  chars: number;
  /** False when the backend wrote without throwing but read-back differed. */
  verified: boolean;
  /**
   * Present on failure, and on a successful-but-unverified write where it is
   * always 'read_threw' — the copy landed, but verification could not run.
   * Callers use it to explain a greyed "Copied (unverified)" state.
   */
  reason?: ClipboardFailureReason;
  /** Human-readable failure detail. Absent on a verified success. */
  error?: string;
}

export interface ClipboardReadResult {
  ok: boolean;
  text: string;
  reason?: ClipboardFailureReason;
  error?: string;
}

/** One entry of the bounded diagnostics ring. Contains NO clipboard content. */
export interface ClipboardAuditEntry {
  timestamp: number;
  op: 'write' | 'read';
  source: string;
  ok: boolean;
  chars: number;
  reason?: ClipboardFailureReason;
  error?: string;
}

const AUDIT_RING_LIMIT = 24;
const auditRing: ClipboardAuditEntry[] = [];

let backend: ClipboardBackend | null = null;

/** Registers the process clipboard backend. Called once during app boot. */
export function registerClipboardBackend(next: ClipboardBackend | null): void {
  backend = next;
}

function record(entry: ClipboardAuditEntry): void {
  auditRing.push(entry);
  if (auditRing.length > AUDIT_RING_LIMIT) auditRing.splice(0, auditRing.length - AUDIT_RING_LIMIT);
}

/** Newest-first copy of the ring, for diagnostics surfaces. */
export function getClipboardAuditTrail(): ClipboardAuditEntry[] {
  return auditRing.slice().reverse();
}

/** Clears the ring. Test seam and diagnostics "reset" action. */
export function clearClipboardAuditTrail(): void {
  auditRing.length = 0;
}

function failWrite(reason: ClipboardFailureReason, error: string, source: string): ClipboardWriteResult {
  record({ timestamp: Date.now(), op: 'write', source, ok: false, chars: 0, reason, error });
  return { ok: false, via: 'main', chars: 0, verified: false, reason, error };
}

/**
 * Write exact text to the system clipboard and VERIFY it landed.
 *
 * Verification is a read-back comparison. Some platforms swallow write
 * failures; without this the UI would report "Copied" for a clipboard that
 * never changed, which is precisely the silent-failure class this prompt bans.
 */
export function writeClipboardText(text: unknown, source = 'unspecified'): ClipboardWriteResult {
  const parsed = ClipboardWritePayloadSchema.safeParse({ text, source });
  if (!parsed.success) {
    return failWrite(
      'invalid_payload',
      parsed.error.issues[0]?.message || 'Clipboard payload failed validation',
      typeof source === 'string' ? source.slice(0, 64) : 'unspecified'
    );
  }

  if (!backend) return failWrite('no_backend', 'Clipboard backend is not registered.', parsed.data.source || 'unspecified');

  const payload = parsed.data.text;
  const label = parsed.data.source || 'unspecified';

  try {
    backend.writeText(payload);
  } catch (err: unknown) {
    return failWrite('write_threw', err instanceof Error ? err.message : String(err), label);
  }

  let readBack: string;
  try {
    readBack = backend.readText();
  } catch (err: unknown) {
    // The write itself did not throw. A read-back failure is reported but
    // does not invalidate the copy — several headless/remote setups allow
    // writes without reads. Surface it so diagnostics are never blind.
    const detail = err instanceof Error ? err.message : String(err);
    record({
      timestamp: Date.now(),
      op: 'write',
      source: label,
      ok: true,
      chars: payload.length,
      reason: 'read_threw',
      error: detail
    });
    return {
      ok: true,
      via: 'main',
      chars: payload.length,
      verified: false,
      reason: 'read_threw',
      error: `Copied, but the read-back verification was blocked: ${detail}`
    };
  }

  if (readBack !== payload) {
    return failWrite(
      'unverified',
      'Clipboard write was not reflected on read-back (another application may own the clipboard).',
      label
    );
  }

  record({ timestamp: Date.now(), op: 'write', source: label, ok: true, chars: payload.length });
  return { ok: true, via: 'main', chars: payload.length, verified: true };
}

/** Read the system clipboard. Returns an empty string (ok:false) on failure. */
export function readClipboardText(source = 'unspecified'): ClipboardReadResult {
  if (!backend) {
    const error = 'Clipboard backend is not registered.';
    record({ timestamp: Date.now(), op: 'read', source, ok: false, chars: 0, reason: 'no_backend', error });
    return { ok: false, text: '', reason: 'no_backend', error };
  }
  try {
    const text = backend.readText() ?? '';
    record({ timestamp: Date.now(), op: 'read', source, ok: true, chars: text.length });
    return { ok: true, text };
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    record({ timestamp: Date.now(), op: 'read', source, ok: false, chars: 0, reason: 'read_threw', error });
    return { ok: false, text: '', reason: 'read_threw', error };
  }
}

/**
 * In-memory clipboard used by unit tests. Mirrors the real backend's failure
 * modes: throwing writes and write-without-effect (unverified) cases.
 */
export function createInMemoryClipboard(options: { failWrites?: boolean; ignoreWrites?: boolean; failReads?: boolean } = {}): ClipboardBackend & { peek(): string } {
  let value = '';
  return {
    writeText(text: string): void {
      if (options.failWrites) throw new Error('Simulated clipboard write failure');
      if (options.ignoreWrites) return;
      value = text;
    },
    readText(): string {
      if (options.failReads) throw new Error('Simulated clipboard read failure');
      return value;
    },
    peek(): string {
      return value;
    }
  };
}
