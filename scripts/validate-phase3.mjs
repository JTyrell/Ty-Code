import assert from 'assert';
import path from 'path';
import fs from 'fs/promises';
import os from 'os';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.env.GIT_AUTHOR_NAME = 'Ty-Claude Test';
process.env.GIT_AUTHOR_EMAIL = 'ty-claude-test@example.invalid';
process.env.GIT_COMMITTER_NAME = 'Ty-Claude Test';
process.env.GIT_COMMITTER_EMAIL = 'ty-claude-test@example.invalid';
const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-claude-phase3-'));
const bundleDir = path.join(testDir, 'bundle');
await fs.mkdir(bundleDir, { recursive: true });

// Bundle with esbuild for CJS runtime
const bundleConfig = (entry, outfile) => build({
  entryPoints: [path.join(projectRoot, entry)],
  outfile: path.join(bundleDir, outfile),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron', 'node-pty'],
  logLevel: 'silent'
});

await Promise.all([
  bundleConfig('src/main/services/git-service.ts', 'git-service.cjs'),
  bundleConfig('src/main/agent/tool-executor.ts', 'tool-executor.cjs')
]);

const { gitService } = require(path.join(bundleDir, 'git-service.cjs'));
const { ToolExecutor } = require(path.join(bundleDir, 'tool-executor.cjs'));

