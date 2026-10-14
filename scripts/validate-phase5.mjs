import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase5-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

// Bundle TypeScript services for Node testing
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
  bundleConfig('src/main/services/lsp-client.ts', 'lsp-client.cjs'),
  bundleConfig('src/main/services/lsp-manager.ts', 'lsp-manager.cjs'),
  bundleConfig('src/main/ipc/fs-handlers.ts', 'fs-handlers.cjs'),
  bundleConfig('src/main/services/config-schemas.ts', 'config-schemas.cjs'),
  bundleConfig('src/main/services/workspace-edit-preview.ts', 'workspace-edit-preview.cjs'),
  bundleConfig('src/main/services/lsp-path-utils.ts', 'lsp-path-utils.cjs')
]);

const { LspClient } = require(path.join(bundleDir, 'lsp-client.cjs'));
const { LspManager, SUPPORTED_LANGUAGE_SERVERS } = require(path.join(bundleDir, 'lsp-manager.cjs'));
const { WorkspaceEditPreviewService } = require(path.join(bundleDir, 'workspace-edit-preview.cjs'));
const { toFileUri, fromFileUri } = require(path.join(bundleDir, 'lsp-path-utils.cjs'));
const { searchInWorkspaceFiles, replaceInWorkspaceFiles } = require(path.join(bundleDir, 'fs-handlers.cjs'));
const { DEFAULT_KEYBINDINGS, DEFAULT_EDITOR_SETTINGS, SETTINGS_JSON_SCHEMA, KEYBINDINGS_JSON_SCHEMA } = require(path.join(bundleDir, 'config-schemas.cjs'));

