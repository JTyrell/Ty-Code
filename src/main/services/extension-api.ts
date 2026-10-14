import type { ExtensionManifest } from '../../preload/types';

export interface Disposable {
  dispose: () => void;
}

export interface WorkspaceEdit {
  changes: Record<string, Array<{
    range: { startLine: number; startColumn: number; endLine: number; endColumn: number };
    newText: string;
  }>>;
}

export interface TextDocument {
  uri: string;
  fileName: string;
  languageId: string;
  lineCount: number;
  getText: () => string;
}

export interface TextEditor {
  document: TextDocument;
  selection: { startLine: number; startColumn: number; endLine: number; endColumn: number };
  edit: (callback: (editBuilder: {
    insert: (line: number, column: number, value: string) => void;
    delete: (range: { startLine: number; startColumn: number; endLine: number; endColumn: number }) => void;
    replace: (range: { startLine: number; startColumn: number; endLine: number; endColumn: number }, value: string) => void;
  }) => void) => Promise<boolean>;
}

export interface CompletionItem {
  label: string;
  kind?: string;
  detail?: string;
  documentation?: string;
  insertText?: string;
}

export interface OutputChannel {
  name: string;
  append: (value: string) => void;
  appendLine: (value: string) => void;
  clear: () => void;
  show: () => void;
}

export interface ExtensionContext {
  subscriptions: Disposable[];
  extensionPath: string;
  storagePath: string;
  globalState: {
    get: <T>(key: string, defaultValue?: T) => T;
    update: (key: string, value: unknown) => Promise<void>;
  };
}

export interface TyClaudeExtensionAPI {
  workspace: {
    openTextDocument: (uri: string) => Promise<TextDocument>;
    createFileSystemWatcher: (globPattern: string) => Disposable;
    findFiles: (include: string, exclude?: string) => Promise<string[]>;
    applyEdit: (edit: WorkspaceEdit) => Promise<boolean>;
  };
  editor: {
    registerTextEditorCommand: (commandId: string, callback: (editor: TextEditor, ...args: unknown[]) => void) => Disposable;
    setDecorations: (decorationType: string, ranges: Array<{ startLine: number; endLine: number }>) => void;
    revealRange: (range: { startLine: number; endLine: number }, revealType?: string) => void;
  };
  commands: {
    registerCommand: (commandId: string, callback: (...args: unknown[]) => unknown) => Disposable;
    executeCommand: (commandId: string, ...args: unknown[]) => Promise<unknown>;
  };
  languages: {
    registerCompletionItemProvider: (selector: string | string[], provider: {
      provideCompletionItems: (document: TextDocument, position: { line: number; column: number }) => CompletionItem[] | Promise<CompletionItem[]>;
    }) => Disposable;
    registerHoverProvider: (selector: string | string[], provider: {
      provideHover: (document: TextDocument, position: { line: number; column: number }) => { contents: string[] } | Promise<{ contents: string[] }>;
    }) => Disposable;
    registerDefinitionProvider: (selector: string | string[], provider: unknown) => Disposable;
    registerCodeActionsProvider: (selector: string | string[], provider: unknown) => Disposable;
  };
  window: {
    showInformationMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
    showInputBox: (options: { prompt?: string; value?: string; placeHolder?: string }) => Promise<string | undefined>;
    createOutputChannel: (name: string) => OutputChannel;
    createWebviewPanel: (viewType: string, title: string, showOptions: unknown, options?: unknown) => unknown;
  };
  terminal: {
    createTerminal: (name: string, shellPath?: string, shellArgs?: string[]) => unknown;
    sendText: (text: string, addNewLine?: boolean) => void;
  };
}

export function validateExtensionManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!manifest || typeof manifest !== 'object') {
    return { valid: false, errors: ['Manifest must be a non-null object.'] };
  }

  const m = manifest as Record<string, unknown>;
  if (!m.name || typeof m.name !== 'string') errors.push('Missing or invalid "name" attribute.');
  if (!m.publisher || typeof m.publisher !== 'string') errors.push('Missing or invalid "publisher" attribute.');
  if (!m.version || typeof m.version !== 'string') errors.push('Missing or invalid "version" attribute.');

  return {
    valid: errors.length === 0,
    errors
  };
}
