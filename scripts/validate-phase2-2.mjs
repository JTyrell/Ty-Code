import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-phase2-2-'));
const bundleDir = path.join(testDir, 'bundle');
const workspace = path.join(testDir, 'workspace');
const outside = path.join(testDir, 'outside.txt');
await fs.mkdir(bundleDir, { recursive: true });
await fs.mkdir(workspace, { recursive: true });
await fs.writeFile(outside, 'outside boundary\n', 'utf8');

try {
  await build({
    entryPoints: [
      path.join(projectRoot, 'src/main/services/settings-manager.ts'),
      path.join(projectRoot, 'src/main/services/security-policy.ts')
    ],
    outdir: bundleDir,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    logLevel: 'silent'
  });

  const { SettingsManager } = require(path.join(bundleDir, 'settings-manager.js'));
  const SETTINGS_SCHEMA_VERSION = 2;
  const { SecurityPolicyEngine } = require(path.join(bundleDir, 'security-policy.js'));
  let passed = 0;
  let failed = 0;
  const verify = (condition, message) => {
    console.log(`  ${condition ? 'PASS' : 'FAIL'}: ${message}`);
    if (condition) passed++;
    else failed++;
  };

  console.log('Ty-Code Phase 2.2: Settings and Security Policy Validation');
  const globalFile = path.join(testDir, 'global', 'settings.json');
  await fs.mkdir(path.dirname(globalFile), { recursive: true });
  await fs.writeFile(globalFile, JSON.stringify({
    schemaVersion: 1,
    activeProvider: 'openrouter',
    activeModel: 'migration-test-model',
    security: { terminalPolicy: 'always-ask' }
  }), 'utf8');

  const manager = new SettingsManager({ globalSettingsPath: globalFile, workspacePath: workspace, watchFiles: false });
  let settings = await manager.getEffectiveSettings();
  verify(settings.activeModel === 'migration-test-model', 'Legacy settings retain existing values during migration');
  verify(settings.security.fileAccessPolicy === 'workspace-only' && settings.security.systemAccessConfirmed === false, 'Missing security fields migrate to conservative defaults');
  const migratedDocument = JSON.parse(await fs.readFile(globalFile, 'utf8'));
  verify(migratedDocument.schemaVersion === SETTINGS_SCHEMA_VERSION, 'Global settings schema version upgrades on load');

  await manager.saveLayer('workspace', { activeModel: 'workspace-model' });
  settings = await manager.getEffectiveSettings();
  verify(settings.activeModel === 'workspace-model', 'Workspace settings override global model preferences');
  verify(settings.apiKeys && Object.keys(settings.apiKeys).length === 0, 'Workspace layer cannot replace global credentials');

  let invalidRejected = false;
  try { await manager.saveLayer('global', { temperature: 9 }); }
  catch { invalidRejected = true; }
  verify(invalidRejected, 'Invalid settings are rejected by Zod validation');

  await manager.saveLayer('workspace', { security: { terminalPolicy: 'always-proceed', fileAccessPolicy: 'system-access' } });
  settings = await manager.getEffectiveSettings();
  verify(settings.security.terminalPolicy === 'always-ask', 'Workspace settings cannot weaken a stricter global terminal policy');
  verify(settings.security.fileAccessPolicy === 'workspace-only', 'Workspace files cannot enable system-wide file access');

  await manager.saveLayer('global', { security: { terminalPolicy: 'restricted' } });
  settings = await manager.getEffectiveSettings();
  verify(settings.security.terminalPolicy === 'restricted', 'Global restricted policy remains the workspace terminal ceiling');
  const policy = new SecurityPolicyEngine(workspace, manager);
  let outsideBlocked = false;
  try { await policy.resolveFilePath(outside); }
  catch (error) { outsideBlocked = String(error).includes('outside workspace'); }
  verify(outsideBlocked, 'Workspace-only policy denies absolute paths outside the project');

  const safeCommand = await policy.evaluateTerminalCommand('git status --short');
  const unsafeCommand = await policy.evaluateTerminalCommand('rm -rf ../outside');
  verify(safeCommand.decision === 'allow', 'Restricted Mode auto-approves safe git status');
  verify(unsafeCommand.decision === 'block', 'Workspace boundary blocks destructive commands targeting parent paths');
  const unknownCommand = await policy.evaluateTerminalCommand('npm test');
  verify(unknownCommand.decision === 'ask', 'Restricted Mode asks before commands outside its safe allowlist');

  await manager.saveLayer('global', {
    security: {
      terminalPolicy: 'restricted',
      fileAccessPolicy: 'system-access',
      systemAccessConfirmed: true,
      reviewPolicy: 'always-ask'
    }
  });
  settings = await manager.getEffectiveSettings();
  verify(settings.security.fileAccessPolicy === 'system-access' && settings.security.systemAccessConfirmed, 'Explicit global confirmation enables System Access');
  verify(await policy.resolveFilePath(outside) === outside, 'Confirmed System Access permits an absolute path outside the workspace');

  await manager.saveLayer('global', { security: { reviewPolicy: 'auto-apply-safe' } });
  const small = await policy.evaluateFileMutation({
    filePath: 'small.txt', originalContent: 'one\ntwo\n', proposedContent: 'one\nTWO\n', addedLines: 1, removedLines: 1,
    originalExists: true, originalHash: 'fixture'
  });
  const large = await policy.evaluateFileMutation({
    filePath: 'large.txt', originalContent: '', proposedContent: '', addedLines: 3, removedLines: 2,
    originalExists: false, originalHash: 'fixture'
  });
  verify(small.decision === 'allow', 'Auto-Apply Safe allows changes under five lines');
  verify(large.decision === 'ask', 'Auto-Apply Safe asks for changes of five or more lines');

  const watcherFile = path.join(testDir, 'watch', 'settings.json');
  const watcherWorkspace = path.join(testDir, 'watch-workspace');
  await fs.mkdir(watcherWorkspace, { recursive: true });
  const watcher = new SettingsManager({ globalSettingsPath: watcherFile, workspacePath: watcherWorkspace, watchFiles: true });
  await watcher.getEffectiveSettings();
  await fs.mkdir(path.dirname(watcherFile), { recursive: true });
  await fs.writeFile(watcherFile, JSON.stringify({ schemaVersion: SETTINGS_SCHEMA_VERSION, activeModel: 'hot-reloaded-model' }), 'utf8');
  let afterReload = await watcher.getEffectiveSettings();
  for (let attempt = 0; attempt < 20 && afterReload.activeModel !== 'hot-reloaded-model'; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    afterReload = await watcher.getEffectiveSettings();
  }
  verify(afterReload.activeModel === 'hot-reloaded-model', 'External file edits hot-reload without application restart');
  watcher.dispose();
  manager.dispose();

  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exitCode = 1;
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await fs.rm(testDir, { recursive: true, force: true });
}
