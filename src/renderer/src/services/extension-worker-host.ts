import type { InstalledExtension } from '../../../preload/types';
import {
  EXTENSION_RPC_MAX_IN_FLIGHT,
  EXTENSION_RPC_TIMEOUT_MS,
  EXTENSION_WORKER_HEARTBEAT_MS,
  EXTENSION_WORKER_WATCHDOG_MS,
  ExtensionIdSchema,
  ExtensionRpcMessageSchema,
  ExtensionRpcParamsSchema,
  parseExtensionRpcMessage,
  type ExtensionCapability,
  type ExtensionRpcMethod,
  type ExtensionRpcMessage,
  type ExtensionRpcRequest,
  type ExtensionRpcResponse
} from '../../../preload/extension-schemas';
import type { ExtensionCapabilityProvider } from '../../../main/services/extension-api';
import type { ExtensionTransport } from './extension-transport';
import { WorkerTransport } from './extension-transport';

interface PendingCall { method: ExtensionRpcMethod; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number; }
interface WorkerSession {
  extension: InstalledExtension;
  transport: ExtensionTransport;
  nonce: string;
  pending: Map<string, PendingCall>;
  inboundCount: number;
  unsubscribe: () => void;
  heartbeat: number;
  lastPong: number;
  restartCount: number;
  active: boolean;
}

export class ExtensionWorkerHost {
  private readonly sessions = new Map<string, WorkerSession>();
  private readonly commandOwners = new Map<string, string>();

  constructor(private readonly providerFactory: (extensionId: string) => ExtensionCapabilityProvider, private readonly makeTransport: () => ExtensionTransport = () => new WorkerTransport()) {}

  getRegisteredCommands(): Array<{ id: string; title: string; extensionId: string }> {
    const result: Array<{ id: string; title: string; extensionId: string }> = [];
    for (const [id, extensionId] of this.commandOwners) {
      const command = this.sessions.get(extensionId)?.extension.manifest.contributes?.commands?.find((item) => item.command === id);
      if (command) result.push({ id, title: command.title, extensionId });
    }
    return result;
  }

  async initialize(extensions: InstalledExtension[]): Promise<void> {
    for (const extensionId of [...this.sessions.keys()]) this.deactivate(extensionId);
    for (const extension of extensions) {
      if (extension.enabled && extension.isBuiltIn && extension.executionState === 'built-in') await this.activate(extension);
    }
  }

  async activate(extension: InstalledExtension): Promise<void> {
    const extensionId = ExtensionIdSchema.parse(extension.id);
    if (!extension.enabled || !extension.isBuiltIn || extension.executionState !== 'built-in') return;
    if (this.sessions.has(extensionId)) this.deactivate(extensionId);
    const capabilities = extension.manifest.capabilities || [];
    if (!capabilities.includes('commands.register')) throw new Error(`Built-in extension "${extensionId}" has no command registration capability.`);
    const session = this.createSession(extension, 0);
    this.sessions.set(extensionId, session);
    this.startWatchdog(session);
    await this.call(session, 'host.activate', { extensionId, manifest: extension.manifest, capabilities });
    session.active = true;
  }

  async executeCommand(extensionId: string, commandId: string, args: unknown[]): Promise<unknown> {
    const session = this.sessions.get(ExtensionIdSchema.parse(extensionId));
    if (!session?.active || !session.extension.enabled) throw new Error(`Extension "${extensionId}" is disabled or inactive.`);
    if (this.commandOwners.get(commandId) !== extensionId) throw new Error(`Extension command "${commandId}" is not registered to this extension.`);
    return this.call(session, 'host.execute-command', { extensionId, commandId, args });
  }

