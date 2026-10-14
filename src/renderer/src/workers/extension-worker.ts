import {
  EXTENSION_RPC_MAX_BYTES,
  ExtensionCapabilitySchema,
  ExtensionIdSchema,
  ExtensionManifestSchema,
  ExtensionRpcMessageSchema,
  ExtensionRpcParamsSchema,
  parseExtensionRpcMessage,
  type ExtensionCapability,
  type ExtensionRpcMethod,
  type ExtensionRpcMessage,
  type ExtensionRpcRequest,
  type ExtensionRpcResponse
} from '../../../preload/extension-schemas';
import type { ExtensionManifest } from '../../../preload/types';
import { activateAiCopilot } from '../extensions/ai-copilot';
import { activateGitlensLite } from '../extensions/gitlens-lite';
import { activatePrettierFormatter } from '../extensions/prettier-formatter';
import { activatePythonSupport } from '../extensions/python-support';
import { activateTypescriptSupport } from '../extensions/typescript-support';

interface WorkerApi {
  workspace: { readFile: (relativePath: string) => Promise<string>; writeFile: (relativePath: string, content: string) => Promise<void> };
  editor: { getActiveDocument: () => Promise<{ uri: string; fileName: string; languageId: string; lineCount: number; text: string } | null>; applyActiveEdit: (content: string) => Promise<boolean> };
  window: { showMessage: (message: string) => Promise<void>; showInput: (prompt: string, value?: string) => Promise<string | undefined> };
  terminal: { open: () => Promise<void> };
  agent: { request: (prompt: string) => Promise<void> };
  git: { refresh: () => Promise<void>; copyRemoteUrl: () => Promise<string> };
  commands: { registerCommand: (commandId: string, title: string, callback: (...args: unknown[]) => unknown) => void; executeCommand: (commandId: string, ...args: unknown[]) => Promise<unknown> };
}

interface BuiltInModule { activate: (api: WorkerApi, manifest: ExtensionManifest) => void | Promise<void>; }
const registry = new Map<string, BuiltInModule>([
  ['ty-claude.python-support', { activate: activatePythonSupport }],
  ['ty-claude.typescript-support', { activate: activateTypescriptSupport }],
  ['ty-claude.gitlens-lite', { activate: activateGitlensLite }],
  ['ty-claude.prettier-formatter', { activate: activatePrettierFormatter }],
  ['ty-claude.ai-copilot', { activate: activateAiCopilot }]
]);

interface WorkerSession { extensionId: string; nonce: string; capabilities: Set<ExtensionCapability>; commands: Map<string, (...args: unknown[]) => unknown>; manifest: ExtensionManifest; }
let session: WorkerSession | null = null;
const pending = new Map<string, { method: ExtensionRpcMethod; resolve: (value: unknown) => void; reject: (error: Error) => void; timer: number }>();

function send(message: ExtensionRpcMessage): void {
  const validated = parseExtensionRpcMessage(message);
  self.postMessage(validated);
}

function callHost(method: ExtensionRpcMethod, params: unknown): Promise<unknown> {
  if (!session) return Promise.reject(new Error('Extension Worker is not active.'));
  if (pending.size >= 32) return Promise.reject(new Error('Extension RPC concurrency limit reached.'));
  const validatedParams = ExtensionRpcParamsSchema[method].parse(params);
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    const timeoutMs = method === 'capability.window.show-input' || method === 'capability.agent.request' ? 120_000 : 8_000;
    const timer = self.setTimeout(() => { pending.delete(id); reject(new Error(`Extension API call timed out: ${method}`)); }, timeoutMs);
    pending.set(id, { method, resolve, reject, timer });
    send({ v: 1, id, kind: 'request', method, params: validatedParams, extensionId: session!.extensionId, nonce: session!.nonce });
  });
}

function createApi(active: WorkerSession): WorkerApi {
  return {
    workspace: {
      readFile: async (relativePath) => String(await callHost('capability.workspace.read-file', { relativePath }) ?? ''),
      writeFile: async (relativePath, content) => { await callHost('capability.workspace.write-file', { relativePath, content }); }
    },
    editor: {
      getActiveDocument: async () => await callHost('capability.editor.get-active-document', {}) as Awaited<ReturnType<WorkerApi['editor']['getActiveDocument']>>,
      applyActiveEdit: async (content) => Boolean(await callHost('capability.editor.apply-active-edit', { content }))
    },
    window: {
      showMessage: async (message) => { await callHost('capability.window.show-message', { message }); },
      showInput: async (prompt, value) => await callHost('capability.window.show-input', { prompt, value }) as string | undefined
    },
    terminal: { open: async () => { await callHost('capability.terminal.open', {}); } },
    agent: { request: async (prompt) => { await callHost('capability.agent.request', { prompt }); } },
    git: {
      refresh: async () => { await callHost('capability.git.refresh', {}); },
      copyRemoteUrl: async () => String(await callHost('capability.git.copy-remote-url', {}) ?? '')
    },
    commands: {
      registerCommand: (commandId, title, callback) => {
        if (!active.capabilities.has('commands.register')) throw new Error('Extension did not declare commands.register.');
        const prefix = `${active.extensionId}.`;
        if (!commandId.startsWith(prefix)) throw new Error(`Command must be namespaced with ${prefix}`);
        if (active.commands.has(commandId)) throw new Error(`Command ${commandId} is already registered.`);
        active.commands.set(commandId, callback);
        send({ v: 1, id: crypto.randomUUID(), kind: 'event', method: 'command.register', params: { commandId, title }, extensionId: active.extensionId, nonce: active.nonce });
      },
      executeCommand: async (commandId, ...args) => await callHost('host.execute-command', { extensionId: active.extensionId, commandId, args })
    }
  };
}

