import { defineConfig } from 'vitest/config';

/**
 * Main-process unit tests (Main-side verification harness).
 *
 * Runs pure Node modules under src/main (RouteEventPolicy, ProviderHealthStore,
 * ...) without Electron or the renderer. Renderer tests keep using
 * `test:unit` (vite root src/renderer). Wire-in: `npm run test:unit:main`.
 */
export default defineConfig({
  test: {
    include: ['src/main/**/*.test.ts'],
    environment: 'node',
    // Knowledge-layer tests (wiki generation, semantic indexing) do heavy real-disk +
    // local-embedder I/O. Under full core-count parallelism on a loaded machine they
    // intermittently blow past the 5s default. Raise the per-test budget and cap worker
    // fan-out so disk/CPU contention doesn't produce flaky timeouts.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    maxWorkers: 4
  }
});
