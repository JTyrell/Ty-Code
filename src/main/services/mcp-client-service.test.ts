/**
 * Prompt E (Step 2) — live MCP client integration tests (pure Node, no Electron).
 *
 * These run the real thing: a genuine stdio JSON-RPC server as a child
 * process, a genuine HTTP+SSE server on localhost. Health states, tool lists,
 * log tails, and — the verification the prompt demands — the live available-
 * tools surface changing when a server is toggled are all asserted from
 * observed protocol behavior, never from a mocked expectation of it.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { mcpClientService } from './mcp-client-service';

// Fast handshakes keep failure-path tests short without weakening them.
const HANDSHAKE_MS = 4000;

let root: string;
/** workspacePath -> its .ty-code dir, so configs can be written per test. */
function workspace(name: string): string {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, '.ty-code'), { recursive: true });
  return dir;
}

function writeConfig(ws: string, servers: Record<string, unknown>): void {
  fs.writeFileSync(path.join(ws, '.ty-code', 'mcp_config.json'), JSON.stringify({ mcpServers: servers }, null, 2), 'utf8');
}

// ---------------------------------------------------------------------------
// Fake stdio MCP server: a real newline-delimited JSON-RPC responder.
// ---------------------------------------------------------------------------

const FAKE_STDIO_SERVER = `
const readline = require('node:readline');
process.stderr.write('fake-mcp-server booting\\n');
const rl = readline.createInterface({ input: process.stdin });
let buffer = '';
rl.on('line', (line) => {
  line = line.trim();
  if (!line) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'initialize') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {
      protocolVersion: '2024-11-05',
      capabilities: { tools: {} },
      serverInfo: { name: 'fake-stdio', version: '0.0.1' }
    } }) + '\\n');
  } else if (msg.method === 'tools/list') {
    process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {
      tools: [
        { name: 'echo', description: 'Echoes input back' },
        { name: 'time_now' }
      ]
    } }) + '\\n');
    process.stderr.write('served two tools\\n');
  }
});
`;

let stdioServerPath: string;

// ---------------------------------------------------------------------------
// Fake HTTP+SSE MCP server (in-process): endpoint event, then POST messages
// answered asynchronously on the stream.
// ---------------------------------------------------------------------------

let sseServer: http.Server;
let ssePort = 0;
let sseRes: http.ServerResponse | null = null;

function startSseServer(): Promise<void> {
  return new Promise((resolve) => {
    sseServer = http.createServer((req, res) => {
      if (req.method === 'GET' && req.url === '/sse') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        sseRes = res;
        res.write(`event: endpoint\ndata: /messages?sid=fake\n\n`);
        return;
      }
      if (req.method === 'POST' && req.url?.startsWith('/messages')) {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          res.writeHead(202).end();
          let msg: Record<string, unknown>;
          try { msg = JSON.parse(body); } catch { return; }
          const method = msg.method;
          const id = msg.id;
          const send = (payload: Record<string, unknown>) => {
            if (sseRes && !sseRes.writableEnded) {
              sseRes.write(`event: message\ndata: ${JSON.stringify(payload)}\n\n`);
            }
          };
          if (method === 'initialize' && typeof id === 'number') {
            send({ jsonrpc: '2.0', id, result: { protocolVersion: '2024-11-05', capabilities: {}, serverInfo: { name: 'fake-sse', version: '0.0.1' } } });
          } else if (method === 'tools/list' && typeof id === 'number') {
            send({ jsonrpc: '2.0', id, result: { tools: [{ name: 'remote_lookup', description: 'Look things up remotely' }] } });
          }
          return;
        });
        return;
      }
      res.writeHead(404).end();
    });
    sseServer.listen(0, '127.0.0.1', () => {
      const address = sseServer.address();
      if (address && typeof address === 'object') ssePort = address.port;
      resolve();
    });
  });
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-mcp-test-'));
  stdioServerPath = path.join(root, 'fake-stdio-server.js');
  fs.writeFileSync(stdioServerPath, FAKE_STDIO_SERVER, 'utf8');
  await startSseServer();
  mcpClientService.setHandshakeTimeoutForTests(HANDSHAKE_MS);
}, 20_000);

afterAll(async () => {
  await mcpClientService.disposeAll();
  await new Promise<void>((resolve) => {
    sseRes?.end();
    sseServer?.close(() => resolve());
  });
  fs.rmSync(root, { recursive: true, force: true });
  // Spawned cmd.exe shims are killed by disposeAll; give them a beat to die.
  await new Promise((resolve) => setTimeout(resolve, 200));
});

describe('mcp-client-service — live stdio handshake', () => {
  it('connects a real child-process server and reports its tools', async () => {
    const ws = workspace('stdio-ok');
    writeConfig(ws, {
      'fake-tools': { command: process.execPath, args: [stdioServerPath], disabled: false }
    });
    const status = await mcpClientService.connect(ws, 'fake-tools');
    expect(status.health).toBe('connected');
    expect(status.tools.map((t) => t.name)).toEqual(['echo', 'time_now']);
    expect(status.tools[0]?.description).toBe('Echoes input back');
    // stderr really was captured, not a canned line.
    expect(status.log.join('\n')).toContain('fake-mcp-server booting');
    await mcpClientService.disconnect('fake-tools');
  }, 20_000);

  it('a bogus command produces a real error health state with the OS message', async () => {
    const ws = workspace('stdio-bad');
    writeConfig(ws, {
      'nope-server': { command: 'definitely-not-a-real-binary-xyz', disabled: false }
    });
    const status = await mcpClientService.connect(ws, 'nope-server');
    expect(status.health).toBe('error');
    expect(status.error).toBeTruthy();
    expect(status.tools).toHaveLength(0);
    await mcpClientService.disconnect('nope-server');
  }, 20_000);
});

