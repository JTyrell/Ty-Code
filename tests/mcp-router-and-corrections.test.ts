import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  getRecommendedMCPs,
  injectRecommendedMCPs
} from '../src/main/services/context-engine/mcp-router';
import {
  computeWorkspaceHash,
  saveCorrection,
  getCorrections,
  getCorrectionEntries,
  deleteCorrection,
  clearCorrections,
  closeDatabaseConnections
} from '../src/main/services/context-engine/correction-memory';
import type { WorkspaceProfile } from '../src/main/services/context-engine/types';

describe('Ty-Code Context Engine: Auto-MCP Routing & Correction Memory', () => {
  let tempWorkspaceA: string;
  let tempWorkspaceB: string;

  beforeEach(async () => {
    tempWorkspaceA = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-mcp-test-a-'));
    tempWorkspaceB = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-mcp-test-b-'));
  });

  afterEach(async () => {
    closeDatabaseConnections();
    try {
      await fs.rm(tempWorkspaceA, { recursive: true, force: true });
      await fs.rm(tempWorkspaceB, { recursive: true, force: true });
    } catch {}
  });

  describe('Step 1: Dynamic MCP Server Router', () => {
    it('recommends Postgres and Puppeteer MCPs for Next.js + PostgreSQL', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['Next.js', 'React', 'Tailwind CSS'],
        databases: ['PostgreSQL'],
        architecture: 'Next.js App Router',
        keyDirectories: { app: 'src/app' },
        missingContext: [],
        lastScanned: Date.now()
      };

      const mcps = getRecommendedMCPs(profile);
      const ids = mcps.map((m) => m.id);

      expect(ids).toContain('postgres');
      expect(ids).toContain('puppeteer');
      expect(ids).toContain('filesystem');

      // Verify all recommended MCPs are local stdio
      for (const mcp of mcps) {
        expect(['npx', 'python', 'node']).toContain(mcp.command);
        expect(mcp.disabled).toBe(false);
      }
    });

    it('recommends SQLite and Python/Pandas MCP for Python Data Science stack', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'Python',
        frameworks: ['FastAPI', 'Pandas'],
        databases: ['SQLite'],
        architecture: 'Modular Application',
        keyDirectories: {},
        missingContext: [],
        lastScanned: Date.now()
      };

      const mcps = getRecommendedMCPs(profile);
      const ids = mcps.map((m) => m.id);

      expect(ids).toContain('sqlite');
      expect(ids).toContain('python-pandas');
      expect(ids).toContain('filesystem');
    });

    it('recommends Git MCP for Monorepo architecture', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['React'],
        databases: [],
        architecture: 'Monorepo',
        keyDirectories: { packages: 'packages' },
        missingContext: [],
        lastScanned: Date.now()
      };

      const mcps = getRecommendedMCPs(profile);
      const ids = mcps.map((m) => m.id);

      expect(ids).toContain('git');
      expect(ids).toContain('puppeteer');
    });

    it('injects recommended MCPs into workspace mcp_config.json on sync', async () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['React', 'Next.js'],
        databases: ['PostgreSQL'],
        architecture: 'Next.js App Router',
        keyDirectories: {},
        missingContext: [],
        lastScanned: Date.now()
      };

      const { injected, total } = await injectRecommendedMCPs(tempWorkspaceA, profile);
      expect(injected.length).toBeGreaterThan(0);
      expect(total).toBeGreaterThanOrEqual(injected.length);

      // Verify mcp_config.json was written to .ty-code/
      const configPath = path.join(tempWorkspaceA, '.ty-code', 'mcp_config.json');
      const content = await fs.readFile(configPath, 'utf-8');
      const parsed = JSON.parse(content);

      expect(parsed.mcpServers.postgres).toBeDefined();
      expect(parsed.mcpServers.puppeteer).toBeDefined();
      expect(parsed.mcpServers.filesystem).toBeDefined();
      expect(parsed.mcpServers.postgres.disabled).toBe(false);
    });
  });

  describe('Step 2: Correction Memory (Local Audit Ledger)', () => {
    it('computes deterministic workspace hashes', () => {
      const hash1 = computeWorkspaceHash(tempWorkspaceA);
      const hash2 = computeWorkspaceHash(tempWorkspaceA);
      const hashB = computeWorkspaceHash(tempWorkspaceB);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(16);
      expect(hash1).not.toBe(hashB);
    });

    it('saves corrections, formats rules, and retrieves them as strict constraints', async () => {
      // 1. Style correction
      const entry1 = await saveCorrection(
        tempWorkspaceA,
        "Don't use `var`, we use `const`",
        'style'
      );
      expect(entry1.rule).toBe('NEVER use `var`, use `const` or `let`.');
      expect(entry1.category).toBe('style');

      // 2. Stack correction
      const entry2 = await saveCorrection(
        tempWorkspaceA,
        'We use Zod for all API validation, not Joi',
        'stack'
      );
      expect(entry2.rule).toBe('ALWAYS use Zod for validation.');
      expect(entry2.category).toBe('stack');

      // 3. Architecture correction
      const entry3 = await saveCorrection(
        tempWorkspaceA,
        'Database queries must go through the `src/repositories` layer, not directly in controllers.',
        'architecture'
      );
      expect(entry3.rule).toContain('src/repositories');
      expect(entry3.category).toBe('architecture');

      // 4. Retrieve rules
      const rules = await getCorrections(tempWorkspaceA);
      expect(rules).toContain('NEVER use `var`, use `const` or `let`.');
      expect(rules).toContain('ALWAYS use Zod for validation.');
      expect(rules.some((r) => r.includes('src/repositories'))).toBe(true);
    });

    it('strictly isolates corrections between different workspace hashes', async () => {
      // Save rules in Workspace A
      await saveCorrection(tempWorkspaceA, 'ALWAYS use pnpm', 'stack');
      await saveCorrection(tempWorkspaceA, 'NEVER use any', 'style');

      // Save different rule in Workspace B
      await saveCorrection(tempWorkspaceB, 'ALWAYS use yarn', 'stack');

      const rulesA = await getCorrections(tempWorkspaceA);
      const rulesB = await getCorrections(tempWorkspaceB);

      // Verify no cross-project leakage
      expect(rulesA).toContain('ALWAYS use pnpm');
      expect(rulesA).toContain('NEVER use any');
      expect(rulesA).not.toContain('ALWAYS use yarn');

      expect(rulesB).toContain('ALWAYS use yarn');
      expect(rulesB).not.toContain('ALWAYS use pnpm');
      expect(rulesB).not.toContain('NEVER use any');
    });

    it('supports deleting individual corrections and clearing workspace memory', async () => {
      const entry = await saveCorrection(tempWorkspaceA, 'ALWAYS write unit tests', 'style');
      let rules = await getCorrections(tempWorkspaceA);
      expect(rules).toContain('ALWAYS write unit tests');

      const deleted = await deleteCorrection(tempWorkspaceA, entry.id);
      expect(deleted).toBe(true);

      rules = await getCorrections(tempWorkspaceA);
      expect(rules).not.toContain('ALWAYS write unit tests');

      await saveCorrection(tempWorkspaceA, 'Rule 1', 'style');
      await saveCorrection(tempWorkspaceA, 'Rule 2', 'architecture');
      await clearCorrections(tempWorkspaceA);

      rules = await getCorrections(tempWorkspaceA);
      expect(rules).toHaveLength(0);
    });
  });
});
