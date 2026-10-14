/**
 * Ty-Code Language Server Manager
 * Manages language server definitions, discovery, lifecycle (start/stop/restart),
 * open document synchronization, and routing requests to appropriate LSP clients.
 */

import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import crossSpawn from 'cross-spawn';
import { LspClient, type LspPosition, type LspRange } from './lsp-client';
import { toFileUri } from './lsp-path-utils';

const execFileAsync = promisify(execFile);
const SUPPORTED_PLATFORMS = ['win32', 'darwin', 'linux'] as const;
type SupportedPlatform = typeof SUPPORTED_PLATFORMS[number];

export interface LanguageServerSpec {
  languageId: string;
  name: string;
  extensions: string[];
  defaultCommand: string;
  defaultArgs: string[];
  installInstructions: string;
}

export interface LanguageServerConfig {
  enabled: boolean;
  args?: string[];
  /** Explicitly trusted executable path selected by the user. */
  path?: string;
  /** Legacy settings key retained for migration; treated as an explicit path. */
  customPath?: string;
}

export interface LanguageServerInstallCommand {
  platform: SupportedPlatform;
  command?: string;
  guidance: string;
  sourceUrl: string;
}

export interface WorkspaceServerCandidate {
  path: string;
  source: 'node_modules' | 'cargo-target' | 'python-venv' | 'workspace-bin';
}

export interface LspManagerOptions {
  resolveSystemExecutable?: (command: string) => Promise<{ resolvedPath?: string; version?: string }>;
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
  resolvedPath?: string;
  version?: string;
  workspaceCandidates?: WorkspaceServerCandidate[];
  installCommands?: LanguageServerInstallCommand[];
  isExplicitPath?: boolean;
  configuredPath?: string;
}


export interface TrackedDocument {
  uri: string;
  filePath: string;
  languageId: string;
  version: number;
  text: string;
  savedText: string;
  isDirty: boolean;
}

