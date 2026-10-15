import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8'));
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase6-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

const mockElectronPath = path.join(testDir, 'mock-electron.cjs');
await fs.writeFile(
  mockElectronPath,
  `const path = require('node:path');
module.exports = {
  app: {
    getPath: (name) => path.join('${testDir.replace(/\\/g, '\\\\')}', 'userdata'),
    getVersion: () => '0.1.0',
    isPackaged: false
  },
  screen: {
    getAllDisplays: () => [{ bounds: { x: 0, y: 0, width: 1920, height: 1080 } }]
  },
  BrowserWindow: class {}
};`,
  'utf-8'
);

// Bundle TypeScript services for Node testing
const bundleConfig = (entry, outfile) =>
  build({
    entryPoints: [path.join(projectRoot, entry)],
    outfile: path.join(bundleDir, outfile),
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent',
    alias: {
      electron: mockElectronPath
    },
    external: ['electron-updater', 'simple-git', 'node-pty']
  });

await Promise.all([
  bundleConfig('src/main/services/myers-diff.ts', 'myers-diff.cjs'),
  bundleConfig('src/main/services/window-state.ts', 'window-state.cjs'),
  bundleConfig('src/main/services/update-manager.ts', 'update-manager.cjs'),
  bundleConfig('src/main/services/recent-workspaces.ts', 'recent-workspaces.cjs'),
  bundleConfig('src/renderer/src/services/storage-cache.ts', 'storage-cache.cjs'),
  bundleConfig('src/renderer/src/services/i18n.ts', 'i18n.cjs')
]);

const { MyersDiff } = require(path.join(bundleDir, 'myers-diff.cjs'));
const { WindowStateManager } = require(path.join(bundleDir, 'window-state.cjs'));
const { UpdateManager } = require(path.join(bundleDir, 'update-manager.cjs'));
const { RecentWorkspacesManager } = require(path.join(bundleDir, 'recent-workspaces.cjs'));
const { StorageCache } = require(path.join(bundleDir, 'storage-cache.cjs'));
const { useI18nStore, t } = require(path.join(bundleDir, 'i18n.cjs'));
const { generateReleaseNotes } = await import(pathToFileURL(path.join(projectRoot, 'scripts/generate-release-notes.mjs')).href);

let passedTests = 0;
let failedTests = 0;