function assertWorkerMessage(value: unknown): ExtensionRpcMessage {
  const serialized = JSON.stringify(value);
  if (serialized === undefined || new TextEncoder().encode(serialized).byteLength > EXTENSION_RPC_MAX_BYTES) throw new Error('Extension RPC message exceeds the size limit.');
  return ExtensionRpcMessageSchema.parse(value);
}

async function handleRequest(message: ExtensionRpcRequest): Promise<unknown> {
  if (message.method === 'host.activate') {
    const params = ExtensionRpcParamsSchema['host.activate'].parse(message.params) as { extensionId: string; manifest: ExtensionManifest; capabilities: ExtensionCapability[] };
    const extensionId = ExtensionIdSchema.parse(params.extensionId);
    const manifest = ExtensionManifestSchema.parse(params.manifest);
    if (`${manifest.publisher}.${manifest.name}` !== extensionId) throw new Error('Manifest identity does not match Worker identity.');
    const builtin = registry.get(extensionId);
    if (!builtin) throw new Error('Only statically bundled built-in modules may execute.');
    const capabilities = new Set(params.capabilities.map((capability) => ExtensionCapabilitySchema.parse(capability)));
    session = { extensionId, nonce: message.nonce, capabilities, commands: new Map(), manifest };
    await builtin.activate(createApi(session), manifest);
    send({ v: 1, id: crypto.randomUUID(), kind: 'event', method: 'runtime.ready', params: {}, extensionId, nonce: session.nonce });
    return true;
  }
  if (message.method === 'host.execute-command') {
    if (!session || message.extensionId !== session.extensionId) throw new Error('No matching active extension session.');
    const params = ExtensionRpcParamsSchema['host.execute-command'].parse(message.params) as { extensionId: string; commandId: string; args: unknown[] };
    if (params.extensionId !== session.extensionId) throw new Error('Extension ID mismatch.');
    const handler = session.commands.get(params.commandId);
    if (!handler) throw new Error(`Extension command "${params.commandId}" is not registered.`);
    return await handler(...params.args);
  }
  if (message.method === 'host.deactivate') {
    for (const request of pending.values()) { self.clearTimeout(request.timer); request.reject(new Error('Extension was deactivated.')); }
    pending.clear(); session?.commands.clear(); session = null;
    return true;
  }
  if (message.method === 'host.ping') return true;
  throw new Error(`Unsupported host method: ${message.method}`);
}

self.onmessage = (event: MessageEvent<unknown>) => {
  void (async () => {
    try {
      const message = assertWorkerMessage(event.data);
      if (message.kind === 'response') {
        if (!session || message.extensionId !== session.extensionId || message.nonce !== session.nonce) throw new Error('Stale or mismatched RPC response.');
        const request = pending.get(message.id);
        if (!request) throw new Error('Unknown or expired RPC response ID.');
        if (request.method !== message.method) throw new Error('RPC response method does not match its request.');
        pending.delete(message.id);
        self.clearTimeout(request.timer);
        if (message.ok) request.resolve(message.result);
        else request.reject(new Error(message.error || 'Capability call failed.'));
        return;
      }
      if (message.kind !== 'request' || !['host.activate', 'host.execute-command', 'host.deactivate', 'host.ping'].includes(message.method)) throw new Error('Worker received an invalid host message.');
      if (session && (message.extensionId !== session.extensionId || message.nonce !== session.nonce) && message.method !== 'host.activate') throw new Error('Host session identity mismatch.');
      const result = await handleRequest(message);
      send({ v: 1, id: message.id, kind: 'response', method: message.method, ok: true, result, extensionId: message.extensionId, nonce: message.nonce });
    } catch (error) {
      const message = event.data as Partial<ExtensionRpcMessage>;
      if (typeof message.id === 'string' && typeof message.extensionId === 'string' && typeof message.nonce === 'string') {
        const failure: ExtensionRpcResponse = { v: 1, id: message.id, kind: 'response', method: typeof message.method === 'string' ? message.method as ExtensionRpcMethod : 'host.ping', ok: false, error: error instanceof Error ? error.message.slice(0, 2_000) : String(error).slice(0, 2_000), extensionId: message.extensionId, nonce: message.nonce };
        try { send(failure); } catch { /* Parent watchdog will terminate malformed/unresponsive sessions. */ }
      }
    }
  })();
};
