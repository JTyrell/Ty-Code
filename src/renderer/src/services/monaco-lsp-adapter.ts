/**
 * Ty-Code Monaco LSP Adapter
 * Bridges Monaco Editor instances with Language Server Protocol IPC endpoints.
 * Registers completion, hover, definition, references, rename, symbols, and signature help.
 */

import type * as monacoType from 'monaco-editor';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useEditorNavigationStore } from '../state/editor-navigation-store';
import { handleAutoAppliedTransaction } from './workspace-edit-commands';
import { useLspStore } from '../state/lsp-store';
import { toast } from '../state/toast-store';

const changeDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();

type Monaco = typeof monacoType;

const REGISTERED_LANGUAGES = ['typescript', 'javascript', 'python', 'rust', 'go', 'cpp', 'c', 'java'];
let isAdapterRegistered = false;
let editorOpenerRegistered = false;
let reviewCommandRegistered = false;

// Conversion helpers from LSP to Monaco types
function toMonacoRange(range: any): monacoType.IRange {
  if (!range || !range.start) {
    return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 };
  }
  return {
    startLineNumber: (range.start.line ?? 0) + 1,
    startColumn: (range.start.character ?? 0) + 1,
    endLineNumber: (range.end?.line ?? range.start.line ?? 0) + 1,
    endColumn: (range.end?.character ?? range.start.character ?? 0) + 1
  };
}

function toMonacoCompletionKind(monaco: Monaco, kind?: number): monacoType.languages.CompletionItemKind {
  const K = monaco.languages.CompletionItemKind;
  switch (kind) {
    case 1: return K.Text;
    case 2: return K.Method;
    case 3: return K.Function;
    case 4: return K.Constructor;
    case 5: return K.Field;
    case 6: return K.Variable;
    case 7: return K.Class;
    case 8: return K.Interface;
    case 9: return K.Module;
    case 10: return K.Property;
    case 11: return K.Unit;
    case 12: return K.Value;
    case 13: return K.Enum;
    case 14: return K.Keyword;
    case 15: return K.Snippet;
    case 16: return K.Color;
    case 17: return K.File;
    case 18: return K.Reference;
    case 19: return K.Folder;
    case 20: return K.EnumMember;
    case 21: return K.Constant;
    case 22: return K.Struct;
    case 23: return K.Event;
    case 24: return K.Operator;
    case 25: return K.TypeParameter;
    default: return K.Text;
  }
}

function toMonacoSymbolKind(monaco: Monaco, kind: number): monacoType.languages.SymbolKind {
  const K = monaco.languages.SymbolKind;
  switch (kind) {
    case 1: return K.File;
    case 2: return K.Module;
    case 3: return K.Namespace;
    case 4: return K.Package;
    case 5: return K.Class;
    case 6: return K.Method;
    case 7: return K.Property;
    case 8: return K.Field;
    case 9: return K.Constructor;
    case 10: return K.Enum;
    case 11: return K.Interface;
    case 12: return K.Function;
    case 13: return K.Variable;
    case 14: return K.Constant;
    case 15: return K.String;
    case 16: return K.Number;
    case 17: return K.Boolean;
    case 18: return K.Array;
    case 19: return K.Object;
    case 20: return K.Key;
    case 21: return K.Null;
    case 22: return K.EnumMember;
    case 23: return K.Struct;
    case 24: return K.Event;
    case 25: return K.Operator;
    case 26: return K.TypeParameter;
    default: return K.Variable;
  }
}

function parseUri(monaco: Monaco, uriStr: string): monacoType.Uri {
  return monaco.Uri.parse(uriStr);
}

function getModelPath(model: monacoType.editor.ITextModel): string {
  return model.uri.scheme === 'file' ? model.uri.fsPath : model.uri.path;
}

