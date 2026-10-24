/**
 * Ty-Code Prompt Assembler Test Suite
 *
 * Covers:
 * - Compact variant tier derivation & AST parsing
 * - Deterministic degradation ladder ordering
 * - Telemetry ring buffer FIFO eviction
 * - Zod round-trip validation of AssemblyResult & AssemblyLayer
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveRoleTiers,
  parseRolePromptAST,
  rankRules,
  getRolePromptTier,
  tierTokens
} from '../src/main/agent/prompt-assembler/compact-variants';
import {
  assembleSystemPrompt,
  estimateTokens,
  invalidateAssemblyCache
} from '../src/main/agent/prompt-assembler/assembler';
import {
  recordAssembly,
  getAssemblyHistory,
  getAssemblyInfo,
  clearAssemblyHistory,
  assemblyEmitter,
  MAX_RING_CAPACITY
} from '../src/main/agent/prompt-assembler/telemetry-ring';
import {
  AssemblyResultSchema,
  AssemblyLayerSchema,
  type RolePreferences,
  type AssemblyResult
} from '../src/main/agent/prompt-assembler/schemas';

const TEST_PREFS: RolePreferences = {
  version: 1,
  defaultMode: 'BUILD',
  roleOverrides: { pin: [], ban: [], prefer: {} },
  tokenBudget: { systemPromptFraction: 0.12, maxRoles: 2 },
  questGate: { autoApproveMedium: false, requireApprovalFrom: 'Large' },
  conventions: { autoExtract: false, refreshOnHeadChange: false }
};

describe('Prompt Assembler: Compact Variant Derivation', () => {
  const samplePrompt = `## ROLE: TEST SPECIALIST
- General setup: run baseline test first.
- Strict constraint: NEVER bypass linting under any circumstances.
- Safety check: ALWAYS validate authentication tokens and secrets.
- Minor suggestion: keep formatting clean.
- Code coverage: ensure edge cases are tested.
VERIFY: execute test runner → assert 100% pass rate.`;

  it('parses header, rules, and verify block into AST', () => {
    const ast = parseRolePromptAST(samplePrompt);
    expect(ast.header).toBe('## ROLE: TEST SPECIALIST');
    expect(ast.rules).toHaveLength(5);
    expect(ast.verify).toContain('VERIFY: execute test runner');
  });

  it('ranks rules by constraint and safety signal scores with positional primacy', () => {
    const ast = parseRolePromptAST(samplePrompt);
    const ranked = rankRules(ast.rules, 3);
    expect(ranked).toHaveLength(3);
    // Should include NEVER rule and ALWAYS validate rule
    expect(ranked.some((r) => r.includes('NEVER bypass'))).toBe(true);
    expect(ranked.some((r) => r.includes('validate authentication'))).toBe(true);
  });

  it('preserves header and verify verbatim across all tiers', () => {
    const tiers = deriveRoleTiers(samplePrompt);
    const ast = parseRolePromptAST(samplePrompt);

    expect(tiers.FULL.prompt).toContain(ast.header);
    expect(tiers.COMPACT.prompt).toContain(ast.header);
    expect(tiers.MICRO.prompt).toContain(ast.header);

    expect(tiers.FULL.prompt).toContain(ast.verify);
    expect(tiers.COMPACT.prompt).toContain(ast.verify);
    expect(tiers.MICRO.prompt).toContain(ast.verify);
  });

  it('ensures token tier reduction: MICRO < COMPACT < FULL', () => {
    const tiers = deriveRoleTiers(samplePrompt);
    expect(tiers.MICRO.tokens).toBeLessThan(tiers.COMPACT.tokens);
    expect(tiers.COMPACT.tokens).toBeLessThan(tiers.FULL.tokens);
  });

  it('retrieves precomputed registry tiers cleanly', () => {
    const full = getRolePromptTier('frontend', 'FULL');
    const compact = getRolePromptTier('frontend', 'COMPACT');
    const micro = getRolePromptTier('frontend', 'MICRO');

    expect(full).toBeTruthy();
    expect(compact).toBeTruthy();
    expect(micro).toBeTruthy();

    expect(tierTokens('frontend', 'MICRO')).toBeLessThan(tierTokens('frontend', 'COMPACT'));
    expect(tierTokens('frontend', 'COMPACT')).toBeLessThan(tierTokens('frontend', 'FULL'));
  });
});

describe('Prompt Assembler: Degradation Ladder & Layer Population', () => {
  beforeEach(() => {
    invalidateAssemblyCache();
    clearAssemblyHistory();
  });

  it('assembles full layers without degradation when budget is ample', () => {
    const res = assembleSystemPrompt({
      taskId: 'task_ample_budget',
      userPrompt: 'Build a fullstack user authentication feature',
      activeFiles: ['src/ui.tsx', 'src/server.ts'],
      workspaceRoot: 'c:/test-repo',
      profile: null,
      modelLimitTokens: 100_000, // Budget = 12,000 tokens
      preferences: TEST_PREFS,
      envContext: { hasWorkspace: true, workspaceRoot: 'c:/test-repo', activeFiles: ['src/ui.tsx'] }
    });

    expect(res.degraded).toBe(false);
    expect(res.layers.length).toBeGreaterThan(3);
    expect(res.layers.every((l) => !l.dropped)).toBe(true);
    expect(res.pinnedSections).toEqual(['CORE', 'PROFILE']);
  });

  it('steps through degradation ladder when budget is severely constrained', () => {
    const res = assembleSystemPrompt({
      taskId: 'task_tight_budget',
      userPrompt: 'Build a fullstack UI feature with database queries and migrations',
      activeFiles: ['src/ui.tsx', 'src/db.sql'],
      workspaceRoot: 'c:/test-repo',
      profile: null,
      modelLimitTokens: 4_000, // Budget = 480 tokens (forces ladder steps)
      preferences: TEST_PREFS,
      envContext: { hasWorkspace: true, workspaceRoot: 'c:/test-repo', activeFiles: [] }
    });

    expect(res.degraded).toBe(true);
    // Confirm layers array tracks dropped items as ghost rows
    const droppedLayers = res.layers.filter((l) => l.dropped);
    expect(droppedLayers.length).toBeGreaterThan(0);

    // CORE and PROFILE must never be dropped
    const coreLayer = res.layers.find((l) => l.id === 'core');
    const profileLayer = res.layers.find((l) => l.id === 'profile');
    expect(coreLayer?.dropped).toBe(false);
    expect(profileLayer?.dropped).toBe(false);
  });
});

describe('Prompt Assembler: Telemetry Ring Buffer', () => {
  beforeEach(() => {
    clearAssemblyHistory();
  });

  it('records assembly and looks up by taskId', () => {
    const fakeResult: AssemblyResult = {
      taskId: 'task_test_123',
      timestamp: Date.now(),
      systemPrompt: 'System Prompt Content',
      pinnedSections: ['CORE', 'PROFILE'],
      roles: ['frontend'],
      mode: 'BUILD',
      taskClass: 'Small',
      tokenEstimate: 450,
      budget: 1000,
      degraded: false,
      assemblyMs: 2,
      cache: 'miss',
      layers: [
        {
          id: 'core',
          kind: 'core',
          label: 'CORE Directives',
          tokens: 200,
          pinned: true,
          dropped: false
        }
      ]
    };

    recordAssembly(fakeResult);
    const fetched = getAssemblyInfo('task_test_123');
    expect(fetched).not.toBeNull();
    expect(fetched?.taskId).toBe('task_test_123');
  });

  it('evicts FIFO when exceeding ring buffer capacity of 50', () => {
    for (let i = 0; i < 60; i++) {
      recordAssembly({
        taskId: `task_ring_${i}`,
        systemPrompt: 'prompt',
        pinnedSections: ['CORE'],
        roles: [],
        mode: 'BUILD',
        taskClass: 'Trivial',
        tokenEstimate: 100,
        budget: 500,
        degraded: false,
        assemblyMs: 1,
        cache: 'miss',
        layers: []
      });
    }

    const history = getAssemblyHistory();
    expect(history.length).toBe(MAX_RING_CAPACITY);
    // Oldest entries (0 to 9) should be evicted
    expect(getAssemblyInfo('task_ring_0')).toBeNull();
    // Most recent entries should exist
    expect(getAssemblyInfo('task_ring_59')).not.toBeNull();
  });

  it('broadcasts assembly events over assemblyEmitter', async () => {
    let captured: AssemblyResult | null = null;
    const listener = (res: AssemblyResult) => {
      captured = res;
    };
    assemblyEmitter.once('assembly', listener);

    const testItem: AssemblyResult = {
      taskId: 'task_event_check',
      systemPrompt: 'Test',
      pinnedSections: ['CORE'],
      roles: ['backend'],
      mode: 'BUILD',
      taskClass: 'Medium',
      tokenEstimate: 300,
      budget: 1000,
      degraded: false,
      assemblyMs: 3,
      cache: 'miss',
      layers: []
    };

    recordAssembly(testItem);
    expect(captured).not.toBeNull();
    expect((captured as any)?.taskId).toBe('task_event_check');
  });
});

describe('Prompt Assembler: Zod Schema Contracts', () => {
  it('validates AssemblyLayerSchema with full and ghost properties', () => {
    const activeLayer = AssemblyLayerSchema.parse({
      id: 'role_frontend',
      kind: 'role',
      label: 'ROLE: Frontend',
      tokens: 150,
      pinned: false,
      tier: 'COMPACT',
      scope: 'all',
      dropped: false
    });
    expect(activeLayer.tier).toBe('COMPACT');

    const ghostLayer = AssemblyLayerSchema.parse({
      id: 'role_review',
      kind: 'role',
      label: 'ROLE: Reviewer',
      tokens: 0,
      pinned: false,
      dropped: true,
      reason: 'budget: role #2 cut'
    });
    expect(ghostLayer.dropped).toBe(true);
    expect(ghostLayer.reason).toBe('budget: role #2 cut');
  });

  it('validates AssemblyResultSchema round-trip with layers', () => {
    const parsed = AssemblyResultSchema.parse({
      taskId: 'task_validation',
      systemPrompt: 'Full System Prompt',
      pinnedSections: ['CORE', 'PROFILE'],
      roles: ['fullstack'],
      mode: 'BUILD',
      taskClass: 'Medium',
      tokenEstimate: 650,
      budget: 1200,
      degraded: false,
      assemblyMs: 4,
      cache: 'miss',
      layers: [
        {
          id: 'core',
          kind: 'core',
          label: 'CORE',
          tokens: 300,
          pinned: true,
          dropped: false
        }
      ]
    });
    expect(parsed.layers).toHaveLength(1);
    expect(parsed.pinnedSections).toContain('CORE');
  });
});
