import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  MyersDiffResult,
  SearchInFilesOptions,
  WorkspaceEditOrigin,
  WorkspaceEditPreview,
  WorkspaceEditPreviewFile,
  WorkspaceEditTransactionResult
} from '../../preload/types';
import { searchInWorkspaceFiles, buildSearchRegex } from '../ipc/fs-handlers';
import { MyersDiff } from './myers-diff';
import { fromFileUri } from './lsp-path-utils';
import type { LspManager } from './lsp-manager';

const PREVIEW_TTL_MS = 5 * 60_000;
const MAX_PREVIEWS = 32;
const MAX_FILES_PER_PREVIEW = 200;
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SEARCH_MATCHES = 50_000;

type LspTextEdit = { range: { start: { line: number; character: number }; end: { line: number; character: number } }; newText: string };
type PreviewFileSnapshot = WorkspaceEditPreviewFile & {
  absolutePath: string;
  originalDiskContent: string;
  originalBufferContent: string;
  originalBufferWasDirty: boolean;
  originalHash: string;
  mode: number;
};
type StoredPreview = { publicPreview: WorkspaceEditPreview; files: PreviewFileSnapshot[] };
type UndoEntry = {
  transactionId: string;
  origin: WorkspaceEditOrigin;
  createdAt: number;
  files: Array<PreviewFileSnapshot & { afterContent: string; afterHash: string; afterDocumentVersion?: number }>;
};

