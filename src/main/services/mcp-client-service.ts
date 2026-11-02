/**
 * Prompt E (Step 2) — live MCP client service.
 *
 * Until now Ty-Code only had an MCP *config* (mcp-manager) and *recommendations*
 * (mcp-router); nothing ever spoke Model Context Protocol. This service is the
 * real client: it spawns stdio servers and connects to HTTP+SSE servers, runs
 * the JSON-RPC `initialize` → `tools/list` handshake, and reports health,
 * tool lists, and stderr log tails exactly as observed. A red dot means the
 * handshake actually failed — there is no painted-on success state anywhere
 * in here.
 *
 * Scope honesty: this panel's live tool registry is surfaced through
 * `getLiveTools()` (used by the UI and the enable/disable verification).
 * Wiring MCP tools into the agent's execution loop is a separate follow-up;
 * the legacy `open-seo` fake-analytics path in mcp-manager is untouched and
 * stays gated by its integration flag.
 *
 * Deliberately Electron-free so the pure-Node main-process test suite can
 * integration-test it against a real child-process MCP server.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  MCP_LOG_TAIL_LIMIT,
  type McpEvent,
  type McpHealthState,
  type McpServerStatus,
  type McpToolInfo,
  type McpTransport
} from '../../shared/types/mcp';

// ---------------------------------------------------------------------------
// Config shapes (shared file format with mcp-manager; read without Electron)
// ---------------------------------------------------------------------------

interface RawServerConfig {
  type?: string;
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  disabled?: boolean;
  description?: string;
  name?: string;
  [key: string]: unknown;
}

interface RawConfigFile {
  mcpServers?: Record<string, RawServerConfig>;
}

interface ManagedServer {
  id: string;
  scope: 'workspace' | 'global';
  transport: McpTransport;
  name?: string;
  description?: string;
  /** stdio command or sse url */
  target: string;
  args: string[];
  env: Record<string, string>;
  disabled: boolean;
}

interface RuntimeState {
  health: McpHealthState;
  error?: string;
  tools: McpToolInfo[];
  log: string[];
  proc?: ChildProcessWithoutNullStreams;
  sseAbort?: AbortController;
  pending: Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
  nextId: number;
  connectedAt?: number;
}

export type McpEventListener = (event: McpEvent) => void;

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'Ty-Code', version: '1.0.0' };

function emptyRuntime(): RuntimeState {
  return { health: 'idle', tools: [], log: [], pending: new Map(), nextId: 1 };
}

/**
 * Windows needs the cmd shim for bare package launchers (`npx`, `pip`, …),
 * because Node's spawn cannot see `.cmd` files without a shell. Absolute
 * paths and explicit executables bypass the shim.
 */
function resolveSpawn(command: string, args: string[]): { file: string; args: string[] } {
  if (process.platform === 'win32' && !/[\\/]/.test(command) && !/\.(exe|cmd|bat)$/i.test(command)) {
    return { file: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] };
  }
  return { file: command, args };
}

/** Minimal env for spawned servers: shell plumbing, never the whole profile. */
function buildServerEnv(base: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'APPDATA', 'LOCALAPPDATA', 'XDG_DATA_HOME']) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return { ...env, ...base };
}

class McpClientService {
  private servers = new Map<string, ManagedServer>();
  private runtimes = new Map<string, RuntimeState>();
  private listeners = new Set<McpEventListener>();
  private workspaceRoot = '';
  private handshakeTimeoutMs = 12_000;
  private emitTimer: NodeJS.Timeout | null = null;

  // -------------------------------------------------------------------------
  // Config
  // -------------------------------------------------------------------------

  private configPath(scope: 'workspace' | 'global'): string {
    const root = scope === 'workspace' ? this.workspaceRoot : os.homedir();
    return path.join(root, '.ty-code', 'mcp_config.json');
  }