export const SUPPORTED_LANGUAGE_SERVERS: LanguageServerSpec[] = [
  {
    languageId: 'typescript',
    name: 'TypeScript / JavaScript',
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    defaultCommand: 'typescript-language-server',
    defaultArgs: ['--stdio'],
    installInstructions: 'Install Node.js and npm, then install TypeScript Language Server.'
  },
  {
    languageId: 'python',
    name: 'Python (Pyright / PyLSP)',
    extensions: ['.py', '.pyw'],
    defaultCommand: 'pyright-langserver',
    defaultArgs: ['--stdio'],
    installInstructions: 'Install Pyright or python-lsp-server with your Python package manager.'
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
    installInstructions: 'Download and extract the Eclipse JDT Language Server release, then configure its executable path.'
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
  private workspaceEpoch = 0;
  private injectedExecutableResolver?: LspManagerOptions['resolveSystemExecutable'];

  constructor(workspacePath?: string, options: LspManagerOptions = {}) {
    this.workspacePath = path.resolve(workspacePath || process.cwd());
    this.injectedExecutableResolver = options.resolveSystemExecutable;
    this.initializeServerStatuses();
  }

  public static getInstance(workspacePath?: string): LspManager {
    if (!LspManager.instance) {
      LspManager.instance = new LspManager(workspacePath);
    } else if (workspacePath && LspManager.instance.workspacePath !== path.resolve(workspacePath)) {
      LspManager.instance.setWorkspacePath(workspacePath);
    }
    return LspManager.instance;
  }

  public setWorkspacePath(newPath: string): void {
    const resolvedPath = path.resolve(newPath);
    if (this.workspacePath !== resolvedPath) {
      this.workspacePath = resolvedPath;
      this.workspaceEpoch++;
      this.trackedDocuments.clear();
      this.binaryCache.clear();
      for (const client of this.clients.values()) void client.stop();
      this.clients.clear();
      for (const status of this.serverStatuses.values()) {
        if (status.status !== 'disabled') status.status = 'stopped';
      }
      void this.refreshAvailability();
    }
  }

  public getWorkspacePath(): string {
    return this.workspacePath;
  }

  private binaryCache = new Map<string, { expiresAt: number; resolvedPath?: string; version?: string }>();
  private startPromises = new Map<string, Promise<boolean>>();

  private initializeServerStatuses(): void {
    for (const spec of SUPPORTED_LANGUAGE_SERVERS) {
      this.serverStatuses.set(spec.languageId, {
        languageId: spec.languageId,
        name: spec.name,
        status: 'stopped',
        isAvailable: false,
        command: spec.defaultCommand,
        args: [...spec.defaultArgs],
        extensions: spec.extensions,
        installInstructions: spec.installInstructions,
        workspaceCandidates: [],
        installCommands: this.getInstallCommands(spec.languageId)
      });
    }
    void this.refreshAvailability();
  }

  private getInstallCommands(languageId: string): LanguageServerInstallCommand[] {
    const sourceUrls: Record<string, string> = {
      typescript: 'https://github.com/typescript-language-server/typescript-language-server',
      python: 'https://pypi.org/project/python-lsp-server/',
      rust: 'https://rust-analyzer.github.io/book/installation.html',
      go: 'https://go.dev/gopls/',
      java: 'https://github.com/eclipse-jdtls/eclipse.jdt.ls',
      cpp: 'https://clangd.llvm.org/installation.html'
    };
    const commandByLanguage: Record<string, Partial<Record<SupportedPlatform, string>>> = {
      typescript: { win32: 'npm install -g typescript typescript-language-server', darwin: 'npm install -g typescript typescript-language-server', linux: 'npm install -g typescript typescript-language-server' },
      python: { win32: 'python -m pip install pyright', darwin: 'python3 -m pip install pyright', linux: 'python3 -m pip install pyright' },
      rust: { win32: 'rustup component add rust-analyzer', darwin: 'rustup component add rust-analyzer', linux: 'rustup component add rust-analyzer' },
      go: { win32: 'go install golang.org/x/tools/gopls@latest', darwin: 'go install golang.org/x/tools/gopls@latest', linux: 'go install golang.org/x/tools/gopls@latest' },
      java: { win32: 'scoop install main/jdtls', darwin: 'brew install jdtls' },
      cpp: { win32: 'winget install --id LLVM.clangd', darwin: 'brew install llvm', linux: 'sudo apt install clangd' }
    };
    const guidanceByLanguage: Record<string, Partial<Record<SupportedPlatform, string>>> = {
      java: {
        linux: 'Download and extract an Eclipse JDT Language Server build; configure its launcher path.'
      },
      cpp: { linux: 'For Fedora, install clang-tools-extra; for other distributions, use the official clangd package instructions.' }
    };
    return SUPPORTED_PLATFORMS.map((platform) => ({
      platform,
      command: commandByLanguage[languageId]?.[platform],
      guidance: guidanceByLanguage[languageId]?.[platform] || this.serverInstructions(languageId, platform),
      sourceUrl: sourceUrls[languageId] || 'https://clangd.llvm.org/installation.html'
    }));
  }

  private serverInstructions(languageId: string, platform: SupportedPlatform): string {
    if (languageId === 'python' && platform === 'linux') return 'Pyright is installed with pip; distro packages for python-lsp-server are also available.';
    if (languageId === 'cpp' && platform === 'linux') return 'For newer LLVM versions, use the official clangd package instructions.';
    return 'Run this command in a terminal after installing the required language runtime.';
  }

  private async resolveSystemExecutable(command: string): Promise<{ resolvedPath?: string; version?: string }> {
    const key = `${process.platform}:${command}`;
    const cached = this.binaryCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached;
    if (this.injectedExecutableResolver) {
      const injected = await this.injectedExecutableResolver(command);
      const result = { ...injected, expiresAt: Date.now() + 30_000 };
      this.binaryCache.set(key, result);
      return result;
    }

    let resolvedPath: string | undefined;
    try {
      const resolver = process.platform === 'win32' ? 'where.exe' : 'which';
      const { stdout } = await execFileAsync(resolver, [command], { timeout: 2_000, windowsHide: true, maxBuffer: 16_384 });
      const candidate = stdout.split(/\r?\n/).map((item) => item.trim()).find(Boolean);
      if (candidate) {
        const candidateStats = await stat(candidate);
        if (candidateStats.isFile()) resolvedPath = path.resolve(candidate);
      }
    } catch {
      // PATH lookup failure means unavailable; local project candidates are informational only.
    }

    const version = resolvedPath ? await this.probeVersion(resolvedPath) : undefined;
    const result = { resolvedPath, version, expiresAt: Date.now() + 30_000 };
    this.binaryCache.set(key, result);
    return result;
  }

  private probeVersion(executablePath: string): Promise<string | undefined> {
    return new Promise((resolve) => {
      const child = crossSpawn(executablePath, ['--version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let output = '';
      let settled = false;
      const finish = (value?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => { child.kill(); finish(); }, 2_000);
      child.stdout?.on('data', (chunk: Buffer | string) => { output = (output + chunk.toString()).slice(0, 512); });
      child.stderr?.on('data', (chunk: Buffer | string) => { output = (output + chunk.toString()).slice(0, 512); });
      child.once('error', () => finish());
      child.once('close', (code) => finish(code === 0 ? output.trim().split(/\r?\n/)[0]?.slice(0, 160) : undefined));
    });
  }

  private async findWorkspaceCandidates(spec: LanguageServerSpec): Promise<WorkspaceServerCandidate[]> {
    const command = spec.defaultCommand;
    const win = process.platform === 'win32';
    const executable = win ? `${command}.cmd` : command;
    const names: Array<{ path: string; source: WorkspaceServerCandidate['source'] }> = [
      { path: path.join('node_modules', '.bin', executable), source: 'node_modules' }
    ];
    if (command === 'pyright-langserver') {
      names.push(
        { path: path.join('.venv', win ? 'Scripts' : 'bin', win ? 'pyright-langserver.exe' : command), source: 'python-venv' },
        { path: path.join('venv', win ? 'Scripts' : 'bin', win ? 'pyright-langserver.exe' : command), source: 'python-venv' }
      );
    }
    if (command === 'rust-analyzer') names.push({ path: path.join('target', 'debug', win ? 'rust-analyzer.exe' : command), source: 'cargo-target' });
    if (command === 'gopls') names.push({ path: path.join('bin', win ? 'gopls.exe' : 'gopls'), source: 'workspace-bin' });
    if (command === 'clangd') names.push({ path: path.join('bin', win ? 'clangd.exe' : 'clangd'), source: 'workspace-bin' });
    if (command === 'jdtls') names.push({ path: path.join('bin', win ? 'jdtls.bat' : 'jdtls'), source: 'workspace-bin' });
    const candidates: WorkspaceServerCandidate[] = [];
    for (const item of names) {
      const candidate = path.resolve(this.workspacePath, item.path);
      try {
        const candidateStats = await stat(candidate);
        if (candidateStats.isFile()) candidates.push({ path: candidate, source: item.source });
      } catch {
        // Candidate is optional and remains informational only.
      }
    }
    return candidates;
  }

  private async discoverServer(spec: LanguageServerSpec, config = this.userConfigs.get(spec.languageId)):
    Promise<{ resolvedPath?: string; version?: string; workspaceCandidates: WorkspaceServerCandidate[]; isExplicitPath: boolean }> {
    const [workspaceCandidates, system] = await Promise.all([
      this.findWorkspaceCandidates(spec),
      config?.path || config?.customPath
        ? Promise.resolve({ resolvedPath: undefined, version: undefined })
        : this.resolveSystemExecutable(spec.defaultCommand)
    ]);
    const explicitPath = config?.path || config?.customPath;
    let resolvedPath = system.resolvedPath;
    let version = system.version;
    if (explicitPath) {
      if (!path.isAbsolute(explicitPath) || path.win32.isAbsolute(explicitPath) !== (process.platform === 'win32')) {
        throw new Error('Language server executable path must be an absolute path for this operating system.');
      }
      const candidate = path.resolve(explicitPath);
      const candidateStats = await stat(candidate).catch(() => null);
      if (!candidateStats?.isFile()) throw new Error(`Language server executable was not found at ${candidate}.`);
      resolvedPath = candidate;
      version = await this.probeVersion(candidate);
    }
    return { resolvedPath, version, workspaceCandidates, isExplicitPath: Boolean(explicitPath) };
  }

  public async refreshAvailability(languageId?: string): Promise<void> {
    const specs = SUPPORTED_LANGUAGE_SERVERS.filter((spec) => !languageId || spec.languageId === languageId);
    await Promise.all(specs.map(async (spec) => {
      const status = this.serverStatuses.get(spec.languageId);
      if (!status) return;
      try {
        const result = await this.discoverServer(spec);
        status.resolvedPath = result.resolvedPath;
        status.version = result.version;
        status.workspaceCandidates = result.workspaceCandidates;
        status.isExplicitPath = result.isExplicitPath;
        status.configuredPath = this.userConfigs.get(spec.languageId)?.path || this.userConfigs.get(spec.languageId)?.customPath;
        status.isAvailable = Boolean(result.resolvedPath);
        status.command = result.resolvedPath || spec.defaultCommand;
        status.args = [...(this.userConfigs.get(spec.languageId)?.args || spec.defaultArgs)];
        if (this.userConfigs.get(spec.languageId)?.enabled === false) status.status = 'disabled';
        else if (status.status === 'disabled') status.status = 'stopped';
        status.error = undefined;
      } catch (error) {
        status.isAvailable = false;
        status.resolvedPath = undefined;
        status.version = undefined;
        status.configuredPath = this.userConfigs.get(spec.languageId)?.path || this.userConfigs.get(spec.languageId)?.customPath;
        status.error = error instanceof Error ? error.message : String(error);
      }
    }));
  }

  public getAllServers(): LanguageServerStatus[] {
    return Array.from(this.serverStatuses.values());
  }

  public getServerStatus(languageId: string): LanguageServerStatus | undefined {
    return this.serverStatuses.get(languageId);
  }

  public async configureServer(languageId: string, config: LanguageServerConfig): Promise<void> {
    const spec = SUPPORTED_LANGUAGE_SERVERS.find((item) => item.languageId === languageId);
    if (!spec) throw new Error(`Unsupported language server: ${languageId}`);
    if (config.path && config.customPath && config.path !== config.customPath) throw new Error('Configure only one explicit server path.');
    if (config.args && (!Array.isArray(config.args) || config.args.some((arg) => typeof arg !== 'string' || arg.length > 500))) {
      throw new Error('Language server arguments must be a list of strings shorter than 500 characters each.');
    }
    const previous = this.userConfigs.get(languageId);
    const pathWasProvided = Object.prototype.hasOwnProperty.call(config, 'path') || Object.prototype.hasOwnProperty.call(config, 'customPath');
    const configuredPath = pathWasProvided ? (config.path || config.customPath || undefined) : previous?.path;
    this.userConfigs.set(languageId, { ...previous, ...config, path: configuredPath, customPath: undefined });
    await this.refreshAvailability(languageId);
    const status = this.serverStatuses.get(languageId);
    if (status && this.userConfigs.get(languageId)?.enabled === false) {
      await this.stopServer(languageId);
      status.status = 'disabled';
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
  public startServer(languageId: string): Promise<boolean> {
    const existing = this.startPromises.get(languageId);
    if (existing) return existing;
    const pending = this.startServerInternal(languageId).finally(() => {
      if (this.startPromises.get(languageId) === pending) this.startPromises.delete(languageId);
    });
    this.startPromises.set(languageId, pending);
    return pending;
  }

  private async startServerInternal(languageId: string): Promise<boolean> {
    const spec = SUPPORTED_LANGUAGE_SERVERS.find((item) => item.languageId === languageId);
    if (!spec) return false;

    const status = this.serverStatuses.get(languageId);
    const running = this.clients.get(languageId);
    if (status?.status === 'running' && running?.isRunning) return true;
    if (this.userConfigs.get(languageId)?.enabled === false) return false;

    await this.refreshAvailability(languageId);
    const command = status?.resolvedPath;
    const args = this.userConfigs.get(languageId)?.args || spec.defaultArgs;
    if (!command) {
      if (status) {
        status.status = 'error';
        status.error = status.workspaceCandidates?.length
          ? 'Only workspace-local executable candidates were found. Set an explicit absolute path in Settings to run one.'
          : `Language server '${spec.name}' is not installed or not on the system PATH.`;
      }
      return false;
    }

    const workspaceEpoch = this.workspaceEpoch;
    if (status) {
      status.isAvailable = true;
      status.command = command;
      status.args = [...args];
      status.status = 'starting';
      status.error = undefined;
    }

    const client = new LspClient({ command, args, workspacePath: this.workspacePath, languageId });
    client.on('exit', () => {
      if (this.clients.get(languageId) !== client) return;
      this.clients.delete(languageId);
      if (status && status.status !== 'disabled') status.status = 'stopped';
    });
    client.on('error', (error) => {
      if (status && (this.clients.get(languageId) === client || !this.clients.has(languageId))) {
        status.status = 'error';
        status.error = error.message;
      }
    });

    try {
      await client.start();
      if (workspaceEpoch !== this.workspaceEpoch || !client.isRunning) {
        await client.stop();
        return false;
      }
      this.clients.set(languageId, client);
      if (status) {
        status.status = 'running';
        status.error = undefined;
      }
      for (const doc of this.trackedDocuments.values()) {
        if (doc.languageId === languageId) client.didOpen(doc.uri, doc.languageId, doc.version, doc.text);
      }
      return true;
    } catch (error) {
      if (this.clients.get(languageId) === client) this.clients.delete(languageId);
      await client.stop().catch(() => undefined);
      if (status) {
        status.status = 'error';
        status.error = error instanceof Error ? error.message : String(error);
      }
      return false;
    }
  }

  /**
   * Stops a language server
   */
  public async stopServer(languageId: string): Promise<void> {
    const pendingStart = this.startPromises.get(languageId);
    if (pendingStart) await pendingStart;
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
    const normalizedPath = path.resolve(filePath);
    const uri = this.toUri(normalizedPath);
    const resolvedLanguageId = this.getLanguageIdForFile(normalizedPath) || (languageId === 'javascript' ? 'typescript' : languageId);
    const existing = this.trackedDocuments.get(uri);
    if (existing) {
      if (existing.text !== text) this.onDocumentChanged(normalizedPath, text);
      return;
    }
    const doc: TrackedDocument = { uri, filePath: normalizedPath, languageId: resolvedLanguageId, version: 1, text, savedText: text, isDirty: false };
    this.trackedDocuments.set(uri, doc);

    const client = this.clients.get(resolvedLanguageId);
    if (client?.isRunning) {
      client.didOpen(uri, resolvedLanguageId, doc.version, text);
      return;
    }
    const status = this.serverStatuses.get(resolvedLanguageId);
    if (status && status.status !== 'disabled') await this.startServer(resolvedLanguageId);
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
    return toFileUri(filePath);
  }

  public cleanupAll(): void {
    for (const [, client] of this.clients) {
      void client.stop();
    }
    this.clients.clear();
    this.trackedDocuments.clear();
  }
}
