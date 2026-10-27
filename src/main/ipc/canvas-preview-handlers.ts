/**
 * Canvas Live Preview + Edit IPC (Prompt 4)
 *
 * - preview lifecycle: canvas:preview:start / stop / status
 * - Inspector bridge: guest pages report hover/click/select over a
 *   window.parent postMessage channel; MAIN never relays guest DOM data, the
 *   canvas window host validates and renders it directly.
 * - canvas:edit:apply routes validated CanvasEditIntent batches through the
 *   EXISTING Safe Edit Review Gate (WorkspaceEditPreviewService) — no silent
 *   disk mutation; >single-safe-edit edits open the Monaco review in the Main
 *   Editor via 'workspace-edit:preview-proposed'.
 * - canvas:structural:dispatch routes add/move/delete intents to the canvas
 *   agent engine with the extracted DesignProfile constraints fence.
 */

import { ipcMain, BrowserWindow } from 'electron';
import path from 'node:path';
import fsPromises from 'node:fs/promises';
import { z } from 'zod';
import { CanvasPreviewManager, type CanvasPreviewSnapshot, type CanvasPreviewState } from '../services/canvas-preview-manager';
import { getWorkspaceSessionManager } from '../services/workspace-session-manager';
import { searchInWorkspaceFiles } from './fs-handlers';
import { getSettings } from './settings-handlers';
import { getWorkspaceEditPreviewService } from '../services/workspace-edit-preview';
import { canvasAgentEngine } from '../agent/canvas-agent-engine';
import type { CanvasPreviewStatusPayload, IpcResponse, WorkspaceEditPreview } from '../../preload/types';

const MANAGER_KEY_NO_WORKSPACE = '/no/ty/workspace';

let previewManager: CanvasPreviewManager | null = null;

function getPreviewManager(): CanvasPreviewManager {
  if (!previewManager) {
    previewManager = new CanvasPreviewManager((snapshot) => broadcastSnapshot(snapshot));
  }
  return previewManager;
}

/** Shared singleton handle used by the canvas window close hook. */
export function getCanvasPreviewManager(): CanvasPreviewManager {
  return getPreviewManager();
}

function broadcastSnapshot(snapshot: CanvasPreviewSnapshot): void {
  const payload: CanvasPreviewStatusPayload = {
    status: snapshot.status,
    workspacePath: snapshot.workspacePath
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('canvas:preview:status', payload);
    }
  }
}

// ---------------------------------------------------------------------------
// Zod schemas — every inbound payload is validated
// ---------------------------------------------------------------------------

export const CanvasEditIntentSchema = z.object({
  intentId: z.string().min(1).max(120),
  kind: z.enum(['style', 'text', 'structural']),
  property: z.string().max(80),
  value: z.string().max(4096),
  targetSelector: z.string().min(1).max(2048),
  componentName: z.string().max(200).optional(),
  sourceFileHint: z.string().max(1024).optional(),
  originalInnerText: z.string().max(8192).optional()
});

export type ParsedCanvasEditIntent = z.infer<typeof CanvasEditIntentSchema>;

export const CanvasEditIntentBatchSchema = z.object({
  intents: z.array(CanvasEditIntentSchema).min(1).max(20)
});

export const CanvasStructuralIntentSchema = z.object({
  operation: z.enum(['add', 'move', 'delete']),
  componentName: z.string().max(200).optional(),
  targetSelector: z.string().min(1).max(2048),
  value: z.string().max(4096).optional(),
  details: z.string().max(16384).optional()
});

export type ParsedCanvasStructuralIntent = z.infer<typeof CanvasStructuralIntentSchema>;

function validationFailure(error: z.ZodError): { success: false; error: string } {
  const where = error.issues.map((i) => `${i.path.join('.') || 'payload'}: ${i.message}`).slice(0, 3).join('; ');
  return { success: false, error: `Canvas payload failed validation: ${where || 'invalid'}` };
}

// ---------------------------------------------------------------------------
// Source-file resolution for style/text intents
// ---------------------------------------------------------------------------

