import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase4-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

const bundleConfig = (entry, outfile) => build({
  entryPoints: [path.join(projectRoot, entry)],
  outfile: path.join(bundleDir, outfile),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  logLevel: 'silent'
});

await Promise.all([
  bundleConfig('src/main/services/extension-manager.ts', 'extension-manager.cjs'),
  bundleConfig('src/main/services/extension-api.ts', 'extension-api.cjs'),
  bundleConfig('src/preload/extension-schemas.ts', 'extension-schemas.cjs'),
  bundleConfig('src/main/ipc/fs-handlers.ts', 'fs-handlers.cjs'),
  bundleConfig('src/renderer/src/services/extension-worker-host.ts', 'extension-worker-host.cjs')
]);

const { ExtensionManager } = require(path.join(bundleDir, 'extension-manager.cjs'));
const { validateExtensionManifest } = require(path.join(bundleDir, 'extension-api.cjs'));
const { readFile: readWorkspaceFile, writeFile: writeWorkspaceFile, deletePath: deleteWorkspacePath, renamePath: renameWorkspacePath } = require(path.join(bundleDir, 'fs-handlers.cjs'));
const schemas = require(path.join(bundleDir, 'extension-schemas.cjs'));
const { ExtensionWorkerHost } = require(path.join(bundleDir, 'extension-worker-host.cjs'));
const { ExtensionRpcMessageSchema, parseExtensionRpcMessage, parseExtensionRpcParams } = schemas;

globalThis.window = globalThis;

function expectThrows(callback, pattern, message) {
  assert.throws(callback, pattern, message);
}

class FakeTransport {
  terminated = false;
  listener = null;
  failureListener = null;
  delayExecutions = false;
  pendingExecutions = [];
  postMessage(message) {
    const valid = ExtensionRpcMessageSchema.parse(message);
    if (valid.kind !== 'request') return;
    if (valid.method === 'host.activate') {
      const params = valid.params;
      const firstCommand = params.manifest.contributes?.commands?.[0];
      if (firstCommand) {
        this.listener?.({
          v: 1, id: crypto.randomUUID(), kind: 'event', method: 'command.register',
          params: { commandId: firstCommand.command, title: firstCommand.title },
          extensionId: valid.extensionId, nonce: valid.nonce
        });
      }
      this.listener?.({
        v: 1, id: valid.id, kind: 'response', method: valid.method, ok: true, result: true,
        extensionId: valid.extensionId, nonce: valid.nonce
      });
      return;
    }
    if (valid.method === 'host.execute-command') {
      if (this.delayExecutions) { this.pendingExecutions.push(valid); return; }
      this.reply(valid, valid.params.args[0] ?? 'executed');
      return;
    }
    if (valid.method === 'host.ping' || valid.method === 'host.deactivate') {
      this.listener?.({
        v: 1, id: valid.id, kind: 'response', method: valid.method, ok: true, result: true,
        extensionId: valid.extensionId, nonce: valid.nonce
      });
    }
  }
  subscribe(listener, onFailure) {
    this.listener = listener;
    this.failureListener = onFailure;
    return () => { this.listener = null; };
  }
  emit(value) { this.listener?.(value); }
  reply(request, result) {
    this.listener?.({ v: 1, id: request.id, kind: 'response', method: request.method, ok: true, result, extensionId: request.extensionId, nonce: request.nonce });
  }
  fail(error) { this.failureListener?.(error); }
  terminate() { this.terminated = true; }
}

