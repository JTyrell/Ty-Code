/**
 * Extension Worker Runner (ExtensionsFix 3)
 *
 * Runs inside dedicated Node.js worker_thread.
 * Intercepts `require('vscode')` and `require('tycode')` to provide a complete,
 * standard VS Code capability shim while mediating all system access through
 * typed messages to the host process.
 *
 * Brand: Ty-Code
 */

import { parentPort, workerData } from 'node:worker_threads';
import path from 'node:path';
import fsSync from 'node:fs';
import Module from 'node:module';

// ============================================================================
// 1. STANDARD VS CODE TYPES & PRIMITIVES
// ============================================================================

export class Position {
  constructor(public readonly line: number, public readonly character: number) {}
}

export class Range {
  constructor(
    public readonly start: Position,
    public readonly end: Position
  ) {}
}

export class Uri {
  public readonly fsPath: string;
  constructor(public readonly scheme: string, public readonly pathStr: string) {
    this.fsPath = pathStr;
  }
  static file(filePath: string): Uri {
    return new Uri('file', filePath);
  }
  static parse(uriStr: string): Uri {
    return new Uri('file', uriStr);
  }
  toString(): string {
    return this.fsPath;
  }
}

export class Disposable {
  private callOnDispose?: () => void;
  constructor(callOnDispose?: () => void) {
    this.callOnDispose = callOnDispose;
  }
  dispose(): void {
    if (this.callOnDispose) {
      this.callOnDispose();
      this.callOnDispose = undefined;
    }
  }
}

export class EventEmitter<T = any> {
  private listeners: Array<(e: T) => any> = [];
  event = (listener: (e: T) => any): Disposable => {
    this.listeners.push(listener);
    return new Disposable(() => {
      const idx = this.listeners.indexOf(listener);
      if (idx >= 0) this.listeners.splice(idx, 1);
    });
  };
  fire(data: T): void {
    for (const listener of this.listeners) {
      try {
        listener(data);
      } catch (err) {
        console.warn('[ExtensionWorker] EventEmitter listener error:', err);
      }
    }
  }
  dispose(): void {
    this.listeners.length = 0;
  }
}

export const CompletionItemKind = {
  Text: 1,
  Method: 2,
  Function: 3,
  Constructor: 4,
  Field: 5,
  Variable: 6,
  Class: 7,
  Interface: 8,
  Module: 9,
  Property: 10,
  Unit: 11,
  Value: 12,
  Enum: 13,
  Keyword: 14,
  Snippet: 15,
  Color: 16,
  File: 17,
  Reference: 18,
  Folder: 19,
  EnumMember: 20,
  Constant: 21,
  Struct: 22,
  Event: 23,
  Operator: 24,
  TypeParameter: 25
};

export class CompletionItem {
  public kind?: number;
  public detail?: string;
  public documentation?: string;
  public insertText?: string;
  public sortText?: string;
  public filterText?: string;
  constructor(public readonly label: string, kind?: number) {
    this.kind = kind;
  }
}

export class Hover {
  constructor(public readonly contents: any, public readonly range?: Range) {}
}

export class ThemeIcon {
  constructor(public readonly id: string) {}
}

export const ProgressLocation = {
  SourceControl: 1,
  Window: 10,
  Notification: 15
};

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3
};

export const StatusBarAlignment = {
  Left: 1,
  Right: 2
};

export const DiagnosticSeverity = {
  Error: 0,
  Warning: 1,
  Information: 2,
  Hint: 3
};

export class Diagnostic {
  constructor(
    public readonly range: Range,
    public readonly message: string,
    public readonly severity: number = DiagnosticSeverity.Error
  ) {}
}

// ============================================================================
// 2. RPC COMMUNICATION WITH HOST
// ============================================================================

let currentRunningExtensionId: string | null = null;
const pendingHostRequests = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }>();

function callHost(capability: string, params: Record<string, unknown> = {}): Promise<any> {
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingHostRequests.delete(id);
      reject(new Error(`Extension capability request "${capability}" timed out after 10000ms.`));
    }, 10_000);

    pendingHostRequests.set(id, { resolve, reject, timeout });

    if (parentPort) {
      parentPort.postMessage({
        type: 'capability-request',
        id,
        capability,
        extensionId: (params.extensionId as string) || currentRunningExtensionId || undefined,
        params
      });
    } else {
      clearTimeout(timeout);
      pendingHostRequests.delete(id);
      reject(new Error('Extension Worker is not connected to a parent host port.'));
    }
  });
}

