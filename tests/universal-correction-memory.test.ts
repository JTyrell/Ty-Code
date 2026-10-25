import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  saveCorrection,
  getCorrections,
  getCorrectionEntries,
  deleteCorrection,
  clearCorrections,
  closeDatabaseConnections,
  onCorrectionAdded,
  computeWorkspaceHash,
  getWorkspaceStorageDir,
  formatRule,
  type CorrectionEvent,
  type CorrectionEntry
} from '../src/main/services/context-engine/correction-memory';
import { getRuntimeLearnedRules } from '../src/main/agent/agent-engine';
import { getDebuggerLiveCorrections, runFullAnalysis } from '../src/main/services/debugger-orchestrator';
import { runArchAnalysis } from '../src/main/services/debugger-engines/arch-engine';
import { getCanvasLiveCorrections, buildProjectDesignPrompt } from '../src/main/agent/canvas-agent-engine';

describe('Universal Correction Memory Enforcement (The Learning Loop)', () => {
  const testWorkspacePath = path.join(os.tmpdir(), `tycode_corr_test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const workspaceHash = computeWorkspaceHash(testWorkspacePath);
  const storageDir = getWorkspaceStorageDir(workspaceHash);

  beforeEach(async () => {
    await fs.mkdir(testWorkspacePath, { recursive: true });
    await clearCorrections(testWorkspacePath);
  });

  afterEach(async () => {
    closeDatabaseConnections();
    try {
      await fs.rm(testWorkspacePath, { recursive: true, force: true });
      await fs.rm(storageDir, { recursive: true, force: true });
    } catch {}
  });

  it('Step 1: The Global Correction Hook emits onCorrectionAdded event with surface and rule', async () => {
    const receivedEvents: CorrectionEvent[] = [];
    const unsubscribe = onCorrectionAdded((event) => {
      receivedEvents.push(event);
    });

    const entry = await saveCorrection(
      testWorkspacePath,
      'Never use var, use const or let',
      'style',
      'chat'
    );

    expect(entry).toBeDefined();
    expect(entry.surface).toBe('chat');
    expect(entry.rule).toBe('NEVER use `var`, use `const` or `let`.');

    expect(receivedEvents.length).toBe(1);
    expect(receivedEvents[0].rule).toBe(entry.rule);
    expect(receivedEvents[0].surface).toBe('chat');
    expect(receivedEvents[0].workspaceHash).toBe(workspaceHash);

    // Test unsubscribe
    unsubscribe();
    await saveCorrection(testWorkspacePath, 'Always use Zod for validation', 'architecture', 'global');
    expect(receivedEvents.length).toBe(1); // Should not increase after unsubscribe
  });

  it('Strict Rule: SQLite ledger uses write-ahead logging (WAL) and dual durability', async () => {
    const entry = await saveCorrection(
      testWorkspacePath,
      'Direct database queries must go through repositories',
      'architecture',
      'debugger'
    );

    // Verify storage directory matches Zero-Telemetry path: ~/.tycode/workspaces/{hash}/
    expect(storageDir).toBe(path.join(os.homedir(), '.tycode', 'workspaces', workspaceHash));

    // Check files exist
    const dbPath = path.join(storageDir, 'corrections.db');
    const jsonlPath = path.join(storageDir, 'corrections.jsonl');

    expect(fsSync.existsSync(dbPath)).toBe(true);
    expect(fsSync.existsSync(jsonlPath)).toBe(true);

    // Verify WAL mode is set on SQLite DB
    let sqliteModule: any = null;
    try {
      sqliteModule = require('node:sqlite');
    } catch {}

    if (sqliteModule) {
      const db = new sqliteModule.DatabaseSync(dbPath);
      const pragmaResult = db.prepare('PRAGMA journal_mode;').get();
      expect(pragmaResult.journal_mode.toLowerCase()).toBe('wal');
      db.close();
    }

    // Verify JSONL mirror has entry
    const jsonlContent = await fs.readFile(jsonlPath, 'utf8');
    expect(jsonlContent).toContain(entry.id);
    expect(jsonlContent).toContain('repositories');
  });

  it('Step 2: Real-Time Rule Injection in Chat Sidecar agent-engine', async () => {
    const uniqueRule = `Enforce strict functional components #${Date.now()}`;
    await saveCorrection(testWorkspacePath, uniqueRule, 'style', 'chat');

    const runtimeRules = getRuntimeLearnedRules(testWorkspacePath);
    expect(runtimeRules).toContain(uniqueRule);
  });

  it('Step 3: Debugger Live Sync instantly detects and flags "Never use var" violations', async () => {
    // 1. Emit correction: "Never use var" from chat
    await saveCorrection(testWorkspacePath, 'Never use var, use const or let', 'style', 'chat');

    // Verify debugger registered the rule live
    const debuggerRules = getDebuggerLiveCorrections(testWorkspacePath);
    expect(debuggerRules.some((r) => r.includes('NEVER use `var`'))).toBe(true);

    // 2. Create a test file with `var` keyword in the test workspace
    const legacyJsFile = path.join(testWorkspacePath, 'legacy.js');
    await fs.writeFile(legacyJsFile, 'var legacyCount = 42;\nconsole.log(legacyCount);\n', 'utf8');

    // 3. Test arch engine run (reads corrections ledger and flags var violation)
    const archReport = await runArchAnalysis(testWorkspacePath);
    expect(archReport).toBeDefined();
    expect(archReport.warnings.length).toBeGreaterThan(0);

    // Must find critical violation for forbidden 'var' keyword
    const varViolation = archReport.warnings.find(
      (r) => r.ruleId === 'arch-correction-violation' && r.message.includes("Forbidden 'var' keyword detected")
    );
    expect(varViolation).toBeDefined();
    expect(varViolation?.severity).toBe('critical');
    expect(varViolation?.message).toContain('Rule: "NEVER use `var`, use `const` or `let`."');
  });

  it('Step 3: Canvas Live Sync instantly injects "Always use lucide-react for icons" and forbids react-icons', async () => {
    // 1. Emit correction from canvas: "Always use lucide-react for icons"
    await saveCorrection(testWorkspacePath, 'Always use lucide-react for icons', 'style', 'canvas');

    // Verify canvas registered the rule live
    const canvasRules = getCanvasLiveCorrections(testWorkspacePath);
    expect(canvasRules.some((r) => r.includes('lucide-react'))).toBe(true);

    // 2. Build canvas project design prompt
    const prompt = buildProjectDesignPrompt(null, null, canvasRules);

    // 3. Prompt must contain mandatory instruction prohibiting react-icons
    expect(prompt).toContain('[UNIVERSAL LEARNED WORKSPACE RULES (MANDATORY)]');
    expect(prompt).toContain('Always use `lucide-react` for icons; NEVER import or generate `react-icons`.');
  });

  it('Step 4: Rule deletion and retrieval by surface', async () => {
    const entry1 = await saveCorrection(testWorkspacePath, 'Rule for Chat', 'style', 'chat');
    const entry2 = await saveCorrection(testWorkspacePath, 'Rule for Debugger', 'architecture', 'debugger');
    const entry3 = await saveCorrection(testWorkspacePath, 'Rule for Canvas', 'stack', 'canvas');

    const allEntries = await getCorrectionEntries(testWorkspacePath);
    expect(allEntries.length).toBe(3);

    const chatEntry = allEntries.find((e) => e.id === entry1.id);
    const debuggerEntry = allEntries.find((e) => e.id === entry2.id);
    const canvasEntry = allEntries.find((e) => e.id === entry3.id);

    expect(chatEntry?.surface).toBe('chat');
    expect(debuggerEntry?.surface).toBe('debugger');
    expect(canvasEntry?.surface).toBe('canvas');

    // Delete one rule
    const deleted = await deleteCorrection(testWorkspacePath, entry2.id);
    expect(deleted).toBe(true);

    const remainingEntries = await getCorrectionEntries(testWorkspacePath);
    expect(remainingEntries.length).toBe(2);
    expect(remainingEntries.some((e) => e.id === entry2.id)).toBe(false);
  });
});
