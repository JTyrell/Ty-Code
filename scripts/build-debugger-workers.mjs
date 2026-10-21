#!/usr/bin/env node
/**
 * Compiles the Omni-Debugger worker threads into their standalone runtime
 * bundles. Worker files cannot live inside the main-process bundle:
 *
 *   - static-worker.js  -> detached Worker Thread (node:worker_threads)
 *   - arch-worker.js    -> detached Worker Thread (node:worker_threads)
 *   - dynamic-sandbox.js -> sandboxed child spawned via child_process.fork
 *
 * Both spawn targets must be real .js files on disk at
 * dist/main/workers/<name>.js, which is exactly what
 * src/main/services/debugger-engines/runtime-paths.ts resolves at runtime.
 *
 * `typescript` is bundled into the static worker because it is a devDependency
 * and electron-builder strips devDependencies from the packaged node_modules.
 */

import { build } from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(scriptDir, '..');

const WORKER_ENTRIES = ['static-worker', 'arch-worker', 'dynamic-sandbox'];

export async function buildDebuggerWorkers(root = rootDir) {
  await Promise.all(
    WORKER_ENTRIES.map((name) =>
      build({
        entryPoints: [path.join(root, 'src/main/services/debugger-engines/workers', `${name}.ts`)],
        bundle: true,
        platform: 'node',
        target: 'node20',
        format: 'cjs',
        external: ['electron'],
        outfile: path.join(root, 'dist/main/workers', `${name}.js`),
        sourcemap: true,
        logLevel: 'warning'
      })
    )
  );
}

const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) {
  buildDebuggerWorkers()
    .then(() => {
      console.log(`[Workers] Bundled ${WORKER_ENTRIES.length} debugger workers -> dist/main/workers/`);
    })
    .catch((error) => {
      console.error('[Workers] Failed to bundle debugger workers:', error);
      process.exit(1);
    });
}