function hashContent(content: string): string {
  return createHash('sha256').update(content, 'utf8').digest('hex');
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function positionOffset(content: string, position: { line: number; character: number }): number {
  if (!Number.isInteger(position.line) || !Number.isInteger(position.character) || position.line < 0 || position.character < 0) {
    throw new Error('The language server returned an invalid text-edit position.');
  }
  let lineStart = 0;
  for (let line = 0; line < position.line; line++) {
    const newline = content.indexOf('\n', lineStart);
    if (newline < 0) throw new Error('The language server returned a text edit outside the document.');
    lineStart = newline + 1;
  }
  const nextNewline = content.indexOf('\n', lineStart);
  const lineEnd = nextNewline < 0 ? content.length : nextNewline;
  const logicalLineEnd = lineEnd > lineStart && content.charCodeAt(lineEnd - 1) === 13 ? lineEnd - 1 : lineEnd;
  if (position.character > logicalLineEnd - lineStart) throw new Error('The language server returned a text edit outside the document.');
  return lineStart + position.character;
}

function applyTextEdits(content: string, edits: LspTextEdit[]): string {
  const offsets = edits.map((edit) => ({
    start: positionOffset(content, edit.range.start),
    end: positionOffset(content, edit.range.end),
    newText: edit.newText
  })).sort((a, b) => b.start - a.start || b.end - a.end);
  let lastStart = content.length + 1;
  let result = content;
  for (const edit of offsets) {
    if (edit.end < edit.start || edit.end > lastStart || (edit.start === lastStart && edit.start === edit.end)) throw new Error('The language server returned overlapping text edits.');
    result = `${result.slice(0, edit.start)}${edit.newText}${result.slice(edit.end)}`;
    lastStart = edit.start;
  }
  return result;
}

function countEdits(diff: MyersDiffResult): number {
  return diff.additions + diff.deletions;
}

export class WorkspaceEditPreviewService {
  private previews = new Map<string, StoredPreview>();
  private undoEntries: UndoEntry[] = [];
  private transactionInFlight = false;

  constructor(private readonly workspacePath: string, private readonly lspManager: LspManager) {}

  private prunePreviews(): void {
    const now = Date.now();
    for (const [id, preview] of this.previews) {
      if (preview.publicPreview.expiresAt <= now) this.previews.delete(id);
    }
    while (this.previews.size >= MAX_PREVIEWS) {
      const oldest = this.previews.keys().next().value as string | undefined;
      if (!oldest) break;
      this.previews.delete(oldest);
    }
  }

  private async resolveTarget(filePathOrUri: string): Promise<{ absolutePath: string; relativePath: string }> {
    const root = await fs.realpath(this.workspacePath);
    const filePath = filePathOrUri.startsWith('file:') ? fromFileUri(filePathOrUri) : filePathOrUri;
    const absolutePath = path.isAbsolute(filePath) || path.win32.isAbsolute(filePath)
      ? path.resolve(filePath)
      : path.resolve(root, filePath);
    if (!isContained(root, absolutePath) || absolutePath === root) throw new Error(`Edit target is outside the active workspace: ${filePathOrUri}`);
    const realPath = await fs.realpath(absolutePath);
    if (!isContained(root, realPath) || realPath === root) throw new Error(`Edit target resolves outside the active workspace: ${filePathOrUri}`);
    const stats = await fs.stat(realPath);
    if (!stats.isFile()) throw new Error(`Edit target is not a regular file: ${filePathOrUri}`);
    if (stats.size > MAX_FILE_BYTES) throw new Error(`Edit target exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MiB preview limit: ${filePathOrUri}`);
    return { absolutePath: realPath, relativePath: path.relative(root, realPath).split(path.sep).join('/') };
  }

  private async makeSnapshot(relativePath: string, modifiedContent: string, editCount: number, origin: WorkspaceEditOrigin, documentVersion?: number): Promise<PreviewFileSnapshot> {
    const { absolutePath, relativePath: safeRelativePath } = await this.resolveTarget(relativePath);
    const [originalDiskContent, stats] = await Promise.all([fs.readFile(absolutePath, 'utf8'), fs.stat(absolutePath)]);
    const tracked = this.lspManager.getTrackedDocument(absolutePath);
    const originalBufferContent = tracked?.text ?? originalDiskContent;
    const originalBufferWasDirty = tracked?.isDirty ?? false;
    const comparisonContent = origin === 'search-replace' ? originalDiskContent : originalBufferContent;
    const diff = MyersDiff.diff(comparisonContent, modifiedContent);
    const bytes = Buffer.byteLength(originalDiskContent, 'utf8') + Buffer.byteLength(modifiedContent, 'utf8');
    if (bytes > MAX_FILE_BYTES * 2) throw new Error(`Edit target exceeds the ${MAX_FILE_BYTES / 1024 / 1024} MiB preview limit: ${safeRelativePath}`);
    return {
      filePath: safeRelativePath,
      absolutePath,
      originalContent: comparisonContent,
      modifiedContent,
      diff,
      editCount: Math.max(editCount, countEdits(diff)),
      documentVersion: documentVersion ?? tracked?.version,
      isDirty: originalBufferWasDirty,
      originalDiskContent,
      originalBufferContent,
      originalBufferWasDirty,
      originalHash: hashContent(originalDiskContent),
      mode: stats.mode
    };
  }

  private async savePreview(origin: WorkspaceEditOrigin, title: string, files: PreviewFileSnapshot[]): Promise<WorkspaceEditPreview> {
    this.prunePreviews();
    if (files.length === 0) throw new Error('The language server returned no changes to review.');
    if (files.length > MAX_FILES_PER_PREVIEW) throw new Error(`Edit preview contains more than ${MAX_FILES_PER_PREVIEW} files.`);
    const totalBytes = files.reduce((sum, file) => sum + Buffer.byteLength(file.originalDiskContent, 'utf8') + Buffer.byteLength(file.modifiedContent, 'utf8'), 0);
    if (totalBytes > MAX_TOTAL_BYTES) throw new Error('Edit preview exceeds the 20 MiB total size limit. Narrow the operation and try again.');
    const previewId = randomUUID();
    const expiresAt = Date.now() + PREVIEW_TTL_MS;
    const publicFiles: WorkspaceEditPreviewFile[] = files.map(({ absolutePath: _absolutePath, originalDiskContent: _originalDiskContent, originalBufferContent: _originalBufferContent, originalBufferWasDirty: _originalBufferWasDirty, originalHash: _originalHash, mode: _mode, ...file }) => file);
    const publicPreview: WorkspaceEditPreview = {
      previewId,
      origin,
      title,
      files: publicFiles,
      totalEdits: files.reduce((total, file) => total + file.editCount, 0),
      expiresAt
    };
    this.previews.set(previewId, { publicPreview, files });
    return publicPreview;
  }

  public async createLspPreview(workspaceEdit: unknown, title: string): Promise<WorkspaceEditPreview> {
    if (!workspaceEdit || typeof workspaceEdit !== 'object') throw new Error('The language server returned an invalid workspace edit.');
    const edit = workspaceEdit as { changes?: Record<string, LspTextEdit[]>; documentChanges?: unknown[] };
    const editsByUri = new Map<string, LspTextEdit[]>();
    const expectedVersions = new Map<string, number>();
    for (const [uri, edits] of Object.entries(edit.changes || {})) {
      if (!Array.isArray(edits)) throw new Error('The language server returned an invalid text edit list.');
      editsByUri.set(uri, [...(editsByUri.get(uri) || []), ...edits]);
    }
    for (const change of edit.documentChanges || []) {
      if (!change || typeof change !== 'object' || !('textDocument' in change) || !('edits' in change)) {
        throw new Error('This refactor includes file creation, deletion, or rename operations that are not supported. No files were changed.');
      }
      const textChange = change as { textDocument: { uri: string; version?: number | null }; edits: LspTextEdit[] };
      if (typeof textChange.textDocument?.uri !== 'string' || !Array.isArray(textChange.edits)) throw new Error('The language server returned an invalid document change.');
      if (typeof textChange.textDocument.version === 'number') expectedVersions.set(textChange.textDocument.uri, textChange.textDocument.version);
      editsByUri.set(textChange.textDocument.uri, [...(editsByUri.get(textChange.textDocument.uri) || []), ...textChange.edits]);
    }

    const files: PreviewFileSnapshot[] = [];
    for (const [uri, edits] of editsByUri) {
      const { absolutePath, relativePath } = await this.resolveTarget(uri);
      const tracked = this.lspManager.getTrackedDocument(absolutePath);
      const expectedVersion = expectedVersions.get(uri);
      if (expectedVersion !== undefined && tracked?.version !== expectedVersion) throw new Error(`The language server edit for ${relativePath} is stale. Request a new rename preview.`);
      const original = tracked?.text ?? await fs.readFile(absolutePath, 'utf8');
      const modified = applyTextEdits(original, edits);
      files.push(await this.makeSnapshot(relativePath, modified, edits.length, 'lsp-rename', tracked?.version));
    }
    return this.savePreview('lsp-rename', title, files);
  }

  public async createSearchReplacePreview(options: SearchInFilesOptions & { replacement: string; filePaths?: string[] }): Promise<WorkspaceEditPreview> {
    if (!options.query.trim()) throw new Error('Enter a search term before previewing replacements.');
    const search = await searchInWorkspaceFiles(this.workspacePath, { ...options, maxResults: MAX_SEARCH_MATCHES });
    if (!search.success || !search.data) throw new Error(search.error || 'Workspace search failed.');
    const matchCount = search.data.reduce((total, result) => total + result.matches.length, 0);
    if (matchCount === 0) throw new Error('No matching text was found to replace.');
    if (matchCount >= MAX_SEARCH_MATCHES) throw new Error('Search matched the 50,000-result safety limit. Narrow the search and preview again.');

    const regex = buildSearchRegex(options);
    const files: PreviewFileSnapshot[] = [];
    for (const result of search.data) {
      if (options.filePaths?.length && !options.filePaths.includes(result.filePath)) continue;
      const { absolutePath, relativePath } = await this.resolveTarget(result.filePath);
      const original = await fs.readFile(absolutePath, 'utf8');
      const tracked = this.lspManager.getTrackedDocument(absolutePath);
      if (tracked?.isDirty) {
        // Still allow inspection; Apply will be blocked until the dirty buffer is saved or closed.
      }
      regex.lastIndex = 0;
      const replacedCount = Array.from(original.matchAll(regex)).length;
      regex.lastIndex = 0;
      const modified = original.replace(regex, options.replacement);
      if (modified !== original) files.push(await this.makeSnapshot(relativePath, modified, replacedCount, 'search-replace'));
    }
    const title = options.filePaths?.length === 1 ? `Replace “${options.query}” in ${path.basename(options.filePaths[0])}` : `Replace “${options.query}” across workspace`;
    return this.savePreview('search-replace', title, files);
  }

  public cancelPreview(previewId: string): void {
    this.previews.delete(previewId);
  }

  private async validateFreshness(snapshot: PreviewFileSnapshot, origin: WorkspaceEditOrigin): Promise<void> {
    const current = await fs.readFile(snapshot.absolutePath, 'utf8');
    if (hashContent(current) !== snapshot.originalHash) throw new Error(`Preview is stale: ${snapshot.filePath} changed on disk. Refresh the preview before applying.`);
    const tracked = this.lspManager.getTrackedDocument(snapshot.absolutePath);
    if (snapshot.documentVersion !== undefined && tracked?.version !== snapshot.documentVersion) {
      throw new Error(`Preview is stale: the open document ${snapshot.filePath} changed since the edit was computed. Refresh the preview before applying.`);
    }
    if (origin === 'search-replace' && tracked?.isDirty) {
      throw new Error(`Cannot replace ${snapshot.filePath} while it has unsaved editor changes. Save or discard the buffer, then refresh the preview.`);
    }
  }

  private async stageFiles(files: Array<{ absolutePath: string; content: string; mode: number }>, transactionId: string): Promise<string[]> {
    const staged: string[] = [];
    try {
      for (let index = 0; index < files.length; index++) {
        const file = files[index];
        const temporaryPath = path.join(path.dirname(file.absolutePath), `.ty-code-edit-${transactionId}-${index}.tmp`);
        await fs.writeFile(temporaryPath, file.content, { encoding: 'utf8', flag: 'wx', mode: file.mode });
        staged.push(temporaryPath);
      }
      return staged;
    } catch (error) {
      await Promise.all(staged.map((temporaryPath) => fs.rm(temporaryPath, { force: true }).catch(() => undefined)));
      throw error;
    }
  }

  private async commitContents(
    files: Array<{ absolutePath: string; content: string; rollbackContent: string; mode: number }>,
    transactionId: string,
    beforeCommit?: () => Promise<void>
  ): Promise<void> {
    const staged = await this.stageFiles(files, transactionId);
    const committed: number[] = [];
    try {
      await beforeCommit?.();
      for (let index = 0; index < files.length; index++) {
        await fs.rename(staged[index], files[index].absolutePath);
        committed.push(index);
      }
    } catch (error) {
      let rollbackError: unknown;
      for (const index of committed.reverse()) {
        const file = files[index];
        const rollbackPath = path.join(path.dirname(file.absolutePath), `.ty-code-rollback-${transactionId}-${index}.tmp`);
        try {
          await fs.writeFile(rollbackPath, file.rollbackContent, { encoding: 'utf8', flag: 'wx', mode: file.mode });
          await fs.rename(rollbackPath, file.absolutePath);
        } catch (rollbackFailure) {
          rollbackError = rollbackFailure;
          await fs.rm(rollbackPath, { force: true }).catch(() => undefined);
        }
      }
      await Promise.all(staged.map((temporaryPath) => fs.rm(temporaryPath, { force: true }).catch(() => undefined)));
      if (rollbackError) throw new Error(`Transaction failed and rollback needs recovery: ${error instanceof Error ? error.message : String(error)}; ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`);
      throw error;
    }
  }

  public async applyPreview(previewId: string): Promise<WorkspaceEditTransactionResult> {
    if (this.transactionInFlight) throw new Error('Another workspace edit transaction is in progress.');
    const stored = this.previews.get(previewId);
    if (!stored || stored.publicPreview.expiresAt <= Date.now()) {
      this.previews.delete(previewId);
      throw new Error('This edit preview expired. Create a new preview before applying.');
    }
    if (stored.files.length === 0) throw new Error('No changes to apply.');
    this.transactionInFlight = true;
    try {
      for (const file of stored.files) await this.validateFreshness(file, stored.publicPreview.origin);
      const transactionId = randomUUID();
      const writeFiles = stored.files.map((file) => ({ absolutePath: file.absolutePath, content: file.modifiedContent, rollbackContent: file.originalDiskContent, mode: file.mode }));
      await this.commitContents(writeFiles, transactionId, async () => {
        for (const file of stored.files) await this.validateFreshness(file, stored.publicPreview.origin);
      });
      for (const file of stored.files) this.lspManager.applyDocumentContent(file.absolutePath, file.modifiedContent, file.modifiedContent);
      const undoFiles = stored.files.map((file) => ({
        ...file,
        afterContent: file.modifiedContent,
        afterHash: hashContent(file.modifiedContent),
        afterDocumentVersion: this.lspManager.getTrackedDocument(file.absolutePath)?.version
      }));
      this.undoEntries.push({ transactionId, origin: stored.publicPreview.origin, createdAt: Date.now(), files: undoFiles });
      this.previews.delete(previewId);
      return {
        transactionId,
        origin: stored.publicPreview.origin,
        files: undoFiles.map((file) => ({ filePath: file.filePath, content: file.modifiedContent, isDirty: false })),
        fileCount: undoFiles.length,
        editCount: undoFiles.reduce((total, file) => total + file.editCount, 0)
      };
    } finally {
      this.transactionInFlight = false;
    }
  }

  public async undoTransaction(transactionId?: string): Promise<WorkspaceEditTransactionResult> {
    if (this.transactionInFlight) throw new Error('Another workspace edit transaction is in progress.');
    const entry = this.undoEntries[this.undoEntries.length - 1];
    if (!entry || (transactionId && entry.transactionId !== transactionId)) throw new Error('There is no current workspace edit transaction to undo.');
    this.transactionInFlight = true;
    try {
      const validateUndo = async () => {
        for (const file of entry.files) {
          const current = await fs.readFile(file.absolutePath, 'utf8');
          if (hashContent(current) !== file.afterHash) throw new Error(`Cannot undo the entire operation because ${file.filePath} changed after it was applied. No files were changed.`);
          const tracked = this.lspManager.getTrackedDocument(file.absolutePath);
          if (file.afterDocumentVersion !== undefined && tracked?.version !== file.afterDocumentVersion) throw new Error(`Cannot undo the entire operation because the open document ${file.filePath} changed after it was applied. No files were changed.`);
        }
      };
      await validateUndo();
      const undoId = randomUUID();
      await this.commitContents(entry.files.map((file) => ({ absolutePath: file.absolutePath, content: file.originalDiskContent, rollbackContent: file.afterContent, mode: file.mode })), undoId, validateUndo);
      this.undoEntries.pop();
      for (const file of entry.files) this.lspManager.applyDocumentContent(file.absolutePath, file.originalBufferContent, file.originalDiskContent);
      return {
        transactionId: entry.transactionId,
        origin: entry.origin,
        files: entry.files.map((file) => ({ filePath: file.filePath, content: file.originalBufferContent, isDirty: file.originalBufferWasDirty || file.originalBufferContent !== file.originalDiskContent })),
        fileCount: entry.files.length,
        editCount: entry.files.reduce((total, file) => total + file.editCount, 0)
      };
    } finally {
      this.transactionInFlight = false;
    }
  }

  public getRecentUndo(): Array<{ transactionId: string; origin: WorkspaceEditOrigin; createdAt: number; fileCount: number }> {
    return [...this.undoEntries].reverse().map((entry) => ({ transactionId: entry.transactionId, origin: entry.origin, createdAt: entry.createdAt, fileCount: entry.files.length }));
  }
}
