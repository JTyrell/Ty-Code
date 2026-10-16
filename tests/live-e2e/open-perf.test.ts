/**
 * Fix 5 Live Validation Gate: Open-Path Performance Test Suite
 *
 * Requirements:
 * 1. Open 10k-folder fixture; assert first paint and full-index timings within budgets.
 * 2. Open 1KB and 1MB files; assert click-to-editable timings within budgets.
 * 3. Second open uses disk cache and is >= 3x faster.
 * 4. Zero main-thread blocking >50ms during tree opens.
 *
 * Budgets:
 * - folder_10k_first_tree_paint: < 1500ms progressive
 * - folder_10k_full_index_background: < 5s (5000ms)
 * - second_open_ge_3x_faster: true (>= 3.0x)
 * - file_open_click_to_editable_small (1KB): < 150ms warm, < 400ms cold
 * - file_open_1mb: < 1200ms with progressive content
 * - no_main_thread_block_over_50ms_during_open: true
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getWorkspaceTreeChunked, readFile as fsReadFile } from '../../src/main/ipc/fs-handlers';
import { WorkerIndexerService } from '../../src/main/services/indexing/worker-indexer-service';
import { LazyModelManager } from '../../src/renderer/src/services/lazy-model-manager';

const projectRoot = process.cwd();

let totalTests = 0;
let passedTests = 0;

function assert(condition: boolean, message: string): void {
  totalTests++;
  if (condition) {
    console.log(`  ✓ ${message}`);
    passedTests++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

export async function runOpenPerfTests(): Promise<{ passed: number; total: number }> {
  console.log('========================================================================');
  console.log('=== LIVE E2E SUITE: OPEN-PATH PERFORMANCE & BUDGET VALIDATION        ===');
  console.log('========================================================================\n');

  const fixtureDir = path.join(os.tmpdir(), `tycode-open-perf-10k-${Date.now()}`);
  await fs.mkdir(fixtureDir, { recursive: true });

  try {
    // -------------------------------------------------------------------------
    // 1. Generate 10,000 File Fixture Directory
    // -------------------------------------------------------------------------
    console.log('Generating 10,000 files across 100 subdirectories for live fixture test...');
    const genStart = performance.now();

    // 100 directories, each with 100 files = 10,000 files
    for (let d = 0; d < 100; d++) {
      const sub = path.join(fixtureDir, `module_${d.toString().padStart(3, '0')}`);
      await fs.mkdir(sub, { recursive: true });
      for (let f = 0; f < 100; f++) {
        fsSync.writeFileSync(
          path.join(sub, `component_${f.toString().padStart(3, '0')}.ts`),
          `export const item_${d}_${f} = "val_${d}_${f}";\n`
        );
      }
    }
    const genDuration = Math.round(performance.now() - genStart);
    console.log(`  ✓ Generated 10,000 files in ${genDuration}ms\n`);

    // -------------------------------------------------------------------------
    // 2. 10k Folder Open: First Progressive Paint & Full Index Timings
    // -------------------------------------------------------------------------
    console.log('--- 1. 10k Folder Progressive Open & Full Index Benchmark ---');

    let firstChunkTime = 0;
    let firstChunkSize = 0;
    let totalEntriesReceived = 0;
    let chunksCount = 0;
    let maxLoopBlockMs = 0;

    // Monitor event-loop responsiveness during chunked walk
    const heartbeatInterval = 10; // check every 10ms
    let lastHeartbeat = performance.now();
    const heartbeatTimer = setInterval(() => {
      const now = performance.now();
      const delay = now - lastHeartbeat - heartbeatInterval;
      if (delay > maxLoopBlockMs) maxLoopBlockMs = delay;
      lastHeartbeat = now;
    }, heartbeatInterval);

    const coldStart = performance.now();

    const coldResult = await getWorkspaceTreeChunked(fixtureDir, (chunk, isComplete, total) => {
      chunksCount++;
      if (chunksCount === 1) {
        firstChunkTime = Math.round(performance.now() - coldStart);
        firstChunkSize = chunk.length;
      }
      if (isComplete) {
        totalEntriesReceived = total;
      }
    });

    clearInterval(heartbeatTimer);
    const fullIndexTime = Math.round(performance.now() - coldStart);

    console.log(`  First paint chunk: ${firstChunkSize} entries at ${firstChunkTime}ms`);
    console.log(`  Full 10k tree walk: ${coldResult.data?.flatTree?.length || totalEntriesReceived} entries in ${fullIndexTime}ms`);
    console.log(`  Maximum event loop lag observed: ${maxLoopBlockMs.toFixed(1)}ms`);

    // Assert Budgets for 10k folder
    assert(coldResult.success === true, 'getWorkspaceTreeChunked completed successfully');
    assert(
      firstChunkTime < 1500,
      `Budget Met: folder_10k_first_tree_paint < 1500ms progressive (Actual: ${firstChunkTime}ms)`
    );
    assert(
      fullIndexTime < 5000,
      `Budget Met: folder_10k_full_index_background < 5000ms (Actual: ${fullIndexTime}ms)`
    );
    assert(
      maxLoopBlockMs < 50,
      `Budget Met: no_main_thread_block_over_50ms_during_open (Actual lag: ${maxLoopBlockMs.toFixed(1)}ms)`
    );

    // -------------------------------------------------------------------------
    // 3. Second Open: Disk Cache Speedup (>= 3x faster)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Second Open Disk Cache Speedup Benchmark ---');

    const warmStart = performance.now();
    const warmResult = await getWorkspaceTreeChunked(fixtureDir);
    const warmDuration = Math.max(1, Math.round(performance.now() - warmStart));

    assert(warmResult.success === true, 'Second open succeeded');
    assert(warmResult.data?.fromCache === true, 'Second open was loaded directly from disk cache');
    assert(
      warmResult.data?.flatTree?.length === coldResult.data?.flatTree?.length,
      `Cached entry count (${warmResult.data?.flatTree?.length}) matches full walk count`
    );

    const speedupFactor = Math.round((fullIndexTime / warmDuration) * 10) / 10;
    console.log(`  Cold open: ${fullIndexTime}ms | Cached open: ${warmDuration}ms | Speedup: ${speedupFactor}x`);

    assert(
      speedupFactor >= 3.0,
      `Budget Met: second_open_ge_3x_faster >= 3.0x (Actual: ${speedupFactor}x)`
    );

    // -------------------------------------------------------------------------
    // 4. File Open Timings: 1KB File (Warm < 150ms, Cold < 400ms)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. 1KB File Click-to-Editable Benchmark ---');

    const file1KB = path.join(fixtureDir, 'module_000', 'sample_1kb.ts');
    const content1KB = '// Ty-Code Sample 1KB Benchmark File\n'.repeat(30); // ~1KB
    await fs.writeFile(file1KB, content1KB, 'utf-8');

    // Cold read (initial file access)
    const coldFileStart = performance.now();
    const coldFileRes = await fsReadFile(file1KB, fixtureDir);
    const coldFileMs = Math.round(performance.now() - coldFileStart);

    assert(coldFileRes.success === true, 'Cold read of 1KB file succeeded');
    assert(
      coldFileMs < 400,
      `Budget Met: file_open_click_to_editable_small cold < 400ms (Actual: ${coldFileMs}ms)`
    );

    // Warm read (cached model instantiation)
    const warmFileStart = performance.now();
    const warmFileRes = await fsReadFile(file1KB, fixtureDir);
    const warmFileMs = Math.round(performance.now() - warmFileStart);

    assert(warmFileRes.success === true, 'Warm read of 1KB file succeeded');
    assert(
      warmFileMs < 150,
      `Budget Met: file_open_click_to_editable_small warm < 150ms (Actual: ${warmFileMs}ms)`
    );

    // -------------------------------------------------------------------------
    // 5. File Open Timings: 1MB File (Progressive < 1200ms)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. 1MB File Progressive Load Benchmark ---');

    const file1MB = path.join(fixtureDir, 'module_000', 'large_1mb.ts');
    const content1MB = 'export const row = { id: 1, text: "Ty-Code high performance desktop editor" };\n'.repeat(15_000); // ~1.2MB
    await fs.writeFile(file1MB, content1MB, 'utf-8');

    const modelManager = LazyModelManager.getInstance();
    let initialChunkLength = 0;
    let completedContentLength = 0;
    const mbStart = performance.now();

    // Mock electronAPI on global window for LazyModelManager in Node test environment
    (global as any).window = {
      electronAPI: {
        readFile: async (p: string) => ({ success: true, data: await fs.readFile(p, 'utf-8') })
      }
    };

    await modelManager.loadLargeFileProgressively(
      file1MB,
      (chunk) => {
        if (!initialChunkLength) initialChunkLength = chunk.length;
      },
      (full) => {
        completedContentLength = full.length;
      }
    );

    const mbDuration = Math.round(performance.now() - mbStart);
    console.log(`  1MB initial paint chunk: ${initialChunkLength} bytes`);
    console.log(`  1MB full content streamed: ${completedContentLength} bytes in ${mbDuration}ms`);

    assert(initialChunkLength > 0, 'Progressive loader produced initial viewable chunk');
    assert(completedContentLength === content1MB.length, 'Complete 1MB file loaded without corruption');
    assert(
      mbDuration < 1200,
      `Budget Met: file_open_1mb with progressive content < 1200ms (Actual: ${mbDuration}ms)`
    );

    console.log('\n========================================================================');
    console.log(`=== OPEN-PATH PERF SUITE PASSED: ${passedTests}/${totalTests} TESTS             ===`);
    console.log('========================================================================\n');

    return { passed: passedTests, total: totalTests };
  } finally {
    try {
      await fs.rm(fixtureDir, { recursive: true, force: true });
    } catch {}
  }
}