async function runPhase4Validation() {
  console.log('\n=============================================================');
  console.log('  TY-CODE PHASE 4: EXTENSION SECURITY & WORKER VALIDATION');
  console.log('=============================================================\n');

  console.log('--- 1. Manifest and identity validation ---');
  const validManifest = { name: 'test-plugin', publisher: 'community', version: '1.0.0', displayName: 'Test Plugin', contributes: { commands: [{ command: 'community.test-plugin.run', title: 'Run' }] } };
  assert.strictEqual(validateExtensionManifest(validManifest).valid, true);
  assert.strictEqual(validateExtensionManifest({ name: 'invalid-plugin' }).valid, false);
  assert.strictEqual(validateExtensionManifest({ ...validManifest, version: 'latest' }).valid, false);
  assert.strictEqual(validateExtensionManifest({ ...validManifest, contributes: { commands: [{ command: 'outside.run', title: 'Run' }] } }).valid, false);
  for (const id of ['../outside', '..\\outside', 'community.\\..\\outside', 'community.name/../../outside']) {
    expectThrows(() => schemas.ExtensionIdSchema.parse(id), undefined, `Unsafe ID rejected: ${id}`);
  }
  console.log('✓ Strict manifest fields, SemVer, namespaced commands, and traversal IDs rejected');

  console.log('\n--- 2. Trusted built-ins and inert registry entries ---');
  const baseDir = path.join(testDir, 'extensions');
  const manager = new ExtensionManager(baseDir);
  await manager.init();
  const builtIns = manager.getInstalledExtensions();
  assert.strictEqual(builtIns.length, 5);
  assert.ok(builtIns.every((extension) => extension.isBuiltIn && extension.executionState === 'built-in'));
  const python = builtIns.find((extension) => extension.id === 'ty-claude.python-support');
  assert.ok(python.manifest.contributes.commands.some((command) => command.command === 'ty-claude.python-support.lintFile'));

  const marketplaceItem = {
    id: 'community.test-plugin', namespace: 'community', name: 'test-plugin', displayName: 'Test Plugin',
    description: 'metadata only', version: '1.0.0', categories: ['Tools'], downloadUrl: 'https://open-vsx.org/api/community/test-plugin/1.0.0/file/community.test-plugin-1.0.0.vsix'
  };
  const installed = await manager.installExtension(marketplaceItem);
  assert.strictEqual(installed.enabled, false);
  assert.strictEqual(installed.executionState, 'metadata-only');
  assert.strictEqual(installed.manifest.contributes.commands, undefined);
  await assert.rejects(fs.access(installed.installPath), { code: 'ENOENT' }, 'Marketplace install must not create executable package files');
  await assert.rejects(() => manager.installExtension(marketplaceItem), /already installed/);
  await assert.rejects(() => manager.installExtension({ ...marketplaceItem, id: 'ty-claude.python-support', namespace: 'ty-claude', name: 'python-support' }), /cannot be replaced|already installed/i);
  await assert.rejects(() => manager.installExtension({ ...marketplaceItem, id: '../../escape', namespace: 'community', name: 'test-plugin' }));
  await assert.rejects(() => manager.toggleExtension(installed.id, true), /third-party|community/i);
  await assert.rejects(() => manager.installFromVsix(path.join(testDir, 'fake.vsix')), /unavailable/);
  console.log('✓ Marketplace records stay disabled, create no package files, cannot override built-ins, and VSIX is refused');

  console.log('\n--- 3. Extension settings schema ---');
  await manager.updateSettings('ty-claude.prettier-formatter', { 'prettier.tabWidth': 4, 'prettier.singleQuote': false });
  const prettier = manager.getInstalledExtensions().find((extension) => extension.id === 'ty-claude.prettier-formatter');
  assert.strictEqual(prettier.settings['prettier.tabWidth'], 4);
  await assert.rejects(() => manager.updateSettings(prettier.id, { 'prettier.tabWidth': 'wide' }), /must be a number/);
  await assert.rejects(() => manager.updateSettings(prettier.id, { 'prettier.unknown': true }), /Unknown setting/);
  await assert.rejects(() => manager.updateSettings('ty-claude.python-support', { 'python.formatting.provider': 'unknown' }), /not an allowed value/);
  const roundTrip = new ExtensionManager(baseDir);
  await roundTrip.init();
  assert.strictEqual(roundTrip.getInstalledExtensions().find((extension) => extension.id === prettier.id).settings['prettier.tabWidth'], 4);
  console.log('✓ Type, key, enum, and persistence checks behave as expected');

  console.log('\n--- 4. Corrupt registry and poisoned persisted paths ---');
  const corruptBase = path.join(testDir, 'corrupt-state');
  const corruptRegistry = path.join(corruptBase, '.ty-claude', 'extensions', 'installed.json');
  await fs.mkdir(path.dirname(corruptRegistry), { recursive: true });
  await fs.writeFile(corruptRegistry, '{broken json', 'utf8');
  const corruptManager = new ExtensionManager(corruptBase);
  await corruptManager.init();
  assert.strictEqual(corruptManager.getInstalledExtensions().length, 5);
  assert.ok((await fs.readdir(path.dirname(corruptRegistry))).some((name) => name.startsWith('installed.json.corrupt-') && name.endsWith('.bak')));

  const poisonedBase = path.join(testDir, 'poisoned-state');
  const poisonedRegistry = path.join(poisonedBase, '.ty-claude', 'extensions', 'installed.json');
  const outsideSentinel = path.join(testDir, 'must-survive.txt');
  await fs.mkdir(path.dirname(poisonedRegistry), { recursive: true });
  await fs.writeFile(outsideSentinel, 'preserve', 'utf8');
  await fs.writeFile(poisonedRegistry, JSON.stringify({ 'community.persisted': { enabled: false, manifest: { name: 'persisted', publisher: 'community', version: '1.0.0' }, installPath: outsideSentinel } }), 'utf8');
  const poisonedManager = new ExtensionManager(poisonedBase);
  await poisonedManager.init();
  await poisonedManager.uninstallExtension('community.persisted');
  assert.strictEqual(await fs.readFile(outsideSentinel, 'utf8'), 'preserve');
  assert.ok(!poisonedManager.getInstalledExtensions().some((extension) => extension.id.includes('..')));
  console.log('✓ Corrupt state is backed up; serialized installPath is ignored during uninstall');

  console.log('--- 5. Renderer file-operation workspace boundary ---');
  const workspaceRoot = path.join(testDir, 'workspace');
  const outsidePath = path.join(testDir, 'outside.txt');
  const workspaceFile = path.join(workspaceRoot, 'safe.txt');
  await fs.mkdir(workspaceRoot, { recursive: true });
  await fs.writeFile(workspaceFile, 'safe', 'utf8');
  await fs.writeFile(outsidePath, 'untouched', 'utf8');
  assert.strictEqual((await readWorkspaceFile(workspaceFile, workspaceRoot)).success, true);
  assert.strictEqual((await readWorkspaceFile(outsidePath, workspaceRoot)).success, false);
  assert.strictEqual((await writeWorkspaceFile(outsidePath, 'overwritten', workspaceRoot)).success, false);
  assert.strictEqual((await deleteWorkspacePath(outsidePath, workspaceRoot)).success, false);
  assert.strictEqual((await renameWorkspacePath(outsidePath, workspaceFile, workspaceRoot)).success, false);
  assert.strictEqual(await fs.readFile(outsidePath, 'utf8'), 'untouched');
  console.log('✓ Renderer file handlers reject reads, writes, deletes, and renames outside the selected workspace');

  console.log('\n--- 6. RPC envelope and payload validation ---');
  const extensionId = 'ty-claude.python-support';
  const nonce = crypto.randomUUID();
  const goodMessage = { v: 1, id: crypto.randomUUID(), kind: 'request', method: 'host.ping', params: {}, extensionId, nonce };
  assert.strictEqual(parseExtensionRpcMessage(goodMessage).method, 'host.ping');
  expectThrows(() => parseExtensionRpcMessage({ ...goodMessage, v: 2 }), undefined, 'RPC version is fixed');
  expectThrows(() => parseExtensionRpcMessage({ ...goodMessage, method: 'host.run-shell' }), undefined, 'Unknown RPC method rejected');
  expectThrows(() => parseExtensionRpcMessage({ ...goodMessage, id: 'not-a-uuid' }), undefined, 'Malformed request IDs rejected');
  expectThrows(() => parseExtensionRpcParams('capability.workspace.read-file', {}), undefined, 'Invalid method params rejected');
  expectThrows(() => parseExtensionRpcMessage({ ...goodMessage, method: 'capability.window.show-message', params: { message: 'x'.repeat(300_000) } }), /256 KiB/);
  assert.strictEqual(schemas.ExtensionCapabilityRequestSchema.safeParse({ extensionId, capability: 'workspace.fs.read', method: 'workspace.read-file', relativePath: '../.env' }).success, false);
  console.log('✓ RPC methods, IDs, versions, params, and message sizes validated');

  console.log('\n--- 6. Real Worker host command lifecycle ---');
  const fakeTransports = [];
  const host = new ExtensionWorkerHost(() => ({}), () => {
    const transport = new FakeTransport();
    fakeTransports.push(transport);
    return transport;
  });
  const pythonExtension = manager.getInstalledExtensions().find((extension) => extension.id === extensionId);
  await host.activate(pythonExtension);
  const commandId = pythonExtension.manifest.contributes.commands[0].command;
  assert.strictEqual(host.getRegisteredCommands().some((command) => command.id === commandId), true);
  assert.strictEqual(await host.executeCommand(extensionId, commandId, ['test-result']), 'test-result');
  await assert.rejects(() => host.executeCommand(extensionId, 'ty-claude.other.command', []), /not registered/);
  const firstTransport = fakeTransports[0];
  firstTransport.delayExecutions = true;
  const concurrentCalls = Array.from({ length: 32 }, (_, index) => host.executeCommand(extensionId, commandId, [`concurrent-${index}`]));
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(() => host.executeCommand(extensionId, commandId, ['overflow']), /concurrency limit/);
  for (const request of firstTransport.pendingExecutions) firstTransport.reply(request, request.params.args[0]);
  assert.strictEqual((await Promise.all(concurrentCalls)).length, 32);
  const firstTransportAfterCalls = firstTransport;
  firstTransportAfterCalls.emit({ invalid: true });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(firstTransport.terminated, true);
  assert.strictEqual(fakeTransports.length, 2, 'Worker host restarts at most once after a protocol fault');
  assert.strictEqual(fakeTransports[1].terminated, false);
  host.deactivate(extensionId);
  assert.strictEqual(fakeTransports[1].terminated, true);
  assert.strictEqual(host.getRegisteredCommands().length, 0);
  console.log('✓ Worker command proxy, protocol-fault recovery, bounded restart, and cleanup verified');

  console.log('\n--- 7. Runtime hardening configuration ---');
  const rendererHtml = await fs.readFile(path.join(projectRoot, 'src/renderer/index.html'), 'utf8');
  assert.match(rendererHtml, /Content-Security-Policy/i);
  assert.match(rendererHtml, /worker-src 'self'/);
  assert.doesNotMatch(rendererHtml, /unsafe-eval/);
  const extensionSource = await fs.readFile(path.join(projectRoot, 'src/renderer/src/workers/extension-worker.ts'), 'utf8');
  assert.match(extensionSource, /registry\.get\(extensionId\)/);
  assert.doesNotMatch(extensionSource, /from ['"](?:node:|electron)['"]|require\s*\(/);
  console.log('✓ Renderer CSP and static-only Worker entry verified');

  console.log('\n=============================================================');
  console.log('  ALL PHASE 4 EXTENSION VALIDATION ASSERTIONS PASSED');
  console.log('=============================================================\n');
}

try {
  await runPhase4Validation();
} finally {
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => undefined);
}
process.exit(0);