  deactivate(extensionId: string): void {
    const session = this.sessions.get(extensionId);
    if (!session) return;
    this.sessions.delete(extensionId);
    window.clearInterval(session.heartbeat);
    session.unsubscribe();
    for (const [id, owner] of this.commandOwners) if (owner === extensionId) this.commandOwners.delete(id);
    for (const pending of session.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error(`Extension "${extensionId}" was deactivated.`));
    }
    session.pending.clear();
    try { session.transport.postMessage(this.message('request', 'host.deactivate', { extensionId }, extensionId, session.nonce)); } catch { /* Worker may already have failed. */ }
    session.transport.terminate();
  }

  private createSession(extension: InstalledExtension, restartCount: number): WorkerSession {
    const nonce = crypto.randomUUID();
    const transport = this.makeTransport();
    const session: WorkerSession = {
      extension, transport, nonce, pending: new Map(), inboundCount: 0, unsubscribe: () => undefined,
      heartbeat: 0, lastPong: Date.now(), restartCount, active: false
    };
    session.unsubscribe = transport.subscribe((raw) => this.onMessage(session, raw), (error) => this.restartOrStop(session, error));
    return session;
  }

  private message(kind: 'request' | 'response', method: ExtensionRpcMethod, params: unknown, extensionId: string, nonce: string, id = crypto.randomUUID()): ExtensionRpcMessage {
    return parseExtensionRpcMessage({ v: 1, id, kind, method, params, extensionId, nonce });
  }

  private call(session: WorkerSession, method: ExtensionRpcMethod, params: unknown): Promise<unknown> {
    const safeParams = ExtensionRpcParamsSchema[method].parse(params);
    if (session.pending.size >= EXTENSION_RPC_MAX_IN_FLIGHT) return Promise.reject(new Error('Extension RPC concurrency limit reached.'));
    const id = crypto.randomUUID();
    const request = this.message('request', method, safeParams, session.extension.id, session.nonce, id);
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        session.pending.delete(id);
        reject(new Error(`Extension RPC timed out: ${method}`));
        if (method === 'host.ping') this.restartOrStop(session, new Error('Extension Worker watchdog timed out.'));
      }, method === 'host.execute-command' ? 30_000 : EXTENSION_RPC_TIMEOUT_MS);
      session.pending.set(id, { method, resolve, reject, timer });
      try { session.transport.postMessage(request); }
      catch (error) {
        window.clearTimeout(timer);
        session.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  private onMessage(session: WorkerSession, raw: unknown): void {
    let message: ExtensionRpcMessage;
    try {
      message = ExtensionRpcMessageSchema.parse(raw);
      const bytes = new TextEncoder().encode(JSON.stringify(raw)).byteLength;
      if (bytes > 256 * 1024) throw new Error('Extension RPC message exceeds the 256 KiB limit.');
      if (message.extensionId !== session.extension.id || message.nonce !== session.nonce) throw new Error('Extension Worker identity or nonce mismatch.');
      if (message.kind === 'response') {
        const pending = session.pending.get(message.id);
        if (!pending) throw new Error('Extension Worker returned an unknown or expired request ID.');
        if (pending.method !== message.method) throw new Error('Extension Worker response method does not match its request.');
        session.pending.delete(message.id);
        window.clearTimeout(pending.timer);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error || 'Extension Worker call failed.'));
        return;
      }
      if (message.kind === 'request') {
        const request = message as ExtensionRpcRequest;
        if (!request.method.startsWith('capability.')) throw new Error('Worker attempted a host-only RPC method.');
        if (session.inboundCount >= EXTENSION_RPC_MAX_IN_FLIGHT) throw new Error('Extension inbound RPC concurrency limit reached.');
        session.inboundCount += 1;
        void this.handleCapabilityRequest(session, request).then((result) => {
          const response: ExtensionRpcResponse = {
            v: 1, id: request.id, kind: 'response', method: request.method, ok: true, result,
            extensionId: session.extension.id, nonce: session.nonce
          };
          session.transport.postMessage(parseExtensionRpcMessage(response));
        }).catch((error: unknown) => {
          const response: ExtensionRpcResponse = {
            v: 1, id: request.id, kind: 'response', method: request.method, ok: false,
            error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000),
            extensionId: session.extension.id, nonce: session.nonce
          };
          session.transport.postMessage(parseExtensionRpcMessage(response));
        }).finally(() => { session.inboundCount = Math.max(0, session.inboundCount - 1); });
        return;
      }
      if (message.kind !== 'event') throw new Error('Extension Worker sent an unexpected message.');
      if (message.method === 'runtime.ready') { session.lastPong = Date.now(); return; }
      if (message.method === 'command.register') this.registerCommand(session, message.params.commandId, message.params.title);
      else throw new Error('Unrecognized extension event.');
    } catch (error) {
      this.restartOrStop(session, error instanceof Error ? error : new Error(String(error)));
    }
  }

  private async handleCapabilityRequest(session: WorkerSession, message: ExtensionRpcRequest): Promise<unknown> {
    if (!session.extension.enabled) throw new Error('Extension is disabled.');
    const params = ExtensionRpcParamsSchema[message.method].parse(message.params) as Record<string, unknown>;
    const policy: Partial<Record<ExtensionRpcMethod, ExtensionCapability>> = {
      'capability.workspace.read-file': 'workspace.fs.read',
      'capability.workspace.write-file': 'workspace.fs.write',
      'capability.editor.get-active-document': 'editor.read',
      'capability.editor.apply-active-edit': 'editor.edit',
      'capability.window.show-message': 'window.messages',
      'capability.window.show-input': 'window.input',
      'capability.terminal.open': 'terminal.open',
      'capability.agent.request': 'agent.request',
      'capability.git.refresh': 'git.read',
      'capability.git.copy-remote-url': 'git.read'
    };
    const capability = policy[message.method];
    if (!capability || !(session.extension.manifest.capabilities || []).includes(capability)) {
      throw new Error(`Extension "${session.extension.id}" has not declared this capability.`);
    }
    const provider = this.providerFactory(session.extension.id);
    switch (message.method) {
      case 'capability.workspace.read-file': return provider.workspace.readFile(String(params.relativePath));
      case 'capability.workspace.write-file': return provider.workspace.writeFile(String(params.relativePath), String(params.content));
      case 'capability.editor.get-active-document': return provider.editor.getActiveDocument();
      case 'capability.editor.apply-active-edit': return provider.editor.applyActiveEdit(String(params.content));
      case 'capability.window.show-message': return provider.window.showMessage(String(params.message));
      case 'capability.window.show-input': return provider.window.showInput(String(params.prompt), typeof params.value === 'string' ? params.value : undefined);
      case 'capability.terminal.open': return provider.terminal.open();
      case 'capability.agent.request': return provider.agent.request(String(params.prompt));
      case 'capability.git.refresh': return provider.git.refresh();
      case 'capability.git.copy-remote-url': return provider.git.copyRemoteUrl();
      default: throw new Error(`Unsupported capability method: ${message.method}`);
    }
  }

  private registerCommand(session: WorkerSession, commandId: string, title?: string): void {
    const declared = session.extension.manifest.contributes?.commands?.find((command) => command.command === commandId);
    const prefix = `${session.extension.id}.`;
    if (!session.extension.enabled || !declared || !commandId.startsWith(prefix)) throw new Error('Worker attempted to register an undeclared or unowned command.');
    const owner = this.commandOwners.get(commandId);
    if (owner && owner !== session.extension.id) throw new Error(`Command "${commandId}" is already registered by "${owner}".`);
    this.commandOwners.set(commandId, session.extension.id);
  }

  private startWatchdog(session: WorkerSession): void {
    session.heartbeat = window.setInterval(() => {
      if (Date.now() - session.lastPong > EXTENSION_WORKER_WATCHDOG_MS) {
        this.restartOrStop(session, new Error('Extension Worker missed its watchdog deadline.'));
        return;
      }
      void this.call(session, 'host.ping', {}).then(() => { session.lastPong = Date.now(); }).catch(() => undefined);
    }, EXTENSION_WORKER_HEARTBEAT_MS);
  }

  private restartOrStop(session: WorkerSession, _reason: Error): void {
    console.warn(`[ExtensionWorkerHost] Session restarted/stopped for "${session.extension.id}":`, _reason);
    if (this.sessions.get(session.extension.id) !== session) return;
    this.sessions.delete(session.extension.id);
    window.clearInterval(session.heartbeat);
    session.unsubscribe();
    session.transport.terminate();
    for (const [id, owner] of this.commandOwners) if (owner === session.extension.id) this.commandOwners.delete(id);
    for (const pending of session.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error('Extension Worker was restarted after a protocol or watchdog failure.'));
    }
    session.pending.clear();
    if (session.restartCount >= 1 || !session.extension.enabled) return;
    const replacement = this.createSession(session.extension, session.restartCount + 1);
    this.sessions.set(session.extension.id, replacement);
    this.startWatchdog(replacement);
    void this.call(replacement, 'host.activate', {
      extensionId: replacement.extension.id,
      manifest: replacement.extension.manifest,
      capabilities: replacement.extension.manifest.capabilities || []
    }).then(() => { replacement.active = true; }).catch((err) => this.restartOrStop(replacement, new Error(`Extension Worker restart failed: ${err instanceof Error ? err.message : String(err)}`)));
  }
}