function toMonacoLocations(monaco: Monaco, result: any): monacoType.languages.Location[] {
  const raw = Array.isArray(result) ? result : result ? [result] : [];
  return raw.flatMap((location: any) => {
    if (location.uri && location.range) return [{ uri: parseUri(monaco, location.uri), range: toMonacoRange(location.range) }];
    if (location.targetUri && location.targetRange) return [{ uri: parseUri(monaco, location.targetUri), range: toMonacoRange(location.targetSelectionRange || location.targetRange) }];
    return [];
  });
}

const LSP_MARKER_OWNER = 'ty-code-lsp';

async function requestWorkspaceEditPreview(
  edit: unknown,
  title: string,
  origin: 'lsp-rename' | 'refactor',
  forcePreview: boolean
): Promise<void> {
  const response = await window.electronAPI.previewLspWorkspaceEdit({ edit, title, origin, forcePreview });
  if (!response.success || !response.data) throw new Error(response.error || 'Could not create the workspace edit preview.');
  if (response.data.applied) {
    handleAutoAppliedTransaction(response.data.applied);
    return;
  }
  if (!response.data.preview) throw new Error('The workspace edit preview was empty.');
  useWorkspaceEditStore.getState().setRequest({
    preview: response.data.preview,
    isStale: false,
    refresh: async () => {
      const refreshed = await window.electronAPI.previewLspWorkspaceEdit({ edit, title, origin, forcePreview: true });
      if (!refreshed.success || !refreshed.data?.preview) throw new Error(refreshed.error || 'Could not refresh the workspace edit preview.');
      return refreshed.data.preview;
    }
  });
}

function toMonacoMarkerSeverity(monaco: Monaco, severity?: number): monacoType.MarkerSeverity {
  switch (severity) {
    case 1: return monaco.MarkerSeverity.Error;
    case 2: return monaco.MarkerSeverity.Warning;
    case 3: return monaco.MarkerSeverity.Info;
    case 4: return monaco.MarkerSeverity.Hint;
    default: return monaco.MarkerSeverity.Info;
  }
}

function applyDiagnosticsToModel(monaco: Monaco, event: { filePath: string; diagnostics: Array<{ range: any; severity?: number; code?: number | string; source?: string; message: string }> }): void {
  const model = monaco.editor.getModel(monaco.Uri.file(event.filePath));
  if (!model) return;
  monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, event.diagnostics.map((diagnostic) => ({
    ...toMonacoRange(diagnostic.range),
    severity: toMonacoMarkerSeverity(monaco, diagnostic.severity),
    code: diagnostic.code === undefined ? undefined : String(diagnostic.code),
    source: diagnostic.source,
    message: diagnostic.message
  })));
}

export function applyStoredDiagnostics(monaco: Monaco, filePath: string): void {
  const event = useLspStore.getState().diagnostics[filePath];
  if (event) applyDiagnosticsToModel(monaco, event);
}

export function subscribeLspDiagnostics(monaco: Monaco): () => void {
  if (!window.electronAPI) return () => undefined;
  const unsubscribe = window.electronAPI.onLspDiagnostics((event) => {
    useLspStore.getState().setDiagnostics(event);
    applyDiagnosticsToModel(monaco, event);
  });
  for (const event of Object.values(useLspStore.getState().diagnostics)) applyDiagnosticsToModel(monaco, event);
  return () => {
    unsubscribe();
    for (const model of monaco.editor.getModels()) monaco.editor.setModelMarkers(model, LSP_MARKER_OWNER, []);
  };
}

