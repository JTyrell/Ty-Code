import { defineConfig } from 'vitest/config';

/**
 * Stage 6e + Stage 8a integration/service tests (Main-side, headless).
 *
 * These live under `tests/` (NOT `src/main/**`) so the no-mock-agent-path
 * production guard, which forbids stub identifiers inside `src/main/agent`,
 * `src/main/providers` and `src/main/services/fcc`, is never touched. The
 * environment mirrors `vitest.main.config.ts` (pure Node, no renderer/jsdom) so
 * the real AgentEngine loop and the shared workspace cache run exactly as they
 * do in the gated main-process suite. Wire-in: `npm run test:integration`.
 */
export default defineConfig({
  test: {
    include: ['tests/workspace-cache.test.ts', 'tests/integration/**/*.test.ts'],
    environment: 'node',
    testTimeout: 90_000,
    hookTimeout: 30_000,
    maxWorkers: 2
  }
});
