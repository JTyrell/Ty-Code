/**
 * Session crypto — a thin, failure-aware wrapper over the operating-system
 * credential store already used for provider keys (safeStorage / DPAPI).
 *
 * It is intentionally separate from `encryptSecret`/`decryptSecret` because the
 * session layer must DISTINGUISH three outcomes that the credential helpers
 * collapse: (1) encryption simply unavailable on this platform, (2) a payload
 * that was encrypted under a different OS/user profile (DPAPI context change or
 * a portable build moved between machines), and (3) a clean decrypt. `credential
 * store` swallows (2) into an empty string; we surface it so the history browser
 * can mark a session "Locked" instead of crashing or falling back to plaintext.
 *
 * There is never a plaintext fallback: if secure storage is unavailable, an
 * encrypt call throws and the caller must not write an unencrypted session.
 */

import { decryptSecret, encryptSecret, getCredentialStorageStatus } from '../../ipc/settings-handlers';
import type { SessionDecryptFailureReason } from '../../../shared/types/session-envelope';

export type DecryptResult<T> =
  | { ok: true; data: T }
  | { ok: false; reason: SessionDecryptFailureReason };

/** Whether the OS credential store can protect session payloads right now. */
export function isEncryptionAvailable(): boolean {
  return getCredentialStorageStatus().available;
}

/**
 * Encrypt an arbitrary JSON-serializable object to the tagged base64 string we
 * store in the envelope `payload`. Throws if secure storage is unavailable —
 * callers treat that as "refuse to persist", never "persist in the clear".
 */
export function encryptJson(obj: unknown): string {
  return encryptSecret(JSON.stringify(obj));
}

/** Decrypt a `payload` back to an object, classifying any failure. */
export function decryptPayload<T = unknown>(payload: string): DecryptResult<T> {
  if (!payload) return { ok: false, reason: 'unavailable' };
  if (!isEncryptionAvailable()) return { ok: false, reason: 'unavailable' };

  // decryptSecret returns '' both for "no storage" (already ruled out above)
  // and for a genuine decrypt throw — i.e. a foreign DPAPI blob. A real session
  // payload is non-empty JSON, so an empty result here means we cannot open it.
  const plain = decryptSecret(payload);
  if (!plain) return { ok: false, reason: 'dpapi-mismatch' };

  try {
    return { ok: true, data: JSON.parse(plain) as T };
  } catch {
    return { ok: false, reason: 'dpapi-mismatch' };
  }
}