export function registerMonacoLspProviders(monaco: Monaco): void {
  if (isAdapterRegistered || !window.electronAPI) return;
  isAdapterRegistered = true;

  const typescriptMode = monaco.languages.typescript.typescriptDefaults;
  const javascriptMode = monaco.languages.typescript.javascriptDefaults;
  typescriptMode.setModeConfiguration({ ...typescriptMode.modeConfiguration, rename: false });
  javascriptMode.setModeConfiguration({ ...javascriptMode.modeConfiguration, rename: false });
  if (!reviewCommandRegistered) {
    reviewCommandRegistered = true;
    monaco.editor.registerCommand('tycode.lsp.applyReviewedEdit', (_accessor, edit: unknown, title: string) => {
      void requestWorkspaceEditPreview(edit, title, 'refactor', useWorkspaceEditStore.getState().forcePreviewAll).catch((error: unknown) => {
        toast.error('Code action failed', error instanceof Error ? error.message : String(error));
      });
    });
  }
  if (!editorOpenerRegistered) {
    editorOpenerRegistered = true;
    monaco.editor.registerEditorOpener({
      openCodeEditor: async (_source, resource, selectionOrPosition) => {
        const line = selectionOrPosition && 'lineNumber' in selectionOrPosition
          ? selectionOrPosition.lineNumber
          : selectionOrPosition && 'startLineNumber' in selectionOrPosition
            ? selectionOrPosition.startLineNumber
            : 1;
        const column = selectionOrPosition && 'column' in selectionOrPosition
          ? selectionOrPosition.column
          : selectionOrPosition && 'startColumn' in selectionOrPosition
            ? selectionOrPosition.startColumn
            : 1;
        useEditorNavigationStore.getState().navigateTo({ filePath: resource.fsPath || resource.path, line, column });
        return true;
      }
    });
  }

  for (const lang of REGISTERED_LANGUAGES) {
    // 1. Completion Provider
    monaco.languages.registerCompletionItemProvider(lang, {
      triggerCharacters: ['.', ':', '/', '@', '"', "'", '<', '$', '_'],
      provideCompletionItems: async (model, position) => {
        try {
          const filePath = getModelPath(model);
          const res = await window.electronAPI.lspCompletion({
            filePath,
            line: position.lineNumber - 1,
            character: position.column - 1
          });

          if (!res.success || !res.data) {
            return { suggestions: [] };
          }

          const rawItems = Array.isArray(res.data) ? res.data : res.data.items || [];
          const word = model.getWordUntilPosition(position);
          const defaultRange: monacoType.IRange = {
            startLineNumber: position.lineNumber,
            endLineNumber: position.lineNumber,
            startColumn: word.startColumn,
            endColumn: word.endColumn
          };

          const suggestions: monacoType.languages.CompletionItem[] = rawItems.map((item: any) => ({
            label: typeof item.label === 'string' ? item.label : item.label?.label || '',
            kind: toMonacoCompletionKind(monaco, item.kind),
            detail: item.detail,
            documentation: typeof item.documentation === 'string'
              ? item.documentation
              : item.documentation?.value,
            insertText: item.insertText || (typeof item.label === 'string' ? item.label : item.label?.label || ''),
            range: item.textEdit?.range ? toMonacoRange(item.textEdit.range) : defaultRange,
            sortText: item.sortText,
            filterText: item.filterText
          }));

          return { suggestions };
        } catch {
          return { suggestions: [] };
        }
      }
    });

    // 2. Hover Provider
    monaco.languages.registerHoverProvider(lang, {
      provideHover: async (model, position) => {
        try {
          const filePath = getModelPath(model);
          const res = await window.electronAPI.lspHover({
            filePath,
            line: position.lineNumber - 1,
            character: position.column - 1
          });

          if (!res.success || !res.data || !res.data.contents) {
            return null;
          }

          const raw = res.data.contents;
          const contents: monacoType.IMarkdownString[] = [];

          if (typeof raw === 'string') {
            contents.push({ value: raw });
          } else if (Array.isArray(raw)) {
            for (const c of raw) {
              if (typeof c === 'string') contents.push({ value: c });
              else if (c && c.value) contents.push({ value: `\`\`\`${c.language || ''}\n${c.value}\n\`\`\`` });
            }
          } else if (raw && raw.value) {
            contents.push({ value: raw.value });
          }

          return {
            range: res.data.range ? toMonacoRange(res.data.range) : undefined,
            contents
          };
        } catch {
          return null;
        }
      }
    });

    // 3. Definition Provider (F12)
    monaco.languages.registerDefinitionProvider(lang, {
      provideDefinition: async (model, position) => {
        try {
          const filePath = getModelPath(model);
          const res = await window.electronAPI.lspDefinition({
            filePath,
            line: position.lineNumber - 1,
            character: position.column - 1
          });

          if (!res.success || !res.data) return null;

          const raw = Array.isArray(res.data) ? res.data : [res.data];
          const locations: monacoType.languages.Location[] = [];

          for (const loc of raw) {
            if (loc.uri && loc.range) {
              locations.push({
                uri: parseUri(monaco, loc.uri),
                range: toMonacoRange(loc.range)
              });
            } else if (loc.targetUri && loc.targetRange) {
              locations.push({
                uri: parseUri(monaco, loc.targetUri),
                range: toMonacoRange(loc.targetRange)
              });
            }
          }

          return locations.length === 1 ? locations[0] : locations;
        } catch {
          return null;
        }
      }
    });

    // Type and implementation navigation
    monaco.languages.registerTypeDefinitionProvider(lang, {
      provideTypeDefinition: async (model, position) => {
        const response = await window.electronAPI.lspTypeDefinition({ filePath: getModelPath(model), line: position.lineNumber - 1, character: position.column - 1 });
        return response.success && response.data ? toMonacoLocations(monaco, response.data) : null;
      }
    });
    monaco.languages.registerImplementationProvider(lang, {
      provideImplementation: async (model, position) => {
        const response = await window.electronAPI.lspImplementation({ filePath: getModelPath(model), line: position.lineNumber - 1, character: position.column - 1 });
        return response.success && response.data ? toMonacoLocations(monaco, response.data) : null;
      }
    });

    // Code actions with text edits are converted to review commands, never returned as implicit writes.
    monaco.languages.registerCodeActionProvider(lang, {
      provideCodeActions: async (model, range, context) => {
        const response = await window.electronAPI.lspCodeActions({
          filePath: getModelPath(model),
          range: {
            start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
            end: { line: range.endLineNumber - 1, character: range.endColumn - 1 }
          },
          context: { diagnostics: context.markers.map((marker) => ({ message: marker.message, severity: marker.severity })) }
        });
        if (!response.success || !Array.isArray(response.data)) return { actions: [], dispose: () => undefined };
        const actions: monacoType.languages.CodeAction[] = response.data.map((action: any) => ({
          title: action.title || 'Language-server action',
          kind: action.kind,
          diagnostics: context.markers,
          disabled: action.edit ? undefined : 'This server command is not supported yet.',
          command: action.edit ? {
            id: 'tycode.lsp.applyReviewedEdit',
            title: action.title || 'Review language-server edit',
            arguments: [action.edit, action.title || 'Review language-server edit']
          } : undefined
        }));
        return { actions, dispose: () => undefined };
      }
    });

    // 4. Reference Provider (Shift+F12)
    monaco.languages.registerReferenceProvider(lang, {
      provideReferences: async (model, position, context) => {
        try {
          const filePath = getModelPath(model);
          const res = await window.electronAPI.lspReferences({
            filePath,
            line: position.lineNumber - 1,
            character: position.column - 1,
            includeDeclaration: context.includeDeclaration
          });

          if (!res.success || !Array.isArray(res.data)) return [];

          return res.data.map((loc: any) => ({
            uri: parseUri(monaco, loc.uri),
            range: toMonacoRange(loc.range)
          }));
        } catch {
          return [];
        }
      }
    });

    // 5. Rename Provider (F2): return no Monaco edits. All writes go through the review surface.
    monaco.languages.registerRenameProvider(lang, {
      provideRenameEdits: async (model, position, newName) => {
        try {
          const request = {
            filePath: getModelPath(model),
            line: position.lineNumber - 1,
            character: position.column - 1,
            newName,
            forcePreview: useWorkspaceEditStore.getState().forcePreviewAll
          };
          const response = await window.electronAPI.lspRenamePreview(request);
          if (!response.success || !response.data) return null;
          if (response.data.applied) {
            handleAutoAppliedTransaction(response.data.applied);
            return null;
          }
          const preview = response.data.preview;
          if (!preview) return null;
          useWorkspaceEditStore.getState().setRequest({
            preview,
            isStale: false,
            refresh: async () => {
              const refreshed = await window.electronAPI.lspRenamePreview({ ...request, forcePreview: true });
              if (!refreshed.success || !refreshed.data?.preview) throw new Error(refreshed.error || 'Could not refresh rename preview.');
              return refreshed.data.preview;
            }
          });
          return null;
        } catch {
          return null;
        }
      }
    });

    // 6. Document Symbol Provider (Outline / Breadcrumbs)
    monaco.languages.registerDocumentSymbolProvider(lang, {
      provideDocumentSymbols: async (model) => {
        try {
          const filePath = getModelPath(model);
          const res = await window.electronAPI.lspDocumentSymbols({ filePath });

          if (!res.success || !Array.isArray(res.data)) return [];

          function mapSymbol(sym: any): monacoType.languages.DocumentSymbol {
            return {
              name: sym.name,
              detail: sym.detail || '',
              kind: toMonacoSymbolKind(monaco, sym.kind),
              tags: [],
              range: toMonacoRange(sym.range),
              selectionRange: toMonacoRange(sym.selectionRange || sym.range),
              children: Array.isArray(sym.children) ? sym.children.map(mapSymbol) : []
            };
          }

          return res.data.map(mapSymbol);
        } catch {
          return [];
        }
      }
    });

    // 7. Signature Help Provider
    monaco.languages.registerSignatureHelpProvider(lang, {
      signatureHelpTriggerCharacters: ['(', ','],
      provideSignatureHelp: async (model, position) => {
        try {
          const filePath = getModelPath(model);
          const res = await window.electronAPI.lspSignatureHelp({
            filePath,
            line: position.lineNumber - 1,
            character: position.column - 1
          });

          if (!res.success || !res.data) return null;

          return {
            value: {
              signatures: res.data.signatures || [],
              activeSignature: res.data.activeSignature || 0,
              activeParameter: res.data.activeParameter || 0
            },
            dispose: () => {}
          };
        } catch {
          return null;
        }
      }
    });
  }
}

