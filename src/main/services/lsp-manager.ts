/**
 * Ty-Claude Language Server Manager
 * Manages language server definitions, discovery, lifecycle (start/stop/restart),
 * open document synchronization, and routing requests to appropriate LSP clients.
 */

import { spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import { LspClient, type LspPosition, type LspRange } from './lsp-client';

export interface LanguageServerSpec {
  languageId: string;
  name: string;
  extensions: string[];
  defaultCommand: string;
  defaultArgs: string[];
  fallbackCommands?: string[];
  installInstructions: string;
}

export interface LanguageServerConfig {
  enabled: boolean;
  command?: string;
  args?: string[];
  customPath?: string;
}

export interface LanguageServerStatus {
  languageId: string;
  name: string;
  status: 'stopped' | 'starting' | 'running' | 'error' | 'disabled';
  isAvailable: boolean;
  command: string;
  args: string[];
  extensions: string[];
  installInstructions: string;
  error?: string;
}

export interface TrackedDocument {
  uri: string;
  filePath: string;
  languageId: string;
  version: number;
  text: string;
}

export const SUPPORTED_LANGUAGE_SERVERS: LanguageServerSpec[] = [
  {
    languageId: 'typescript',
    name: 'TypeScript / JavaScript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    defaultCommand: 'typescript-language-server',
    defaultArgs: ['--stdio'],
    fallbackCommands: ['npx typescript-language-server'],
    installInstructions: 'npm install -g typescript typescript-language-server'
  },
  {
    languageId: 'python',
    name: 'Python (Pyright / PyLSP)',
    extensions: ['.py', '.pyw'],
    defaultCommand: 'pyright-langserver',
    defaultArgs: ['--stdio'],
    fallbackCommands: ['pylsp', 'python -m pylsp'],
    installInstructions: 'npm install -g pyright  OR  pip install python-lsp-server'
  },
  {
    languageId: 'rust',
    name: 'Rust (rust-analyzer)',
    extensions: ['.rs'],
    defaultCommand: 'rust-analyzer',
    defaultArgs: [],
    installInstructions: 'rustup component add rust-analyzer'
  },
  {
    languageId: 'go',
    name: 'Go (gopls)',
    extensions: ['.go'],
    defaultCommand: 'gopls',
    defaultArgs: [],
    installInstructions: 'go install golang.org/x/tools/gopls@latest'
  },
  {
    languageId: 'java',
    name: 'Java (Eclipse JDT-LS)',
    extensions: ['.java'],
    defaultCommand: 'jdtls',
    defaultArgs: [],
    fallbackCommands: ['eclipse-jdt-ls'],
    installInstructions: 'Install Eclipse JDT Language Server (jdtls) and configure path'
  },
  {
    languageId: 'cpp',
    name: 'C / C++ (clangd)',
    extensions: ['.c', '.cpp', '.h', '.hpp', '.cc', '.cxx'],
    defaultCommand: 'clangd',
    defaultArgs: ['--background-index'],
    installInstructions: 'Install LLVM / Clang toolkit (includes clangd)'
  }
];

export class LspManager {
  private static instance: LspManager | null = null;
  private clients = new Map<string, LspClient>();
  private serverStatuses = new Map<string, LanguageServerStatus>();
  private userConfigs = new Map<string, LanguageServerConfig>();
  private trackedDocuments = new Map<string, TrackedDocument>();
  private workspacePath: string;

  constructor(workspacePath?: string) {
    this.workspacePath = workspacePath || process.cwd();
    this.initializeServerStatuses();
  }

  public static getInstance(workspacePath?: string): LspManager {
    if (!LspManager.instance) {
      LspManager.instance = new LspManager(workspacePath);
    } else if (workspacePath && LspManager.instance.workspacePath !== workspacePath) {
      LspManager.instance.setWorkspacePath(workspacePath);
    }
    return LspManager.instance;
  }

  public setWorkspacePath(newPath: string): void {
    if (this.workspacePath !== newPath) {
      this.workspacePath = newPath;
      this.refreshAvailability();
    }
  }

  public getWorkspacePath(): string {
    return this.workspacePath;
  }

  private initializeServerStatuses(): void {
    for (const spec of SUPPORTED_LANGUAGE_SERVERS) {
      const isAvailable = this.checkBinaryAvailable(spec.defaultCommand);
      this.serverStatuses.set(spec.languageId, {
        languageId: spec.languageId,
        name: spec.name,
        status: 'stopped',
        isAvailable,
        command: spec.defaultCommand,
        args: spec.defaultArgs,
        extensions: spec.extensions,
        installInstructions: spec.installInstructions
      });
    }
  }

  /**
   * Probes whether a command or binary is runnable
   */
  public checkBinaryAvailable(cmd: string): boolean {
    if (!cmd) return false;

    // Check workspace node_modules/.bin
    try {
      const localBin = path.join(this.workspacePath, 'node_modules', '.bin', process.platform === 'win32' ? `${cmd}.cmd` : cmd);
      if (fs.existsSync(localBin)) {
        return true;
      }
    } catch {
      // Ignore
    }

    // Check if absolute path exists
    try {
      if (path.isAbsolute(cmd) && fs.existsSync(cmd)) {
        return true;
      }
    } catch {
      // Ignore
    }

    // Check system PATH via where/which or version flag
    try {
      const probeTool = process.platform === 'win32' ? 'where.exe' : 'which';
      const check = spawnSync(probeTool, [cmd], {
        stdio: 'ignore',
        shell: false,
        timeout: 2000
      });
      if (check.status === 0) {
        return true;
      }
    } catch {
      // Ignore
    }

    // Try direct --version test
    try {
      const verCheck = spawnSync(cmd, ['--version'], {
        stdio: 'ignore',
        shell: false,
        timeout: 2000
      });
      if (verCheck.status === 0) {
        return true;
      }
    } catch {
      // Ignore
    }

    return false;
  }

  public refreshAvailability(): void {
    for (const spec of SUPPORTED_LANGUAGE_SERVERS) {
      const config = this.userConfigs.get(spec.languageId);
      const command = config?.customPath || config?.command || spec.defaultCommand;
      const isAvailable = this.checkBinaryAvailable(command);
      const current = this.serverStatuses.get(spec.languageId);
      if (current) {
        current.isAvailable = isAvailable;
        current.command = command;
      }
    }
  }

  public getAllServers(): LanguageServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  public getServerStatus(languageId: string): LanguageServerStatus | undefined {
    return this.serverStatuses.get(languageId);
  }

  public configureServer(languageId: string, config: LanguageServerConfig): void {
    this.userConfigs.set(languageId, config);
    const spec = SUPPORTED_LANGUAGE_SERVERS.find((s) => s.languageId === languageId);
    if (!spec) return;

    const status = this.serverStatuses.get(languageId);
    if (status) {
      if (config.enabled === false) {
        status.status = 'disabled';
      } else if (status.status === 'disabled') {
        status.status = 'stopped';
      }
      if (config.command) status.command = config.command;
      if (config.args) status.args = config.args;
      if (config.customPath) status.command = config.customPath;
      status.isAvailable = this.checkBinaryAvailable(status.command);
    }
  }

  /**
   * Resolves languageId by file extension
   */
  public getLanguageIdForFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase();
    for (const spec of SUPPORTED_LANGUAGE_SERVERS) {
      if (spec.extensions.includes(ext)) {
        return spec.languageId;
      }
    }
    return null;
  }

  /**
   * Starts a language server for a given language ID
   */
  public async startServer(languageId: string): Promise<boolean> {
    const spec = SUPPORTED_LANGUAGE_SERVERS.find((s) => s.languageId === languageId);
    if (!spec) return false;

    const status = this.serverStatuses.get(languageId);
    if (status?.status === 'running' && this.clients.has(languageId)) {
      return true;
    }

    const config = this.userConfigs.get(languageId);
    if (config?.enabled === false) {
      return false;
    }

    const command = config?.customPath || config?.command || spec.defaultCommand;
    const args = config?.args || spec.defaultArgs;

    // Check if binary is available
    const isAvailable = this.checkBinaryAvailable(command);
    if (status) {
      status.isAvailable = isAvailable;
      status.command = command;
      status.args = args;
    }

    if (!isAvailable) {
      if (status) {
        status.status = 'error';
        status.error = `Language server executable '${command}' not found. Fallback to built-in editor features.`;
      }
      return false;
    }

    try {
      if (status) status.status = 'starting';

      const client = new LspClient({
        command,
        args,
        workspacePath: this.workspacePath,
        languageId
      });

      client.on('exit', () => {
        if (status) {
          status.status = 'stopped';
        }
        this.clients.delete(languageId);
      });

      client.on('error', (err) => {
        if (status) {
          status.status = 'error';
          status.error = err.message;
        }
      });

      await client.start();
      this.clients.set(languageId, client);

      if (status) {
        status.status = 'running';
        status.error = undefined;
      }

      // Re-synchronize any already-tracked open documents for this language
      for (const [, doc] of this.trackedDocuments) {
        if (doc.languageId === languageId) {
          client.didOpen(doc.uri, doc.languageId, doc.version, doc.text);
        }
      }

      return true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (status) {
        status.status = 'error';
        status.error = msg;
      }
      return false;
    }
  }

  /**
   * Stops a language server
   */
  public async stopServer(languageId: string): Promise<void> {
    const client = this.clients.get(languageId);
    if (client) {
      await client.stop();
      this.clients.delete(languageId);
    }
    const status = this.serverStatuses.get(languageId);
    if (status && status.status !== 'disabled') {
      status.status = 'stopped';
    }
  }

  /**
   * Restarts a language server
   */
  public async restartServer(languageId: string): Promise<boolean> {
    await this.stopServer(languageId);
    return this.startServer(languageId);
  }

  /**
   * Auto-launches server if available and enabled when a document is opened
   */
  public async onDocumentOpened(filePath: string, languageId: string, text: string): Promise<void> {
    const uri = this.toUri(filePath);
    const doc: TrackedDocument = {
      uri,
      filePath,
      languageId,
      version: 1,
      text
    };
    this.trackedDocuments.set(uri, doc);

    const client = this.clients.get(languageId);
    if (client && client.isRunning) {
      client.didOpen(uri, languageId, doc.version, text);
    } else {
      // Auto-start if available
      const status = this.serverStatuses.get(languageId);
      if (status && status.isAvailable && status.status !== 'disabled') {
        const started = await this.startServer(languageId);
        if (started) {
          // Document will be opened in startServer re-sync loop
        }
      }
    }
  }

  public onDocumentChanged(filePath: string, text: string): void {
    const uri = this.toUri(filePath);
    const doc = this.trackedDocuments.get(uri);
    if (!doc) return;

    doc.version++;
    doc.text = text;

    const client = this.clients.get(doc.languageId);
    if (client && client.isRunning) {
      client.didChange(uri, doc.version, text);
    }
  }

  public onDocumentSaved(filePath: string, text?: string): void {
    const uri = this.toUri(filePath);
    const doc = this.trackedDocuments.get(uri);
    if (!doc) return;

    const client = this.clients.get(doc.languageId);
    if (client && client.isRunning) {
      client.didSave(uri, text);
    }
  }

  public onDocumentClosed(filePath: string): void {
    const uri = this.toUri(filePath);
    const doc = this.trackedDocuments.get(uri);
    if (!doc) return;

    const client = this.clients.get(doc.languageId);
    if (client && client.isRunning) {
      client.didClose(uri);
    }
    this.trackedDocuments.delete(uri);
  }

  // --- Routed Language Queries ---

  private getClientForFile(filePath: string): { client: LspClient | null; uri: string; error?: string } {
    const uri = this.toUri(filePath);
    const languageId = this.getLanguageIdForFile(filePath);
    if (!languageId) {
      return { client: null, uri, error: 'No language server configured for this file type.' };
    }

    const client = this.clients.get(languageId);
    if (!client || !client.isRunning) {
      return { client: null, uri, error: `Language server for '${languageId}' is not running.` };
    }

    return { client, uri };
  }

  public async getCompletions(filePath: string, position: LspPosition): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.completion(uri, position);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getHover(filePath: string, position: LspPosition): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.hover(uri, position);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getDefinition(filePath: string, position: LspPosition): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.definition(uri, position);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getTypeDefinition(filePath: string, position: LspPosition): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.typeDefinition(uri, position);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getImplementation(filePath: string, position: LspPosition): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.implementation(uri, position);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getReferences(filePath: string, position: LspPosition, includeDeclaration = true): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.references(uri, position, includeDeclaration);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async renameSymbol(filePath: string, position: LspPosition, newName: string): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.rename(uri, position, newName);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getDocumentSymbols(filePath: string): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.documentSymbol(uri);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getWorkspaceSymbols(query: string): Promise<any> {
    // Query all running clients
    const results: any[] = [];
    for (const [, client] of this.clients) {
      if (client.isRunning) {
        try {
          const res = await client.workspaceSymbol(query);
          if (Array.isArray(res)) results.push(...res);
        } catch {
          // Ignore individual client query failure
        }
      }
    }
    return { success: true, data: results };
  }

  public async getCodeActions(filePath: string, range: LspRange, context?: any): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.codeAction(uri, range, context);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public async getSignatureHelp(filePath: string, position: LspPosition): Promise<any> {
    const { client, uri, error } = this.getClientForFile(filePath);
    if (!client) return { success: false, fallbackToBuiltin: true, error };
    try {
      const result = await client.signatureHelp(uri, position);
      return { success: true, data: result };
    } catch (err: unknown) {
      return { success: false, fallbackToBuiltin: true, error: err instanceof Error ? err.message : String(err) };
    }
  }

  public toUri(filePath: string): string {
    if (filePath.startsWith('file://')) return filePath;
    const normalized = filePath.replace(/\\/g, '/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  }

  public cleanupAll(): void {
    for (const [, client] of this.clients) {
      void client.stop();
    }
    this.clients.clear();
    this.trackedDocuments.clear();
  }
}