  private async readConfigFile(scope: 'workspace' | 'global'): Promise<RawConfigFile> {
    if (scope === 'workspace' && !this.workspaceRoot) return {};
    try {
      const raw = await fs.readFile(this.configPath(scope), 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && parsed.mcpServers ? (parsed as RawConfigFile) : {};
    } catch {
      return {};
    }
  }

  private static toManaged(id: string, scope: 'workspace' | 'global', cfg: RawServerConfig): ManagedServer {
    const transport: McpTransport = cfg.url && (!cfg.command || cfg.type === 'sse') ? 'sse' : 'stdio';
    return {
      id,
      scope,
      transport,
      name: typeof cfg.name === 'string' ? cfg.name : undefined,
      description: typeof cfg.description === 'string' ? cfg.description : undefined,
      target: transport === 'sse' ? String(cfg.url) : String(cfg.command ?? ''),
      args: Array.isArray(cfg.args) ? cfg.args.map(String) : [],
      env: cfg.env && typeof cfg.env === 'object' ? (cfg.env as Record<string, string>) : {},
      disabled: cfg.disabled !== false
    };
  }

  /** Loads workspace + global configs; workspace entries win on id clash. */
  async loadServers(workspacePath: string): Promise<ManagedServer[]> {
    this.workspaceRoot = workspacePath;
    const [workspaceFile, globalFile] = await Promise.all([
      this.readConfigFile('workspace'),
      this.readConfigFile('global')
    ]);
    const merged = new Map<string, ManagedServer>();
    for (const [id, cfg] of Object.entries(globalFile.mcpServers ?? {})) {
      merged.set(id, McpClientService.toManaged(id, 'global', cfg));
    }
    for (const [id, cfg] of Object.entries(workspaceFile.mcpServers ?? {})) {
      merged.set(id, McpClientService.toManaged(id, 'workspace', cfg));
    }
    this.servers = merged;
    // Servers removed from config while running must not keep a live process.
    for (const runtimeId of [...this.runtimes.keys()]) {
      if (!merged.has(runtimeId)) await this.disconnect(runtimeId);
    }
    return [...merged.values()];
  }

  private async writeServerToConfig(scope: 'workspace' | 'global', id: string, entry: RawServerConfig | null): Promise<void> {
    const file = await this.readConfigFile(scope);
    const servers = { ...(file.mcpServers ?? {}) };
    if (entry === null) {
      delete servers[id];
    } else {
      servers[id] = entry;
    }
    const targetPath = this.configPath(scope);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    const tmp = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(tmp, JSON.stringify({ ...file, mcpServers: servers }, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(tmp, targetPath);
    } catch (err) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Status projection + events
  // -------------------------------------------------------------------------

  statusFor(server: ManagedServer): McpServerStatus {
    const runtime = this.runtimes.get(server.id) ?? emptyRuntime();
    const health: McpHealthState = server.disabled ? 'disabled' : runtime.health;
    return {
      id: server.id,
      scope: server.scope,
      transport: server.transport,
      name: server.name,
      description: server.description,
      target: server.target,
      args: server.args,
      disabled: server.disabled,
      health,
      error: server.disabled ? undefined : runtime.error,
      tools: server.disabled ? [] : runtime.tools,
      log: runtime.log.slice(-MCP_LOG_TAIL_LIMIT)
    };
  }

  async listStatuses(workspacePath: string): Promise<McpServerStatus[]> {
    const servers = await this.loadServers(workspacePath);
    return servers.map((server) => this.statusFor(server));
  }

  /** The live available-tool surface: only connected servers contribute. */
  getLiveTools(): Array<{ serverId: string; tool: string }> {
    const live: Array<{ serverId: string; tool: string }> = [];
    for (const [id, runtime] of this.runtimes) {
      if (runtime.health === 'connected') {
        for (const tool of runtime.tools) live.push({ serverId: id, tool: tool.name });
      }
    }
    return live;
  }

  onEvent(listener: McpEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Coalesce status churn into one push per animation frame-ish window. */
  private scheduleEmit(): void {
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      if (!this.workspaceRoot) return;
      const servers = [...this.servers.values()].map((server) => this.statusFor(server));
      const event: McpEvent = { kind: 'status', workspaceRoot: this.workspaceRoot, servers };
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // A dead sink must not break the client loop.
        }
      }
    }, 120);
  }

  private runtime(id: string): RuntimeState {
    let runtime = this.runtimes.get(id);
    if (!runtime) {
      runtime = emptyRuntime();
      this.runtimes.set(id, runtime);
    }
    return runtime;
  }

  private setHealth(id: string, health: McpHealthState, error?: string): void {
    const runtime = this.runtime(id);
    runtime.health = health;
    runtime.error = error;
    if (health !== 'connected') runtime.tools = [];
    this.scheduleEmit();
  }