async function hintToFile(workspacePath: string, hint: string): Promise<string | null> {
  try {
    const abs = path.isAbsolute(hint) ? hint : path.join(workspacePath, hint.replace(/^[/\\]+/, ''));
    const resolved = path.resolve(abs);
    const root = path.resolve(workspacePath);
    const rel = path.relative(root, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
    const stat = await fsPromises.stat(resolved);
    return stat.isFile() ? resolved : null;
  } catch {
    return null;
  }
}

async function grepIntentFile(
  workspaceRoot: string,
  needle: string,
  componentName: string | undefined
): Promise<string | null> {
  const query = (needle || componentName || '').trim();
  if (!query) return null;
  const result = await searchInWorkspaceFiles(workspaceRoot, {
    query,
    isRegex: false,
    isCaseSensitive: false,
    matchWholeWord: false,
    includePattern: componentName ? `*${componentName}*` : undefined,
    excludePattern: undefined,
    maxResults: 10
  });
  const results = result.success ? result.data ?? [] : [];
  if (!results.length) return null;
  const preferred = results.find((r) => /\.(tsx|jsx|ts|js|css|scss|svelte|vue)$/i.test(r.relativePath) && !r.relativePath.includes('node_modules'));
  const hit = preferred ?? results[0];
  return path.join(workspaceRoot, hit.relativePath);
}

function cssPropertyToken(property: string): string {
  return property.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

function tailwindTokenForProperty(property: string): string | null {
  switch (property) {
    case 'color': return 'text';
    case 'background': case 'backgroundColor': return 'bg';
    case 'padding': return 'p';
    case 'margin': return 'm';
    case 'fontSize': return 'text';
    case 'fontWeight': return 'font';
    case 'borderRadius': return 'rounded';
    case 'gap': return 'gap';
    case 'width': return 'w';
    case 'height': return 'h';
    default: return null;
  }
}

function buildSnippetEdit(intent: ParsedCanvasEditIntent, content: string): { original: string; replacement: string; lineNumber: number } | null {
  const lines = content.split(/\r?\n/);

  if (intent.kind === 'text') {
    const target = (intent.originalInnerText ?? '').trim();
    if (!target) return null;
    const lineIndex = lines.findIndex((line) => line.includes(target) && /[{('"`]/.test(line));
    const chosen = lineIndex >= 0 ? lineIndex : lines.findIndex((line) => line.includes(target));
    if (chosen < 0) return null;
    const original = lines[chosen];
    const replacement = original.replace(target, intent.value);
    if (replacement === original) return null;
    return { original, replacement, lineNumber: chosen + 1 };
  }

  const propToken = cssPropertyToken(intent.property);
  const tailwindProperty = tailwindTokenForProperty(intent.property);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const originalLine = lines[lineIndex];
    if (tailwindProperty) {
      const tailwindTester = new RegExp(`(?:${tailwindProperty})-\\[[^\\]]*\\]|${tailwindProperty}-[\\w#()\\[\\]/.:%-]+`);
      if (tailwindTester.test(originalLine)) {
        const replacementLine = originalLine.replace(tailwindTester, `${tailwindProperty}-[${intent.value.replace(/[\\[\]"']/g, '')}]`);
        if (replacementLine !== originalLine) return { original: originalLine, replacement: replacementLine, lineNumber: lineIndex + 1 };
      }
    }
    const quotedTester = new RegExp(`(${propToken}\\s*:\\s*)(['"\\\`])([^;'"\\\`}]+)\\2`, 'i');
    const quoted = originalLine.match(quotedTester);
    if (quoted) {
      const replacementLine = originalLine.replace(quotedTester, (_full, prefix: string, quote: string) => `${prefix}${quote}${intent.value}${quote}`);
      if (replacementLine !== originalLine) return { original: originalLine, replacement: replacementLine, lineNumber: lineIndex + 1 };
    }
    const unquotedTester = new RegExp(`(${propToken}\\s*:\\s*)([^;'}"[\\n]+)`, 'i');
    const unquoted = originalLine.match(unquotedTester);
    if (unquoted) {
      const replacementLine = originalLine.replace(unquotedTester, (_full, prefix: string) => `${prefix}${intent.value}`);
      if (replacementLine !== originalLine) return { original: originalLine, replacement: replacementLine, lineNumber: lineIndex + 1 };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Safe-gate application
// ---------------------------------------------------------------------------

async function applyCanvasEditIntents(
  intents: ParsedCanvasEditIntent[],
  workspacePath: string
): Promise<IpcResponse<{ autoApplied: boolean; files: string[] }>> {
  const service = getWorkspaceEditPreviewService();
  const settings = (await getSettings()).data;
  const autoApplyPolicy = { enabled: settings?.['editor.reviewPolicy'] === 'autoApplySafeSingleFile', forcePreviewAll: false };
  const files: string[] = [];
  const appliedFiles: string[] = [];

  for (const intent of intents) {
    if (intent.kind === 'structural') {
      return { success: false, error: 'Structural edits route through the canvas:structural:dispatch channel.' };
    }

    const hinted = intent.sourceFileHint ? await hintToFile(workspacePath, intent.sourceFileHint) : null;
    const file = hinted ?? await grepIntentFile(workspacePath, intent.originalInnerText ?? '', intent.componentName);
    if (!file) {
      return { success: false, error: `Could not resolve a source file for selector "${intent.targetSelector}" (component ${intent.componentName ?? 'unknown'}).` };
    }

    let content: string;
    try {
      content = await fsPromises.readFile(file, 'utf8');
      if (content.includes('\0')) throw new Error('binary file');
    } catch {
      return { success: false, error: `Source file is not readable as text: ${path.basename(file)}` };
    }

    const edit = buildSnippetEdit(intent, content);
    if (!edit) {
      return { success: false, error: `No supported ${intent.kind} patch for "${intent.property}" was found in ${path.basename(file)}.` };
    }

    const preview = await service.createSnippetEditPreview({
      filePath: file,
      lineNumber: edit.lineNumber,
      originalText: edit.original,
      replacementText: edit.replacement,
      title: `Canvas live edit — ${intent.property || intent.kind}${intent.componentName ? ` · ${intent.componentName}` : ''}`
    });
    files.push(path.relative(workspacePath, file).replace(/\\/g, '/'));

    // Safe Edit Review Gate: tryAutoApplyPreview enforces the user's review
    // policy + the service's single-safe-edit classifier (>threshold edits
    // always open the Monaco diff in the Main Editor). No silent disk writes.
    const applied = await service.tryAutoApplyPreview(preview.previewId, autoApplyPolicy);
    if (applied) {
      appliedFiles.push(path.relative(workspacePath, file).replace(/\\/g, '/'));
    } else {
      broadcastPreviewProposed(preview, intent);
    }
  }

  if (appliedFiles.length > 0) {
    broadcastEditApplied(appliedFiles);
  }
  if (files.length === 0) {
    return { success: false, error: 'No intents were applicable.' };
  }
  return { success: true, data: { autoApplied: appliedFiles.length > 0, files } };
}

function broadcastPreviewProposed(
  preview: WorkspaceEditPreview,
  intent: ParsedCanvasEditIntent
): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('workspace-edit:preview-proposed', {
        canvas: {
          selector: intent.targetSelector,
          component: intent.componentName ?? null,
          property: intent.property
        },
        preview
      });
    }
  }
}

function broadcastEditApplied(files: string[]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('canvas-edit:applied', { files, at: Date.now() });
    }
  }
}

// ---------------------------------------------------------------------------
// Structural routing → canvas agent engine (DesignProfile constraints)
// ---------------------------------------------------------------------------

export async function dispatchStructuralToAgent(
  intent: ParsedCanvasStructuralIntent,
  workspaceRoot: string,
  awaitCompletion: boolean
): Promise<void> {
  const palette = await constraintFence(workspaceRoot);
  const componentName = intent.componentName ?? 'the nearest component';
  const goal = `[M3E Canvas structural edit]\nOperation: ${intent.operation.toUpperCase()} — ${intent.targetSelector}\nAttach component: ${componentName}${intent.value ? `\nTarget state: ${intent.value}` : ''}${intent.details ? `\nDesigner note: ${intent.details}` : ''}\n${palette}\nApply the change to the workspace source so the live preview hot-reloads.`;

  const run = canvasAgentEngine.generate(goal, { workspaceRoot });
  if (awaitCompletion) await run;
  else void run.catch(() => { /* agent failures surface in canvas chat */ });
}

async function constraintFence(workspaceRoot: string): Promise<string> {
  try {
    const { extractDesignSystem } = await import('../services/context-engine/design-system-extractor');
    const profile = await extractDesignSystem(workspaceRoot);
    const colorEntries = Object.entries(profile.colors).slice(0, 8);
    const spacingEntries = Object.entries(profile.spacing).slice(0, 6);
    const lines: string[] = [`CSS framework: ${profile.cssFramework}; UI library: ${profile.uiLibrary}.`];
    if (colorEntries.length > 0) lines.push(`Palette (DesignProfile colors): ${colorEntries.map(([k, v]) => `${k}=${v}`).join(', ')} — keep colors within this palette.`);
    if (spacingEntries.length > 0) lines.push(`Spacing scale: ${spacingEntries.map(([k, v]) => `${k}=${v}`).join(', ')} — reuse existing spacing tokens.`);
    if (profile.tailwindClasses.length > 0) lines.push(`Existing Tailwind classes: ${profile.tailwindClasses.slice(0, 20).join(' ')}`);
    return `DesignProfile constraints: ${lines.join('\n')}`;
  } catch {
    return 'DesignProfile constraint: keep colors and radii consistent with the running preview (extractor unavailable).';
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerCanvasPreviewHandlers(): void {
  ipcMain.handle('canvas:preview:start', async (): Promise<IpcResponse<CanvasPreviewStatusPayload>> => {
    try {
      const root = getWorkspaceSessionManager().getSession().rootPath;
      if (!root) {
        return { success: false, error: 'No workspace open in the session bus.' };
      }
      const snap = await getPreviewManager().ensureForWorkspace(root);
      return { success: true, data: { status: snap.status, workspacePath: snap.workspacePath } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas:preview:status', async (): Promise<IpcResponse<CanvasPreviewStatusPayload>> => {
    const root = getWorkspaceSessionManager().getSession().rootPath ?? '';
    try {
      const snap = await getPreviewManager().statusForCurrent(root);
      return { success: true, data: { status: snap.status, workspacePath: snap.workspacePath } };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas:preview:stop', async (): Promise<IpcResponse<CanvasPreviewStatusPayload>> => {
    try {
      const root = getWorkspaceSessionManager().getSession().rootPath;
      await getPreviewManager().stopForCurrent(root);
      const state: CanvasPreviewState = 'stopped';
      return {
        success: true,
        data: {
          status: { mode: 'none', state, url: null, error: null, adapter: 'stopped by user' },
          workspacePath: root ?? ''
        }
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('canvas:edit:apply', async (_event, payload: unknown): Promise<IpcResponse<{ autoApplied?: boolean; files?: string[]; routedToAgent?: number }>> => {
    try {
      const parsed = CanvasEditIntentBatchSchema.safeParse(payload);
      if (!parsed.success) return validationFailure(parsed.error);
      const root = getWorkspaceSessionManager().getSession().rootPath;
      if (!root) return { success: false, error: 'No workspace open in the session bus.' };
      return await applyCanvasEditIntents(parsed.data.intents, root);
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('canvas:structural:dispatch', async (_event, payload: unknown): Promise<IpcResponse<void>> => {
    try {
      const parsed = CanvasStructuralIntentSchema.safeParse(payload);
      if (!parsed.success) return validationFailure(parsed.error);
      const root = getWorkspaceSessionManager().getSession().rootPath;
      if (!root) return { success: false, error: 'No workspace open in the session bus.' };
      await dispatchStructuralToAgent(parsed.data, root, false);
      return { success: true, data: undefined };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('canvas:preview:dispose-all', async (): Promise<IpcResponse<void>> => {
    try {
      await getPreviewManager().stopAll();
      return { success: true, data: undefined };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) };
    }
  });
}
