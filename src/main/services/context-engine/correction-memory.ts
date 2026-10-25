/**
 * Ty-Code Context Engine: Local Correction Memory (Audit Ledger)
 *
 * Implements a persistent, local SQLite database and JSON-lines audit ledger
 * stored at `~/.tycode/workspaces/{hash}/corrections.db`.
 *
 * Scoped strictly to the current workspace hash to prevent cross-project rule leakage.
 * 100% Local (Zero-Telemetry guarantee).
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';

export type CorrectionCategory = 'style' | 'architecture' | 'stack';
export type CorrectionSurface = 'chat' | 'debugger' | 'canvas' | 'global';

export interface CorrectionEntry {
  id: string;
  workspaceHash: string;
  rule: string;
  category: CorrectionCategory;
  surface?: CorrectionSurface;
  createdAt: number;
}

export interface CorrectionEvent {
  entry: CorrectionEntry;
  workspaceHash: string;
  surface: CorrectionSurface;
  rule: string;
}

export type CorrectionCallback = (event: CorrectionEvent) => void;

const correctionEmitter = new EventEmitter();
correctionEmitter.setMaxListeners(100);

/**
 * Subscribes to the universal correction event stream across all surfaces.
 * Returns an unsubscription function.
 */
export function onCorrectionAdded(callback: CorrectionCallback): () => void {
  correctionEmitter.on('correction-added', callback);
  return () => {
    correctionEmitter.off('correction-added', callback);
  };
}

/**
 * Emits a newly learned correction event to all Main Process subscribers.
 */
export function emitCorrectionAdded(event: CorrectionEvent): void {
  correctionEmitter.emit('correction-added', event);
}

// Dynamically check for node:sqlite support
let sqliteModule: typeof import('node:sqlite') | null = null;
try {
  sqliteModule = require('node:sqlite');
} catch {
  sqliteModule = null;
}

/**
 * Computes a deterministic 16-character hex hash from a workspace path.
 */