  private appendLog(id: string, line: string): void {
    const runtime = this.runtime(id);
    for (const chunk of line.split(/\r?\n/)) {
      const text = chunk.trimEnd();
      if (!text) continue;
      runtime.log.push(text);
      if (runtime.log.length > MCP_LOG_TAIL_LIMIT) runtime.log.splice(0, runtime.log.length - MCP_LOG_TAIL_LIMIT);
    }
    this.scheduleEmit();
  }

  // -------------------------------------------------------------------------
  // Transports
  // -------------------------------------------------------------------------

  async connect(workspacePath: string, id: string): Promise<McpServerStatus> {
    await this.loadServers(workspacePath);
    const server = this.servers.get(id);
    if (!server) throw new Error(`No MCP server named "${id}" is configured.`);
    if (server.disabled) throw new Error(`"${id}" is disabled; enable it before connecting.`);
    await this.disconnect(id);
    const runtime = this.runtime(id);
    this.setHealth(id, 'connecting');
    try {
      const tools = server.transport === 'stdio'
        ? await this.connectStdio(server, runtime)
        : await this.connectSse(server, runtime);
      runtime.tools = tools;
      runtime.connectedAt = Date.now();
      this.setHealthKeepTools(id, 'connected');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.appendLog(id, `[tycode] connection failed: ${message}`);
      await this.disconnect(id);
      this.setHealth(id, 'error', message);
    }
    return this.statusFor(server);
  }

  /** setHealth() clears tools by design; the success path installs them itself. */
  private setHealthKeepTools(id: string, health: McpHealthState): void {
    const runtime = this.runtime(id);
    runtime.health = health;
    runtime.error = undefined;
    this.scheduleEmit();
  }

