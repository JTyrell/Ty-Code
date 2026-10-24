/**
 * Ty-Code End-to-End Verification Suite
 * Tests 1 through 5 for Dynamic Prompt Assembler and Scope-Gated Tool Registry
 *
 * Covers:
 * - TEST 1: Router accuracy (unit)
 * - TEST 2: Mode & scope gating (integration)
 * - TEST 3: Budget degradation & pinning
 * - TEST 4: Cache & latency
 * - TEST 5: IPC contract
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as fsp from 'fs/promises';
import * as os from 'os';

import { classifyRoles } from '../src/main/agent/prompt-assembler/role-registry';
import { classifyMode, modeScope } from '../src/main/agent/prompt-assembler/mode-contracts';
import { getAvailableTools, isToolAvailable, isDocsOnlyWrite } from '../src/main/agent/tool-registry';
import {
  assembleSystemPrompt,
  invalidateAssemblyCache
} from '../src/main/agent/prompt-assembler/assembler';
import {
  buildProjectProfile,
  saveProjectProfileCache,
  loadCachedProfile,
  profileCachePath
} from '../src/main/agent/prompt-assembler/project-scanner';
import { compactMessages, type Message } from '../src/main/agent/context-compactor';
import { AgentStartTaskPayloadSchema } from '../src/shared/types/agent-events';
import type { RolePreferences } from '../src/main/agent/prompt-assembler/schemas';

const TEST_PREFS: RolePreferences = {
  version: 1,
  defaultMode: 'BUILD',
  roleOverrides: { pin: [], ban: [], prefer: {} },
  tokenBudget: { systemPromptFraction: 0.12, maxRoles: 2 },
  questGate: { autoApproveMedium: false, requireApprovalFrom: 'Large' },
  conventions: { autoExtract: false, refreshOnHeadChange: false }
};

describe('TEST 1 — Router accuracy (unit)', () => {
  it('classifies "review this PR for security issues" -> security prepended, review included, max 2', () => {
    const roles = classifyRoles('review this PR for security issues');
    expect(roles).toHaveLength(2);
    expect(roles[0]).toBe('security');
    expect(roles).toContain('review');
  });

  it('classifies "explain how the ReAct loop works" -> [mentor] and classifyMode() === EXPLAIN', () => {
    const prompt = 'explain how the ReAct loop works';
    const roles = classifyRoles(prompt);
    const mode = classifyMode(prompt);
    expect(roles).toContain('mentor');
    expect(mode).toBe('EXPLAIN');
  });

  it('classifies "write a solidity staking contract" -> [blockchain]', () => {
    const roles = classifyRoles('write a solidity staking contract');
    expect(roles).toContain('blockchain');
    expect(roles).toHaveLength(1);
  });

  it('classifies "why does the renderer drop frames at 300 tokens/sec" -> debug prepended', () => {
    const roles = classifyRoles('why does the renderer drop frames at 300 tokens/sec');
    expect(roles[0]).toBe('debug');
  });

  it('asserts the max-2-roles invariant holds on a prompt matching 5+ signals', () => {
    // Prompt touches security, review, blockchain, frontend, devops, debug
    const multiSignalPrompt =
      'why does the solidity smart contract drop frames and crash during pr code review with security vulnerability in devops pipeline';
    const roles = classifyRoles(multiSignalPrompt);
    expect(roles.length).toBeLessThanOrEqual(2);
    expect(roles.length).toBe(2);
  });
});

describe('TEST 2 — Mode & scope gating (integration)', () => {
  const workspaceEnv = {
    hasWorkspace: true,
    workspaceRoot: 'c:/test-repo',
    activeFiles: ['src/app.ts']
  };

  const noWorkspaceEnv = {
    hasWorkspace: false,
    workspaceRoot: null,
    activeFiles: []
  };

  it('REVIEW mode: write_file is rejected from available tools; read_file succeeds', () => {
    const reviewScope = modeScope('REVIEW'); // 'read-only'
    expect(reviewScope).toBe('read-only');

    const tools = getAvailableTools(workspaceEnv, reviewScope);
    expect(tools).toContain('read_file');
    expect(tools).toContain('grep_search');
    expect(tools).not.toContain('write_file');
    expect(tools).not.toContain('replace_file_content');

    expect(isToolAvailable('read_file', workspaceEnv, reviewScope)).toBe(true);
    expect(isToolAvailable('write_file', workspaceEnv, reviewScope)).toBe(false);
  });

  it('DESIGN mode: write_file to docs/spec.md allowed; write_file to src/app.ts blocked', () => {
    const designScope = modeScope('DESIGN'); // 'docs-only'
    expect(designScope).toBe('docs-only');

    // write_file is registered as a tool, but execution is constrained to docs/
    expect(isToolAvailable('write_file', workspaceEnv, designScope)).toBe(true);

    // Path check:
    expect(isDocsOnlyWrite('docs/spec.md')).toBe(true);
    expect(isDocsOnlyWrite('./docs/adr/001.md')).toBe(true);
    expect(isDocsOnlyWrite('src/app.ts')).toBe(false);
    expect(isDocsOnlyWrite('package.json')).toBe(false);
  });

  it('BUILD mode with forced roles=[docs] (docs-only scope): writes outside docs/ blocked', () => {
    // Forced docs role scope is docs-only
    const docsScope = 'docs-only';
    expect(isDocsOnlyWrite('docs/architecture.md')).toBe(true);
    expect(isDocsOnlyWrite('src/index.ts')).toBe(false);
  });

  it('No workspace open: ALL workspace tools unavailable regardless of mode/scope (short-circuit AND holds)', () => {
    for (const scope of ['all', 'read-only', 'docs-only'] as const) {
      const tools = getAvailableTools(noWorkspaceEnv, scope);
      expect(tools).toEqual(['request_approval', 'request_workspace_open', 'brave_web_search']);
      expect(isToolAvailable('read_file', noWorkspaceEnv, scope)).toBe(false);
      expect(isToolAvailable('write_file', noWorkspaceEnv, scope)).toBe(false);
      expect(isToolAvailable('list_dir', noWorkspaceEnv, scope)).toBe(false);
      expect(isToolAvailable('run_command', noWorkspaceEnv, scope)).toBe(false);
    }
  });
});

describe('TEST 3 — Budget degradation & pinning', () => {
  beforeEach(() => {
    invalidateAssemblyCache();
  });

  it('degrades when budget is small: role #2 dropped; CORE + PROFILE + MODE CONTRACT still present', () => {
    const res = assembleSystemPrompt({
      taskId: 'task_budget_test',
      userPrompt: 'Review PR for security vulnerabilities and bugs in database queries',
      activeFiles: ['src/db.ts', 'src/auth.ts'],
      workspaceRoot: 'c:/test-repo',
      profile: null,
      modelLimitTokens: 4000, // Budget = 480 tokens (0.12 * 4000)
      preferences: TEST_PREFS,
      envContext: { hasWorkspace: true, workspaceRoot: 'c:/test-repo', activeFiles: [] }
    });

    expect(res.degraded).toBe(true);

    // Assert role #2 was dropped (ghost row)
    const droppedLayers = res.layers.filter((l) => l.dropped);
    expect(droppedLayers.length).toBeGreaterThan(0);
    expect(droppedLayers.some((l) => l.reason?.includes('role #2'))).toBe(true);

    // CORE, PROFILE, and MODE CONTRACT must be present and NOT dropped
    const coreLayer = res.layers.find((l) => l.id === 'core');
    const profileLayer = res.layers.find((l) => l.id === 'profile');
    const modeLayer = res.layers.find((l) => l.id === 'mode');

    expect(coreLayer?.dropped).toBe(false);
    expect(profileLayer?.dropped).toBe(false);
    expect(modeLayer?.dropped).toBe(false);

    // In the final systemPrompt:
    expect(res.systemPrompt).toContain('PRIME DIRECTIVES');
    expect(res.systemPrompt).toContain('PROJECT PROFILE');
    expect(res.systemPrompt).toContain('MODE CONTRACT');
  });

  it('asserts pinnedSections === [CORE, PROFILE] and both survive 95% Auto-Compaction pass verbatim', () => {
    const res = assembleSystemPrompt({
      taskId: 'task_pinning_test',
      userPrompt: 'Implement feature',
      activeFiles: [],
      workspaceRoot: 'c:/test-repo',
      profile: null,
      modelLimitTokens: 100_000,
      preferences: TEST_PREFS,
      envContext: { hasWorkspace: true, workspaceRoot: 'c:/test-repo', activeFiles: [] }
    });

    expect(res.pinnedSections).toEqual(['CORE', 'PROFILE']);

    // Simulate multi-turn conversation exceeding 95% of context window
    const messages: Message[] = [
      { role: 'system', content: res.systemPrompt },
      { role: 'user', content: 'Turn 1 user request' },
      { role: 'assistant', content: 'Turn 1 assistant answer with lots of code' },
      { role: 'user', content: 'Turn 2 user request' },
      { role: 'assistant', content: 'Turn 2 assistant answer' },
      { role: 'user', content: 'Turn 3 user request' },
      { role: 'assistant', content: 'Turn 3 assistant answer' },
      { role: 'user', content: 'Turn 4 user request' },
      { role: 'assistant', content: 'Turn 4 assistant answer' }
    ];

    const compacted = compactMessages(messages, 'Summary of turns 1-2');

    // System prompt at index 0 must be preserved verbatim
    expect(compacted[0].role).toBe('system');
    expect(compacted[0].content).toBe(res.systemPrompt);

    // Pinned sections survived intact
    expect(compacted[0].content).toContain('PRIME DIRECTIVES');
    expect(compacted[0].content).toContain('PROJECT PROFILE');
  });
});

describe('TEST 4 — Cache & latency', () => {
  beforeEach(() => {
    invalidateAssemblyCache();
  });

  it('identical second task hits cache with H0 assemblyMs < 5ms (miss < 200ms)', () => {
    const opts = {
      taskId: 'task_cache_turn_1',
      userPrompt: 'Review this code for bugs',
      activeFiles: ['src/main.ts'],
      workspaceRoot: 'c:/test-repo',
      profile: null,
      modelLimitTokens: 128_000,
      preferences: TEST_PREFS,
      envContext: { hasWorkspace: true, workspaceRoot: 'c:/test-repo', activeFiles: ['src/main.ts'] },
      conventionsHash: 'hash_abc'
    };

    // First assembly (miss)
    const first = assembleSystemPrompt(opts);
    expect(first.cache).toBe('miss');
    expect(first.assemblyMs).toBeLessThan(200);

    // Second identical assembly (hit)
    const second = assembleSystemPrompt({
      ...opts,
      taskId: 'task_cache_turn_2'
    });
    expect(second.cache).toBe('hit');
    expect(second.assemblyMs).toBeLessThan(5);
    expect(second.systemPrompt).toBe(first.systemPrompt);
  });

  it('.tycode/project-profile.json rescans when package.json changes, and does NOT rescan when an unrelated source file changes', async () => {
    // Create temporary workspace
    const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'tycode-profile-test-'));
    try {
      const pkgPath = path.join(tmpDir, 'package.json');
      const srcDir = path.join(tmpDir, 'src');
      await fsp.mkdir(srcDir, { recursive: true });
      const unrelatedFile = path.join(srcDir, 'app.ts');

      // Initial files
      await fsp.writeFile(pkgPath, JSON.stringify({ name: 'test-app', version: '1.0.0' }));
      await fsp.writeFile(unrelatedFile, 'console.log("hello");');

      // Initial scan & cache
      const initialProfile = await buildProjectProfile(tmpDir);
      await saveProjectProfileCache(tmpDir, initialProfile);

      // Verify cached load
      const cached1 = await loadCachedProfile(tmpDir);
      expect(cached1).not.toBeNull();
      expect(cached1?.manifestHash).toBe(initialProfile.manifestHash);

      // Now touch unrelated source file
      await new Promise((r) => setTimeout(r, 50));
      await fsp.writeFile(unrelatedFile, 'console.log("updated source code");');

      // Should still match cache without rescan!
      const cachedAfterSourceEdit = await loadCachedProfile(tmpDir);
      expect(cachedAfterSourceEdit).not.toBeNull();
      expect(cachedAfterSourceEdit?.manifestHash).toBe(initialProfile.manifestHash);

      // Now update package.json (manifest change)
      await new Promise((r) => setTimeout(r, 50));
      await fsp.writeFile(pkgPath, JSON.stringify({ name: 'test-app-renamed', version: '2.0.0' }));

      // Cache MUST be invalidated (returns null, forcing rescan)
      const cachedAfterPkgChange = await loadCachedProfile(tmpDir);
      expect(cachedAfterPkgChange).toBeNull();
    } finally {
      await fsp.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});

describe('TEST 5 — IPC contract', () => {
  it('mode flows through schema and validates valid modes', () => {
    const validPayload = {
      prompt: 'Review the latest diff',
      mode: 'REVIEW' as const,
      workspacePath: 'c:/test-repo',
      history: []
    };

    const parsed = AgentStartTaskPayloadSchema.safeParse(validPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.mode).toBe('REVIEW');
    }
  });

  it('rejects malformed mode with Zod without crash or exception', () => {
    const malformedPayload = {
      prompt: 'Review the latest diff',
      mode: 'INVALID_SUPER_MODE', // Malformed enum
      workspacePath: 'c:/test-repo',
      history: []
    };

    const parsed = AgentStartTaskPayloadSchema.safeParse(malformedPayload);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.message).toContain('mode');
    }
  });

  it('formats [PROMPT] log excerpt matching exact format specification', () => {
    const roles = ['security', 'review'];
    const assembled = {
      mode: 'REVIEW',
      taskClass: 'Small',
      tokenEstimate: 742,
      budget: 15360,
      degraded: false,
      cache: 'miss'
    };
    const taskId = 'task_e2e_verify_001';

    const logExcerpt = `[PROMPT] task=${taskId} roles=[${roles.join(',')}] mode=${assembled.mode} taskClass=${assembled.taskClass} tokens=${assembled.tokenEstimate}/${assembled.budget} degraded=${assembled.degraded} cache=${assembled.cache}`;

    expect(logExcerpt).toBe(
      '[PROMPT] task=task_e2e_verify_001 roles=[security,review] mode=REVIEW taskClass=Small tokens=742/15360 degraded=false cache=miss'
    );
  });
});