export function computeWorkspaceHash(workspacePathOrHash: string): string {
  if (!workspacePathOrHash) return 'default';
  const clean = workspacePathOrHash.trim();
  if (/^[a-f0-9]{16,64}$/i.test(clean)) {
    return clean.toLowerCase();
  }
  const normalized = path.resolve(clean).toLowerCase().replace(/\\/g, '/');
  return crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

/**
 * Returns the storage directory for the given workspace hash:
 * ~/.tycode/workspaces/{hash}
 */
export function getWorkspaceStorageDir(workspaceHash: string): string {
  return path.join(os.homedir(), '.tycode', 'workspaces', workspaceHash);
}

/**
 * Formats user correction into an actionable rule constraint.
 */
export function formatRule(rawRule: string, category: CorrectionCategory): string {
  const trimmed = rawRule.trim();
  if (!trimmed) return '';

  // If already formatted with ALWAYS/NEVER/MUST, keep as is
  if (/^(ALWAYS|NEVER|MUST|DO NOT|PREFER)\b/i.test(trimmed)) {
    return trimmed;
  }

  const lower = trimmed.toLowerCase();

  // Canonical style & architecture constraints
  if (category === 'style' && lower.includes('var') && (lower.includes('const') || lower.includes('let'))) {
    return 'NEVER use `var`, use `const` or `let`.';
  }

  if (lower.includes('zod') && (lower.includes('joi') || lower.includes('yup') || lower.includes('validation'))) {
    return 'ALWAYS use Zod for validation.';
  }

  if (lower.includes('repositories') && (lower.includes('controller') || lower.includes('direct'))) {
    return 'Database queries must go through the `src/repositories` layer, not directly in controllers.';
  }

  // Pattern: "don't use X, use Y" or "no X, use Y"
  const dontMatch = trimmed.match(/^(?:don['’]t use|do not use|never use|no)\s+`?([^,]+?)`?(?:,|\s+we use|\s+instead use|\s+use)\s+`?([^.]+?)`?\s*\.?$/i);
  if (dontMatch) {
    const avoid = dontMatch[1].replace(/^`+|`+$/g, '').trim();
    const prefer = dontMatch[2].replace(/^we use\s+/i, '').replace(/^instead use\s+/i, '').replace(/^use\s+/i, '').replace(/^`+|`+$/g, '').trim();
    return `NEVER use \`${avoid}\`, use \`${prefer}\`.`;
  }

  // Pattern: "we use X for Y, not Z" or "use X instead of Y"
  const weUseMatch = trimmed.match(/^(?:we use|use)\s+`?([^,]+?)`?\s+(?:for\s+([^,]+?))?(?:,\s*not\s+`?([^.]+?)`?|\s+instead of\s+`?([^.]+?)`?)\.?$/i);
  if (weUseMatch) {
    const prefer = weUseMatch[1].replace(/^`+|`+$/g, '').trim();
    const context = weUseMatch[2] ? ` for ${weUseMatch[2].trim()}` : '';
    return `ALWAYS use \`${prefer}\`${context}.`;
  }

  return trimmed;
}

/**
 * In-memory connection cache for DatabaseSync instances keyed by workspace hash.
 */
const dbConnections = new Map<string, any>();

function getDatabase(workspaceHash: string): any {
  if (!sqliteModule) return null;

  if (dbConnections.has(workspaceHash)) {
    return dbConnections.get(workspaceHash);
  }

  const dir = getWorkspaceStorageDir(workspaceHash);
  fsSync.mkdirSync(dir, { recursive: true });
  const dbPath = path.join(dir, 'corrections.db');

  try {
    const db = new sqliteModule.DatabaseSync(dbPath);
    // Write-Ahead Logging (WAL) prevents file locking across concurrent multi-surface access
    try {
      db.exec('PRAGMA journal_mode = WAL;');
    } catch (walErr) {
      console.warn(`[CorrectionMemory] Failed to enable WAL mode for ${workspaceHash}:`, walErr);
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS corrections (
        id TEXT PRIMARY KEY,
        workspace_hash TEXT NOT NULL,
        rule TEXT NOT NULL,
        category TEXT NOT NULL CHECK(category IN ('style', 'architecture', 'stack')),
        surface TEXT DEFAULT 'chat',
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_corrections_hash ON corrections(workspace_hash);
    `);

    // Graceful column migration if existing SQLite table lacks surface column
    try {
      db.exec('ALTER TABLE corrections ADD COLUMN surface TEXT DEFAULT "chat";');
    } catch {}

    dbConnections.set(workspaceHash, db);
    return db;
  } catch (err) {
    console.warn(`[CorrectionMemory] SQLite init failed for ${workspaceHash}, using JSONL fallback:`, err);
    return null;
  }
}

/**
 * Fallback JSONL reader.
 */
async function readJsonl(workspaceHash: string): Promise<CorrectionEntry[]> {
  const jsonlPath = path.join(getWorkspaceStorageDir(workspaceHash), 'corrections.jsonl');
  try {
    const data = await fs.readFile(jsonlPath, 'utf-8');
    const lines = data.split('\n').filter((l) => l.trim().length > 0);
    const entries: CorrectionEntry[] = [];
    for (const line of lines) {
      try {
        entries.push(JSON.parse(line));
      } catch {}
    }
    return entries;
  } catch {
    return [];
  }
}

/**
 * Fallback JSONL writer.
 */
async function writeJsonl(workspaceHash: string, entries: CorrectionEntry[]): Promise<void> {
  const dir = getWorkspaceStorageDir(workspaceHash);
  await fs.mkdir(dir, { recursive: true });
  const jsonlPath = path.join(dir, 'corrections.jsonl');
  const tempPath = `${jsonlPath}.${process.pid}.${Date.now()}.tmp`;
  const content = entries.map((e) => JSON.stringify(e)).join('\n') + (entries.length > 0 ? '\n' : '');
  await fs.writeFile(tempPath, content, 'utf-8');
  await fs.rename(tempPath, jsonlPath);
}

/**
 * Saves a user preference or correction to the workspace-scoped audit ledger.
 * Emits onCorrectionAdded event across all engine subscribers.
 */
export async function saveCorrection(
  workspaceHashOrPath: string,
  rawRule: string,
  category: CorrectionCategory = 'style',
  surface: CorrectionSurface = 'chat'
): Promise<CorrectionEntry> {
  const workspaceHash = computeWorkspaceHash(workspaceHashOrPath);
  const formatted = formatRule(rawRule, category);

  const entry: CorrectionEntry = {
    id: `corr_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
    workspaceHash,
    rule: formatted,
    category,
    surface,
    createdAt: Date.now()
  };

  const db = getDatabase(workspaceHash);
  if (db) {
    try {
      const stmt = db.prepare(`
        INSERT INTO corrections (id, workspace_hash, rule, category, surface, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(entry.id, entry.workspaceHash, entry.rule, entry.category, entry.surface, entry.createdAt);
    } catch (err) {
      console.warn(`[CorrectionMemory] SQLite insert failed, falling back to JSONL:`, err);
    }
  }

  // Always mirror to JSONL for dual durability and human inspectability
  const currentEntries = await readJsonl(workspaceHash);
  currentEntries.push(entry);
  await writeJsonl(workspaceHash, currentEntries);

  // Emit event to Main Process subscribers (Learning Loop)
  emitCorrectionAdded({
    entry,
    workspaceHash,
    surface,
    rule: entry.rule
  });

  return entry;
}

/**
 * Retrieves all formatted correction rules for the current workspace hash.
 */
export async function getCorrections(workspaceHashOrPath: string): Promise<string[]> {
  const entries = await getCorrectionEntries(workspaceHashOrPath);
  return entries.map((e) => e.rule);
}

/**
 * Retrieves full correction entries for the current workspace hash.
 */
export async function getCorrectionEntries(workspaceHashOrPath: string): Promise<CorrectionEntry[]> {
  const workspaceHash = computeWorkspaceHash(workspaceHashOrPath);
  const db = getDatabase(workspaceHash);

  if (db) {
    try {
      const stmt = db.prepare(`
        SELECT id, workspace_hash as workspaceHash, rule, category, surface, created_at as createdAt
        FROM corrections
        WHERE workspace_hash = ?
        ORDER BY created_at ASC
      `);
      const rows = stmt.all(workspaceHash);
      if (Array.isArray(rows) && rows.length > 0) {
        return rows as CorrectionEntry[];
      }
    } catch (err) {
      console.warn(`[CorrectionMemory] SQLite select failed, using JSONL:`, err);
    }
  }

  return await readJsonl(workspaceHash);
}

/**
 * Deletes a correction by ID from the workspace-scoped audit ledger.
 */
export async function deleteCorrection(workspaceHashOrPath: string, id: string): Promise<boolean> {
  const workspaceHash = computeWorkspaceHash(workspaceHashOrPath);
  const db = getDatabase(workspaceHash);
  let deleted = false;

  if (db) {
    try {
      const stmt = db.prepare(`DELETE FROM corrections WHERE id = ? AND workspace_hash = ?`);
      const info = stmt.run(id, workspaceHash);
      deleted = info.changes > 0;
    } catch (err) {
      console.warn(`[CorrectionMemory] SQLite delete failed:`, err);
    }
  }

  const entries = await readJsonl(workspaceHash);
  const filtered = entries.filter((e) => e.id !== id);
  if (filtered.length !== entries.length) {
    deleted = true;
    await writeJsonl(workspaceHash, filtered);
  }

  return deleted;
}

/**
 * Clears all corrections for a workspace hash (useful for test resets).
 */
export async function clearCorrections(workspaceHashOrPath: string): Promise<void> {
  const workspaceHash = computeWorkspaceHash(workspaceHashOrPath);
  const db = getDatabase(workspaceHash);

  if (db) {
    try {
      db.prepare(`DELETE FROM corrections WHERE workspace_hash = ?`).run(workspaceHash);
    } catch {}
  }

  await writeJsonl(workspaceHash, []);
}

/**
 * Closes cached SQLite database connections (for clean shutdown / testing).
 */
export function closeDatabaseConnections(): void {
  for (const [hash, db] of dbConnections.entries()) {
    try {
      db.close();
    } catch {}
  }
  dbConnections.clear();
}