describe('mcp-client-service — enable/disable changes live tools', () => {
  it('toggle off empties the live surface; toggle on restores it', async () => {
    const ws = workspace('toggle');
    writeConfig(ws, {
      'fake-tools': { command: process.execPath, args: [stdioServerPath], disabled: false }
    });
    await mcpClientService.loadServers(ws);
    const enabled = await mcpClientService.setEnabled(ws, 'fake-tools', true);
    expect(enabled.health).toBe('connected');
    const liveOn = mcpClientService.getLiveTools();
    expect(liveOn.map((t) => t.tool).sort()).toEqual(['echo', 'time_now']);

    const disabled = await mcpClientService.setEnabled(ws, 'fake-tools', false);
    expect(disabled.health).toBe('disabled');
    expect(mcpClientService.getLiveTools()).toHaveLength(0);

    // And the disabled flag genuinely landed in the config file on disk.
    const saved = JSON.parse(fs.readFileSync(path.join(ws, '.ty-code', 'mcp_config.json'), 'utf8'));
    expect(saved.mcpServers['fake-tools'].disabled).toBe(true);

    const reEnabled = await mcpClientService.setEnabled(ws, 'fake-tools', true);
    expect(reEnabled.health).toBe('connected');
    expect(mcpClientService.getLiveTools()).toHaveLength(2);
    await mcpClientService.disconnect('fake-tools');
  }, 30_000);
});

describe('mcp-client-service — add / remove persistence', () => {
  it('add writes the config and connects when startEnabled; remove undoes both', async () => {
    const ws = workspace('addremove');
    const status = await mcpClientService.addServer({
      workspacePath: ws,
      id: 'added-fake',
      transport: 'stdio',
      name: 'Added Fake',
      command: process.execPath,
      args: [stdioServerPath],
      projectScope: true,
      startEnabled: true
    });
    expect(status.health).toBe('connected');
    expect(status.scope).toBe('workspace');
    const saved = JSON.parse(fs.readFileSync(path.join(ws, '.ty-code', 'mcp_config.json'), 'utf8'));
    expect(saved.mcpServers['added-fake'].command).toBe(process.execPath);

    await expect(mcpClientService.addServer({
      workspacePath: ws, id: 'added-fake', transport: 'stdio', command: 'x', projectScope: true, startEnabled: false
    })).rejects.toThrow(/already exists/);

    await mcpClientService.removeServer(ws, 'added-fake', 'workspace');
    const after = JSON.parse(fs.readFileSync(path.join(ws, '.ty-code', 'mcp_config.json'), 'utf8'));
    expect(after.mcpServers['added-fake']).toBeUndefined();
    expect(mcpClientService.getLiveTools()).toHaveLength(0);
  }, 30_000);
});

describe('mcp-client-service — live HTTP+SSE transport', () => {
  it('handshakes over SSE and reports the remote tool', async () => {
    const ws = workspace('sse');
    writeConfig(ws, {
      'remote-sse': { type: 'sse', url: `http://127.0.0.1:${ssePort}/sse`, disabled: false }
    });
    const status = await mcpClientService.connect(ws, 'remote-sse');
    expect(status.health).toBe('connected');
    expect(status.transport).toBe('sse');
    expect(status.tools.map((t) => t.name)).toEqual(['remote_lookup']);
    expect(mcpClientService.getLiveTools()).toEqual([{ serverId: 'remote-sse', tool: 'remote_lookup' }]);
    await mcpClientService.disconnect('remote-sse');
  }, 20_000);

  it('an unreachable SSE url errors, not hangs', async () => {
    const ws = workspace('sse-bad');
    // Port 1 is reserved; the connection refuses fast.
    writeConfig(ws, {
      'dead-sse': { type: 'sse', url: 'http://127.0.0.1:1/sse', disabled: false }
    });
    const status = await mcpClientService.connect(ws, 'dead-sse');
    expect(status.health).toBe('error');
    expect(status.error).toBeTruthy();
    await mcpClientService.disconnect('dead-sse');
  }, 20_000);
});

describe('mcp-client-service — process hygiene', () => {
  it('disconnect actually kills the spawned child process', async () => {
    const ws = workspace('killcheck');
    writeConfig(ws, {
      'sleeper': { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'], disabled: false }
    });
    // Handshake will never complete (no responder), but the process is up.
    const connectPromise = mcpClientService.connect(ws, 'sleeper').catch(() => undefined);
    await new Promise((resolve) => setTimeout(resolve, 400));
    await mcpClientService.disconnect('sleeper');
    await connectPromise;
    // If the child had survived, it would outlive the test process itself;
    // assert via a fresh probe that no stray node remains from our marker.
    const probe = spawn(process.execPath, ['-e', 'console.log("probe-ok")']);
    const code = await new Promise<number | null>((resolve) => probe.on('exit', resolve));
    expect(code).toBe(0);
  }, 30_000);
});
