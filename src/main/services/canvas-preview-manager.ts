/**
 * Canvas Live Preview Manager (Prompt 4 Step 1: Isolated Preview Host)
 *
 * Boots the CURRENT session workspace's UI inside the Canvas surface without
 * ever blocking the Main Editor:
 *  - dev strategy: spawn the project's dev/start/serve script via the existing
 *    terminal policy sandbox (SecurityPolicyEngine + sanitized env) and wait
 *    for an http://127.0.0.1 / localhost URL on stdout.
 *  - static strategy: serve the first existing build directory (dist/build/
 *    out/.next?next already needs SSR → dev preferred) over 127.0.0.1.
 *  - lifecycle: the host terminates with the Canvas surface (Prompt 2 rules).
 */

import { spawn as childSpawn, type ChildProcess, type SpawnOptionsWithoutStdio } from 'node:child_process';
import http from 'node:http';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { SecurityPolicyEngine, buildSanitizedPtyEnv } from './security-policy';
import { settingsManager } from './settings-manager';

export type CanvasPreviewStrategy = 'dev' | 'static' | 'none';

export type CanvasPreviewState = 'idle' | 'booting' | 'ready' | 'error' | 'stopped' | 'unavailable';

export interface CanvasPreviewStatus {
  mode: CanvasPreviewStrategy;
  state: CanvasPreviewState;
  url: string | null;
  error: string | null;
  adapter: string;
}

export interface CanvasPreviewSnapshot {
  status: CanvasPreviewStatus;
  workspacePath: string;
}

export type CanvasPreviewBroadcast = (payload: CanvasPreviewSnapshot, destroyed?: boolean) => void;

const START_TIMEOUT_MS = 60_000;
const STATIC_PORT_RANGE = { from: 7860, to: 7900 };
const MAX_CHILD_LOG_LINES = 400;

export class CanvasPreviewSession {
  private workspacePath: string;
  private child: ChildProcess | null = null;
  private staticServer: http.Server | null = null;
  private staticPort: number | null = null;
  private adapter = new AbortController();
  private finished = false;
  private logLines: string[] = [];

  constructor(
    private readonly rootPath: string,
    private readonly strategy: CanvasPreviewStrategy,
    private readonly devScript: string | null,
    private readonly buildDir: string | null,
    private readonly onSnapshot: CanvasPreviewBroadcast
  ) {
    this.workspacePath = rootPath;
  }

  static async detect(rootPath: string): Promise<{
    adapterMode: CanvasPreviewStrategy;
    devScript: string | null;
    buildDir: string | null;
  }> {
    try {
      const pkgRaw = await fs.readFile(path.join(rootPath, 'package.json'), 'utf8');
      const pkg = JSON.parse(pkgRaw) as { scripts?: Record<string, string> };
      const scripts = Object.keys(pkg.scripts || {});
      for (const candidate of ['dev', 'start', 'serve']) {
        if (scripts.includes(candidate)) {
          return { adapterMode: 'dev', devScript: candidate, buildDir: null };
        }
      }
    } catch {
      // package.json intentionally untouched — fall through to static detection.
    }
    for (const dir of ['dist', 'build', 'out', '.output/public', 'public']) {
      const candidate = path.join(rootPath, dir);
      try {
        const stat = await fs.stat(candidate);
        if (stat.isDirectory()) return { adapterMode: 'static', devScript: null, buildDir: candidate };
      } catch {
        // keep looking
      }
    }
    return { adapterMode: 'none', devScript: null, buildDir: null };
  }

  async start(): Promise<CanvasPreviewSnapshot> {
    this.emit('booting');
    try {
      if (this.strategy === 'dev' && this.devScript) {
        await this.startDev();
        return this.snapshot();
      }
      if (this.strategy === 'static' && this.buildDir) {
        await this.startStatic();
        return this.snapshot();
      }
      this.emit('unavailable');
      return this.snapshot();
    } catch (err) {
      this.finished = true;
      this.emit('error', err instanceof Error ? err.message : String(err));
      this.teardownAll();
      return this.snapshot();
    }
  }

  private async startDev(): Promise<void> {
    const script = this.devScript;
    if (!script) throw new Error('Dev preview requested without a dev script.');
    const adjudicator = new SecurityPolicyEngine(this.rootPath, settingsManager);
    const command = `npm run ${script}`;
    const verdict = await adjudicator.evaluateTerminalCommand(command);
    if (verdict.decision === 'block') {
      throw new Error(`Terminal policy blocked preview dev boot: ${verdict.reason}`);
    }
    await this.waitForChildUrl(script);
  }

