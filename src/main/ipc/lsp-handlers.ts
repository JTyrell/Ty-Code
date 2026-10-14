/**
 * Ty-Code LSP IPC Handlers
 * Connects renderer IPC calls to LspManager methods
 */

import { LspManager, type LanguageServerConfig } from '../services/lsp-manager';
import { getSettings, saveSettings } from './settings-handlers';
import type { IpcResponse } from '../../preload/types';

export function getLspManager(workspacePath?: string): LspManager {
  return LspManager.getInstance(workspacePath);
}

const loadedSettings = new WeakSet<LspManager>();
async function loadLspSettings(manager: LspManager): Promise<void> {
  if (loadedSettings.has(manager)) return;
  const response = await getSettings();
  const settings = response.data;
  manager.setAutoStart(settings?.['lsp.autoStart'] ?? true);
  for (const [languageId, config] of Object.entries(settings?.languageServers || {})) {
    try { await manager.configureServer(languageId, config); }
    catch { /* Invalid persisted server paths fail closed and remain editable in Settings. */ }
  }
  loadedSettings.add(manager);
}

export async function handleGetLspServers(workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  await loadLspSettings(manager);
  await manager.refreshAvailability();
  return { success: true, data: manager.getAllServers() };
}

export async function handleStartLspServer(languageId: string, workspacePath?: string): Promise<IpcResponse<boolean>> {
  const manager = getLspManager(workspacePath);
  await loadLspSettings(manager);
  const started = await manager.startServer(languageId);
  return { success: started, data: started };
}

export async function handleStopLspServer(languageId: string, workspacePath?: string): Promise<IpcResponse<void>> {
  const manager = getLspManager(workspacePath);
  await manager.stopServer(languageId);
  return { success: true };
}

export async function handleRestartLspServer(languageId: string, workspacePath?: string): Promise<IpcResponse<boolean>> {
  const manager = getLspManager(workspacePath);
  await loadLspSettings(manager);
  const restarted = await manager.restartServer(languageId);
  return { success: restarted, data: restarted };
}

export async function handleConfigureLspServer(languageId: string, config: LanguageServerConfig, workspacePath?: string): Promise<IpcResponse<void>> {
  try {
    const manager = getLspManager(workspacePath);
    await loadLspSettings(manager);
    await manager.configureServer(languageId, config);
    const persisted = await saveSettings({ languageServers: { [languageId]: config } });
    if (!persisted.success) throw new Error(persisted.error || 'Language-server settings could not be saved.');
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function handleLspDidOpen(payload: { filePath: string; languageId: string; text: string }, workspacePath?: string): Promise<IpcResponse<void>> {
  const manager = getLspManager(workspacePath);
  await loadLspSettings(manager);
  await manager.onDocumentOpened(payload.filePath, payload.languageId, payload.text);
  return { success: true };
}

export function handleLspDidChange(payload: { filePath: string; text: string }, workspacePath?: string): IpcResponse<void> {
  const manager = getLspManager(workspacePath);
  manager.onDocumentChanged(payload.filePath, payload.text);
  return { success: true };
}

export function handleLspDidSave(payload: { filePath: string; text?: string }, workspacePath?: string): IpcResponse<void> {
  const manager = getLspManager(workspacePath);
  manager.onDocumentSaved(payload.filePath, payload.text);
  return { success: true };
}

export function handleLspDidClose(payload: { filePath: string }, workspacePath?: string): IpcResponse<void> {
  const manager = getLspManager(workspacePath);
  manager.onDocumentClosed(payload.filePath);
  return { success: true };
}

export async function handleLspCompletion(payload: { filePath: string; line: number; character: number }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getCompletions(payload.filePath, { line: payload.line, character: payload.character });
}

export async function handleLspHover(payload: { filePath: string; line: number; character: number }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getHover(payload.filePath, { line: payload.line, character: payload.character });
}

export async function handleLspDefinition(payload: { filePath: string; line: number; character: number }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getDefinition(payload.filePath, { line: payload.line, character: payload.character });
}

export async function handleLspTypeDefinition(payload: { filePath: string; line: number; character: number }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getTypeDefinition(payload.filePath, { line: payload.line, character: payload.character });
}

export async function handleLspImplementation(payload: { filePath: string; line: number; character: number }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getImplementation(payload.filePath, { line: payload.line, character: payload.character });
}

export async function handleLspReferences(payload: { filePath: string; line: number; character: number; includeDeclaration?: boolean }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getReferences(payload.filePath, { line: payload.line, character: payload.character }, payload.includeDeclaration);
}

export async function handleLspRename(payload: { filePath: string; line: number; character: number; newName: string }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.renameSymbol(payload.filePath, { line: payload.line, character: payload.character }, payload.newName);
}

export async function handleLspDocumentSymbols(payload: { filePath: string }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getDocumentSymbols(payload.filePath);
}

export async function handleLspWorkspaceSymbols(payload: { query: string }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getWorkspaceSymbols(payload.query);
}

export async function handleLspCodeActions(payload: { filePath: string; range: any; context?: any }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getCodeActions(payload.filePath, payload.range, payload.context);
}

export async function handleLspSignatureHelp(payload: { filePath: string; line: number; character: number }, workspacePath?: string): Promise<IpcResponse<any>> {
  const manager = getLspManager(workspacePath);
  return manager.getSignatureHelp(payload.filePath, { line: payload.line, character: payload.character });
}
