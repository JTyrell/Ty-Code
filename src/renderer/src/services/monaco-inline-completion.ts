import type * as monacoType from 'monaco-editor';
import type { InlineCompletionRequest } from '../../../preload/types';

type Monaco = typeof monacoType;

const REGISTERED_LANGUAGES = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'python',
  'rust',
  'go',
  'html',
  'css',
  'json'
];

let isRegistered = false;
let inlineCompletionsEnabled = true;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function setInlineCompletionsEnabled(enabled: boolean): void {
  inlineCompletionsEnabled = enabled;
}

export function isInlineCompletionsEnabled(): boolean {
  return inlineCompletionsEnabled;
}

export function registerMonacoInlineCompletionProvider(monaco: Monaco): void {
  if (isRegistered || !window.electronAPI?.getInlineCompletions) return;
  isRegistered = true;

  for (const lang of REGISTERED_LANGUAGES) {
    monaco.languages.registerInlineCompletionsProvider(lang, {
      provideInlineCompletions: async (model, position, context, token) => {
        if (!inlineCompletionsEnabled) {
          return { items: [] };
        }

        // Debounce typing if triggered automatically
        if (context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Automatic) {
          await new Promise<void>((resolve) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(resolve, 200);
          });
          if (token.isCancellationRequested) {
            return { items: [] };
          }
        }

        try {
          const filePath = model.uri.fsPath || model.uri.path;
          const fullContent = model.getValue();
          const offset = model.getOffsetAt(position);
          const prefix = fullContent.slice(0, offset);
          const suffix = fullContent.slice(offset);

          const req: InlineCompletionRequest = {
            filePath,
            language: lang,
            prefix,
            suffix,
            line: position.lineNumber,
            character: position.column,
            triggerKind:
              context.triggerKind === monaco.languages.InlineCompletionTriggerKind.Explicit
                ? 'manual'
                : 'automatic'
          };

          const response = await window.electronAPI.getInlineCompletions(req);
          if (!response.success || !response.data?.items?.length) {
            return { items: [] };
          }

          const items: monacoType.languages.InlineCompletion[] = response.data.items.map((item) => ({
            insertText: item.text,
            range: item.range
              ? new monaco.Range(
                  item.range.startLine,
                  item.range.startColumn,
                  item.range.endLine,
                  item.range.endColumn
                )
              : new monaco.Range(
                  position.lineNumber,
                  position.column,
                  position.lineNumber,
                  position.column
                )
          }));

          return { items };
        } catch {
          return { items: [] };
        }
      },
      freeInlineCompletions: () => {}
    });
  }
}