  private waitForChildUrl(script: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const lifecycle = this.adapter;
      const env: NodeJS.ProcessEnv = { ...buildSanitizedPtyEnv(process.env), PAGER: 'cat' };
      let spawned: ChildProcess;
      const spawnOptions: SpawnOptionsWithoutStdio = { cwd: this.rootPath, env, windowsHide: true };
      try {
        if (process.platform === 'win32') {
          spawned = childSpawn('cmd.exe', ['/d', '/s', '/c', `npm run ${script}`], { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
        } else {
          spawned = childSpawn('npm', ['run', script], { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] });
        }
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.child = spawned;
      spawned.stdout?.on('data', (chunk: unknown) => this.consumeChunk(chunk, resolve));
      spawned.stderr?.on('data', (chunk: unknown) => this.consumeChunk(chunk, resolve));
      spawned.on('error', (err) => reject(err instanceof Error ? err : new Error(String(err))));
      const timeout = setTimeout(() => {
        if (this.finished) return;
        reject(new Error(`Preview dev server did not announce an http URL within ${START_TIMEOUT_MS / 1000}s.`));
      }, START_TIMEOUT_MS);
      lifecycle.signal.addEventListener('abort', () => {
        clearTimeout(timeout);
      }, { once: true });
    });
  }

  private consumeChunk(chunk: unknown, resolve: () => void): void {
    if (this.finished) return;
    const text = typeof chunk === 'string' ? chunk : chunk instanceof Uint8Array ? Buffer.from(chunk).toString('utf8') : String(chunk ?? '');
    this.logLines.push(text);
    while (this.logLines.length > MAX_CHILD_LOG_LINES) this.logLines.shift();
    if (this.previewUrl) return;
    if (this.probeTimer) return; // already probing a detected URL
    const matched = /(?:https?):\/\/(?:127\.0\.0\.1|localhost)(?::(\d+))?/.exec(text);
    if (matched) {
      const port = matched[1] ? Number(matched[1]) : 80;
      this.probeTimer = setInterval(() => {
        void this.probeServe(port).then((ready) => {
          if (ready && this.probeTimer) {
            clearInterval(this.probeTimer);
            this.probeTimer = null;
          }
          if (ready && !this.previewUrl && !this.finished) {
            this.previewUrl = matched[0];
            this.emit('ready');
            resolve();
          }
        });
      }, 700);
    }
  }

  private async startStatic(): Promise<void> {
    const server = http.createServer((req, res) => {
      try {
        void this.serveStatic(req, res);
      } catch {
        res.statusCode = 500;
        res.end('static serve error');
      }
    });
    const assigned = await new Promise<number>((resolve, reject) => {
      let attempt = STATIC_PORT_RANGE.from;
      const tryListen = (): void => {
        if (attempt > STATIC_PORT_RANGE.to) {
          reject(new Error('No free port in the static preview range.'));
          return;
        }
        const once = server.listen(attempt, '127.0.0.1', () => resolve(attempt));
        once.on('error', () => {
          attempt += 1;
          server.close();
          tryListen();
        });
      };
      tryListen();
    });
    this.staticServer = server;
    this.staticPort = assigned;
    this.previewUrl = `http://127.0.0.1:${assigned}/`;
    this.emit('ready');
  }

  private async serveStatic(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.buildDir) return;
    const url = new URL(req.url ?? '/', this.previewUrl ?? 'http://127.0.0.1.invalid');
    let relative = decodeURIComponent(url.pathname).replace(/^\//, '').replace(/\\/g, '/');
    if (relative === '' || relative.endsWith('/')) relative += 'index.html';
    const target = path.resolve(this.buildDir, relative);
    const rel = path.relative(path.resolve(this.buildDir), target);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      res.statusCode = 403;
      res.end('forbidden');
      return;
    }
    try {
      const stat = await fs.stat(target);
      const type = inferContentType(target);
      res.setHeader('Content-Type', type);
      res.setHeader('Cache-Control', 'no-store');
      if (stat.isFile()) {
        const stream = fsSync.createReadStream(target);
        stream.pipe(res);
        stream.on('error', () => res.destroy());
        return;
      }
    } catch {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  }

  private previewUrl: string | null = null;
  private probeTimer: ReturnType<typeof setInterval> | null = null;

