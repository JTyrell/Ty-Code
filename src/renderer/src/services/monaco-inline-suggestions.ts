/**
 * Monaco Inline Code Suggestions Integration
 * Provides ghost-text autocompletion within Monaco Editor powered by Ty-Code AI engines.
 */

import type * as monacoType from 'monaco-editor';
import {
  registerMonacoInlineCompletionProvider,
  setInlineCompletionsEnabled,
  isInlineCompletionsEnabled
} from './monaco-inline-completion';

export {
  registerMonacoInlineCompletionProvider,
  setInlineCompletionsEnabled,
  isInlineCompletionsEnabled
};

export function registerMonacoInlineSuggestions(monaco: typeof monacoType): void {
  registerMonacoInlineCompletionProvider(monaco);
}