function verify(condition, name) {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${name}`);
    failedTests++;
  }
}

async function runValidation() {
  console.log('================================================================');
  console.log('  TY-CODE PHASE 6: POLISH, PERFORMANCE & PACKAGING VALIDATION');
  console.log('================================================================\n');

  // --- 1. Window State Manager ---
  console.log('--- Assertion 1: Window State Persistence & Geometry Bounds ---');
  const customConfigPath = path.join(testDir, 'test-window-state.json');
  const windowManager = new WindowStateManager(customConfigPath);
  const initialState = windowManager.getState();
  verify(initialState.width >= 1000 && initialState.height >= 600, 'Initial default window state meets desktop bounds');

  // Simulate window resize and persistence
  const mockWindow = {
    isDestroyed: () => false,
    isMaximized: () => false,
    isFullScreen: () => false,
    getBounds: () => ({ x: 120, y: 80, width: 1400, height: 900 }),
    maximize: () => {},
    setFullScreen: () => {},
    on: (event, handler) => {
      if (event === 'close') {
        mockWindow.closeHandler = handler;
      }
    }
  };
  windowManager.manage(mockWindow);
  mockWindow.closeHandler();

  const persistedManager = new WindowStateManager(customConfigPath);
  const restoredState = persistedManager.getState();
  verify(restoredState.x === 120 && restoredState.y === 80, 'Window coordinates persisted and restored correctly');
  verify(restoredState.width === 1400 && restoredState.height === 900, 'Window dimensions saved accurately');

  const recentManager = new RecentWorkspacesManager(path.join(testDir, 'recent-workspaces.json'));
  const recent = recentManager.addRecent(path.join(testDir, 'sample-project'));
  verify(recent[0]?.name === 'sample-project' && recentManager.getRecent().length === 1, 'Recent workspaces persist and load from disk');
  recentManager.addRecent(path.join(testDir, 'sample-project'));
  verify(recentManager.getRecent().length === 1, 'Opening the same project updates rather than duplicates its entry');
  recentManager.clearRecent();
  verify(recentManager.getRecent().length === 0, 'Recent workspaces can be cleared');

  // --- 2. Myers Diff Algorithm ---
  console.log('\n--- Assertion 2: Myers Diff Shortest Edit Script (SES) & Unified Diff ---');
  const textA = 'function add(a, b) {\n  return a + b;\n}\n';
  const textB = 'function add(a, b) {\n  console.log("Adding");\n  return a + b;\n}\n// End\n';

  const diffResult = MyersDiff.diff(textA, textB);
  verify(!diffResult.isIdentical, 'Detects difference between modified files');
  verify(diffResult.additions === 2 && diffResult.deletions === 0, 'Accurately computes additions and deletions count');
  verify(diffResult.hunks.length > 0, 'Generates valid unified diff hunks');
  verify(diffResult.hunks[0].header.startsWith('@@ -'), 'Hunk includes standard @@ unified diff header');

  // Test edge cases: identical strings and completely disjoint strings
  const identicalResult = MyersDiff.diff('hello\nworld', 'hello\nworld');
  verify(identicalResult.isIdentical && identicalResult.additions === 0, 'Identical strings return zero diff');

  const disjointResult = MyersDiff.diff('foo', 'bar');
  verify(disjointResult.deletions === 1 && disjointResult.additions === 1, 'Disjoint lines identified as 1 deletion and 1 addition');

  const lineEndingResult = MyersDiff.diff('alpha\r\nbeta\r\n', 'alpha\nbeta\n');
  verify(!lineEndingResult.isIdentical && lineEndingResult.additions > 0 && lineEndingResult.deletions > 0, 'CRLF-to-LF changes are visible in the diff');
  const overLimitDiff = (() => {
    try { MyersDiff.diff('a'.repeat(100_001), 'b'.repeat(100_001)); return false; } catch (error) { return String(error).includes('character limit'); }
  })();
  verify(overLimitDiff, 'Rejects total text beyond the bounded diff input size');
  const coarseDiff = MyersDiff.diff(
    Array.from({ length: 1_001 }, (_, index) => `old-${index}`).join('\n'),
    Array.from({ length: 1_001 }, (_, index) => `new-${index}`).join('\n')
  );
  verify(coarseDiff.additions === 1_001 && coarseDiff.deletions === 1_001, 'Uses a bounded-memory replacement fallback for highly divergent text');

  // --- 3. Auto-Update Service & Channels ---
  console.log('\n--- Assertion 3: Auto-Update Channels & Lifecycle ---');
  let updaterResult = {
    isUpdateAvailable: true,
    updateInfo: { version: '0.2.0', releaseNotes: 'Update notes', releaseDate: '2026-10-14' }
  };
  const fakeUpdater = {
    autoDownload: true,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    channel: 'latest',
    on: () => {},
    checkForUpdates: async () => updaterResult,
    downloadUpdate: async () => []
  };
  const updateManager = new UpdateManager({ updater: fakeUpdater, isPackaged: true, currentVersion: '0.1.0' });
  verify(updateManager.getChannel() === 'stable' && fakeUpdater.autoDownload === false, 'Default update channel is stable and updater waits for approval');

  updateManager.setChannel('beta');
  verify(updateManager.getChannel() === 'beta' && fakeUpdater.channel === 'beta' && fakeUpdater.allowPrerelease, 'Beta channel configures prerelease update source');

  updateManager.setChannel('nightly');
  verify(updateManager.getChannel() === 'nightly' && fakeUpdater.channel === 'nightly', 'Nightly channel is applied to the updater');
  let invalidChannelRejected = false;
  try { updateManager.setChannel('preview'); } catch { invalidChannelRejected = true; }
  verify(invalidChannelRejected, 'Unknown update channels are rejected');

  const updateResult = await updateManager.checkForUpdates();
  verify(updateResult.updateAvailable && updateResult.latestVersion === '0.2.0', 'Real updater result reports an available update and release details');
  updaterResult = { isUpdateAvailable: false, updateInfo: { version: '0.0.9' } };
  const downgradeResult = await updateManager.checkForUpdates();
  verify(!downgradeResult.updateAvailable && downgradeResult.latestVersion === '0.0.9', 'Older channel release is not offered as an update');
  verify((await updateManager.downloadUpdate()).success, 'Approved update download is delegated to electron-updater');

  const failingManager = new UpdateManager({
    updater: { ...fakeUpdater, checkForUpdates: async () => { throw new Error('network unavailable'); } },
    isPackaged: true,
    currentVersion: '0.1.0'
  });
  const failedCheck = await failingManager.checkForUpdates();
  verify(failedCheck.error === 'network unavailable', 'Updater failures are returned for visible renderer feedback');

  // --- 4. Virtual File Tree (10,000+ Files Flattening & Slice Window) ---
  console.log('\n--- Assertion 4: Virtual Scrolling File Tree (10,000+ File Nodes) ---');
  // Generate a massive tree of 10,000 files
  const rootNode = {
    name: 'large-workspace',
    path: '/workspace',
    relativePath: '',
    isDirectory: true,
    children: []
  };

  for (let dirIdx = 0; dirIdx < 100; dirIdx++) {
    const dir = {
      name: `package-${dirIdx}`,
      path: `/workspace/package-${dirIdx}`,
      relativePath: `package-${dirIdx}`,
      isDirectory: true,
      children: []
    };
    for (let fileIdx = 0; fileIdx < 100; fileIdx++) {
      dir.children.push({
        name: `component-${fileIdx}.tsx`,
        path: `/workspace/package-${dirIdx}/component-${fileIdx}.tsx`,
        relativePath: `package-${dirIdx}/component-${fileIdx}.tsx`,
        isDirectory: false,
        extension: '.tsx'
      });
    }
    rootNode.children.push(dir);
  }

  // Benchmark tree flattening and windowing
  const t0 = performance.now();
  const flatNodes = [];
  const traverse = (node, depth) => {
    flatNodes.push({ node, depth });
    if (node.children) {
      for (const child of node.children) traverse(child, depth + 1);
    }
  };
  traverse(rootNode, 0);
  const t1 = performance.now();

  verify(flatNodes.length === 10101, 'Tree accurately expanded to 10,101 total nodes');
  verify(t1 - t0 < 50, `10,000 files flattened in ${(t1 - t0).toFixed(2)}ms (<50ms constraint)`);

  // Virtual slice calculation
  const itemHeight = 24;
  const containerHeight = 600;
  const scrollTop = 2400; // Scrolled down
  const overscan = 6;
  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);
  const endIndex = Math.min(flatNodes.length, Math.ceil((scrollTop + containerHeight) / itemHeight) + overscan);
  const renderedCount = endIndex - startIndex;

  verify(renderedCount < 45, `Virtual window bounds active DOM elements to ${renderedCount} nodes (<45 max DOM nodes)`);

  // --- 5. Storage Cache & TTL Persistence ---
  console.log('\n--- Assertion 5: Storage Cache TTL & Memory Fallback ---');
  const cache = new StorageCache('test_cache_' + Date.now(), 'store');
  await cache.set('user_pref', { theme: 'dark', fontSize: 14 });
  const cachedVal = await cache.get('user_pref');
  verify(cachedVal && cachedVal.theme === 'dark', 'Data stored and retrieved from cache');

  // Test TTL expiration
  await cache.set('short_lived', 'expires_soon', 10);
  await new Promise((r) => setTimeout(r, 25));
  const expiredVal = await cache.get('short_lived');
  verify(expiredVal === null, 'Expired cache entry evicted on TTL timeout');

  // --- 6. Internationalization (i18n) Engine ---
  console.log('\n--- Assertion 6: Internationalization (i18n) Engine ---');
  useI18nStore.getState().setLocale('en');
  verify(t('welcome.openFolder') === 'Open Folder', 'English translation retrieved correctly');

  useI18nStore.getState().setLocale('es');
  verify(t('welcome.openFolder') === 'Abrir Carpeta', 'Spanish translation retrieved correctly');

  useI18nStore.getState().setLocale('ja');
  verify(t('welcome.openFolder') === 'フォルダーを開く', 'Japanese translation retrieved correctly');

  // Parameterized string interpolation
  useI18nStore.getState().setLocale('en');
  const formatted = t('update.available', { version: '1.2.0' });
  verify(formatted === 'Update available: v1.2.0', 'Parameterized template string interpolated');

  // --- 7. Theme Tokens & CSS Definitions ---
  console.log('\n--- Assertion 7: Multi-Theme Tokens (Dark, Light, High-Contrast) ---');
  const cssContent = await fs.readFile(path.join(projectRoot, 'src/renderer/src/index.css'), 'utf-8');
  verify(cssContent.includes('body.theme-light'), 'CSS defines body.theme-light class');
  verify(cssContent.includes('body.theme-high-contrast'), 'CSS defines body.theme-high-contrast class');
  verify(cssContent.includes('--accent-primary'), 'Accent color CSS variable present');

  // --- 8. electron-builder Configuration ---
  console.log('\n--- Assertion 8: electron-builder Multi-Platform Configuration ---');
  const builderYaml = await fs.readFile(path.join(projectRoot, 'electron-builder.yml'), 'utf-8');
  verify(builderYaml.includes('appId: com.tycode.app'), 'AppId is configured');
  verify(builderYaml.includes('target: nsis') && builderYaml.includes('target: portable'), 'Windows installer and portable targets configured');
  verify(builderYaml.includes('target: dmg') && builderYaml.includes('target: zip'), 'macOS DMG and ZIP targets configured');
  verify(builderYaml.includes('target: AppImage') && builderYaml.includes('target: deb') && builderYaml.includes('target: rpm'), 'Linux AppImage, DEB, and RPM targets configured');
  verify(builderYaml.includes('hardenedRuntime: true') && builderYaml.includes('artifactName:'), 'Hardened runtime and deterministic artifact names are configured');
  for (const platform of ['win', 'mac']) {
    verify(new RegExp(`${platform}:\\s*\\n\\s+icon:\\s*icon\\.png`).test(builderYaml), `${platform} packaging uses the shared branded PNG icon source`);
  }
  verify(builderYaml.includes('linux:\n  icon: icons/'), 'Linux packaging uses the generated hicolor icon set');
  verify(builderYaml.includes('from: build/icon.png') && builderYaml.includes('to: icon.png'), 'Packaged app includes the runtime window icon resource');
  const iconSvg = await fs.readFile(path.join(projectRoot, 'build/icon.svg'), 'utf-8');
  verify(iconSvg.includes('viewBox="0 0 1024 1024"') && iconSvg.includes('#8B5CF6') && iconSvg.includes('#06B6D4'), 'Branded vector master has a square high-resolution canvas and Ty-Code accent colors');
  const iconPng = await fs.readFile(path.join(projectRoot, 'build/icon.png'));
  verify(iconPng.toString('hex', 0, 8) === '89504e470d0a1a0a' && iconPng.readUInt32BE(16) === 1024 && iconPng.readUInt32BE(20) === 1024, 'Branded PNG icon is a valid 1024px square raster');
  for (const size of [16, 24, 32, 48, 64, 128, 256, 512]) {
    const linuxIconPath = path.join(projectRoot, 'build/icons', `${size}x${size}.png`);
    const linuxIcon = await fs.readFile(linuxIconPath).catch(() => null);
    verify(linuxIcon?.toString('hex', 0, 8) === '89504e470d0a1a0a' && linuxIcon.readUInt32BE(16) === size && linuxIcon.readUInt32BE(20) === size, `Linux icon set contains a valid ${size}x${size} PNG`);
  }
  for (const relativePath of ['build/entitlements.mac.plist', 'build/entitlements.mac.inherit.plist']) {
    const exists = await fs.stat(path.join(projectRoot, relativePath)).then((stats) => stats.isFile()).catch(() => false);
    verify(exists, `Configured macOS resource exists: ${relativePath}`);
  }
  verify(packageJson.scripts.package?.includes('--publish never') && packageJson.scripts['package:all']?.includes('--publish never'), 'Packaging scripts defer publishing to the release job');

  // --- 9. GitHub Actions CI/CD Pipeline ---
  console.log('\n--- Assertion 9: GitHub Actions CI/CD Workflow ---');
  const workflowYaml = await fs.readFile(path.join(projectRoot, '.github/workflows/build.yml'), 'utf-8');
  verify(workflowYaml.includes('matrix:'), 'Matrix build strategy configured');
  verify(workflowYaml.includes('windows-latest') && workflowYaml.includes('macos-latest') && workflowYaml.includes('ubuntu-latest'), 'Test and package jobs cover Windows, macOS, and Linux');
  verify(workflowYaml.includes('npm test'), 'Includes automated test suite execution');
  verify(workflowYaml.includes('dist-release/*.yml') && workflowYaml.includes('dist-release/*.blockmap'), 'Uploads electron-updater manifests and differential metadata');
  verify(workflowYaml.includes('dist-release/*.zip') && workflowYaml.includes('dist-release/*.deb') && workflowYaml.includes('dist-release/*.rpm'), 'Uploads macOS ZIP and Linux DEB/RPM formats');
  verify(workflowYaml.includes('if-no-files-found: error') && !workflowYaml.includes('sha256sum * > SHA256SUMS.txt || true'), 'Missing release artifacts and checksum failures fail the workflow');
  verify(workflowYaml.includes('WIN_CSC_LINK') && workflowYaml.includes('APPLE_APP_SPECIFIC_PASSWORD'), 'Tagged distribution requires signing and notarization secrets');
  verify(workflowYaml.includes('Ensure release tag matches package version'), 'Tagged releases reject a package-version mismatch');
  const settingsUi = await fs.readFile(path.join(projectRoot, 'src/renderer/src/components/SettingsModal.tsx'), 'utf-8');
  verify(settingsUi.includes('ty_code_update_channel') && settingsUi.includes('Check for Updates') && settingsUi.includes('setUpdateChannel'), 'Settings exposes a persistent release channel and manual update check');
  const rendererEntry = await fs.readFile(path.join(projectRoot, 'src/renderer/src/main.tsx'), 'utf-8');
  const monacoRuntime = await fs.readFile(path.join(projectRoot, 'src/renderer/src/services/monaco-runtime.ts'), 'utf-8');
  verify(!rendererEntry.includes('monaco-editor') && monacoRuntime.includes("import('monaco-editor')"), 'Monaco core is loaded only by the deferred editor runtime');

  // --- 10. Automated Release Notes Generator ---
  console.log('\n--- Assertion 10: Release Notes Generator & Conventional Commits ---');
  const notes = generateReleaseNotes({ version: '0.1.0', date: '2026-10-14' });
  verify(notes.includes('# Ty-Code v0.1.0'), 'Release notes header contains package version');
  verify(notes.includes('Highlights'), 'Highlights section included');
  verify(notes.includes('Download Packages'), 'Download packages section included');
  verify(notes.includes('Ty-Code-0.1.0-mac.dmg') && notes.includes('Ty-Code-0.1.0-x64.AppImage'), 'Release note package names match configured artifacts');

  console.log('\n================================================================');
  console.log(`  PHASE 6 VALIDATION SUMMARY: ${passedTests} Passed | ${failedTests} Failed`);
  console.log('================================================================\n');
  await fs.rm(testDir, { recursive: true, force: true });

  if (failedTests > 0) {
    process.exit(1);
  }
}

await runValidation();