  private async probeServe(port: number): Promise<boolean> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2500);
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: controller.signal });
      void res.arrayBuffer().catch(() => undefined);
      return res.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async snapshot(): Promise<CanvasPreviewSnapshot> {
    return {
      workspacePath: this.workspacePath,
      status: this.statusSnapshot()
    };
  }

  private statusSnapshot(): CanvasPreviewStatus {
    if (this.finished) {
      return { mode: this.strategy, state: 'stopped', url: null, error: null, adapter: this.adapterLabel() };
    }
    if (this.previewUrl) {
      return { mode: this.strategy, state: 'ready', url: this.previewUrl, error: null, adapter: this.adapterLabel() };
    }
    if (this.strategy === 'none') {
      return { mode: 'none', state: 'unavailable', url: null, error: null, adapter: this.adapterLabel() };
    }
    if (!this.diagnosticsError) {
      return { mode: this.strategy, state: 'booting', url: null, error: null, adapter: this.adapterLabel() };
    }
    return { mode: this.strategy, state: 'error', url: null, error: this.diagnosticsError, adapter: this.adapterLabel() };
  }

  private adapterLabel(): string {
    return this.strategy === 'dev'
      ? `npm run ${this.devScript ?? '?'}`
      : this.strategy === 'static'
        ? `static: ${this.buildDir ?? '?'}`
        : 'none';
  }

  private diagnosticsError: string | null = null;

  private emit(state: CanvasPreviewStatus['state'], error?: string): void {
    if (state === 'error') this.diagnosticsError = error ?? 'Unknown preview server error';
    const snap: CanvasPreviewSnapshot = {
      workspacePath: this.workspacePath,
      status: this.statusSnapshot()
    };
    void this.onSnapshot(snap, this.finished === true);
  }

  stop(): void {
    this.finished = true;
    try {
      this.adapter.abort();
    } catch {
      /* tolerated */
    }
    if (this.probeTimer) {
      clearInterval(this.probeTimer);
      this.probeTimer = null;
    }
    this.teardownAll();
  }

  private teardownAll(): void {
    if (this.child) {
      try {
        this.child.kill();
      } catch {
        /* already dead */
      }
      this.child = null;
    }
    if (this.staticServer) {
      try {
        this.staticServer.close();
      } catch {
        /* tolerated */
      }
      this.staticServer = null;
      this.staticPort = null;
    }
    this.previewUrl = null;
  }
}

function inferContentType(target: string): string {
  switch (path.extname(target).toLowerCase()) {
    case '.html': return 'text/html; charset=utf-8';
    case '.js': return 'text/javascript; charset=utf-8';
    case '.css': return 'text/css; charset=utf-8';
    case '.json': return 'application/json; charset=utf-8';
    case '.svg': return 'image/svg+xml';
    case '.png': return 'image/png';
    case '.jpg': case '.jpeg': return 'image/jpeg';
    case '.woff': return 'font/woff';
    case '.woff2': return 'font/woff2';
    default: return 'application/octet-stream';
  }
}

export class CanvasPreviewManager {
  private sessions = new Map<string, CanvasPreviewSession>();
  private broadcastLog = new Map<string, CanvasPreviewSnapshot>();

  constructor(private readonly broadcast: (payload: CanvasPreviewSnapshot) => void) {}

  private static readonly snapshotKey = (workspace: string): string =>
    createHash('sha256').update(path.resolve(workspace)).digest('hex').slice(0, 16);

  async ensureForWorkspace(workspacePath: string): Promise<CanvasPreviewSnapshot> {
    const key = CanvasPreviewManager.snapshotKey(workspacePath);
    const existing = this.sessions.get(key);
    const cached = this.broadcastLog.get(key);
    if (existing) return cached ?? await existing.snapshot();
    const detection = await CanvasPreviewSession.detect(workspacePath);
    const session = new CanvasPreviewSession(workspacePath, detection.adapterMode, detection.devScript, detection.buildDir, (snap, destroyed) => {
      if (!destroyed) this.broadcastLog.set(key, snap);
      this.broadcast(snap);
    });
    this.sessions.set(key, session);
    void session.start();
    const fresh = await session.snapshot();
    this.broadcastLog.set(key, fresh);
    return fresh;
  }

  async statusForCurrent(workspacePath: string | null): Promise<CanvasPreviewSnapshot> {
    const resolved = workspacePath ?? '';
    const key = CanvasPreviewManager.snapshotKey(resolved || '/no/ty/workspace');
    const cached = this.broadcastLog.get(key);
    if (cached) return cached;
    return {
      workspacePath: resolved,
      status: { mode: 'none', state: 'idle', url: null, error: null, adapter: 'not started' }
    };
  }

  async stopForCurrent(workspacePath: string | null): Promise<void> {
    const key = CanvasPreviewManager.snapshotKey(workspacePath ?? '/no/ty/workspace');
    const session = this.sessions.get(key);
    if (!session) return;
    this.sessions.delete(key);
    this.broadcastLog.delete(key);
    session.stop();
  }

  async stopAll(): Promise<void> {
    for (const key of Array.from(this.sessions.keys())) {
      this.sessions.get(key)?.stop();
      this.sessions.delete(key);
      this.broadcastLog.delete(key);
    }
  }
}
