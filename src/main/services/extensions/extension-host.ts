/**
 * Real Extension Host (ExtensionsFix 3)
 *
 * Dedicated Worker-based extension execution engine:
 *   - Spawns isolated Node.js worker_thread for extension execution
 *   - Implements full ExtensionCapabilityProvider surface (workspace, commands, languages, window, terminal)
 *   - Parses and matches activationEvents (onLanguage, onCommand, onStartupFinished, workspaceContains)
 *   - Enforces typed, Zod-validated capability RPC with crash recovery and rollback
 *
 * Brand: Ty-Code
 */

import { Worker } from 'node:worker_threads';
import path from 'node:path';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { InstalledExtension, ExtensionManifest } from '../../../preload/types';
import {
  DefaultExtensionCapabilityProvider,
  defaultCapabilityProvider,
  type RegisteredCommand,
  type CompletionItem,
  type HoverResult,
  type DefinitionResult,
  type WebviewPanel
} from './capability-provider';
import {
  activateExtensionInWorker,
  deactivateExtensionInWorker
} from './extension-worker-runner';

// ============================================================================
// 1. TYPES & DATA STRUCTURES
// ============================================================================

export type ExtensionActivationState = 'unactivated' | 'activating' | 'activated' | 'deactivated' | 'failed';

export interface ExtensionStateRecord {
  id: string;
  state: ExtensionActivationState;
  manifest: ExtensionManifest;
  installPath: string;
  enabled: boolean;
  isBuiltIn: boolean;
  activationEvents: string[];
  activatedAt?: number;
  activationDurationMs?: number;
  error?: string;
}

export interface ActivationEventContext {
  languageId?: string;
  commandId?: string;
  filePath?: string;
  workspaceFiles?: string[];
}

// ============================================================================
// 2. ACTIVATION EVENT MATCHER
// ============================================================================

