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
    environment: 'node'
  }
});