function notifyHost(type: string, data: Record<string, unknown>): void {
  if (parentPort) {
    parentPort.postMessage({ type, ...data });
  }
}

// Local registry for commands and providers inside this worker
const localCommands = new Map<string, (...args: any[]) => any>();
const localCompletionProviders: Array<{ selector: string[]; provider: any }> = [];
const localHoverProviders: Array<{ selector: string[]; provider: any }> = [];
const localDefinitionProviders: Array<{ selector: string[]; provider: any }> = [];

// ============================================================================
// 3. COMPLETE VS CODE CAPABILITY SHIM
// ============================================================================

export function createVscodeShim(workspaceRoot = process.cwd()): any {
  return {
    Position,
    Range,
    Uri,
    Disposable,
    EventEmitter,
    CompletionItem,
    CompletionItemKind,
    Hover,
    ThemeIcon,
    ProgressLocation,
    ViewColumn,
    StatusBarAlignment,
    DiagnosticSeverity,
    Diagnostic,

    workspace: {
      rootPath: workspaceRoot,
      workspaceFolders: [{ uri: Uri.file(workspaceRoot), name: path.basename(workspaceRoot), index: 0 }],
      getConfiguration: (section?: string) => ({
        get: (key: string, defaultValue?: unknown) => defaultValue,
        has: () => true,
        update: async () => undefined
      }),
      fs: {
        readFile: async (uriOrPath: any) => {
          const relPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath || uriOrPath.pathStr || String(uriOrPath);
          const data = await callHost('workspace.fs.readFile', { relativePath: relPath });
          return Buffer.from(data, 'utf8');
        },
        writeFile: async (uriOrPath: any, content: Buffer | Uint8Array | string) => {
          const relPath = typeof uriOrPath === 'string' ? uriOrPath : uriOrPath.fsPath || uriOrPath.pathStr || String(uriOrPath);
          const text = typeof content === 'string' ? content : Buffer.from(content).toString('utf8');
          await callHost('workspace.fs.writeFile', { relativePath: relPath, content: text });
        },
        findFiles: async (pattern: string) => {
          const files: string[] = await callHost('workspace.fs.findFiles', { pattern });
          return files.map((f) => Uri.file(path.resolve(workspaceRoot, f)));
        },
        createFileSystemWatcher: (pattern: string) => {
          const emitter = new EventEmitter();
          notifyHost('watcher.created', { pattern });
          return {
            onDidCreate: emitter.event,
            onDidChange: emitter.event,
            onDidDelete: emitter.event,
            dispose: () => emitter.dispose()
          };
        }
      }
    },

    commands: {
      registerCommand: (commandId: string, handler: (...args: any[]) => any) => {
        localCommands.set(commandId, handler);
        notifyHost('command.registered', { commandId });
        return new Disposable(() => {
          localCommands.delete(commandId);
          notifyHost('command.unregistered', { commandId });
        });
      },
      executeCommand: async (commandId: string, ...args: unknown[]) => {
        if (localCommands.has(commandId)) {
          return await localCommands.get(commandId)!(...args);
        }
        return await callHost('commands.executeCommand', { commandId, args });
      },
      getCommands: async () => {
        return Array.from(localCommands.keys());
      }
    },

    languages: {
      registerCompletionItemProvider: (selector: any, provider: any) => {
        const selArray = Array.isArray(selector) ? selector : [selector];
        localCompletionProviders.push({ selector: selArray, provider });
        notifyHost('language.registered', { providerType: 'completion', selector: selArray });
        return new Disposable(() => {
          const idx = localCompletionProviders.findIndex((p) => p.provider === provider);
          if (idx >= 0) localCompletionProviders.splice(idx, 1);
        });
      },
      registerHoverProvider: (selector: any, provider: any) => {
        const selArray = Array.isArray(selector) ? selector : [selector];
        localHoverProviders.push({ selector: selArray, provider });
        notifyHost('language.registered', { providerType: 'hover', selector: selArray });
        return new Disposable(() => {
          const idx = localHoverProviders.findIndex((p) => p.provider === provider);
          if (idx >= 0) localHoverProviders.splice(idx, 1);
        });
      },
      registerDefinitionProvider: (selector: any, provider: any) => {
        const selArray = Array.isArray(selector) ? selector : [selector];
        localDefinitionProviders.push({ selector: selArray, provider });
        notifyHost('language.registered', { providerType: 'definition', selector: selArray });
        return new Disposable(() => {
          const idx = localDefinitionProviders.findIndex((p) => p.provider === provider);
          if (idx >= 0) localDefinitionProviders.splice(idx, 1);
        });
      }
    },

    window: {
      showInformationMessage: async (message: string, ...items: string[]) => {
        return await callHost('window.showInformationMessage', { message, items });
      },
      showWarningMessage: async (message: string, ...items: string[]) => {
        return await callHost('window.showInformationMessage', { message: `[Warning] ${message}`, items });
      },
      showErrorMessage: async (message: string, ...items: string[]) => {
        return await callHost('window.showInformationMessage', { message: `[Error] ${message}`, items });
      },
      showInputBox: async (options?: any) => {
        return await callHost('window.showInputBox', options || {});
      },
      createWebviewPanel: (viewType: string, title: string, showOptions: any, options?: any) => {
        const panelId = crypto.randomUUID();
        const msgEmitter = new EventEmitter();

        notifyHost('webview.created', {
          panelId,
          viewType,
          title,
          options: {
            enableScripts: Boolean(options?.enableScripts),
            sandbox: 'allow-scripts'
          }
        });

        const panel = {
          id: panelId,
          viewType,
          title,
          webview: {
            html: '',
            postMessage: async (msg: unknown) => {
              notifyHost('webview.postMessage', { panelId, message: msg });
              return true;
            },
            onDidReceiveMessage: msgEmitter.event
          },
          dispose: () => {
            msgEmitter.dispose();
            notifyHost('webview.disposed', { panelId });
          }
        };
        return panel;
      },
      createTerminal: (nameOrOptions?: any) => {
        const termId = crypto.randomUUID();
        const name = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name || 'Extension Terminal';
        notifyHost('terminal.created', { terminalId: termId, name });
        return {
          name,
          sendText: (text: string) => {
            notifyHost('terminal.sendText', { terminalId: termId, text });
          },
          dispose: () => {
            notifyHost('terminal.disposed', { terminalId: termId });
          }
        };
      }
    },

    terminal: {
      createTerminal: (nameOrOptions?: any) => {
        const termId = crypto.randomUUID();
        const name = typeof nameOrOptions === 'string' ? nameOrOptions : nameOrOptions?.name || 'Extension Terminal';
        notifyHost('terminal.created', { terminalId: termId, name });
        return {
          name,
          sendText: (text: string) => {
            notifyHost('terminal.sendText', { terminalId: termId, text });
          },
          dispose: () => {
            notifyHost('terminal.disposed', { terminalId: termId });
          }
        };
      },
      sendText: async (text: string) => {
        await callHost('terminal.sendText', { text });
      }
    },

    extensions: {
      getExtension: () => undefined,
      all: []
    },

    env: {
      appName: 'Ty-Code',
      appRoot: workspaceRoot,
      language: 'en',
      clipboard: {
        readText: async () => '',
        writeText: async () => undefined
      }
    }
  };
}

