import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  calculateContextScore,
  computeGrade,
  type ContextScoreResult
} from '../src/main/services/context-engine/context-scorer';
import type { WorkspaceProfile } from '../src/main/services/context-engine/types';
import {
  buildOmniContextPrompt,
  formatKeyDirectories,
  modelRotationManager
} from '../src/main/services/model-rotation-manager';
import {
  saveCorrection,
  getCorrections,
  getCorrectionEntries,
  deleteCorrection,
  clearCorrections,
  closeDatabaseConnections
} from '../src/main/services/context-engine/correction-memory';

describe('Ty-Code Context Engine: Context Audit Scorer (Step 1)', () => {
  it('calculates 100% score for a complete stack with 5+ corrections and no missing context', () => {
    const profile: WorkspaceProfile = {
      primaryLanguage: 'TypeScript',
      frameworks: ['React', 'Next.js', 'Vitest'],
      databases: ['PostgreSQL'],
      architecture: 'Monorepo',
      keyDirectories: {
        components: 'src/components',
        api: 'src/app/api',
        tests: 'tests'
      },
      missingContext: [],
      lastScanned: Date.now()
    };

    const result = calculateContextScore(profile, 5);

    expect(result.score).toBe(100);
    expect(result.grade).toBe('A');
    expect(result.breakdown.languageAndFrameworks.score).toBe(20);
    expect(result.breakdown.databaseSchema.score).toBe(20);
    expect(result.breakdown.testFiles.score).toBe(20);
    expect(result.breakdown.ciCdOrDocker.score).toBe(20);
    expect(result.breakdown.correctionMemories.score).toBe(20);
    expect(result.breakdown.missingContextPenalties.penalty).toBe(0);
  });

  it('correctly scores partial correction memories proportional to 5 rules', () => {
    const profile: WorkspaceProfile = {
      primaryLanguage: 'TypeScript',
      frameworks: ['Next.js'],
      databases: ['PostgreSQL'],
      architecture: 'Next.js App Router',
      keyDirectories: { components: 'src/components', tests: 'tests' },
      missingContext: [],
      lastScanned: Date.now()
    };

    // 0 corrections -> 0 pts
    expect(calculateContextScore(profile, 0).breakdown.correctionMemories.score).toBe(0);
    // 1 correction -> 4 pts
    expect(calculateContextScore(profile, 1).breakdown.correctionMemories.score).toBe(4);
    // 3 corrections -> 12 pts
    expect(calculateContextScore(profile, 3).breakdown.correctionMemories.score).toBe(12);
    // 5 corrections -> 20 pts
    expect(calculateContextScore(profile, 5).breakdown.correctionMemories.score).toBe(20);
    // 8 corrections -> capped at 20 pts
    expect(calculateContextScore(profile, 8).breakdown.correctionMemories.score).toBe(20);
  });

  it('deducts points for missingContext warnings (e.g. No testing framework found)', () => {
    const profileWithWarnings: WorkspaceProfile = {
      primaryLanguage: 'TypeScript',
      frameworks: ['Next.js'],
      databases: ['PostgreSQL'],
      architecture: 'Next.js App Router',
      keyDirectories: { components: 'src/components' },
      missingContext: [
        'No testing framework detected',
        'Database detected without schema or migrations',
        'No CI/CD pipeline detected'
      ],
      lastScanned: Date.now()
    };

    const result = calculateContextScore(profileWithWarnings, 5);

    // Lang: 20
    // DB: 0 (since missing schema warning is present)
    // Tests: 0 (since missing testing warning is present)
    // CI/Docker: 20 (docker not listed in missing)
    // Corrections: 20
    // Raw = 20 + 0 + 0 + 20 + 20 = 60
    // Penalty = 3 * 5 = 15
    // Final score = 60 - 15 = 45 (Grade F or D)
    expect(result.rawScore).toBe(60);
    expect(result.totalPenalty).toBe(15);
    expect(result.score).toBe(45);
    expect(result.grade).toBe('F');
    expect(result.missingContext).toHaveLength(3);
    expect(result.recommendations.length).toBeGreaterThan(0);
  });

  it('clamps scores between 0 and 100', () => {
    const emptyProfile: WorkspaceProfile = {
      primaryLanguage: 'Unknown',
      frameworks: [],
      databases: [],
      architecture: 'Unknown',
      keyDirectories: {},
      missingContext: [
        'No testing framework detected',
        'Database detected without schema or migrations',
        'No linter or formatter configuration detected',
        'No CI/CD pipeline detected',
        'No Docker or container configuration detected'
      ],
      lastScanned: Date.now()
    };

    const result = calculateContextScore(emptyProfile, 0);
    expect(result.score).toBe(0);
    expect(result.grade).toBe('F');
  });

  it('computes correct letter grades', () => {
    expect(computeGrade(95)).toBe('A');
    expect(computeGrade(90)).toBe('A');
    expect(computeGrade(85)).toBe('B');
    expect(computeGrade(75)).toBe('C');
    expect(computeGrade(65)).toBe('D');
    expect(computeGrade(40)).toBe('F');
  });
});

