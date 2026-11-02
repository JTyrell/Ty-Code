/**
 * Phase 3 — CheckpointService: one API, two backends, honest rollback.
 *
 * capture(): reads the pre-edit contents of ONLY the files about to be touched,
 *   always writes an ENCRYPTED snapshot bundle (the authoritative restore source
 *   — it also correctly covers untracked/created files git cannot), and, when the
 *   workspace is a usable git repo, ALSO pins a hidden `refs/tycode/...` commit
 *   for full-fidelity evidence. The backend badge reflects whether that ref was
 *   created; a mid-task git failure degrades subsequent checkpoints to snapshot
 *   so the edit batch never errors out.
 *
 * finalize(): after the batch lands, records the agent's result contents so a
 *   later restore can tell "only the agent changed this" (safe revert) from
 *   "the user also edited this" (three-way conflict — never silent).
 *
 * restore(): reverts touched files to their pre-edit contents, removes
 *   agent-created files, and re-creates agent-deleted ones. Untouched files and
 *   genuine user edits are respected per the mode.
 *
 * retention(): cap 50 checkpoints or 512 MB per workspace; oldest pruned first
 *   (both the bundle and any hidden ref).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { computeWsHash } from '../session/unified-session-store';
import { snapshotBackend } from './snapshot-backend';
import { gitRefBackend } from './git-ref-backend';
import {
  CHECKPOINT_RETENTION,
  type CheckpointBundle,
  type CheckpointManifest,
  type PlannedEdit,
  type RestoreMode,
  type RestoreResult
} from '../../../shared/types/checkpoint';

class CheckpointService {
  /** Backend chosen once per task; flips to 'snapshot' after any git failure. */
  private taskBackend = new Map<string, 'git-ref' | 'snapshot'>();

  private safeJoin(workspaceRoot: string, rel: string): string | null {
    const abs = path.resolve(workspaceRoot, rel);
    const root = path.resolve(workspaceRoot);
    if (abs !== root && !abs.startsWith(root + path.sep)) return null; // escapes root
    return abs;
  }

  private async readOrNull(abs: string): Promise<string | null> {
    try {
      return await fsp.readFile(abs, 'utf8');
    } catch {
      return null;
    }
  }

  private nextIndex(manifests: CheckpointManifest[], taskId: string): number {
    return manifests.filter((m) => m.taskId === taskId).length;
  }

  private estimateSize(before: Record<string, string | null>, after: Record<string, string | null>): number {
    let bytes = 0;
    for (const v of Object.values(before)) if (typeof v === 'string') bytes += Buffer.byteLength(v, 'utf8');
    for (const v of Object.values(after)) if (typeof v === 'string') bytes += Buffer.byteLength(v, 'utf8');
    return bytes;
  }

  /**
   * Capture a checkpoint BEFORE the agent's edit batch touches disk. Returns the
   * plaintext manifest (the chip/Details render from this; contents stay inside
   * the encrypted bundle).
   */
  async capture(
    workspaceRoot: string,
    taskId: string,
    edits: PlannedEdit[],
    summary = ''
  ): Promise<CheckpointManifest> {
    const wsHash = computeWsHash(workspaceRoot);
    const existing = await snapshotBackend.list(workspaceRoot);
    const n = this.nextIndex(existing, taskId);

    const touched: string[] = [];
    const created: string[] = [];
    const deleted: string[] = [];
    const before: Record<string, string | null> = {};

    for (const edit of edits) {
      const abs = this.safeJoin(workspaceRoot, edit.path);
      if (!abs) continue; // refuse path escapes
      const content = await this.readOrNull(abs);
      before[edit.path] = content; // null when the file does not exist yet
      if (edit.kind === 'create') created.push(edit.path);
      else if (edit.kind === 'delete') deleted.push(edit.path);
      else touched.push(edit.path);
    }

    // Backend selection: cached per task; probe git only on first capture.
    let backend = this.taskBackend.get(taskId);
    if (!backend) {
      backend = (await gitRefBackend.isUsable(workspaceRoot)) ? 'git-ref' : 'snapshot';
      this.taskBackend.set(taskId, backend);
    }

    const manifest: CheckpointManifest = {
      id: `ckpt_${wsHash.slice(0, 6)}_${taskId}_${n}_${crypto.randomBytes(3).toString('hex')}`,
      taskId,
      n,
      wsHash,
      backend,
      gitRef: null,
      touched,
      created,
      deleted,
      summary,
      createdAt: Date.now(),
      sizeBytes: this.estimateSize(before, {})
    };

    const bundle: CheckpointBundle = { manifest, before, after: {} };
    const bytes = await snapshotBackend.write(manifest, bundle);
    manifest.sizeBytes = bytes;

    // Pin a hidden ref when the backend is git-ref. A failure degrades the task
    // to snapshot for subsequent captures rather than throwing up the batch.
    if (backend === 'git-ref') {
      try {
        const { ref } = await gitRefBackend.captureRef(workspaceRoot, taskId, n);
        manifest.gitRef = ref;
        await snapshotBackend.write(manifest, bundle);
      } catch {
        this.taskBackend.set(taskId, 'snapshot');
        manifest.backend = 'snapshot';
        await snapshotBackend.write(manifest, bundle);
      }
    }

    await this.enforceRetention(workspaceRoot);
    return manifest;
  }

  /** Record the agent's result contents so restore can detect real user edits. */
  async finalize(
    workspaceRoot: string,
    manifest: CheckpointManifest,
    results: Array<{ path: string; content: string | null }>
  ): Promise<void> {
    const bundle = await snapshotBackend.read(workspaceRoot, manifest.taskId, manifest.n);
    if (!bundle) return;
    for (const r of results) {
      bundle.after[r.path] = r.content;
    }
    bundle.manifest = manifest;
    await snapshotBackend.write(manifest, bundle);
  }

  private async loadBundle(
    workspaceRoot: string,
    checkpointId: string
  ): Promise<{ manifest: CheckpointManifest; bundle: CheckpointBundle } | null> {
    const manifests = await snapshotBackend.list(workspaceRoot);
    const manifest = manifests.find((m) => m.id === checkpointId);
    if (!manifest) return null;
    const bundle = await snapshotBackend.read(workspaceRoot, manifest.taskId, manifest.n);
    if (!bundle) return null;
    return { manifest, bundle };
  }

  /**
   * Compute (preview) what a restore would change, WITHOUT writing anything.
   * The "Restore to here" UI shows this before committing.
   */
  async restorePreview(workspaceRoot: string, checkpointId: string): Promise<RestoreResult> {
    return this.applyRestore(workspaceRoot, checkpointId, 'review');
  }

  async restore(workspaceRoot: string, checkpointId: string, mode: RestoreMode): Promise<RestoreResult> {
    return this.applyRestore(workspaceRoot, checkpointId, mode);
  }

  private async applyRestore(
    workspaceRoot: string,
    checkpointId: string,
    mode: RestoreMode
  ): Promise<RestoreResult> {
    const loaded = await this.loadBundle(workspaceRoot, checkpointId);
    if (!loaded) {
      return { restored: [], created: [], deleted: [], conflicts: [], skipped: [], success: false };
    }
    const { bundle } = loaded;
    const result: RestoreResult = {
      restored: [],
      created: [],
      deleted: [],
      conflicts: [],
      skipped: [],
      success: true
    };

    // Every path the batch touched, with its desired pre-batch content.
    const targets = new Set<string>([
      ...bundle.manifest.touched,
      ...bundle.manifest.created,
      ...bundle.manifest.deleted
    ]);

    for (const rel of targets) {
      const abs = this.safeJoin(workspaceRoot, rel);
      if (!abs) {
        result.skipped.push(rel);
        continue;
      }
      const target = bundle.before[rel] ?? null; // pre-edit content (null = did not exist)
      const current = await this.readOrNull(abs);
      if (current === target) {
        result.skipped.push(rel);
        continue;
      }
      const after = bundle.after[rel];
      const knownAfter = after !== undefined;
      // A genuine user edit: we know what the agent wrote, and the current file
      // matches neither the pre-edit nor the agent result.
      const userEdited = knownAfter && current !== after && current !== target;
      if (userEdited && mode === 'review') {
        result.conflicts.push({ path: rel, checkpointContent: target, currentContent: current });
        continue;
      }
      if (userEdited && mode === 'keep-mine') {
        result.skipped.push(rel);
        continue;
      }
      // Revert (force, or no proven user edit).
      if (target === null) {
        if (current !== null) {
          await fsp.unlink(abs).catch(() => undefined);
          result.deleted.push(rel);
        }
      } else {
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, target, 'utf8');
        if (current === null) result.created.push(rel);
        else result.restored.push(rel);
      }
    }

    return result;
  }

  async list(workspaceRoot: string, taskId?: string): Promise<CheckpointManifest[]> {
    const manifests = await snapshotBackend.list(workspaceRoot);
    return taskId ? manifests.filter((m) => m.taskId === taskId) : manifests;
  }

  /** Cap 50 checkpoints or 512 MB per workspace; prune oldest first. */
  async enforceRetention(workspaceRoot: string): Promise<void> {
    const manifests = await snapshotBackend.list(workspaceRoot);
    // Newest first. `createdAt` is only millisecond-resolution, so rapid captures
    // collide on the same ms; tie-break on the per-task monotonic `n` so the
    // truly-oldest bundle is deterministically at the tail (otherwise pruning
    // could drop a newer checkpoint while an older one survives).
    let remaining = manifests
      .slice()
      .sort((a, b) => (b.createdAt !== a.createdAt ? b.createdAt - a.createdAt : b.n - a.n));
    let totalBytes = remaining.reduce((sum, m) => sum + (m.sizeBytes || 0), 0);

    const toRemove: CheckpointManifest[] = [];
    while (remaining.length > CHECKPOINT_RETENTION.maxCount || totalBytes > CHECKPOINT_RETENTION.maxBytes) {
      const oldest = remaining[remaining.length - 1];
      if (!oldest) break;
      toRemove.push(oldest);
      totalBytes -= oldest.sizeBytes || 0;
      remaining = remaining.slice(0, -1);
    }

    for (const m of toRemove) {
      if (m.gitRef) {
        await gitRefBackend.deleteRef(workspaceRoot, m.gitRef).catch(() => undefined);
      }
      await snapshotBackend.remove(m).catch(() => undefined);
    }
  }

  /** Explicit purge (e.g. "Purge migrated checkpoints"). */
  async purgeOlderThan(workspaceRoot: string, olderThanMs: number): Promise<number> {
    const cutoff = Date.now() - olderThanMs;
    const manifests = await snapshotBackend.list(workspaceRoot);
    const doomed = manifests.filter((m) => m.createdAt < cutoff);
    for (const m of doomed) {
      if (m.gitRef) await gitRefBackend.deleteRef(workspaceRoot, m.gitRef).catch(() => undefined);
      await snapshotBackend.remove(m).catch(() => undefined);
    }
    return doomed.length;
  }
}

export const checkpointService = new CheckpointService();