  private withTimeout<T>(label: string, promise: Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${label} timed out after ${this.handshakeTimeoutMs / 1000}s`)), this.handshakeTimeoutMs);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        (err: unknown) => {
          clearTimeout(timer);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
  }

  // ── stdio: newline-delimited JSON-RPC over the child's stdin/stdout ──────

  private async connectStdio(server: ManagedServer, runtime: RuntimeState): Promise<McpToolInfo[]> {
    const { file, args } = resolveSpawn(server.target, server.args);
    const proc = spawn(file, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: buildServerEnv(server.env),
      cwd: this.workspaceRoot || undefined
    }) as ChildProcessWithoutNullStreams;
    runtime.proc = proc;
    // Reconnects race the old child's exit events; handlers only speak for the
    // runtime while this exact process is still the runtime's current one.
    const isCurrent = () => runtime.proc === proc;

    proc.stderr.on('data', (chunk: Buffer) => this.appendLog(server.id, chunk.toString('utf8')));
    proc.on('error', (err: Error) => {
      if (!isCurrent()) return;
      this.appendLog(server.id, `[spawn] ${err.message}`);
      if (runtime.health === 'connecting' || runtime.health === 'connected') {
        this.setHealth(server.id, 'error', err.message);
      }
    });
    proc.on('close', (code) => {
      if (!isCurrent()) return;
      this.appendLog(server.id, `[process exited with code ${code ?? 'null'}]`);
      for (const pending of runtime.pending.values()) pending.reject(new Error(`MCP server exited (code ${code ?? 'null'})`));
      runtime.pending.clear();
      if (runtime.health === 'connected' || runtime.health === 'connecting') {
        this.setHealth(server.id, 'error', `Process exited (code ${code ?? 'null'}) during or after handshake`);
      }
    });

    // Route stdout lines into the pending RPC map.
    let buffer = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) this.handleRpcLine(server.id, runtime, line);
        index = buffer.indexOf('\n');
      }
    });

    await this.withTimeout(`MCP stdio handshake "${server.id}"`, (async () => {
      await this.rpcRequest(runtime, 'initialize', {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO
      });
      this.rpcNotify(runtime, 'notifications/initialized', {});
    })());

    const listed = await this.withTimeout(`MCP tools/list "${server.id}"`, this.rpcRequest(runtime, 'tools/list', {}));
    return normalizeTools(listed);
  }

  private handleRpcLine(id: string, runtime: RuntimeState, line: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(line);
    } catch {
      this.appendLog(id, `[non-JSON stdout] ${line.slice(0, 200)}`);
      return;
    }
    const msgId = typeof message.id === 'number' ? message.id : undefined;
    if (msgId === undefined) return; // notification from the server — not needed for health/tools yet
    const pending = runtime.pending.get(msgId);
    if (!pending) return;
    runtime.pending.delete(msgId);
    if (message.error) {
      const error = message.error as { message?: string; code?: number };
      pending.reject(new Error(error.message || `MCP error ${error.code ?? 'unknown'}`));
    } else {
      pending.resolve(message.result);
    }
  }

  private rpcRequest(runtime: RuntimeState, method: string, params: unknown): Promise<unknown> {
    const proc = runtime.proc;
    if (!proc || proc.killed) return Promise.reject(new Error('MCP server process is not running'));
    const id = runtime.nextId++;
    return new Promise<unknown>((resolve, reject) => {
      runtime.pending.set(id, { resolve, reject });
      const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      proc.stdin.write(payload, (err) => {
        if (err) {
          runtime.pending.delete(id);
          reject(err);
        }
      });
    });
  }

  private rpcNotify(runtime: RuntimeState, method: string, params: unknown): void {
    runtime.proc?.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  // ── sse: the 2024-11-05 HTTP+SSE transport (GET stream + POST messages) ──

  private async connectSse(server: ManagedServer, runtime: RuntimeState): Promise<McpToolInfo[]> {
    const abort = new AbortController();
    runtime.sseAbort = abort;
    const response = await this.withTimeout(
      `MCP SSE connect "${server.id}"`,
      fetch(server.target, { headers: { Accept: 'text/event-stream' }, signal: abort.signal })
    );
    if (!response.ok || !response.body) {
      throw new Error(`SSE endpoint responded ${response.status} ${response.statusText}`);
    }
    this.appendLog(server.id, `[sse] connected to ${server.target}`);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let endpoint: string | null = null;
    let endpointResolver: ((url: string) => void) | null = null;
    let buffer = '';
    const streamDone = new Promise<void>((resolve) => {
      void (async () => {
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            let boundary = buffer.indexOf('\n\n');
            while (boundary >= 0) {
              const block = buffer.slice(0, boundary);
              buffer = buffer.slice(boundary + 2);
              this.handleSseBlock(server.id, block, (url) => {
                endpoint = url;
                endpointResolver?.(url);
              });
              boundary = buffer.indexOf('\n\n');
            }
          }
        } catch {
          // Aborted on disconnect — expected.
        }
        void endpoint;
        resolve();
      })();
    });
    void streamDone;

    if (!endpoint) {
      endpoint = await this.withTimeout(
        `MCP SSE endpoint event "${server.id}"`,
        new Promise<string>((resolve, reject) => {
          endpointResolver = resolve;
          abort.signal.addEventListener('abort', () => reject(new Error('SSE connection aborted')));
        })
      );
    }
    endpointResolver = null;
    const postUrl = new URL(endpoint, server.target).toString();

    // Serialize through the same RPC promise map; responses arrive via SSE
    // blocks (handled above), so the request is just the POST.
    const send = async (payload: Record<string, unknown>): Promise<void> => {
      const post = await fetch(postUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abort.signal
      });
      if (!post.ok) throw new Error(`SSE message POST failed with ${post.status}`);
    };
    this.sseSend = send;

    await this.withTimeout(`MCP SSE handshake "${server.id}"`, (async () => {
      const initializeId = runtime.nextId++;
      await send({ jsonrpc: '2.0', id: initializeId, method: 'initialize', params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO } });
      await new Promise<unknown>((resolve, reject) => {
        runtime.pending.set(initializeId, { resolve, reject });
      });
      await send({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} });
    })());

    const toolsId = runtime.nextId++;
    const toolsPromise = new Promise<unknown>((resolve, reject) => {
      runtime.pending.set(toolsId, { resolve, reject });
    });
    await send({ jsonrpc: '2.0', id: toolsId, method: 'tools/list', params: {} });
    const listed = await this.withTimeout(`MCP SSE tools/list "${server.id}"`, toolsPromise);
    this.sseSend = null;
    return normalizeTools(listed);
  }

  private sseSend: ((payload: Record<string, unknown>) => Promise<void>) | null = null;

  private handleSseBlock(id: string, block: string, onEndpoint: (url: string) => void): void {
    let event = 'message';
    const dataLines: string[] = [];
    for (const line of block.split(/\r?\n/)) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
    }
    const data = dataLines.join('\n');
    if (!data) return;
    if (event === 'endpoint') {
      onEndpoint(data);
      return;
    }
    if (event === 'message') {
      // Reuse the stdio line router — same JSON-RPC message shape.
      const runtime = this.runtimes.get(id);
      if (runtime) this.handleRpcLine(id, runtime, data);
      return;
    }
    this.appendLog(id, `[sse ${event}] ${data.slice(0, 200)}`);
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  async disconnect(id: string): Promise<void> {
    const runtime = this.runtimes.get(id);
    if (!runtime) return;
    for (const pending of runtime.pending.values()) pending.reject(new Error('MCP connection closed'));
    runtime.pending.clear();
    runtime.sseAbort?.abort();
    runtime.sseAbort = undefined;
    if (runtime.proc) {
      try {
        runtime.proc.kill();
      } catch {
        // Already gone.
      }
      runtime.proc = undefined;
    }
    runtime.tools = [];
  }

  async setEnabled(workspacePath: string, id: string, enabled: boolean): Promise<McpServerStatus> {
    await this.loadServers(workspacePath);
    const server = this.servers.get(id);
    if (!server) throw new Error(`No MCP server named "${id}" is configured.`);
    const file = await this.readConfigFile(server.scope);
    const entry = { ...(file.mcpServers?.[id] ?? {}) };
    entry.disabled = !enabled;
    await this.writeServerToConfig(server.scope, id, entry);
    server.disabled = !enabled;
    if (!enabled) {
      await this.disconnect(id);
      this.setHealth(id, 'disabled');
      return this.statusFor(server);
    }
    return this.connect(workspacePath, id);
  }

  async addServer(request: {
    workspacePath: string;
    id: string;
    transport: McpTransport;
    name?: string;
    description?: string;
    command?: string;
    args?: string[];
    url?: string;
    projectScope: boolean;
    startEnabled: boolean;
  }): Promise<McpServerStatus> {
    await this.loadServers(request.workspacePath);
    if (this.servers.has(request.id)) {
      throw new Error(`An MCP server with id "${request.id}" already exists in the ${this.servers.get(request.id)?.scope} config.`);
    }
    const scope: 'workspace' | 'global' = request.projectScope ? 'workspace' : 'global';
    if (scope === 'workspace' && !this.workspaceRoot) {
      throw new Error('No workspace is open, so a project-scoped server cannot be saved.');
    }
    const entry: RawServerConfig = request.transport === 'stdio'
      ? {
          command: request.command,
          args: request.args ?? [],
          disabled: !request.startEnabled,
          ...(request.description ? { description: request.description } : {}),
          ...(request.name ? { name: request.name } : {})
        }
      : {
          type: 'sse',
          url: request.url,
          disabled: !request.startEnabled,
          ...(request.description ? { description: request.description } : {}),
          ...(request.name ? { name: request.name } : {})
        };
    await this.writeServerToConfig(scope, request.id, entry);
    const managed = McpClientService.toManaged(request.id, scope, entry);
    this.servers.set(request.id, managed);
    if (request.startEnabled) {
      // connect() reloads both config files, and the entry above was just
      // written to disk — the reload is the same read the panel would do.
      return this.connect(request.workspacePath, request.id);
    }
    return this.statusFor(managed);
  }

  async removeServer(workspacePath: string, id: string, scope: 'workspace' | 'global'): Promise<void> {
    await this.loadServers(workspacePath);
    await this.disconnect(id);
    this.runtimes.delete(id);
    this.servers.delete(id);
    await this.writeServerToConfig(scope, id, null);
  }

  async disposeAll(): Promise<void> {
    for (const id of [...this.runtimes.keys()]) {
      await this.disconnect(id);
    }
    this.runtimes.clear();
    if (this.emitTimer) clearTimeout(this.emitTimer);
    this.emitTimer = null;
  }

  /** Test seam: shorten handshake waits so failure paths stay fast. */
  setHandshakeTimeoutForTests(ms: number): void {
    this.handshakeTimeoutMs = ms;
  }
}

function normalizeTools(listed: unknown): McpToolInfo[] {
  const tools = (listed as { tools?: unknown } | null)?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .filter((tool): tool is Record<string, unknown> => Boolean(tool) && typeof tool === 'object' && typeof (tool as Record<string, unknown>).name === 'string')
    .map((tool) => ({
      name: String(tool.name),
      ...(typeof tool.description === 'string' && tool.description ? { description: tool.description } : {})
    }));
}

export const mcpClientService = new McpClientService();