/**
 * Synchronizes an open Monaco document model with the LSP backend
 */
export function syncDocumentWithLsp(filePath: string, languageId: string, content: string): void {
  if (!window.electronAPI) return;
  void window.electronAPI.lspDidOpen({ filePath, languageId, text: content });
}

export function notifyDocumentChanged(filePath: string, content: string): void {
  if (!window.electronAPI) return;
  const existing = changeDebounceTimers.get(filePath);
  if (existing) clearTimeout(existing);
  changeDebounceTimers.set(filePath, setTimeout(() => {
    changeDebounceTimers.delete(filePath);
    void window.electronAPI.lspDidChange({ filePath, text: content });
  }, 250));
}

export async function flushDocumentChanged(filePath: string, content: string): Promise<void> {
  if (!window.electronAPI) return;
  const timer = changeDebounceTimers.get(filePath);
  if (timer) clearTimeout(timer);
  changeDebounceTimers.delete(filePath);
  await window.electronAPI.lspDidChange({ filePath, text: content });
}

export function notifyDocumentSaved(filePath: string, content?: string): void {
  if (!window.electronAPI) return;
  void window.electronAPI.lspDidSave({ filePath, text: content });
}

export function notifyDocumentClosed(filePath: string): void {
  if (!window.electronAPI) return;
  const timer = changeDebounceTimers.get(filePath);
  if (timer) clearTimeout(timer);
  changeDebounceTimers.delete(filePath);
  void window.electronAPI.lspDidClose({ filePath });
}