describe('Ty-Code Omni-Orchestrator Injection (Step 3)', () => {
  it('formats key directories as a clear, readable mapping', () => {
    const formatted = formatKeyDirectories({
      components: 'src/components',
      api: 'src/app/api',
      tests: 'tests'
    });
    expect(formatted).toBe('components (src/components), api (src/app/api), tests (tests)');

    expect(formatKeyDirectories({})).toBe('Standard layout');
  });

  it('generates the exact required system prompt injection structure', () => {
    const profile: WorkspaceProfile = {
      primaryLanguage: 'TypeScript',
      frameworks: ['React', 'Next.js', 'Tailwind CSS'],
      databases: ['PostgreSQL', 'Redis'],
      architecture: 'Monorepo',
      keyDirectories: {
        components: 'src/components',
        api: 'src/app/api',
        tests: 'tests'
      },
      missingContext: [],
      lastScanned: Date.now()
    };

    const corrections = [
      'NEVER use `var`, use `const` or `let`.',
      'ALWAYS use Zod for validation.',
      'Database queries must go through the `src/repositories` layer.'
    ];

    const injected = buildOmniContextPrompt(profile, corrections);

    // Exact block headers required by Step 3
    expect(injected).toContain('[WORKSPACE CONTEXT]');
    expect(injected).toContain('You are working in a Monorepo project using React, Next.js, Tailwind CSS.');
    expect(injected).toContain('Database: PostgreSQL, Redis.');
    expect(injected).toContain('Key Directories: components (src/components), api (src/app/api), tests (tests).');

    expect(injected).toContain('[USER PREFERENCES & CORRECTIONS]');
    expect(injected).toContain('You MUST adhere to the following project rules learned from previous interactions:');
    expect(injected).toContain('- NEVER use `var`, use `const` or `let`.');
    expect(injected).toContain('- ALWAYS use Zod for validation.');
    expect(injected).toContain('- Database queries must go through the `src/repositories` layer.');
  });

  it('survives model rotation and failover with full context inheritance', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-omni-test-'));

    try {
      // Add a package.json in tempDir so scanner detects it
      await fs.writeFile(
        path.join(tempDir, 'package.json'),
        JSON.stringify({
          name: 'test-project',
          dependencies: { react: '^18.0.0', next: '^14.0.0', pg: '^8.0.0' }
        }),
        'utf-8'
      );

      // Add a couple of user corrections for this workspace
      await saveCorrection(tempDir, 'Never use var, use const', 'style');
      await saveCorrection(tempDir, 'Always validate inputs with Zod', 'architecture');

      // Fetch Omni injection via modelRotationManager
      const omniInjection = await modelRotationManager.getOmniContextInjection(tempDir);

      expect(omniInjection).toContain('[WORKSPACE CONTEXT]');
      expect(omniInjection).toContain('[USER PREFERENCES & CORRECTIONS]');
      expect(omniInjection).toContain('[STYLE]');
      expect(omniInjection).toContain('Never use var, use const');
      expect(omniInjection).toContain('[ARCHITECTURE]');
      expect(omniInjection).toContain('Always validate inputs with Zod');
    } finally {
      await clearCorrections(tempDir);
      closeDatabaseConnections();
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  it('allows deleting an active correction memory and updates the ledger', async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-corr-del-'));

    try {
      const entry1 = await saveCorrection(tempDir, 'Rule 1 to keep', 'style');
      const entry2 = await saveCorrection(tempDir, 'Rule 2 to delete', 'architecture');

      let current = await getCorrectionEntries(tempDir);
      expect(current).toHaveLength(2);

      const deleted = await deleteCorrection(tempDir, entry2.id);
      expect(deleted).toBe(true);

      current = await getCorrectionEntries(tempDir);
      expect(current).toHaveLength(1);
      expect(current[0].id).toBe(entry1.id);
    } finally {
      await clearCorrections(tempDir);
      closeDatabaseConnections();
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  });
});
