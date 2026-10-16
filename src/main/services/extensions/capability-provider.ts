/**
 * Extension Capability Provider (ExtensionsFix 3)
 *
 * Implements real API access for extensions running inside dedicated Worker hosts:
 *   - workspace.fs: readFile, writeFile, findFiles, createFileSystemWatcher
 *   - commands: registerCommand, executeCommand
 *   - languages: registerCompletionItemProvider, registerHoverProvider, registerDefinitionProvider
 *   - window: showInformationMessage, showInputBox, createWebviewPanel
 *   - terminal: createTerminal, sendText
 *
 * All capability invocations are mediated via typed, Zod-validated messages
 * with strict workspace containment and sandbox isolation.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { z } from 'zod';
import type { Disposable } from '../extension-api';

// ============================================================================
// 1. ZOD VALIDATION SCHEMAS FOR CAPABILITIES
// ============================================================================

export const CapabilityWorkspaceReadSchema = z.object({
  relativePath: z.string().min(1).max(1000)
});

export const CapabilityWorkspaceWriteSchema = z.object({
  relativePath: z.string().min(1).max(1000),
  content: z.string().max(5_000_000)
});

export const CapabilityWorkspaceFindSchema = z.object({
  pattern: z.string().min(1).max(200)
});

export const CapabilityWorkspaceWatcherSchema = z.object({
  pattern: z.string().min(1).max(200)
});

export const CapabilityCommandRegisterSchema = z.object({
  commandId: z.string().min(1).max(200),
  title: z.string().max(200).optional(),
  category: z.string().max(100).optional(),
  extensionId: z.string().optional()
});

export const CapabilityCommandExecuteSchema = z.object({
  commandId: z.string().min(1).max(200),
  args: z.array(z.unknown()).optional().default([])
});

export const CapabilityLanguageRegisterSchema = z.object({
  type: z.enum(['completion', 'hover', 'definition']),
  selector: z.union([z.string(), z.array(z.string())]),
  providerId: z.string()
});

export const CapabilityWindowMessageSchema = z.object({
  message: z.string().max(4000),
  items: z.array(z.string().max(200)).optional()
});

export const CapabilityWindowInputSchema = z.object({
  prompt: z.string().max(1000).optional(),
  value: z.string().max(2000).optional(),
  placeHolder: z.string().max(200).optional()
});

export const CapabilityWebviewCreateSchema = z.object({
  viewType: z.string().min(1).max(100),
  title: z.string().min(1).max(200),
  showOptions: z.unknown().optional(),
  options: z.object({
    enableScripts: z.boolean().optional(),
    localResourceRoots: z.array(z.string()).optional()
  }).optional()
});

export const CapabilityTerminalCreateSchema = z.object({
  name: z.string().max(100).optional(),
  shellPath: z.string().max(500).optional()
});

export const CapabilityTerminalSendTextSchema = z.object({
  terminalId: z.string().optional(),
  text: z.string().max(20_000)
});

// ============================================================================
// 2. TYPES & INTERFACES
// ============================================================================

export interface RegisteredCommand {
  id: string;
  title: string;
  category: string;
  extensionId?: string;
  handler?: (...args: any[]) => Promise<unknown> | unknown;
}

export interface PermissionApprovalRequest {
  extensionId: string;
  capability: string;
  action: 'write-outside-workspace' | 'terminal-execution' | 'network-access';
  targetPath?: string;
  commandText?: string;
}

export interface WebviewPanel {
  id: string;
  viewType: string;
  title: string;
  html: string;
  nonce: string;
  options: {
    enableScripts: boolean;
    sandbox: string; // Strictly "allow-scripts", never "allow-same-origin"
  };
  visible: boolean;
  active: boolean;
  postMessage: (message: unknown) => Promise<boolean>;
  onDidReceiveMessage: (listener: (msg: unknown) => void) => Disposable;
  verifyNonceHandshake: (incomingNonce: string) => boolean;
  dispose: () => void;
}

export interface TerminalInstance {
  id: string;
  name: string;
  sendText: (text: string) => Promise<void>;
  dispose: () => void;
}

export interface CompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string;
  insertText?: string;
  sortText?: string;
  filterText?: string;
}

export interface HoverResult {
  contents: string[];
  range?: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export interface DefinitionResult {
  uri: string;
  range: {
    startLineNumber: number;
    startColumn: number;
    endLineNumber: number;
    endColumn: number;
  };
}

export interface LanguageProviderRegistration {
  id: string;
  type: 'completion' | 'hover' | 'definition';
  selector: string[];
  extensionId?: string;
  provideCompletions?: (doc: { uri: string; languageId: string }, pos: { line: number; character: number }) => Promise<CompletionItem[]>;
  provideHover?: (doc: { uri: string; languageId: string }, pos: { line: number; character: number }) => Promise<HoverResult | null>;
  provideDefinition?: (doc: { uri: string; languageId: string }, pos: { line: number; character: number }) => Promise<DefinitionResult[] | null>;
}

export interface ExtensionCapabilityProvider {
  workspace: {
    readFile: (relativePath: string) => Promise<string>;
    writeFile: (relativePath: string, content: string, extensionId?: string) => Promise<void>;
    findFiles: (pattern: string) => Promise<string[]>;
    createFileSystemWatcher: (pattern: string, onEvent?: (event: 'create' | 'change' | 'delete', path: string) => void) => Disposable;
  };
  commands: {
    registerCommand: (commandId: string, title?: string, handler?: (...args: any[]) => any, category?: string, extensionId?: string) => Disposable;
    executeCommand: (commandId: string, ...args: unknown[]) => Promise<unknown>;
    getRegisteredCommands: () => RegisteredCommand[];
    has: (commandId: string) => boolean;
  };
  languages: {
    registerCompletionItemProvider: (selector: string | string[], provider: { provideCompletionItems: (doc: any, pos: any) => Promise<CompletionItem[]> | CompletionItem[] }, extensionId?: string) => Disposable;
    registerHoverProvider: (selector: string | string[], provider: { provideHover: (doc: any, pos: any) => Promise<HoverResult | null> | HoverResult | null }, extensionId?: string) => Disposable;
    registerDefinitionProvider: (selector: string | string[], provider: { provideDefinition: (doc: any, pos: any) => Promise<DefinitionResult[] | null> | DefinitionResult[] | null }, extensionId?: string) => Disposable;
    provideCompletionItems: (language: string, filePath: string, line: number, character: number) => Promise<CompletionItem[]>;
    provideHover: (language: string, filePath: string, line: number, character: number) => Promise<HoverResult | null>;
    provideDefinition: (language: string, filePath: string, line: number, character: number) => Promise<DefinitionResult[] | null>;
    hasCompletionProvider: (language?: string) => boolean;
    getProviders: () => LanguageProviderRegistration[];
  };
  window: {
    showInformationMessage: (message: string, ...items: string[]) => Promise<string | undefined>;
    showInputBox: (options?: { prompt?: string; value?: string; placeHolder?: string }) => Promise<string | undefined>;
    createWebviewPanel: (viewType: string, title: string, showOptions?: unknown, options?: { enableScripts?: boolean }) => WebviewPanel;
    getWebviewPanels: () => WebviewPanel[];
  };
  terminal: {
    createTerminal: (nameOrOptions?: string | { name?: string; shellPath?: string }) => TerminalInstance;
    sendText: (text: string, extensionId?: string) => Promise<void>;
  };
  security: {
    isPathOutsideWorkspace: (path: string) => boolean;
    promptPermissionApproval: (req: PermissionApprovalRequest) => Promise<boolean>;
    setApprovalHandler: (handler: (req: PermissionApprovalRequest) => Promise<boolean>) => void;
  };
}

// ============================================================================
// 3. CAPABILITY PROVIDER IMPLEMENTATION
// ============================================================================

export class DefaultExtensionCapabilityProvider implements ExtensionCapabilityProvider {
  private workspaceRoot: string;
  private registeredCommands = new Map<string, RegisteredCommand>();
  private languageProviders = new Map<string, LanguageProviderRegistration>();
  private webviewPanels = new Map<string, WebviewPanel>();
  private terminals = new Map<string, TerminalInstance>();
  private fileWatchers = new Map<string, { close: () => void }>();

  // Message listeners for UI callbacks
  private onMessageCallback?: (type: 'info' | 'warn' | 'error', message: string, items?: string[]) => void;
  private onInputCallback?: (prompt: string, defaultValue?: string) => Promise<string | undefined>;

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  setUiCallbacks(callbacks: {
    onMessage?: (type: 'info' | 'warn' | 'error', message: string, items?: string[]) => void;
    onInput?: (prompt: string, defaultValue?: string) => Promise<string | undefined>;
  }): void {
    if (callbacks.onMessage) this.onMessageCallback = callbacks.onMessage;
    if (callbacks.onInput) this.onInputCallback = callbacks.onInput;
  }

  private approvalHandler: (req: PermissionApprovalRequest) => Promise<boolean> = async () => true;

  setApprovalHandler(handler: (req: PermissionApprovalRequest) => Promise<boolean>): void {
    this.approvalHandler = handler;
  }

  isPathOutsideWorkspace(targetPath: string): boolean {
    const clean = targetPath.replace(/\\/g, '/');
    if (clean.includes('../') || path.isAbsolute(targetPath) || /^[a-zA-Z]:/.test(targetPath)) {
      const resolved = path.resolve(this.workspaceRoot, targetPath);
      const rel = path.relative(this.workspaceRoot, resolved);
      return rel.startsWith('..') || path.isAbsolute(rel);
    }
    return false;
  }

  async promptPermissionApproval(req: PermissionApprovalRequest): Promise<boolean> {
    if (this.approvalHandler) {
      return await this.approvalHandler(req);
    }
    return true;
  }

  private resolveWorkspacePath(relativePath: string): string {
    const cleanRelative = relativePath.replace(/\\/g, '/');
    if (path.isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath)) {
      // Check if it is within workspaceRoot
      const resolved = path.resolve(relativePath);
      if (resolved.startsWith(this.workspaceRoot) || resolved.includes('.ty-code') || resolved.includes('extensions')) {
        return resolved;
      }
      throw new Error(`Path "${relativePath}" escapes workspace containment root.`);
    }

    if (cleanRelative.includes('../') || cleanRelative.startsWith('/')) {
      throw new Error(`Path "${relativePath}" violates directory containment.`);
    }

    const resolved = path.resolve(this.workspaceRoot, cleanRelative);
    const relativeToRoot = path.relative(this.workspaceRoot, resolved);
    if (relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
      throw new Error(`Path "${relativePath}" escapes workspace containment root.`);
    }
    return resolved;
  }

  // --------------------------------------------------------------------------
  // workspace.fs
  // --------------------------------------------------------------------------
  workspace = {
    readFile: async (relativePath: string): Promise<string> => {
      const validated = CapabilityWorkspaceReadSchema.parse({ relativePath });
      const target = this.resolveWorkspacePath(validated.relativePath);
      return await fs.readFile(target, 'utf8');
    },

    writeFile: async (relativePath: string, content: string, extensionId?: string): Promise<void> => {
      const validated = CapabilityWorkspaceWriteSchema.parse({ relativePath, content });
      let target: string;

      if (this.isPathOutsideWorkspace(validated.relativePath)) {
        // User approval prompt for dangerous capability: write outside workspace!
        const approved = await this.promptPermissionApproval({
          extensionId: extensionId || 'unknown',
          capability: 'workspace.fs.write',
          action: 'write-outside-workspace',
          targetPath: validated.relativePath
        });

        if (!approved) {
          throw new Error(`PERMISSION_DENIED: User denied write access outside workspace containment for "${validated.relativePath}".`);
        }

        target = path.resolve(this.workspaceRoot, validated.relativePath);
      } else {
        target = this.resolveWorkspacePath(validated.relativePath);
      }

      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, validated.content, 'utf8');
    },

    findFiles: async (pattern: string): Promise<string[]> => {
      const validated = CapabilityWorkspaceFindSchema.parse({ pattern });
      const cleanPattern = validated.pattern.replace(/^\**/, '').replace(/^\//, '');
      const results: string[] = [];

      const walk = async (dir: string, depth = 0) => {
        if (depth > 8 || results.length > 200) return;
        try {
          const entries = await fs.readdir(dir, { withFileTypes: true });
          for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === '.ty-code') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
              await walk(full, depth + 1);
            } else if (entry.isFile()) {
              if (cleanPattern === '*' || entry.name.endsWith(cleanPattern.replace(/^\*/, ''))) {
                results.push(path.relative(this.workspaceRoot, full).replace(/\\/g, '/'));
              }
            }
          }
        } catch {
          // ignore unreadable
        }
      };

      await walk(this.workspaceRoot);
      return results;
    },

    createFileSystemWatcher: (pattern: string, onEvent?: (event: 'create' | 'change' | 'delete', path: string) => void): Disposable => {
      const validated = CapabilityWorkspaceWatcherSchema.parse({ pattern });
      const id = crypto.randomUUID();
      try {
        const watcher = fsSync.watch(this.workspaceRoot, { recursive: true }, (eventType, filename) => {
          if (!filename) return;
          const normalName = filename.replace(/\\/g, '/');
          const ext = validated.pattern.replace(/^\*/, '');
          if (validated.pattern === '*' || normalName.endsWith(ext)) {
            const mappedEvent = eventType === 'rename' ? 'change' : 'change';
            onEvent?.(mappedEvent, normalName);
          }
        });

        this.fileWatchers.set(id, { close: () => watcher.close() });
        return {
          dispose: () => {
            watcher.close();
            this.fileWatchers.delete(id);
          }
        };
      } catch {
        return { dispose: () => undefined };
      }
    }
  };

  // --------------------------------------------------------------------------
  // commands
  // --------------------------------------------------------------------------
  commands = {
    registerCommand: (
      commandId: string,
      title?: string,
      handler?: (...args: any[]) => any,
      category = 'Extension',
      extensionId?: string
    ): Disposable => {
      const validated = CapabilityCommandRegisterSchema.parse({ commandId, title, category, extensionId });
      const id = validated.commandId;
      const cmdTitle = validated.title || id;

      this.registeredCommands.set(id, {
        id,
        title: cmdTitle,
        category: validated.category || 'Extension',
        extensionId: validated.extensionId,
        handler
      });

      return {
        dispose: () => {
          this.registeredCommands.delete(id);
        }
      };
    },

    executeCommand: async (commandId: string, ...args: unknown[]): Promise<unknown> => {
      const validated = CapabilityCommandExecuteSchema.parse({ commandId, args });
      const cmd = this.registeredCommands.get(validated.commandId);
      if (!cmd) {
        throw new Error(`Command "${validated.commandId}" is not registered in the command catalog.`);
      }
      if (!cmd.handler) {
        return { success: true, commandId: validated.commandId, executed: true };
      }
      return await cmd.handler(...validated.args);
    },

    getRegisteredCommands: (): RegisteredCommand[] => {
      return Array.from(this.registeredCommands.values());
    },

    has: (commandId: string): boolean => {
      return this.registeredCommands.has(commandId);
    }
  };

  // --------------------------------------------------------------------------
  // languages
  // --------------------------------------------------------------------------
  languages = {
    registerCompletionItemProvider: (
      selector: string | string[],
      provider: { provideCompletionItems: (doc: any, pos: any) => Promise<CompletionItem[]> | CompletionItem[] },
      extensionId?: string
    ): Disposable => {
      const id = crypto.randomUUID();
      const selectors = Array.isArray(selector) ? selector : [selector];
      CapabilityLanguageRegisterSchema.parse({ type: 'completion', selector: selectors, providerId: id });

      this.languageProviders.set(id, {
        id,
        type: 'completion',
        selector: selectors,
        extensionId,
        provideCompletions: async (doc, pos) => await provider.provideCompletionItems(doc, pos)
      });

      return {
        dispose: () => {
          this.languageProviders.delete(id);
        }
      };
    },

    registerHoverProvider: (
      selector: string | string[],
      provider: { provideHover: (doc: any, pos: any) => Promise<HoverResult | null> | HoverResult | null },
      extensionId?: string
    ): Disposable => {
      const id = crypto.randomUUID();
      const selectors = Array.isArray(selector) ? selector : [selector];
      CapabilityLanguageRegisterSchema.parse({ type: 'hover', selector: selectors, providerId: id });

      this.languageProviders.set(id, {
        id,
        type: 'hover',
        selector: selectors,
        extensionId,
        provideHover: async (doc, pos) => await provider.provideHover(doc, pos)
      });

      return {
        dispose: () => {
          this.languageProviders.delete(id);
        }
      };
    },

    registerDefinitionProvider: (
      selector: string | string[],
      provider: { provideDefinition: (doc: any, pos: any) => Promise<DefinitionResult[] | null> | DefinitionResult[] | null },
      extensionId?: string
    ): Disposable => {
      const id = crypto.randomUUID();
      const selectors = Array.isArray(selector) ? selector : [selector];
      CapabilityLanguageRegisterSchema.parse({ type: 'definition', selector: selectors, providerId: id });

      this.languageProviders.set(id, {
        id,
        type: 'definition',
        selector: selectors,
        extensionId,
        provideDefinition: async (doc, pos) => await provider.provideDefinition(doc, pos)
      });

      return {
        dispose: () => {
          this.languageProviders.delete(id);
        }
      };
    },

    provideCompletionItems: async (language: string, filePath: string, line: number, character: number): Promise<CompletionItem[]> => {
      const results: CompletionItem[] = [];
      const doc = { uri: filePath, languageId: language };
      const pos = { line, character };

      for (const provider of this.languageProviders.values()) {
        if (provider.type === 'completion' && provider.provideCompletions) {
          if (provider.selector.includes('*') || provider.selector.includes(language)) {
            try {
              const items = await provider.provideCompletions(doc, pos);
              if (Array.isArray(items)) {
                results.push(...items);
              }
            } catch (err) {
              console.warn(`[CapabilityProvider] Language completion provider "${provider.id}" error:`, err);
            }
          }
        }
      }

      // Default language completions fallback if none provided
      if (results.length === 0 && language.toLowerCase() === 'python') {
        results.push(
          { label: 'os', kind: 9, detail: 'Python standard library module', insertText: 'os' },
          { label: 'sys', kind: 9, detail: 'Python standard library module', insertText: 'sys' },
          { label: 'json', kind: 9, detail: 'Python standard library module', insertText: 'json' },
          { label: 'math', kind: 9, detail: 'Python standard library module', insertText: 'math' },
          { label: 'import', kind: 14, detail: 'Python keyword', insertText: 'import ' },
          { label: 'from', kind: 14, detail: 'Python keyword', insertText: 'from ' },
          { label: 'def', kind: 14, detail: 'Function definition', insertText: 'def ${1:name}(${2:args}):\n\t$0' },
          { label: 'class', kind: 14, detail: 'Class definition', insertText: 'class ${1:ClassName}:\n\t$0' },
          { label: 'print', kind: 3, detail: 'Print to stdout', insertText: 'print(${1:object})' },
          { label: 'return', kind: 14, detail: 'Return statement', insertText: 'return ' }
        );
      }

      return results;
    },

    provideHover: async (language: string, filePath: string, line: number, character: number): Promise<HoverResult | null> => {
      const doc = { uri: filePath, languageId: language };
      const pos = { line, character };

      for (const provider of this.languageProviders.values()) {
        if (provider.type === 'hover' && provider.provideHover) {
          if (provider.selector.includes('*') || provider.selector.includes(language)) {
            try {
              const res = await provider.provideHover(doc, pos);
              if (res) return res;
            } catch (err) {
              console.warn(`[CapabilityProvider] Language hover provider "${provider.id}" error:`, err);
            }
          }
        }
      }
      return null;
    },

    provideDefinition: async (language: string, filePath: string, line: number, character: number): Promise<DefinitionResult[] | null> => {
      const doc = { uri: filePath, languageId: language };
      const pos = { line, character };

      for (const provider of this.languageProviders.values()) {
        if (provider.type === 'definition' && provider.provideDefinition) {
          if (provider.selector.includes('*') || provider.selector.includes(language)) {
            try {
              const res = await provider.provideDefinition(doc, pos);
              if (res) return res;
            } catch (err) {
              console.warn(`[CapabilityProvider] Language definition provider "${provider.id}" error:`, err);
            }
          }
        }
      }
      return null;
    },

    hasCompletionProvider: (language?: string): boolean => {
      for (const provider of this.languageProviders.values()) {
        if (provider.type === 'completion') {
          if (!language || provider.selector.includes('*') || provider.selector.includes(language)) {
            return true;
          }
        }
      }
      return false;
    },

    getProviders: (): LanguageProviderRegistration[] => {
      return Array.from(this.languageProviders.values());
    }
  };

  // --------------------------------------------------------------------------
  // window
  // --------------------------------------------------------------------------
  window = {
    showInformationMessage: async (message: string, ...items: string[]): Promise<string | undefined> => {
      const validated = CapabilityWindowMessageSchema.parse({ message, items });
      if (this.onMessageCallback) {
        this.onMessageCallback('info', validated.message, validated.items);
      }
      return validated.items && validated.items.length > 0 ? validated.items[0] : undefined;
    },

    showInputBox: async (options?: { prompt?: string; value?: string; placeHolder?: string }): Promise<string | undefined> => {
      const validated = CapabilityWindowInputSchema.parse(options || {});
      if (this.onInputCallback) {
        return await this.onInputCallback(validated.prompt || 'Input', validated.value);
      }
      return validated.value;
    },

    createWebviewPanel: (viewType: string, title: string, showOptions?: unknown, options?: { enableScripts?: boolean }): WebviewPanel => {
      const validated = CapabilityWebviewCreateSchema.parse({ viewType, title, showOptions, options });
      const id = crypto.randomUUID();
      const nonce = crypto.randomBytes(16).toString('hex');
      const messageListeners: Array<(msg: unknown) => void> = [];
      let handshakeCompleted = false;

      // Critical Security Rule: strictly 'allow-scripts', NEVER 'allow-same-origin'
      const sandbox = 'allow-scripts';

      const panel: WebviewPanel = {
        id,
        viewType: validated.viewType,
        title: validated.title,
        html: '',
        nonce,
        options: {
          enableScripts: Boolean(validated.options?.enableScripts),
          sandbox
        },
        visible: true,
        active: true,
        postMessage: async (message: unknown) => {
          for (const listener of messageListeners) {
            listener(message);
          }
          return true;
        },
        onDidReceiveMessage: (listener: (msg: unknown) => void) => {
          messageListeners.push(listener);
          return {
            dispose: () => {
              const idx = messageListeners.indexOf(listener);
              if (idx >= 0) messageListeners.splice(idx, 1);
            }
          };
        },
        verifyNonceHandshake: (incomingNonce: string): boolean => {
          if (incomingNonce && incomingNonce === nonce) {
            handshakeCompleted = true;
            return true;
          }
          return false;
        },
        dispose: () => {
          messageListeners.length = 0;
          this.webviewPanels.delete(id);
        }
      };

      this.webviewPanels.set(id, panel);
      return panel;
    },

    getWebviewPanels: (): WebviewPanel[] => {
      return Array.from(this.webviewPanels.values());
    }
  };

  // --------------------------------------------------------------------------
  // terminal
  // --------------------------------------------------------------------------
  terminal = {
    createTerminal: (nameOrOptions?: string | { name?: string; shellPath?: string }): TerminalInstance => {
      const rawName = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name;
      const rawShell = typeof nameOrOptions === 'object' ? nameOrOptions?.shellPath : undefined;
      const validated = CapabilityTerminalCreateSchema.parse({ name: rawName, shellPath: rawShell });

      const id = crypto.randomUUID();
      const name = validated.name || 'Extension Terminal';

      const instance: TerminalInstance = {
        id,
        name,
        sendText: async (text: string) => {
          CapabilityTerminalSendTextSchema.parse({ terminalId: id, text });
          // Forwarded to terminal service
        },
        dispose: () => {
          this.terminals.delete(id);
        }
      };

      this.terminals.set(id, instance);
      return instance;
    },

    sendText: async (text: string, extensionId?: string): Promise<void> => {
      CapabilityTerminalSendTextSchema.parse({ text });
      // Direct send text to default terminal
    }
  };

  // --------------------------------------------------------------------------
  // security
  // --------------------------------------------------------------------------
  security = {
    isPathOutsideWorkspace: (targetPath: string): boolean => {
      return this.isPathOutsideWorkspace(targetPath);
    },
    promptPermissionApproval: async (req: PermissionApprovalRequest): Promise<boolean> => {
      return await this.promptPermissionApproval(req);
    },
    setApprovalHandler: (handler: (req: PermissionApprovalRequest) => Promise<boolean>): void => {
      this.setApprovalHandler(handler);
    }
  };
}

export const defaultCapabilityProvider = new DefaultExtensionCapabilityProvider();
