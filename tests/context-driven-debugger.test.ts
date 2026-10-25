import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import type { WorkspaceProfile } from '../src/main/services/context-engine/types';
import {
  detectArchitecturalDrifts,
  runArchAnalysis
} from '../src/main/services/debugger-engines/arch-engine';
import {
  isReadOnlySafe,
  detectDatabaseQueries,
  profileDatabaseQuery,
  profileFileDatabaseQueries
} from '../src/main/services/debugger-engines/dynamic-engine';
import {
  buildRoleSchemaPrompt,
  summarizeForContext,
  ROLE_PROMPTS
} from '../src/main/services/debugger-engines/ai-analyst';
import {
  saveCorrection,
  clearCorrections,
  closeDatabaseConnections
} from '../src/main/services/context-engine/correction-memory';

describe('Context-Driven Omni-Debugger: Architectural Drift & DB Profiling', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-debugger-test-'));
  });

  afterEach(async () => {
    closeDatabaseConnections();
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 1: Architectural Drift Detection
  // ───────────────────────────────────────────────────────────────────────────
  describe('Step 1: Architectural Drift Detection', () => {
    it('flags legacy Pages Router lifecycle methods in a Next.js App Router project', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['Next.js', 'React'],
        databases: [],
        architecture: 'Next.js App Router',
        keyDirectories: { app: 'src/app' },
        missingContext: [],
        lastScanned: Date.now()
      };

      const fileId = 'src/app/dashboard/page.tsx';
      const content = `
        import React from 'react';
        export async function getServerSideProps(context) {
          return { props: { data: 'old' } };
        }
        export default function Dashboard({ data }) {
          return <div>{data}</div>;
        }
      `;

      const drifts = detectArchitecturalDrifts(fileId, content, [], profile, []);
      expect(drifts.length).toBeGreaterThan(0);
      const legacyDrift = drifts.find((d) => d.ruleId === 'arch-drift-legacy-next-pattern');
      expect(legacyDrift).toBeDefined();
      expect(legacyDrift?.message).toContain('[ARCH_DRIFT] Legacy Pattern Detected');
      expect(legacyDrift?.message).toContain('getServerSideProps');
    });

    it('flags cross-workspace relative imports in a Monorepo project', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: [],
        databases: [],
        architecture: 'Monorepo',
        keyDirectories: { packages: 'packages' },
        missingContext: [],
        lastScanned: Date.now()
      };

      const fileId = 'packages/app/src/index.ts';
      const content = `import { Button } from '../../packages/ui/button';`;
      const specifiers = ['../../packages/ui/button'];

      const drifts = detectArchitecturalDrifts(fileId, content, specifiers, profile, []);
      expect(drifts.length).toBeGreaterThan(0);
      const boundaryDrift = drifts.find((d) => d.ruleId === 'arch-drift-monorepo-boundary');
      expect(boundaryDrift).toBeDefined();
      expect(boundaryDrift?.message).toContain('[ARCH_DRIFT] Cross-Workspace Import Violation');
      expect(boundaryDrift?.suggestedFix).toContain('workspace package name');
    });

    it('flags raw SQL strings bypassing the detected ORM layer', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['Prisma', 'Express'],
        databases: ['PostgreSQL'],
        architecture: 'Layered MVC',
        keyDirectories: {},
        missingContext: [],
        lastScanned: Date.now()
      };

      const fileId = 'src/services/user-service.ts';
      const content = `
        import { db } from '../db';
        export async function getUser(id: string) {
          return await db.query("SELECT * FROM users WHERE id = $1", [id]);
        }
      `;

      const drifts = detectArchitecturalDrifts(fileId, content, [], profile, []);
      expect(drifts.length).toBeGreaterThan(0);
      const bypassDrift = drifts.find((d) => d.ruleId === 'arch-drift-bypassed-data-layer');
      expect(bypassDrift).toBeDefined();
      expect(bypassDrift?.message).toContain('[ARCH_DRIFT] Bypassed Data Layer');
      expect(bypassDrift?.message).toContain('PostgreSQL');
    });

    it('flags user correction memory violations as CRITICAL', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: [],
        databases: [],
        architecture: 'Modular',
        keyDirectories: {},
        missingContext: [],
        lastScanned: Date.now()
      };

      const corrections = ['NEVER use `var`, use `const` or `let`.'];
      const fileId = 'src/utils/legacy.ts';
      const content = `
        var legacyCounter = 0;
        export function increment() { return ++legacyCounter; }
      `;

      const drifts = detectArchitecturalDrifts(fileId, content, [], profile, corrections);
      expect(drifts.length).toBeGreaterThan(0);
      const critDrift = drifts.find((d) => d.ruleId === 'arch-correction-violation');
      expect(critDrift).toBeDefined();
      expect(critDrift?.severity).toBe('critical');
      expect(critDrift?.message).toContain('[CRITICAL] Workspace Preference Violation');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 2: Auto-MCP Database Profiling
  // ───────────────────────────────────────────────────────────────────────────
  describe('Step 2: Auto-MCP Database Profiling', () => {
    it('isReadOnlySafe permits read queries and blocks destructive DDL/DML', () => {
      expect(isReadOnlySafe('SELECT * FROM users WHERE active = true')).toBe(true);
      expect(isReadOnlySafe('WITH cte AS (SELECT id FROM accounts) SELECT * FROM cte')).toBe(true);
      expect(isReadOnlySafe('EXPLAIN ANALYZE SELECT * FROM orders')).toBe(true);
      expect(isReadOnlySafe('PRAGMA table_info(users)')).toBe(true);

      // Destructive/write queries MUST be rejected
      expect(isReadOnlySafe('DROP TABLE users')).toBe(false);
      expect(isReadOnlySafe('DELETE FROM orders WHERE id = 1')).toBe(false);
      expect(isReadOnlySafe('UPDATE accounts SET balance = 0')).toBe(false);
      expect(isReadOnlySafe('INSERT INTO users (name) VALUES (\'malice\')')).toBe(false);
      expect(isReadOnlySafe('TRUNCATE TABLE logs')).toBe(false);
      expect(isReadOnlySafe('ALTER TABLE users ADD COLUMN foo TEXT')).toBe(false);
    });

    it('detectDatabaseQueries extracts raw SQL and ORM queries with line numbers', () => {
      const code = [
        'import { prisma } from "./client";',
        'export async function getActiveUsers() {',
        '  return await prisma.user.findMany({ where: { status: "active" } });',
        '}',
        'export async function getRawOrders() {',
        '  const sql = "SELECT id, total FROM orders WHERE total > 100";',
        '  return sql;',
        '}'
      ].join('\n');

      const detected = detectDatabaseQueries(code);
      expect(detected.length).toBe(2);

      const ormQuery = detected.find((q) => q.isOrm);
      expect(ormQuery).toBeDefined();
      expect(ormQuery?.table).toBe('user');
      expect(ormQuery?.line).toBe(3);

      const rawQuery = detected.find((q) => !q.isOrm);
      expect(rawQuery).toBeDefined();
      expect(rawQuery?.table).toBe('orders');
      expect(rawQuery?.line).toBe(6);
    });

    it('profileDatabaseQuery evaluates query plan and recommends index on sequential scans', async () => {
      const unindexedQuery = {
        raw: 'prisma.user.findMany({ where: { status: "active" } })',
        sql: 'SELECT * FROM "user" WHERE "status" = $1;',
        table: 'user',
        line: 3,
        isOrm: true,
        filterColumn: 'status'
      };

      const unindexedPlan = await profileDatabaseQuery(unindexedQuery, 'PostgreSQL');
      expect('scanType' in unindexedPlan).toBe(true);
      if ('scanType' in unindexedPlan) {
        expect(unindexedPlan.scanType).toBe('Seq Scan');
        expect(unindexedPlan.executionTimeMs).toBeGreaterThan(0);
        expect(unindexedPlan.rawPlan).toContain('Seq Scan');
        expect(unindexedPlan.recommendation).toContain('CREATE INDEX idx_user_status');
      }

      const indexedQuery = {
        raw: 'prisma.user.findUnique({ where: { id: 1 } })',
        sql: 'SELECT * FROM "user" WHERE "id" = $1;',
        table: 'user',
        line: 1,
        isOrm: true,
        filterColumn: 'id'
      };

      const indexedPlan = await profileDatabaseQuery(indexedQuery, 'PostgreSQL');
      expect('scanType' in indexedPlan).toBe(true);
      if ('scanType' in indexedPlan) {
        expect(indexedPlan.scanType).toBe('Index Scan');
        expect(indexedPlan.executionTimeMs).toBeLessThan(1.0);
        expect(indexedPlan.rawPlan).toContain('Index Scan');
      }
    });

    it('profileFileDatabaseQueries scans file and returns AnalysisResult with latency & plan', async () => {
      const testFile = path.join(tempDir, 'user-repo.ts');
      const testContent = `
        import { prisma } from './db';
        export async function findByEmail(email: string) {
          return await prisma.user.findMany({ where: { email: email } });
        }
      `;
      await fs.writeFile(testFile, testContent, 'utf8');

      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['Prisma'],
        databases: ['PostgreSQL'],
        architecture: 'Modular',
        keyDirectories: {},
        missingContext: [],
        lastScanned: Date.now()
      };

      const findings = await profileFileDatabaseQueries(testFile, { profile, projectRoot: tempDir });
      expect(findings.length).toBeGreaterThan(0);

      const dbFinding = findings[0];
      expect(dbFinding.ruleId).toBe('dyn-db-query-profile');
      expect(dbFinding.engine).toBe('dynamic');
      expect(dbFinding.message).toContain('[DB_PROFILE]');
      expect(dbFinding.message).toContain('Sequential Scan');
      expect(dbFinding.suggestedFix).toContain('CREATE INDEX');
      expect(dbFinding.codeSnippet).toContain('Seq Scan on user');
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // Step 3: Correction Memory Integration
  // ───────────────────────────────────────────────────────────────────────────
  describe('Step 3: Correction Memory Integration', () => {
    it('injects forbidden workspace rules into the AI Analyst system prompt', () => {
      const forbiddenRules = [
        'NEVER use `var`, use `const` or `let`.',
        'Database queries must go through the `src/repositories` layer, not directly in controllers.'
      ];

      const devPrompt = buildRoleSchemaPrompt('dev', forbiddenRules);
      expect(devPrompt).toContain('The user has explicitly forbidden the following patterns in this workspace:');
      expect(devPrompt).toContain('- NEVER use `var`, use `const` or `let`.');
      expect(devPrompt).toContain('- Database queries must go through the `src/repositories` layer');
      expect(devPrompt).toContain('Flag any violations as CRITICAL.');

      const pmPrompt = buildRoleSchemaPrompt('pm', forbiddenRules);
      expect(pmPrompt).toContain('The user has explicitly forbidden the following patterns in this workspace:');
      expect(pmPrompt).toContain('Flag any violations as CRITICAL.');
    });

    it('summarizeForContext attaches architectural drift and stack profile to the PM/Dev context', () => {
      const profile: WorkspaceProfile = {
        primaryLanguage: 'TypeScript',
        frameworks: ['Next.js', 'Prisma'],
        databases: ['PostgreSQL'],
        architecture: 'Next.js App Router',
        keyDirectories: {},
        missingContext: [],
        lastScanned: Date.now()
      };

      const archReport = {
        projectRoot: tempDir,
        packageJson: { name: 'test-app', version: '1.0.0', scripts: [] },
        tsconfig: null,
        graph: { nodes: [], edges: [] },
        cycles: [],
        truncated: false,
        debtScore: { value: 25, label: 'acceptable', godFileCount: 0, cycleCount: 0, sourceFileCount: 10, coupling: 1.1 },
        warnings: [],
        archDrifts: [
          {
            id: 'arch:drift:1',
            severity: 'high' as const,
            engine: 'arch' as const,
            role: 'dev' as const,
            message: '[ARCH_DRIFT] Legacy Pattern Detected in src/app/page.tsx',
            ruleId: 'arch-drift-legacy-next-pattern',
            timestamp: Date.now()
          }
        ],
        profile
      };

      const summarized = summarizeForContext([], { arch: archReport });
      const parsed = JSON.parse(summarized);

      expect(parsed.architecture).toBeDefined();
      expect(parsed.architecture.archDrifts.length).toBe(1);
      expect(parsed.architecture.archDrifts[0].rule).toBe('arch-drift-legacy-next-pattern');
      expect(parsed.architecture.profile.frameworks).toContain('Next.js');
      expect(parsed.architecture.profile.databases).toContain('PostgreSQL');
    });
  });
});
