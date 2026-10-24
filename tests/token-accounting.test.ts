import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import path from 'node:path';
import fs from 'node:fs/promises';
import os from 'node:os';
import crypto from 'node:crypto';
import {
  countTokens,
  clearTokenCountCache,
  computeRecordHash,
  verifyHashChain,
  canonicalizeRecordForHashing,
  TokenAccountingRecordSchema,
  type TokenAccountingRecord
} from '../src/main/services/usage/token-accounting';
import { UsageLedger } from '../src/main/services/usage/usage-ledger';
import { LedgerQueryService } from '../src/main/services/usage/ledger-query';

describe('Per-Layer Token Accounting & Usage Ledger', () => {
  let tmpDir: string;

  beforeEach(async () => {
    clearTokenCountCache();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-ledger-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // best effort cleanup
    }
  });

  describe('Token Counting & LRU Memoization', () => {
    it('returns zero tokens for empty string', () => {
      const res = countTokens('');
      expect(res.tokens).toBe(0);
    });

    it('calibrates token ratios according to content type', () => {
      // 320 chars of code -> ~100 tokens (3.2 chars/tok)
      const codeSample = 'function test() { const a = 1; const b = 2; return a + b; }\n'.repeat(5);
      const codeRes = countTokens(codeSample, 'code');
      expect(codeRes.tokens).toBeGreaterThan(0);
      expect(codeRes.tokens).toBe(Math.ceil(codeSample.length / 3.2));

      // 420 chars of prose -> ~100 tokens (4.2 chars/tok)
      const proseSample = 'The quick brown fox jumps over the lazy dog in an English sentence. '.repeat(6);
      const proseRes = countTokens(proseSample, 'prose');
      expect(proseRes.tokens).toBe(Math.ceil(proseSample.length / 4.2));

      // JSON (3.5 chars/tok)
      const jsonSample = JSON.stringify({ key: 'value', numbers: [1, 2, 3, 4, 5] });
      const jsonRes = countTokens(jsonSample, 'json');
      expect(jsonRes.tokens).toBe(Math.ceil(jsonSample.length / 3.5));

      // Markdown (3.8 chars/tok)
      const mdSample = '# Heading\n\nThis is a **bold** paragraph with markdown symbols.\n'.repeat(3);
      const mdRes = countTokens(mdSample, 'markdown');
      expect(mdRes.tokens).toBe(Math.ceil(mdSample.length / 3.8));
    });

    it('memoizes token count results in LRU cache', () => {
      const sample = 'const x = Math.sin(Math.PI / 2);';
      const first = countTokens(sample, 'code');
      const second = countTokens(sample, 'code');

      expect(first).toEqual(second);
      expect(first.tokens).toBe(second.tokens);
    });
  });

  describe('Tamper-Evident Hash Chaining', () => {
    it('produces deterministic canonical serialization', () => {
      const recA: any = { z: 1, a: 2, m: 'test' };
      const recB: any = { a: 2, m: 'test', z: 1 };
      expect(canonicalizeRecordForHashing(recA)).toBe(canonicalizeRecordForHashing(recB));
    });

    it('builds and verifies a valid hash chain', () => {
      const genesis = '0000000000000000000000000000000000000000000000000000000000000000';
      const baseRec = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId: 'sess-1',
        taskId: 'task-1',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered' as const,
        phase: 'assembly' as const,
        layers: [
          { name: 'CORE', kind: 'system' as const, tokens: 250, method: 'calibrated' as const, cached: true }
        ],
        totals: { input: 250, output: 0, cachedInput: 250 }
      };

      const hash1 = computeRecordHash(genesis, baseRec);
      const rec1: TokenAccountingRecord = { ...baseRec, prevHash: genesis, recordHash: hash1 };

      const baseRec2 = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId: 'sess-1',
        taskId: 'task-1',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered' as const,
        phase: 'response' as const,
        layers: [
          { name: 'response', kind: 'response' as const, tokens: 120, method: 'calibrated' as const, cached: false }
        ],
        totals: { input: 0, output: 120, cachedInput: 0 }
      };

      const hash2 = computeRecordHash(hash1, baseRec2);
      const rec2: TokenAccountingRecord = { ...baseRec2, prevHash: hash1, recordHash: hash2 };

      expect(verifyHashChain([rec1, rec2])).toBe(true);
    });

    it('detects tampering in hash chain records', () => {
      const genesis = '0000000000000000000000000000000000000000000000000000000000000000';
      const baseRec = {
        id: crypto.randomUUID(),
        ts: new Date().toISOString(),
        sessionId: 'sess-1',
        taskId: 'task-1',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered' as const,
        phase: 'assembly' as const,
        layers: [],
        totals: { input: 100, output: 0, cachedInput: 0 }
      };

      const hash1 = computeRecordHash(genesis, baseRec);
      const rec1: TokenAccountingRecord = { ...baseRec, prevHash: genesis, recordHash: hash1 };

      // Tamper: alter totals without updating recordHash
      const tamperedRec: TokenAccountingRecord = {
        ...rec1,
        totals: { input: 9999, output: 0, cachedInput: 0 }
      };

      expect(verifyHashChain([tamperedRec])).toBe(false);
    });
  });

  describe('UsageLedger Buffered Persistence & Costing', () => {
    it('appends records to monthly jsonl and preserves hash chain', async () => {
      const ledger = new UsageLedger(tmpDir);

      ledger.record({
        sessionId: 'sess-100',
        taskId: 'task-100',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered',
        phase: 'assembly',
        layers: [
          { name: 'CORE', kind: 'system', tokens: 300, method: 'calibrated', cached: true }
        ],
        totals: { input: 300, output: 0, cachedInput: 300 }
      });

      ledger.record({
        sessionId: 'sess-100',
        taskId: 'task-100',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered',
        phase: 'response',
        layers: [
          { name: 'response', kind: 'response', tokens: 150, method: 'calibrated', cached: false }
        ],
        totals: { input: 0, output: 150, cachedInput: 0 }
      });

      await ledger.flush();

      const monthKey = new Date().toISOString().slice(0, 7);
      const records = await ledger.getMonthlyRecords(monthKey);

      expect(records).toHaveLength(2);
      expect(verifyHashChain(records)).toBe(true);
      expect(records[0].prevHash).toBe('0'.repeat(64));
      expect(records[1].prevHash).toBe(records[0].recordHash);
    });

    it('calculates cost from model pricing and assigns $0 for free-tier/local', async () => {
      const ledger = new UsageLedger(tmpDir);

      // Metered Claude call
      const meteredCost = ledger.calculateCost('anthropic', 'claude-3-5-sonnet', {
        input: 1_000_000,
        output: 1_000_000,
        cachedInput: 500_000
      }, 'metered');

      // pricing: input: 3.00, output: 15.00, cacheRead: 0.30
      // cost: (1M - 500k uncached) * 3.00 + 1M * 15.00 + 500k * 0.30 = $1.50 + $15.00 + $0.15 = $16.65
      expect(meteredCost).toBeCloseTo(16.65, 2);

      // Free tier
      const freeCost = ledger.calculateCost('openkilo', 'kilo-auto/free', {
        input: 100_000,
        output: 50_000,
        cachedInput: 0
      }, 'free-tier');
      expect(freeCost).toBe(0);

      // Local
      const localCost = ledger.calculateCost('ollama', 'llama3', {
        input: 100_000,
        output: 50_000,
        cachedInput: 0
      }, 'local');
      expect(localCost).toBe(0);
    });

    it('computes daily rollups with provider, model, and mode breakdowns', async () => {
      const ledger = new UsageLedger(tmpDir);
      const today = new Date().toISOString().slice(0, 10);

      ledger.record({
        sessionId: 'sess-daily',
        taskId: 'task-daily',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered',
        phase: 'assembly',
        layers: [
          { name: 'CORE', kind: 'system', tokens: 400, method: 'calibrated', cached: true }
        ],
        totals: { input: 400, output: 0, cachedInput: 400 }
      });

      await ledger.flush();

      const rollup = await ledger.getDailyRollup(today);
      expect(rollup).not.toBeNull();
      expect(rollup?.date).toBe(today);
      expect(rollup?.totals.input).toBe(400);
      expect(rollup?.byProvider['anthropic']).toBeDefined();
      expect(rollup?.byProvider['anthropic'].input).toBe(400);
    });
  });

  describe('Ledger Query Service & Insights', () => {
    it('aggregates usage across dimensions', async () => {
      const ledger = new UsageLedger(tmpDir);
      const queryService = new LedgerQueryService(ledger);

      ledger.record({
        sessionId: 'sess-q1',
        taskId: 'task-q1',
        provider: 'openai',
        model: 'gpt-4o',
        billing: 'metered',
        phase: 'request',
        layers: [
          { name: 'CORE', kind: 'system', tokens: 500, method: 'calibrated', cached: false },
          { name: 'ROLE:security', kind: 'system', tokens: 200, method: 'calibrated', cached: false }
        ],
        totals: { input: 700, output: 0, cachedInput: 0 }
      });

      await ledger.flush();

      const agg = await queryService.aggregate();
      expect(agg.totalRequests).toBe(1);
      expect(agg.totalInputTokens).toBe(700);
      expect(agg.byProvider['openai']).toBeDefined();
      expect(agg.byModel['gpt-4o']).toBeDefined();
      expect(agg.byRole['security']).toBeDefined();
      expect(agg.byRole['security'].tokens).toBe(200);
    });

    it('detects history bloat insight when history exceeds 60% of input', async () => {
      const ledger = new UsageLedger(tmpDir);
      const queryService = new LedgerQueryService(ledger);

      ledger.record({
        sessionId: 'sess-bloat',
        taskId: 'task-bloat',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered',
        phase: 'assembly',
        layers: [
          { name: 'CORE', kind: 'system', tokens: 200, method: 'calibrated', cached: false },
          { name: 'history', kind: 'history', tokens: 800, method: 'calibrated', cached: false }
        ],
        totals: { input: 1000, output: 0, cachedInput: 0 }
      });

      await ledger.flush();

      const insights = await queryService.getInsights();
      const bloatInsight = insights.find(i => i.type === 'history-bloat');

      expect(bloatInsight).toBeDefined();
      expect(bloatInsight?.severity).toBe('warning');
      expect(bloatInsight?.metrics.historyRatio).toBe(80);
    });

    it('detects wasted cache or low cache hit rate', async () => {
      const ledger = new UsageLedger(tmpDir);
      const queryService = new LedgerQueryService(ledger);

      ledger.record({
        sessionId: 'sess-cache',
        taskId: 'task-cache',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered',
        phase: 'assembly',
        layers: [
          { name: 'CORE', kind: 'system', tokens: 5000, method: 'calibrated', cached: true }
        ],
        totals: { input: 5000, output: 0, cachedInput: 100 } // only 100 hit out of 5000 (<20%)
      });

      await ledger.flush();

      const insights = await queryService.getInsights();
      const cacheInsight = insights.find(i => i.type === 'cache-hit-rate');

      expect(cacheInsight).toBeDefined();
      expect(cacheInsight?.severity).toBe('warning');
    });

    it('detects tokens-per-hop anomaly across task iterations', async () => {
      const ledger = new UsageLedger(tmpDir);
      const queryService = new LedgerQueryService(ledger);

      // Record 3 normal hops (~100 tokens)
      for (let i = 0; i < 3; i++) {
        ledger.record({
          sessionId: 'sess-hop',
          taskId: 'task-hop',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          billing: 'metered',
          phase: 'tool',
          layers: [
            { name: `tool_result:read_file`, kind: 'tool', tokens: 100, method: 'calibrated', cached: false }
          ],
          totals: { input: 100, output: 0, cachedInput: 0 }
        });
      }

      // Record 1 massive anomalous hop (10,000 tokens)
      ledger.record({
        sessionId: 'sess-hop',
        taskId: 'task-hop',
        provider: 'anthropic',
        model: 'claude-3-5-sonnet',
        billing: 'metered',
        phase: 'tool',
        layers: [
          { name: `tool_result:dump_logs`, kind: 'tool', tokens: 10000, method: 'calibrated', cached: false }
        ],
        totals: { input: 10000, output: 0, cachedInput: 0 }
      });

      await ledger.flush();

      const insights = await queryService.getInsights();
      const hopInsight = insights.find(i => i.type === 'hop-anomaly');

      expect(hopInsight).toBeDefined();
      expect(hopInsight?.severity).toBe('warning');
    });
  });
});