async function runPhase5Validation() {
  console.log('\n=============================================================');
  console.log('  TY-CODE PHASE 5: ADVANCED EDITOR & LSP PROTOCOL VALIDATION');
  console.log('=============================================================\n');

  // --- Assertion 1: LSP JSON-RPC 2.0 Framing & Message Serialization ---
  console.log('--- Assertion 1: LSP JSON-RPC 2.0 Framing & Protocol Parsing ---');
  const testPayload = { jsonrpc: '2.0', id: 1, method: 'textDocument/completion', params: { textDocument: { uri: 'file:///app.ts' } } };
  const framed = LspClient.formatFrame(testPayload);
  assert.ok(framed.startsWith('Content-Length: '), 'Frame must start with Content-Length header');
  assert.ok(framed.includes('\r\n\r\n'), 'Frame must contain CRLF separator');

  const { messages, remaining } = LspClient.parseFrames(Buffer.from(framed, 'utf-8'));
  assert.strictEqual(messages.length, 1, 'Should extract exactly 1 message from single frame');
  assert.strictEqual(messages[0].id, 1, 'Extracted message id should match');
  assert.strictEqual(messages[0].method, 'textDocument/completion', 'Method should match');
  assert.strictEqual(remaining.length, 0, 'Remaining buffer should be empty');
  console.log('✓ Successfully formatted and parsed single LSP message frame');

  // Multiple messages in a single packet chunk
  const multiChunk = Buffer.concat([
    Buffer.from(LspClient.formatFrame({ jsonrpc: '2.0', id: 10, result: { items: ['a', 'b'] } })),
    Buffer.from(LspClient.formatFrame({ jsonrpc: '2.0', method: 'textDocument/publishDiagnostics', params: { uri: 'file:///a.ts', diagnostics: [] } }))
  ]);
  const parsedMulti = LspClient.parseFrames(multiChunk);
  assert.strictEqual(parsedMulti.messages.length, 2, 'Should parse multiple messages in one chunk');
  assert.strictEqual(parsedMulti.messages[0].id, 10, 'First message matches id');
  assert.strictEqual(parsedMulti.messages[1].method, 'textDocument/publishDiagnostics', 'Second message matches notification');
  console.log('✓ Successfully parsed multi-message batch stream with zero packet loss');

  // Split packet across chunks
  const fullPacket = Buffer.from(LspClient.formatFrame({ jsonrpc: '2.0', id: 99, result: 'done' }));
  const half1 = fullPacket.subarray(0, 15);
  const half2 = fullPacket.subarray(15);
  const step1 = LspClient.parseFrames(half1);
  assert.strictEqual(step1.messages.length, 0, 'Incomplete frame should not emit message');
  assert.strictEqual(step1.remaining.length, 15, 'Incomplete frame preserved in remaining buffer');
  const step2 = LspClient.parseFrames(Buffer.concat([step1.remaining, half2]));
  assert.strictEqual(step2.messages.length, 1, 'Re-assembled packet emitted successfully');
  assert.strictEqual(step2.messages[0].id, 99);
  console.log('✓ Chunk fragmentation resilience verified');

  // --- Assertion 2: LSP Client Dispatching & Diagnostics Handling ---
  console.log('\n--- Assertion 2: LSP Client Dispatch & Diagnostics Event Flow ---');
  const client = new LspClient({
    command: 'dummy-lsp',
    workspacePath: testDir,
    languageId: 'typescript'
  });

  let diagnosticsReceived = null;
  client.on('diagnostics', (diag) => {
    diagnosticsReceived = diag;
  });

  client.dispatchMessage({
    jsonrpc: '2.0',
    method: 'textDocument/publishDiagnostics',
    params: {
      uri: 'file:///test.ts',
      diagnostics: [{ message: 'Type error: Cannot find name foo', severity: 1 }]
    }
  });

  assert.ok(diagnosticsReceived !== null, 'Client should emit diagnostics event');
  assert.strictEqual(diagnosticsReceived.diagnostics[0].severity, 1, 'Diagnostic severity preserved');
  console.log('✓ LSP diagnostics event dispatched and handled');

  // --- Assertion 3: Language Server Discovery & Multi-Language Registry ---
  console.log('\n--- Assertion 3: Multi-Language Server Support & File Routing ---');
  const manager = new LspManager(testDir, { resolveSystemExecutable: async () => ({}) });
  await manager.refreshAvailability();
  const allServers = manager.getAllServers();

  assert.strictEqual(allServers.length, 6, 'Must support 6 core language server categories');
  const ids = allServers.map((s) => s.languageId);
  assert.ok(ids.includes('typescript'), 'TypeScript support registered');
  assert.ok(ids.includes('python'), 'Python support registered');
  assert.ok(ids.includes('rust'), 'Rust support registered');
  assert.ok(ids.includes('go'), 'Go support registered');
  assert.ok(ids.includes('java'), 'Java support registered');
  assert.ok(ids.includes('cpp'), 'C/C++ support registered');

  // Extension resolution
  assert.strictEqual(manager.getLanguageIdForFile('src/index.ts'), 'typescript');
  assert.strictEqual(manager.getLanguageIdForFile('components/Button.tsx'), 'typescript');
  assert.strictEqual(manager.getLanguageIdForFile('server/main.py'), 'python');
  assert.strictEqual(manager.getLanguageIdForFile('core/src/main.rs'), 'rust');
  assert.strictEqual(manager.getLanguageIdForFile('backend/main.go'), 'go');
  assert.strictEqual(manager.getLanguageIdForFile('native/engine.cpp'), 'cpp');
  assert.strictEqual(manager.getLanguageIdForFile('App.java'), 'java');
  assert.strictEqual(manager.getLanguageIdForFile('readme.txt'), null);
  console.log('✓ File extension routing verified for all 6 supported languages');

  // --- Assertion 4: Document Synchronization Lifecycle ---
  console.log('\n--- Assertion 4: Document Synchronization (Open, Change, Save, Close) ---');
  const docPath = path.join(testDir, 'sample.ts');
  await manager.onDocumentOpened(docPath, 'typescript', 'const greeting = "Hello World";');
  manager.onDocumentChanged(docPath, 'const greeting = "Hello Ty-Code";');
  manager.onDocumentSaved(docPath, 'const greeting = "Hello Ty-Code";');
  manager.onDocumentClosed(docPath);
  console.log('✓ Document synchronization lifecycle completed without error');

  // --- Assertion 5: Graceful IntelliSense Fallback when Server Unavailable ---
  console.log('\n--- Assertion 5: Monaco IntelliSense Fallback on Missing Binary ---');
  const completionRes = await manager.getCompletions(docPath, { line: 0, character: 10 });
  assert.strictEqual(completionRes.success, false, 'Should report server not running/available');
  assert.strictEqual(completionRes.fallbackToBuiltin, true, 'Must specify fallbackToBuiltin: true for Monaco');

  const defRes = await manager.getDefinition(docPath, { line: 0, character: 10 });
  assert.strictEqual(defRes.fallbackToBuiltin, true, 'Definition query specifies fallback');

  const hoverRes = await manager.getHover(docPath, { line: 0, character: 10 });
  assert.strictEqual(hoverRes.fallbackToBuiltin, true, 'Hover query specifies fallback');

  const renameRes = await manager.renameSymbol(docPath, { line: 0, character: 10 }, 'newVar');
  assert.strictEqual(renameRes.fallbackToBuiltin, true, 'Rename query specifies fallback');
  console.log('✓ Graceful fallback to Monaco built-in intelligence verified');

  // --- Assertion 6: Global Workspace Search Engine ---
  console.log('\n--- Assertion 6: Workspace Search (Regex, Case Sensitive, Whole Word, Globs) ---');
  const searchWorkspace = path.join(testDir, 'search_ws');
  await fs.mkdir(path.join(searchWorkspace, 'src'), { recursive: true });
  await fs.mkdir(path.join(searchWorkspace, 'dist'), { recursive: true });

  await fs.writeFile(path.join(searchWorkspace, 'src', 'main.ts'), 'function calculateTotal(price: number): number {\n  const tax = 0.08;\n  return price * (1 + tax);\n}\n');
  await fs.writeFile(path.join(searchWorkspace, 'src', 'utils.ts'), 'export const formatCurrency = (val: number) => `$${val.toFixed(2)}`;\nconst price = 100;\n');
  await fs.writeFile(path.join(searchWorkspace, 'dist', 'bundle.js'), '// price in bundle should be excluded\nconst price = 100;\n');

  // Case insensitive match
  const search1 = await searchInWorkspaceFiles(searchWorkspace, { query: 'price', isCaseSensitive: false });
  assert.strictEqual(search1.success, true);
  assert.ok(search1.data.length >= 2, 'Should find price across files');

  // Whole word match
  const search2 = await searchInWorkspaceFiles(searchWorkspace, { query: 'price', matchWholeWord: true });
  assert.strictEqual(search2.success, true);
  for (const f of search2.data) {
    for (const m of f.matches) {
      assert.ok(/\bprice\b/.test(m.lineContent), 'Line content should match whole word');
    }
  }

  // Regex search
  const search3 = await searchInWorkspaceFiles(searchWorkspace, { query: 'function\\s+\\w+', isRegex: true });
  assert.strictEqual(search3.success, true);
  assert.strictEqual(search3.data.length, 1);
  assert.ok(search3.data[0].relativePath.includes('main.ts'));

  // Exclude pattern (exclude dist/**)
  const search4 = await searchInWorkspaceFiles(searchWorkspace, { query: 'price', excludePattern: 'dist/**' });
  assert.strictEqual(search4.success, true);
  const foundDist = search4.data.some((f) => f.relativePath.startsWith('dist'));
  assert.strictEqual(foundDist, false, 'dist files must be excluded by pattern');
  console.log('✓ Workspace search passed: regex, case-sensitivity, whole-word, and globs');

  // --- Assertion 7: Multi-File Replace Engine ---
  console.log('\n--- Assertion 7: Multi-File Replace in Files ---');
  const replaceRes = await replaceInWorkspaceFiles(searchWorkspace, {
    query: 'calculateTotal',
    replacement: 'computeGrandTotal',
    excludePattern: 'dist/**'
  });
  assert.strictEqual(replaceRes.success, true);
  assert.strictEqual(replaceRes.data.replacedCount, 1);
  assert.strictEqual(replaceRes.data.filesChanged, 1);

  const updatedMain = await fs.readFile(path.join(searchWorkspace, 'src', 'main.ts'), 'utf-8');
  assert.ok(updatedMain.includes('computeGrandTotal'), 'Content in file replaced');
  assert.ok(!updatedMain.includes('calculateTotal'), 'Old term removed');
  console.log('✓ Multi-file replace executed and verified on disk');

  // --- Assertion 8: Canonical URIs, local-candidate safety, and edit transactions ---
  console.log('\n--- Assertion 8: Canonical URIs, Server Trust, and Workspace Edit Transactions ---');
  const uriFile = path.join(testDir, 'uri path #percent%.ts');
  const uri = toFileUri(uriFile);
  assert.ok(uri.includes('%20') && uri.includes('%23') && uri.includes('%25'), 'File URIs encode spaces and reserved path characters');
  assert.strictEqual(fromFileUri(uri), uriFile, 'File URI round-trips on the current platform');

  const localCandidateWorkspace = path.join(testDir, 'local-candidate-workspace');
  const localBin = path.join(localCandidateWorkspace, 'node_modules', '.bin');
  await fs.mkdir(localBin, { recursive: true });
  const localServerPath = path.join(localBin, process.platform === 'win32' ? 'typescript-language-server.cmd' : 'typescript-language-server');
  const markerPath = path.join(testDir, 'local-server-executed.txt');
  await fs.writeFile(localServerPath, `echo executed > "${markerPath}"\n`, 'utf-8');
  const localManager = new LspManager(localCandidateWorkspace, { resolveSystemExecutable: async () => ({}) });
  await localManager.refreshAvailability();
  const localTypeScript = localManager.getAllServers().find((item) => item.languageId === 'typescript');
  assert.ok(localTypeScript?.workspaceCandidates?.some((candidate) => candidate.path === localServerPath), 'Workspace-local binary is detected for information');
  assert.strictEqual(localTypeScript?.isAvailable, false, 'Workspace-local binary is not considered runnable');
  assert.strictEqual(await localManager.startServer('typescript'), false, 'Workspace-local binary cannot start without an explicit absolute path');
  assert.strictEqual(await fs.access(markerPath).then(() => true, () => false), false, 'Detection does not execute a workspace-local binary');

  const transactionWorkspace = path.join(testDir, 'transaction-workspace');
  await fs.mkdir(path.join(transactionWorkspace, 'src'), { recursive: true });
  const firstFile = path.join(transactionWorkspace, 'src', 'first.ts');
  const secondFile = path.join(transactionWorkspace, 'src', 'second.ts');
  const firstOriginal = 'const oldName = 1;\n';
  const secondOriginal = 'export { oldName };\n';
  await fs.writeFile(firstFile, firstOriginal, 'utf-8');
  await fs.writeFile(secondFile, secondOriginal, 'utf-8');
  const transactionManager = new LspManager(transactionWorkspace, { resolveSystemExecutable: async () => ({}) });
  await transactionManager.onDocumentOpened(firstFile, 'typescript', firstOriginal);
  await transactionManager.onDocumentOpened(secondFile, 'typescript', secondOriginal);
  const editService = new WorkspaceEditPreviewService(transactionWorkspace, transactionManager);
  const makeRenameEdit = () => ({
    documentChanges: [
      { textDocument: { uri: toFileUri(firstFile), version: transactionManager.getTrackedDocument(firstFile)?.version }, edits: [{ range: { start: { line: 0, character: 6 }, end: { line: 0, character: 13 } }, newText: 'newName' }] },
      { textDocument: { uri: toFileUri(secondFile), version: transactionManager.getTrackedDocument(secondFile)?.version }, edits: [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 16 } }, newText: 'newName' }] }
    ]
  });
  const cancelPreview = await editService.createLspPreview(makeRenameEdit(), 'Rename oldName');
  assert.strictEqual(cancelPreview.files.length, 2, 'Rename preview includes both affected files');
  editService.cancelPreview(cancelPreview.previewId);
  assert.strictEqual(await fs.readFile(firstFile, 'utf-8'), firstOriginal, 'Cancel leaves the first file untouched');
  assert.strictEqual(await fs.readFile(secondFile, 'utf-8'), secondOriginal, 'Cancel leaves the second file untouched');

  const stalePreview = await editService.createLspPreview(makeRenameEdit(), 'Rename oldName');
  await fs.writeFile(secondFile, `${secondOriginal}// concurrent edit\n`, 'utf-8');
  await assert.rejects(editService.applyPreview(stalePreview.previewId), /stale/i, 'Stale source blocks the whole transaction');
  assert.strictEqual(await fs.readFile(firstFile, 'utf-8'), firstOriginal, 'Stale validation writes nothing to other files');
  await fs.writeFile(secondFile, secondOriginal, 'utf-8');

  const applyPreview = await editService.createLspPreview(makeRenameEdit(), 'Rename oldName');
  const applied = await editService.applyPreview(applyPreview.previewId);
  assert.strictEqual(applied.files.length, 2, 'Apply reports the complete transaction');
  assert.ok((await fs.readFile(firstFile, 'utf-8')).includes('newName'), 'Apply changes the first file');
  assert.ok((await fs.readFile(secondFile, 'utf-8')).includes('newName'), 'Apply changes the second file');
  const undone = await editService.undoTransaction(applied.transactionId);
  assert.strictEqual(undone.files.length, 2, 'Undo restores all files as one operation');
  assert.strictEqual(await fs.readFile(firstFile, 'utf-8'), firstOriginal, 'Transaction undo restores the first file');
  assert.strictEqual(await fs.readFile(secondFile, 'utf-8'), secondOriginal, 'Transaction undo restores the second file');

  let renameAttempts = 0;
  const failingService = new WorkspaceEditPreviewService(transactionWorkspace, transactionManager, {
    renameFile: async (source, target) => {
      renameAttempts++;
      if (renameAttempts === 2) throw new Error('simulated disk error');
      await fs.rename(source, target);
    }
  });
  const rollbackPreview = await failingService.createLspPreview(makeRenameEdit(), 'Rename oldName');
  await assert.rejects(failingService.applyPreview(rollbackPreview.previewId), /simulated disk error/, 'A commit failure is reported');
  assert.strictEqual(await fs.readFile(firstFile, 'utf-8'), firstOriginal, 'Failed multi-file apply rolls back the first file');
  assert.strictEqual(await fs.readFile(secondFile, 'utf-8'), secondOriginal, 'Failed multi-file apply leaves the second file unchanged');

  const unsupportedRefactor = { documentChanges: [{ kind: 'rename', oldUri: toFileUri(firstFile), newUri: toFileUri(path.join(transactionWorkspace, 'src', 'renamed.ts')) }] };
  await assert.rejects(editService.createLspPreview(unsupportedRefactor, 'Rename file'), /not supported/i, 'Unsupported resource operations are rejected before writes');
  console.log('✓ Local binaries stay inert; preview/cancel/stale/apply/undo preserve all-or-nothing semantics');

  // --- Assertion 9: Command Palette & Keybinding Schema Integrity ---
  console.log('\n--- Assertion 9: Command Palette & Keybindings Schema ---');
  assert.ok(Array.isArray(DEFAULT_KEYBINDINGS), 'Default keybindings list present');
  const keyMap = new Map(DEFAULT_KEYBINDINGS.map((k) => [k.command, k.key]));

  assert.strictEqual(keyMap.get('workbench.action.quickOpen'), 'Ctrl+P');
  assert.strictEqual(keyMap.get('workbench.action.showCommands'), 'Ctrl+Shift+P');
  assert.strictEqual(keyMap.get('workbench.view.search'), 'Ctrl+Shift+F');
  assert.strictEqual(keyMap.get('editor.action.goToDefinition'), 'F12');
  assert.strictEqual(keyMap.get('editor.action.rename'), 'F2');
  assert.strictEqual(keyMap.get('editor.action.findReferences'), 'Shift+F12');
  assert.strictEqual(keyMap.get('workbench.action.splitEditor'), 'Ctrl+\\');

  assert.strictEqual(KEYBINDINGS_JSON_SCHEMA.type, 'array', 'Keybindings schema is array');
  assert.strictEqual(SETTINGS_JSON_SCHEMA.type, 'object', 'Settings schema is object');
  assert.ok(SETTINGS_JSON_SCHEMA.properties['lsp.servers'], 'LSP servers property configured');
  assert.ok(SETTINGS_JSON_SCHEMA.properties['editor.minimap.enabled'], 'Minimap setting configured');
  assert.ok(SETTINGS_JSON_SCHEMA.properties['editor.wordWrap'], 'Word wrap setting configured');
  console.log('✓ VS Code keybindings and schema configurations verified');

  // Clean test workspace
  try {
    await fs.rm(testDir, { recursive: true, force: true });
  } catch {
    // Ignore
  }

  console.log('\n=============================================================');
  console.log('  ALL PHASE 5 VALIDATION ASSERTIONS PASSED (100%)');
  console.log('=============================================================\n');
}

runPhase5Validation().catch((err) => {
  console.error('\n❌ PHASE 5 VALIDATION FAILED:', err);
  process.exit(1);
});