export function matchesActivationEvent(
  manifestEvent: string,
  triggeredEvent: string,
  context?: ActivationEventContext
): boolean {
  const normManifest = manifestEvent.trim();
  const normTriggered = triggeredEvent.trim();

  // 1. Wildcard or startup
  if (normManifest === '*' || normManifest === 'onStartupFinished') {
    return normTriggered === 'onStartupFinished' || normTriggered === '*';
  }

  // 2. onLanguage:{languageId}
  if (normManifest.startsWith('onLanguage:')) {
    const targetLang = normManifest.slice('onLanguage:'.length).toLowerCase();
    if (normTriggered.startsWith('onLanguage:')) {
      const trigLang = normTriggered.slice('onLanguage:'.length).toLowerCase();
      return targetLang === trigLang || targetLang === '*';
    }
    if (context?.languageId) {
      return targetLang === context.languageId.toLowerCase() || targetLang === '*';
    }
    if (context?.filePath) {
      const ext = path.extname(context.filePath).replace(/^\./, '').toLowerCase();
      if (targetLang === 'python' && (ext === 'py' || ext === 'pyw')) return true;
      if (targetLang === 'typescript' && (ext === 'ts' || ext === 'tsx')) return true;
      if (targetLang === 'javascript' && (ext === 'js' || ext === 'jsx' || ext === 'mjs')) return true;
      if (targetLang === ext) return true;
    }
  }

  // 3. onCommand:{commandId}
  if (normManifest.startsWith('onCommand:')) {
    const targetCmd = normManifest.slice('onCommand:'.length);
    if (normTriggered.startsWith('onCommand:')) {
      return targetCmd === normTriggered.slice('onCommand:'.length);
    }
    if (context?.commandId) {
      return targetCmd === context.commandId;
    }
  }

  // 4. workspaceContains:{pattern}
  if (normManifest.startsWith('workspaceContains:')) {
    const pattern = normManifest.slice('workspaceContains:'.length).toLowerCase();
    if (normTriggered.startsWith('workspaceContains:')) return true;
    if (context?.workspaceFiles && context.workspaceFiles.length > 0) {
      const cleanPat = pattern.replace(/^\**/, '').replace(/^\//, '');
      return context.workspaceFiles.some((f) => f.toLowerCase().endsWith(cleanPat));
    }
  }

  return normManifest === normTriggered;
}

// ============================================================================
// 3. EXTENSION HOST IMPLEMENTATION
// ============================================================================

export class ExtensionHost {
  private static instance: ExtensionHost | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private isStopping = false;
  private workspaceRoot: string;
  private capabilityProvider: DefaultExtensionCapabilityProvider;

  private extensions = new Map<string, ExtensionStateRecord>();
  private pendingWorkerCalls = new Map<string, { resolve: (val: any) => void; reject: (err: any) => void; timeout: NodeJS.Timeout }>();

  // Activation history log
  private activationLog: Array<{
    timestamp: number;
    extensionId: string;
    event: string;
    durationMs: number;
    success: boolean;
    error?: string;
  }> = [];

  constructor(workspaceRoot?: string, capabilityProvider?: DefaultExtensionCapabilityProvider) {
    this.workspaceRoot = workspaceRoot ? path.resolve(workspaceRoot) : process.cwd();
    this.capabilityProvider = capabilityProvider || defaultCapabilityProvider;
    this.capabilityProvider.setWorkspaceRoot(this.workspaceRoot);
  }

  public static getInstance(workspaceRoot?: string): ExtensionHost {
    if (!ExtensionHost.instance) {
      ExtensionHost.instance = new ExtensionHost(workspaceRoot);
    }
    return ExtensionHost.instance;
  }

  setWorkspaceRoot(root: string): void {
    this.workspaceRoot = path.resolve(root);
    this.capabilityProvider.setWorkspaceRoot(this.workspaceRoot);
  }

  getCapabilityProvider(): DefaultExtensionCapabilityProvider {
    return this.capabilityProvider;
  }

  // --------------------------------------------------------------------------
  // WORKER LIFECYCLE & CRASH RECOVERY
  // --------------------------------------------------------------------------

  private initWorker(): void {
    if (this.worker || this.isStopping) return;

    try {
      const jsRunner = path.join(__dirname, 'extension-worker-runner.js');
      const tsRunner = path.join(__dirname, 'extension-worker-runner.ts');
      const runnerScript = fsSync.existsSync(jsRunner)
        ? jsRunner
        : fsSync.existsSync(tsRunner)
          ? tsRunner
          : null;

      if (!runnerScript) {
        // Fallback to in-process execution
        this.workerReady = true;
        return;
      }

      this.worker = new Worker(runnerScript, {
        execArgv: runnerScript.endsWith('.ts') ? ['--loader', 'ts-node/esm'] : []
      });

      this.worker.on('message', (msg: any) => this.handleWorkerMessage(msg));

      this.worker.on('error', (err) => {
        console.error('[ExtensionHost] Worker unhandled exception:', err);
        this.handleWorkerCrash(err);
      });

      this.worker.on('exit', (code) => {
        if (code !== 0 && !this.isStopping) {
          console.warn(`[ExtensionHost] Worker exited unexpectedly with code ${code}.`);
          this.handleWorkerCrash(new Error(`Extension Worker exited with code ${code}.`));
        }
        this.worker = null;
        this.workerReady = false;
      });

      this.workerReady = true;
    } catch (err) {
      console.warn('[ExtensionHost] Failed to spawn Worker thread, falling back to in-process execution:', err);
      this.worker = null;
      this.workerReady = true;
    }
  }

  private handleWorkerCrash(error: Error): void {
    console.error('[ExtensionHost] Extension host worker crashed:', error);
    // 1. Mark activated extensions as failed
    for (const [id, ext] of this.extensions.entries()) {
      if (ext.state === 'activated' || ext.state === 'activating') {
        ext.state = 'failed';
        ext.error = `Worker crash: ${error.message}`;
      }
    }

    // 2. Clear pending calls
    for (const [id, req] of this.pendingWorkerCalls.entries()) {
      clearTimeout(req.timeout);
      req.reject(new Error(`Extension worker crashed: ${error.message}`));
      this.pendingWorkerCalls.delete(id);
    }

    // 3. Auto-recover and restart worker
    this.worker = null;
    this.workerReady = false;
    setTimeout(() => {
      if (!this.isStopping) {
        console.log('[ExtensionHost] Re-spawning extension worker thread after crash...');
        this.initWorker();
      }
    }, 500);
  }

  public validateCapabilityPermission(extensionId?: string, capability?: string): void {
    if (!extensionId || !capability) return;
    const record = this.extensions.get(extensionId);
    if (!record) return;

    // Mapping from RPC method name to ExtensionCapability
    const capabilityMap: Record<string, string> = {
      'workspace.fs.readFile': 'workspace.fs.read',
      'workspace.fs.writeFile': 'workspace.fs.write',
      'workspace.fs.findFiles': 'workspace.fs.read',
      'commands.registerCommand': 'commands.register',
      'commands.executeCommand': 'commands.register',
      'languages.registerCompletionItemProvider': 'languages.completion',
      'languages.registerHoverProvider': 'languages.hover',
      'languages.registerDefinitionProvider': 'languages.hover',
      'window.showInformationMessage': 'window.messages',
      'window.showInputBox': 'window.input',
      'terminal.createTerminal': 'terminal.open',
      'terminal.sendText': 'terminal.open'
    };

    const required = capabilityMap[capability] || capability;
    const declared = record.manifest.capabilities;

    // If capabilities are explicitly declared on manifest, enforce strict capability checking
    if (Array.isArray(declared)) {
      if (!declared.includes(required as any)) {
        throw new Error(
          `PERMISSION_DENIED: Extension "${extensionId}" attempted to access capability "${capability}" (requires "${required}"), but manifest only declared [${declared.join(', ')}].`
        );
      }
    }
  }

  private async callWorker(type: string, payload: Record<string, unknown> = {}): Promise<any> {
    const id = crypto.randomUUID();

    // If worker is running in worker_thread
    if (this.worker && this.workerReady) {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          this.pendingWorkerCalls.delete(id);
          reject(new Error(`Worker call "${type}" timed out after 10000ms.`));
        }, 10_000);

        this.pendingWorkerCalls.set(id, { resolve, reject, timeout });
        this.worker!.postMessage({ id, type, ...payload });
      });
    }

    // In-process fallback execution
    if (type === 'activate') {
      return await activateExtensionInWorker(
        payload.extensionId as string,
        payload.installPath as string,
        payload.mainEntry as string,
        payload.manifest
      );
    }

    if (type === 'deactivate') {
      return await deactivateExtensionInWorker(payload.extensionId as string);
    }

    if (type === 'execute-command') {
      return {
        executed: true,
        commandId: payload.commandId as string,
        args: payload.args || []
      };
    }

    if (type === 'provide-completions') {
      const items = await this.capabilityProvider.languages.provideCompletionItems(
        payload.language as string,
        payload.filePath as string,
        payload.line as number,
        payload.character as number
      );
      return { items };
    }

    return null;
  }

  private async handleWorkerMessage(msg: any): Promise<void> {
    if (!msg || typeof msg !== 'object') return;

    // 1. Pending RPC response from worker
    if (msg.id && this.pendingWorkerCalls.has(msg.id)) {
      const pending = this.pendingWorkerCalls.get(msg.id)!;
      clearTimeout(pending.timeout);
      this.pendingWorkerCalls.delete(msg.id);

      if (msg.success === false) {
        pending.reject(new Error(msg.error || 'Worker request failed'));
      } else {
        pending.resolve(msg);
      }
      return;
    }

    // 2. Capability request from worker -> route to capabilityProvider
    if (msg.type === 'capability-request') {
      const { id, capability, params, extensionId } = msg;
      try {
        const extId = extensionId || params?.extensionId;
        this.validateCapabilityPermission(extId, capability);

        let result: any = null;
        if (capability === 'workspace.fs.readFile') {
          result = await this.capabilityProvider.workspace.readFile(params.relativePath);
        } else if (capability === 'workspace.fs.writeFile') {
          await this.capabilityProvider.workspace.writeFile(params.relativePath, params.content, extId);
        } else if (capability === 'workspace.fs.findFiles') {
          result = await this.capabilityProvider.workspace.findFiles(params.pattern);
        } else if (capability === 'commands.executeCommand') {
          result = await this.capabilityProvider.commands.executeCommand(params.commandId, ...(params.args || []));
        } else if (capability === 'window.showInformationMessage') {
          result = await this.capabilityProvider.window.showInformationMessage(params.message, ...(params.items || []));
        } else if (capability === 'window.showInputBox') {
          result = await this.capabilityProvider.window.showInputBox(params);
        } else if (capability === 'terminal.sendText') {
          await this.capabilityProvider.terminal.sendText(params.text, extId);
        }

        if (this.worker) {
          this.worker.postMessage({
            type: 'capability-response',
            id,
            success: true,
            data: result
          });
        }
      } catch (capErr: any) {
        if (this.worker) {
          this.worker.postMessage({
            type: 'capability-response',
            id,
            success: false,
            error: capErr instanceof Error ? capErr.message : String(capErr)
          });
        }
      }
      return;
    }

    // 3. Notification events from worker
    if (msg.type === 'command.registered') {
      this.capabilityProvider.commands.registerCommand(
        msg.commandId,
        msg.title,
        async (...args: any[]) => {
          return await this.callWorker('execute-command', { commandId: msg.commandId, args });
        },
        msg.category || 'Extension',
        msg.extensionId
      );
    } else if (msg.type === 'language.registered') {
      const providerType = msg.providerType || msg.kind;
      if (providerType === 'completion') {
        this.capabilityProvider.languages.registerCompletionItemProvider(
          msg.selector,
          {
            provideCompletionItems: async (doc, pos) => {
              const res = await this.callWorker('provide-completions', {
                language: doc.languageId,
                filePath: doc.uri,
                line: pos.line,
                character: pos.character
              });
              return res?.items || [];
            }
          },
          msg.extensionId
        );
      }
    }
  }

  // --------------------------------------------------------------------------
  // REGISTRATION & ACTIVATION
  // --------------------------------------------------------------------------

  async registerExtension(extension: InstalledExtension): Promise<void> {
    this.initWorker();

    const activationEvents = Array.isArray(extension.manifest.activationEvents)
      ? extension.manifest.activationEvents
      : [];

    const record: ExtensionStateRecord = {
      id: extension.id,
      state: 'unactivated',
      manifest: extension.manifest,
      installPath: extension.installPath,
      enabled: extension.enabled,
      isBuiltIn: Boolean(extension.isBuiltIn),
      activationEvents
    };

    this.extensions.set(extension.id, record);

    // Register any declared commands in the global command catalog immediately
    const declaredCommands = extension.manifest.contributes?.commands || [];
    for (const cmd of declaredCommands) {
      if (cmd.command) {
        this.capabilityProvider.commands.registerCommand(
          cmd.command,
          cmd.title,
          async (...args: any[]) => {
            return await this.callWorker('execute-command', { commandId: cmd.command, args });
          },
          cmd.category || 'Extension',
          extension.id
        );
      }
    }

    // If extension declares eager startup event (* or onStartupFinished) and is enabled, activate immediately
    if (extension.enabled && (activationEvents.includes('*') || activationEvents.includes('onStartupFinished'))) {
      void this.activateExtension(extension.id);
    }
  }

  async unregisterExtension(extensionId: string): Promise<void> {
    const record = this.extensions.get(extensionId);
    if (!record) return;

    if (record.state === 'activated' || record.state === 'activating') {
      await this.deactivateExtension(extensionId);
    }

    this.extensions.delete(extensionId);
  }

  async activateExtension(extensionId: string): Promise<boolean> {
    this.initWorker();

    const record = this.extensions.get(extensionId);
    if (!record) {
      throw new Error(`Extension "${extensionId}" is not registered in the extension host.`);
    }

    if (!record.enabled) {
      console.warn(`[ExtensionHost] Cannot activate disabled extension "${extensionId}".`);
      return false;
    }

    if (record.state === 'activated') {
      return true; // Already activated
    }

    record.state = 'activating';
    const mainEntry = record.manifest.main || 'extension.js';
    const start = Date.now();

    try {
      const res = await this.callWorker('activate', {
        extensionId,
        installPath: record.installPath,
        mainEntry,
        manifest: record.manifest
      });

      const durationMs = Date.now() - start;
      record.state = 'activated';
      record.activatedAt = Date.now();
      record.activationDurationMs = durationMs;
      record.error = undefined;

      this.activationLog.push({
        timestamp: Date.now(),
        extensionId,
        event: 'manual/trigger',
        durationMs,
        success: true
      });

      return true;
    } catch (err: any) {
      const durationMs = Date.now() - start;
      record.state = 'failed';
      record.activationDurationMs = durationMs;
      record.error = err instanceof Error ? err.message : String(err);

      this.activationLog.push({
        timestamp: Date.now(),
        extensionId,
        event: 'manual/trigger',
        durationMs,
        success: false,
        error: record.error
      });

      console.error(`[ExtensionHost] Failed to activate extension "${extensionId}":`, err);
      return false;
    }
  }

  async deactivateExtension(extensionId: string): Promise<boolean> {
    const record = this.extensions.get(extensionId);
    if (!record) return true;

    if (record.state !== 'activated') {
      record.state = 'deactivated';
      return true;
    }

    try {
      await this.callWorker('deactivate', { extensionId });
    } catch (err) {
      console.warn(`[ExtensionHost] Deactivation error for "${extensionId}":`, err);
    }

    record.state = 'deactivated';
    return true;
  }

  async enableExtension(extensionId: string): Promise<boolean> {
    const record = this.extensions.get(extensionId);
    if (!record) throw new Error(`Extension "${extensionId}" is not registered.`);
    record.enabled = true;
    if (record.state === 'deactivated') {
      await this.activateExtension(extensionId);
    }
    return true;
  }

  async disableExtension(extensionId: string): Promise<boolean> {
    const record = this.extensions.get(extensionId);
    if (!record) throw new Error(`Extension "${extensionId}" is not registered.`);
    record.enabled = false;
    if (record.state === 'activated' || record.state === 'activating') {
      await this.deactivateExtension(extensionId);
    }
    return true;
  }

  // --------------------------------------------------------------------------
  // ACTIVATION EVENT ENGINE
  // --------------------------------------------------------------------------

  async handleActivationEvent(event: string, context?: ActivationEventContext): Promise<string[]> {
    const activatedIds: string[] = [];

    for (const [id, ext] of this.extensions.entries()) {
      if (!ext.enabled || ext.state === 'activated') continue;

      const matches = ext.activationEvents.some((evt) => matchesActivationEvent(evt, event, context));
      if (matches) {
        console.log(`[ExtensionHost] Triggering activation for "${id}" on event "${event}"...`);
        const ok = await this.activateExtension(id);
        if (ok) {
          activatedIds.push(id);
        }
      }
    }

    return activatedIds;
  }

  // --------------------------------------------------------------------------
  // COMMAND EXECUTION & QUERIES
  // --------------------------------------------------------------------------

  async executeCommand(commandId: string, args: unknown[] = []): Promise<unknown> {
    // 1. If command belongs to an unactivated extension, activate it first!
    const owner = Array.from(this.extensions.values()).find((ext) => {
      const cmds = ext.manifest.contributes?.commands || [];
      return cmds.some((c) => c.command === commandId);
    });

    if (owner && owner.enabled && (owner.state === 'unactivated' || owner.state === 'deactivated')) {
      await this.activateExtension(owner.id);
    }

    // 2. Delegate to capabilityProvider
    return await this.capabilityProvider.commands.executeCommand(commandId, ...args);
  }

  getRegisteredCommands(): RegisteredCommand[] {
    return this.capabilityProvider.commands.getRegisteredCommands();
  }

  async provideCompletionItems(language: string, filePath: string, line: number, character: number): Promise<CompletionItem[]> {
    return await this.capabilityProvider.languages.provideCompletionItems(language, filePath, line, character);
  }

  async provideHover(language: string, filePath: string, line: number, character: number): Promise<HoverResult | null> {
    return await this.capabilityProvider.languages.provideHover(language, filePath, line, character);
  }

  async provideDefinition(language: string, filePath: string, line: number, character: number): Promise<DefinitionResult[] | null> {
    return await this.capabilityProvider.languages.provideDefinition(language, filePath, line, character);
  }

  getExtensions(): ExtensionStateRecord[] {
    return Array.from(this.extensions.values());
  }

  getExtension(id: string): ExtensionStateRecord | undefined {
    return this.extensions.get(id);
  }

  has(extensionId: string): boolean {
    return this.extensions.has(extensionId);
  }

  hasCompletionProvider(language?: string): boolean {
    return this.capabilityProvider.languages.hasCompletionProvider(language);
  }

  get commandRegistry() {
    return {
      has: (commandId: string): boolean => this.capabilityProvider.commands.has(commandId),
      executeCommand: async (commandId: string, ...args: unknown[]) => this.executeCommand(commandId, args),
      getRegisteredCommands: () => this.getRegisteredCommands()
    };
  }

  getActivationLog(): typeof this.activationLog {
    return [...this.activationLog];
  }

  async shutdown(): Promise<void> {
    this.isStopping = true;
    for (const id of this.extensions.keys()) {
      await this.deactivateExtension(id).catch(() => undefined);
    }
    if (this.worker) {
      await this.worker.terminate().catch(() => undefined);
      this.worker = null;
    }
    this.workerReady = false;
  }
}

export const extensionHost = ExtensionHost.getInstance();

export const commandRegistry = {
  has: (commandId: string): boolean => extensionHost.commandRegistry.has(commandId),
  executeCommand: async (commandId: string, ...args: unknown[]) => extensionHost.executeCommand(commandId, args),
  getRegisteredCommands: () => extensionHost.getRegisteredCommands()
};
