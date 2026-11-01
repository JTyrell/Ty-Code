/**
 * Phase 3 — SnapshotBackend: the guaranteed checkpoint store.
 *
 * Used when the workspace is not a git repo, the git binary is missing/broken,
 * or as the degradation target after a mid-task git failure. It writes an
 * ENCRYPTED inverse bundle:
 *
 *   ~/.tycode/checkpoints/{wsHash}/{taskId}/{n}.bundle
 *   { v:1, cipher:'safeStorage', meta:<plaintext manifest>, payload:<tagged base64> }
 *
 * `payload` is encryptJson({ before, after }) — the pre-edit contents of just the
 * touched files and (once finalized) the agent's result contents. This file is
 * the ONLY sanctioned checkpoint writer (see scripts/no-plaintext-session-bundle
 * .mjs ALLOWED_WRITERS); everything routes through session-crypto's encryptJson,
 * so a bundle never lands in the clear and there is no plaintext fallback.
 *
 * Writes are atomic (tmp + rename) so a kill mid-write leaves the prior bundle
 * intact. fs/crypto are injectable for tests (vi.mock in unit tests).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { encryptJson, decryptPayload, isEncryptionAvailable } from '../session/session-crypto';
import { computeWsHash } from '../session/unified-session-store';
import {
  CHECKPOINT_ENVELOPE_VERSION,
  CheckpointBundleSchema,
  CheckpointManifestSchema,
  type CheckpointBundle,
  type CheckpointManifest
} from '../../../shared/types/checkpoint';

const CHECKPOINTS_ROOT = path.join(os.homedir(), '.tycode', 'checkpoints');

function wsRoot(workspaceRoot: string): string {
  return path.join(CHECKPOINTS_ROOT, computeWsHash(workspaceRoot));
}

function bundlePath(workspaceRoot: string, taskId: string, n: number): string {
  return path.join(wsRoot(workspaceRoot), taskId, `${n}.bundle`);
}

/** The on-disk checkpoint envelope: plaintext manifest + encrypted payload. */
interface CheckpointEnvelope {
  v: number;
  cipher: 'safeStorage';
  meta: CheckpointManifest;
  payload: string;
}

function assertWithinWorkspace(abs: string): void {
  // Defense-in-depth: never write outside the checkpoints root.
  const resolved = path.resolve(abs);
  const root = path.resolve(CHECKPOINTS_ROOT);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write checkpoint bundle outside ${root}`);
  }
}

/**
 * Write an encrypted bundle atomically. Returns the byte size so the caller can
 * stamp the manifest for retention accounting.
 */
export async function writeBundle(
  manifest: CheckpointManifest,
  bundle: CheckpointBundle
): Promise<number> {
  if (!isEncryptionAvailable()) {
    throw new Error('Secure storage unavailable; refusing to write an unencrypted checkpoint bundle.');
  }
  const abs = bundlePathFromManifest(manifest);
  assertWithinWorkspace(abs);
  const envelope: CheckpointEnvelope = {
    v: CHECKPOINT_ENVELOPE_VERSION,
    cipher: 'safeStorage',
    meta: manifest,
    payload: encryptJson({ before: bundle.before, after: bundle.after })
  };
  const serialized = JSON.stringify(envelope);
  const bytes = Buffer.byteLength(serialized, 'utf8');

  await fsp.mkdir(path.dirname(abs), { recursive: true });
  const tmp = `${abs}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await fsp.writeFile(tmp, serialized, 'utf8');
  await fsp.rename(tmp, abs);
  return bytes;
}

export function bundlePathFromManifest(manifest: CheckpointManifest): string {
  // Manifest stores wsHash, not the root; recover the workspace root dir from a
  // reverse index is impossible, so callers pass the workspaceRoot through the
  // service. For direct use we key only by hash + taskId + n.
  return path.join(CHECKPOINTS_ROOT, manifest.wsHash, manifest.taskId, `${manifest.n}.bundle`);
}

/** Read + decrypt a bundle. Returns null when the file is missing. */
export async function readBundle(
  workspaceRoot: string,
  taskId: string,
  n: number
): Promise<CheckpointBundle | null> {
  const abs = bundlePath(workspaceRoot, taskId, n);
  let raw: string;
  try {
    raw = await fsp.readFile(abs, 'utf8');
  } catch {
    return null;
  }
  const envelope = JSON.parse(raw) as CheckpointEnvelope;
  const meta = CheckpointManifestSchema.parse(envelope.meta);
  const dec = decryptPayload<{ before: CheckpointBundle['before']; after: CheckpointBundle['after'] }>(
    envelope.payload
  );
  if (!dec.ok) {
    throw new Error(`checkpoint locked (${dec.reason})`);
  }
  return CheckpointBundleSchema.parse({ manifest: meta, before: dec.data.before, after: dec.data.after });
}

/** List the plaintext manifests for a workspace WITHOUT decrypting any bundle. */
export async function listManifests(workspaceRoot: string): Promise<CheckpointManifest[]> {
  const root = wsRoot(workspaceRoot);
  let taskIds: string[];
  try {
    taskIds = await fsp.readdir(root);
  } catch {
    return [];
  }
  const out: CheckpointManifest[] = [];
  for (const taskId of taskIds) {
    const dir = path.join(root, taskId);
    let files: string[];
    try {
      files = await fsp.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!f.endsWith('.bundle')) continue;
      try {
        const raw = await fsp.readFile(path.join(dir, f), 'utf8');
        const envelope = JSON.parse(raw) as CheckpointEnvelope;
        out.push(CheckpointManifestSchema.parse(envelope.meta));
      } catch {
        /* a corrupt bundle is skipped, never fatal to the listing */
      }
    }
  }
  return out.sort((a, b) => a.createdAt - b.createdAt);
}

export async function deleteBundle(manifest: CheckpointManifest): Promise<void> {
  const abs = bundlePathFromManifest(manifest);
  try {
    await fsp.unlink(abs);
  } catch {
    /* already gone */
  }
}

export const snapshotBackend = {
  name: 'snapshot' as const,
  isAvailable: () => isEncryptionAvailable(),
  write: writeBundle,
  read: readBundle,
  list: listManifests,
  remove: deleteBundle
};
