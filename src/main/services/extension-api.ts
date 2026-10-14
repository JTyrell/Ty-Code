import { ExtensionManifestSchema, validateExtensionSettings } from '../../preload/extension-schemas';
import type { ExtensionManifest } from '../../preload/types';

export interface Disposable {
  dispose: () => void;
}

export interface ExtensionDocument {
  uri: string;
  fileName: string;
  languageId: string;
  lineCount: number;
  text: string;
}

export interface ExtensionCapabilityProvider {
  workspace: {
    readFile: (relativePath: string) => Promise<string>;
    writeFile: (relativePath: string, content: string) => Promise<void>;
  };
  commands: {
    register: (commandId: string, title: string) => Disposable;
    execute: (commandId: string, args: unknown[]) => Promise<unknown>;
  };
  editor: {
    getActiveDocument: () => Promise<ExtensionDocument | null>;
    applyActiveEdit: (content: string) => Promise<boolean>;
  };
  languages: {
    registerCompletionProvider: () => never;
    registerHoverProvider: () => never;
  };
  window: {
    showMessage: (message: string) => Promise<void>;
    showInput: (prompt: string, value?: string) => Promise<string | undefined>;
  };
  terminal: {
    open: () => Promise<void>;
    sendText: (text: string) => Promise<void>;
  };
  agent: {
    request: (prompt: string) => Promise<void>;
  };
  git: {
    refresh: () => Promise<void>;
    copyRemoteUrl: () => Promise<string>;
  };
  webviews: {
    create: () => never;
  };
}

export type ExtensionRpcMethod =
  | 'host.activate' | 'host.execute-command' | 'host.deactivate' | 'host.ping'
  | 'capability.workspace.read-file' | 'capability.workspace.write-file'
  | 'capability.editor.get-active-document' | 'capability.editor.apply-active-edit'
  | 'capability.window.show-message' | 'capability.window.show-input' | 'capability.terminal.open'
  | 'capability.git.refresh' | 'capability.git.copy-remote-url';

export function validateExtensionManifest(manifest: unknown): { valid: boolean; errors: string[] } {
  const result = ExtensionManifestSchema.safeParse(manifest);
  return result.success
    ? { valid: true, errors: [] }
    : { valid: false, errors: result.error.issues.map((issue) => `${issue.path.join('.') || 'manifest'}: ${issue.message}`) };
}

export { validateExtensionSettings };
export type { ExtensionManifest };