async function runPhase3Validation() {
  console.log('\n======================================================');
  console.log('  TY-CLAUDE PHASE 3: GIT & SOURCE CONTROL VALIDATION');
  console.log('======================================================\n');

  const repoDir = path.join(testDir, 'repo');
  await fs.mkdir(repoDir, { recursive: true });
  console.log(`[TEST-ENV] Isolated Git Workspace: ${repoDir}`);

  // 1. Repo Detection & Initialization
  console.log('\n--- Assertion 1: Git Repository Detection & Init ---');
  const isRepoBefore = await gitService.isRepo(repoDir);
  assert.strictEqual(isRepoBefore, false, 'Expected fresh folder to NOT be a Git repo yet');
  console.log('✓ Verified non-repo detection');

  await gitService.init(repoDir);
  const isRepoAfter = await gitService.isRepo(repoDir);
  assert.strictEqual(isRepoAfter, true, 'Expected folder to be a Git repo after gitService.init()');
  console.log('✓ Successfully initialized Git repo');

  // 2. Status Tracking (Untracked Files)
  console.log('\n--- Assertion 2: Status Tracking & Untracked Files ---');
  const readmePath = path.join(repoDir, 'README.md');
  await fs.writeFile(readmePath, '# Ty-Claude Phase 3 Repo\nInitial content\n', 'utf-8');

  const status1 = await gitService.getStatus(repoDir);
  assert.strictEqual(status1.isRepo, true, 'Repository status isRepo should be true');
  assert.strictEqual(status1.untrackedFiles.length, 1, 'Expected 1 untracked file');
  assert.strictEqual(status1.untrackedFiles[0].path, 'README.md', 'Expected README.md to be untracked');
  console.log(`✓ Detected untracked file: ${status1.untrackedFiles[0].path}`);

  // 3. Staging and Committing
  console.log('\n--- Assertion 3: Staging and Initial Commit ---');
  await gitService.stage(repoDir, 'README.md');
  const status2 = await gitService.getStatus(repoDir);
  assert.strictEqual(status2.stagedFiles.length, 1, 'Expected 1 staged file');
  assert.strictEqual(status2.stagedFiles[0].path, 'README.md', 'Expected README.md to be staged');
  console.log(`✓ Staged file verified: ${status2.stagedFiles[0].path}`);

  const commitHash = await gitService.commit(repoDir, 'feat: initial commit for phase 3');
  assert.ok(commitHash, 'Commit should return a commit hash');
  console.log(`✓ Created commit: ${commitHash}`);

  const statusAfterCommit = await gitService.getStatus(repoDir);
  assert.strictEqual(statusAfterCommit.isClean, true, 'Working tree should be clean after commit');
  console.log('✓ Working tree clean verified');

  // 4. File Modification & Diff Generation
  console.log('\n--- Assertion 4: Modification & Unified Diff Generation ---');
  await fs.appendFile(readmePath, 'Additional line for diff testing\n', 'utf-8');
  const status3 = await gitService.getStatus(repoDir);
  assert.strictEqual(status3.unstagedFiles.length, 1, 'Expected 1 modified file');
  assert.strictEqual(status3.unstagedFiles[0].path, 'README.md', 'Expected README.md to be modified');
  console.log('✓ Detected modified file in working tree');

  const diff = await gitService.getDiff(repoDir, 'README.md');
  assert.ok(diff.includes('+Additional line for diff testing'), 'Diff output should contain added line');
  console.log('✓ Unified diff generated successfully:\n' + diff.trim());

  console.log('\n--- Assertion 5: Status mapping, diff content, and path containment ---');
  await gitService.stage(repoDir, 'README.md');
  const stagedStatus = await gitService.getStatus(repoDir);
  assert.strictEqual(stagedStatus.stagedFiles[0].status, 'M', 'Staged modification must be reported as M, not A');
  const stagedDiff = await gitService.getFileDiff(repoDir, 'README.md', true);
  assert.ok(stagedDiff.originalContent.includes('Initial content'), 'Staged diff original must contain HEAD content');
  assert.ok(stagedDiff.modifiedContent.includes('Additional line for diff testing'), 'Staged diff modified content must contain index content');
  await fs.appendFile(readmePath, 'Unstaged follow-up\n', 'utf-8');
  const unstagedDiff = await gitService.getFileDiff(repoDir, 'README.md', false);
  assert.ok(unstagedDiff.originalContent.includes('Additional line for diff testing'), 'Unstaged diff original must contain index content');
  assert.ok(unstagedDiff.modifiedContent.includes('Unstaged follow-up'), 'Unstaged diff modified content must contain working tree content');
  const outsideSentinel = path.join(testDir, 'outside-sentinel.txt');
  await fs.writeFile(outsideSentinel, 'must survive', 'utf-8');
  await assert.rejects(() => gitService.discardChanges(repoDir, '../outside-sentinel.txt', true), /outside|repository|workspace/i);
  assert.strictEqual(await fs.readFile(outsideSentinel, 'utf-8'), 'must survive', 'Out-of-workspace discard must not delete the sentinel');
  await assert.rejects(() => gitService.createBranch(repoDir, '--orphan'), /valid branch|invalid|branch/i);
  console.log('✓ Correct staged/unstaged content, status codes, containment, and ref validation');

  // 6. Branch Management (Create, List, Switch)
  console.log('\n--- Assertion 5: Branch Creation and Switching ---');
  await gitService.createBranch(repoDir, 'feature/source-control');
  const branches = await gitService.getBranches(repoDir);
  assert.ok(branches.all.includes('feature/source-control'), 'Branch list should include new branch');
  assert.strictEqual(branches.current, 'feature/source-control', 'Current branch should be feature/source-control');
  console.log(`✓ Created and switched to branch: ${branches.current}`);

  // Commit on feature branch
  await gitService.stage(repoDir, '.');
  await gitService.commit(repoDir, 'feat(ui): add source control sidebar');
  console.log('✓ Committed on feature branch');

  // 7. Commit History Viewer
  console.log('\n--- Assertion 7: Commit Log Verification ---');
  const logs = await gitService.getLog(repoDir, 10);
  assert.strictEqual(logs.length, 2, 'Expected 2 commits in log');
  assert.ok(logs[0].message.includes('feat(ui): add source control sidebar'), 'Latest commit message match');
  console.log(`✓ Verified ${logs.length} commits in history:`);
  logs.forEach((l) => console.log(`   [${l.shortHash}] ${l.message}`));

  console.log('\n--- Assertion 8: History detail, tags, stashes, and hunks ---');
  const detail = await gitService.getCommitDetail(repoDir, logs[0].hash);
  assert.strictEqual(detail.commit.hash, logs[0].hash, 'Commit detail should resolve the requested SHA');
  assert.ok(detail.files.some((file) => file.path === 'README.md'), 'Commit detail should include changed paths');
  await gitService.createTag(repoDir, 'validation-v1', 'phase 3 validation tag');
  assert.ok((await gitService.getTags(repoDir)).some((tag) => tag.name === 'validation-v1'), 'Created tag should be listed');
  await gitService.deleteTag(repoDir, 'validation-v1');

  const stashFile = path.join(repoDir, 'stash-test.txt');
  await fs.writeFile(stashFile, 'base\n', 'utf-8');
  await gitService.stage(repoDir, 'stash-test.txt');
  await gitService.commit(repoDir, 'test(git): add stash fixture');
  await fs.appendFile(stashFile, 'stashed line\n', 'utf-8');
  await gitService.stash(repoDir, 'save', 'phase 3 stash test');
  const stashes = await gitService.stash(repoDir, 'list');
  assert.ok(Array.isArray(stashes) && stashes.length === 1, 'Stash list should include saved stash');
  await gitService.stash(repoDir, 'pop', undefined, 0);
  assert.ok((await fs.readFile(stashFile, 'utf-8')).includes('stashed line'), 'Popping a stash should restore working changes');
  await gitService.discardChanges(repoDir, 'stash-test.txt');

  const hunkFile = path.join(repoDir, 'hunk-test.txt');
  const hunkBase = Array.from({ length: 18 }, (_, index) => `line ${index + 1}`).join('\n') + '\n';
  await fs.writeFile(hunkFile, hunkBase, 'utf-8');
  await gitService.stage(repoDir, 'hunk-test.txt');
  await gitService.commit(repoDir, 'test(git): add hunk fixture');
  const hunkChanged = hunkBase.replace('line 2\n', 'line 2 changed\n').replace('line 16\n', 'line 16 changed\n');
  await fs.writeFile(hunkFile, hunkChanged, 'utf-8');
  const hunks = await gitService.getHunks(repoDir, 'hunk-test.txt');
  assert.strictEqual(hunks.length, 2, 'Separated modifications should generate two independently reviewable hunks');
  await gitService.applyHunk(repoDir, 'hunk-test.txt', hunks[0].id, 'stage');
  const partialIndex = await gitService.getDiff(repoDir, 'hunk-test.txt', true);
  assert.ok(partialIndex.includes('line 2 changed') && !partialIndex.includes('line 16 changed'), 'Stage hunk should add only selected lines to index');
  const stagedHunks = await gitService.getHunks(repoDir, 'hunk-test.txt', true);
  await gitService.applyHunk(repoDir, 'hunk-test.txt', stagedHunks[0].id, 'unstage');
  const unstagedHunks = await gitService.getHunks(repoDir, 'hunk-test.txt');
  await gitService.applyHunk(repoDir, 'hunk-test.txt', unstagedHunks[0].id, 'revert');
  const hunkAfterRevert = await fs.readFile(hunkFile, 'utf-8');
  assert.ok(!hunkAfterRevert.includes('line 2 changed') && hunkAfterRevert.includes('line 16 changed'), 'Revert hunk should preserve unrelated working-tree hunks');
  await gitService.discardChanges(repoDir, 'hunk-test.txt');
  console.log('✓ Commit detail, tag lifecycle, stash restore, and independent hunk operations');

  // 9. AI Agent Git Tools Integration
  console.log('\n--- Assertion 9: AI Agent Tools Execution (ToolExecutor) ---');
  const toolExecutor = new ToolExecutor(repoDir);

  // AI Tool: git_status
  console.log('Testing AI tool: git_status…');
  const aiStatusRes = await toolExecutor.execute('git_status', {});
  assert.strictEqual(aiStatusRes.isError, undefined, 'git_status should execute without error');
  assert.ok(aiStatusRes.output.includes('feature/source-control'), 'Output should contain active branch name');
  console.log('✓ AI tool git_status passed');

  // Create a new file for AI to stage and commit
  const newScript = path.join(repoDir, 'script.js');
  await fs.writeFile(newScript, 'console.log("AI Git integration working!");\n', 'utf-8');

  // AI Tool: git_diff
  console.log('Testing AI tool: git_diff…');
  const aiDiffRes = await toolExecutor.execute('git_diff', {});
  assert.strictEqual(aiDiffRes.isError, undefined, 'git_diff should execute without error');
  console.log('✓ AI tool git_diff passed');

  // AI Tool: git_commit
  console.log('Testing AI tool: git_commit…');
  const aiCommitRes = await toolExecutor.execute('git_commit', {
    message: 'feat(agent): automated commit via AI agent',
    stageAll: true
  });
  assert.strictEqual(aiCommitRes.isError, undefined, 'git_commit should execute without error');
  assert.ok(aiCommitRes.output.includes('Successfully created Git commit'), 'Commit output should confirm success');
  console.log('✓ AI tool git_commit passed');

  // AI Tool: git_branch
  console.log('Testing AI tool: git_branch (list)…');
  const aiBranchListRes = await toolExecutor.execute('git_branch', { action: 'list' });
  assert.strictEqual(aiBranchListRes.isError, undefined, 'git_branch list should succeed');
  assert.ok(aiBranchListRes.output.includes('feature/source-control'), 'Branch list output should contain branch');
  console.log('✓ AI tool git_branch passed');

  // AI Tool: git_log
  console.log('Testing AI tool: git_log…');
  const aiLogRes = await toolExecutor.execute('git_log', { maxCount: 5 });
  assert.strictEqual(aiLogRes.isError, undefined, 'git_log should succeed');
  assert.ok(aiLogRes.output.includes('automated commit via AI agent'), 'Log output should include agent commit');
  console.log('✓ AI tool git_log passed');

  console.log('\n======================================================');
  console.log('  ALL PHASE 3 VALIDATION ASSERTIONS PASSED (100%)');
  console.log('======================================================\n');
}

try {
  await runPhase3Validation();
} finally {
  await fs.rm(testDir, { recursive: true, force: true }).catch(() => undefined);
}