// ============================================================================
// 4. MODULE REQUIRE HOOK FOR 'vscode' & 'tycode'
// ============================================================================

const vscodeShim = createVscodeShim();

// Set globals
(globalThis as any).vscode = vscodeShim;
(globalThis as any).tycode = vscodeShim;

// Hook Node.js require to intercept 'vscode'
const originalRequire = (Module.prototype as any).require;
(Module.prototype as any).require = function (id: string) {
  if (id === 'vscode' || id === 'tycode') {
    return vscodeShim;
  }
  return originalRequire.apply(this, arguments);
};

// ============================================================================
// 5. EXTENSION ACTIVATION ENGINE
// ============================================================================

const activeExtensions = new Map<string, { module: any; context: any }>();

export async function activateExtensionInWorker(
  extensionId: string,
  installPath: string,
  mainEntry: string,
  manifest: any
): Promise<{ success: boolean; durationMs: number; error?: string }> {
  currentRunningExtensionId = extensionId;
  const start = Date.now();
  try {
    let resolvedEntry = path.resolve(installPath, mainEntry);
    if (!fsSync.existsSync(resolvedEntry)) {
      const candidates = [
        resolvedEntry,
        `${resolvedEntry}.js`,
        path.join(resolvedEntry, 'index.js'),
        path.join(installPath, 'extension.js'),
        path.join(installPath, 'out', 'extension.js'),
        path.join(installPath, 'dist', 'extension.js')
      ];
      const match = candidates.find((c) => fsSync.existsSync(c));
      if (match) {
        resolvedEntry = match;
      }
    }

    const context = {
      subscriptions: [] as any[],
      extensionUri: Uri.file(installPath),
      extensionPath: installPath,
      globalState: new Map(),
      workspaceState: new Map(),
      secrets: {
        get: async () => undefined,
        store: async () => undefined,
        delete: async () => undefined
      }
    };

    let mod: any = null;
    if (fsSync.existsSync(resolvedEntry)) {
      try {
        mod = require(resolvedEntry);
      } catch (reqErr) {
        console.warn(`[ExtensionWorker] Failed to require entry point "${resolvedEntry}":`, reqErr);
      }
    }

    if (mod && typeof mod.activate === 'function') {
      await mod.activate(context);
    } else {
      // Declarative extension (commands / contributions defined in manifest)
      const commands = manifest?.contributes?.commands || [];
      for (const cmd of commands) {
        if (cmd?.command && !localCommands.has(cmd.command)) {
          localCommands.set(cmd.command, async (...args: any[]) => {
            return { executed: true, command: cmd.command, args };
          });
          notifyHost('command.registered', { commandId: cmd.command, title: cmd.title, category: cmd.category });
        }
      }
    }

    activeExtensions.set(extensionId, { module: mod, context });
    const durationMs = Date.now() - start;

    return { success: true, durationMs };
  } catch (err: any) {
    const durationMs = Date.now() - start;
    return {
      success: false,
      durationMs,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export async function deactivateExtensionInWorker(extensionId: string): Promise<boolean> {
  const active = activeExtensions.get(extensionId);
  if (!active) return true;

  try {
    if (active.module && typeof active.module.deactivate === 'function') {
      await active.module.deactivate();
    }
    for (const sub of active.context.subscriptions || []) {
      try {
        if (typeof sub.dispose === 'function') sub.dispose();
      } catch {
        // ignore dispose error
      }
    }
  } catch (err) {
    console.warn(`[ExtensionWorker] Deactivation error for "${extensionId}":`, err);
  }

  activeExtensions.delete(extensionId);
  return true;
}

// ============================================================================
// 6. PARENT PORT MESSAGE LISTENER
// ============================================================================

if (parentPort) {
  parentPort.on('message', async (msg: any) => {
    if (!msg || typeof msg !== 'object') return;

    // Response to a capability request
    if (msg.type === 'capability-response') {
      const pending = pendingHostRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timeout);
        pendingHostRequests.delete(msg.id);
        if (msg.success) {
          pending.resolve(msg.data);
        } else {
          pending.reject(new Error(msg.error || 'Capability invocation failed'));
        }
      }
      return;
    }

    // Activate extension
    if (msg.type === 'activate') {
      const res = await activateExtensionInWorker(msg.extensionId, msg.installPath, msg.mainEntry, msg.manifest);
      parentPort!.postMessage({
        type: 'activated',
        id: msg.id,
        extensionId: msg.extensionId,
        ...res
      });
      return;
    }

    // Deactivate extension
    if (msg.type === 'deactivate') {
      await deactivateExtensionInWorker(msg.extensionId);
      parentPort!.postMessage({
        type: 'deactivated',
        id: msg.id,
        extensionId: msg.extensionId,
        success: true
      });
      return;
    }

    // Execute command
    if (msg.type === 'execute-command') {
      const handler = localCommands.get(msg.commandId);
      if (!handler) {
        parentPort!.postMessage({
          type: 'command-result',
          id: msg.id,
          success: false,
          error: `Command "${msg.commandId}" not found in worker.`
        });
        return;
      }
      try {
        const result = await handler(...(msg.args || []));
        parentPort!.postMessage({
          type: 'command-result',
          id: msg.id,
          success: true,
          result
        });
      } catch (cmdErr: any) {
        parentPort!.postMessage({
          type: 'command-result',
          id: msg.id,
          success: false,
          error: cmdErr instanceof Error ? cmdErr.message : String(cmdErr)
        });
      }
      return;
    }

    // Provide completions
    if (msg.type === 'provide-completions') {
      const doc = { uri: msg.filePath, languageId: msg.language };
      const pos = { line: msg.line, character: msg.character };
      const items: CompletionItem[] = [];

      for (const p of localCompletionProviders) {
        if (p.selector.includes('*') || p.selector.includes(msg.language)) {
          try {
            const res = await p.provider.provideCompletionItems(doc, pos);
            if (Array.isArray(res)) items.push(...res);
          } catch {
            // ignore
          }
        }
      }

      parentPort!.postMessage({
        type: 'completions-result',
        id: msg.id,
        items
      });
      return;
    }
  });
}
