/**
 * Stage 5e — connection pre-warm correctness.
 *
 * `warmConnections()` runs once at startup, but the baked `fcc-proxy` target
 * (http://localhost:8082) may not match the live sidecar port. The reconciliation
 * must: (1) expose the baked default via `getWarmTarget()`, (2) dial the LIVE port
 * when one is supplied, and (3) log `[PERF] Pre-warm target ${target} != live port
 * ${actualPort}` on mismatch so a stale port never silently defeats the pre-warm.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PerformanceManagerService } from './performance-manager';

let fetchSpy: ReturnType<typeof vi.spyOn> | undefined;
let consoleSpy: ReturnType<typeof vi.spyOn> | undefined;
let fetchedUrls: string[] = [];

beforeEach(() => {
    fetchedUrls = [];
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (rawUrl: unknown) => {
        const url = String(rawUrl instanceof Request ? rawUrl.url : rawUrl);
        fetchedUrls.push(url);
        return new Response(null, { status: 200 });
    });
});

afterEach(() => {
    fetchSpy?.mockRestore();
    consoleSpy?.mockRestore();
});

describe('Stage 5e pre-warm target reconciliation', () => {
    it('exposes the baked fcc-proxy default via getWarmTarget()', () => {
        const perf = new PerformanceManagerService();
        try {
            expect(perf.getWarmTarget('fcc-proxy')).toBe('http://localhost:8082');
            expect(perf.getWarmTarget('ollama')).toBe('http://localhost:11434');
        } finally {
            perf.stopBackgroundQuotaRefresh();
        }
    });

    it('dials the live FCC sidecar port and logs the mismatch against the baked default', async () => {
        const perf = new PerformanceManagerService();
        try {
            const bakedTarget = perf.getWarmTarget('fcc-proxy');
            const livePort = 9911;

            await perf.warmConnections(livePort);

            const logged = consoleSpy?.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n') ?? '';
            expect(logged).toContain(`[PERF] Pre-warm target ${bakedTarget} != live port ${livePort}`);

            // The live port was dialled; the stale baked default was NOT.
            expect(fetchedUrls.some((u) => u.includes(`localhost:${livePort}`))).toBe(true);
            expect(fetchedUrls.some((u) => u.includes('localhost:8082'))).toBe(false);
        } finally {
            perf.stopBackgroundQuotaRefresh();
        }
    });

    it('uses the baked default when no live port is supplied (no mismatch log)', async () => {
        const perf = new PerformanceManagerService();
        try {
            await perf.warmConnections();
            const logged = consoleSpy?.mock.calls.map((c: unknown[]) => c.join(' ')).join('\n') ?? '';
            expect(logged).not.toContain('!= live port');
            expect(fetchedUrls.some((u) => u.includes('localhost:8082'))).toBe(true);
        } finally {
            perf.stopBackgroundQuotaRefresh();
        }
    });
});
