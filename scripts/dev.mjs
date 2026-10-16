#!/usr/bin/env node
/**
 * Ty-Code Dev Server Launcher with Port Collision Auto-Cleanup
 *
 * Checks if Vite's port (default: 5173) is occupied. If an orphaned dev process
 * is found, it is terminated gracefully (SIGTERM -> SIGKILL after 5s) before launch.
 * Non-dev processes are preserved and warned.
 *
 * Flags:
 *   --force, -f    Auto-kill orphaned dev processes without interactive prompting
 *   --port, -p <n> Specify an alternative port (default: 5173)
 *
 * Brand: Ty-Code
 */

import { createServer } from 'vite';
import * as esbuild from 'esbuild';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import electron from 'electron';
import { cleanPortConflict, DEFAULT_DEV_PORT } from './port-cleanup.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// CLI Argument Parsing
function parseArgs(args) {
  let port = DEFAULT_DEV_PORT;
  let force = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--force' || arg === '-f') {
      force = true;
    } else if (arg === '--port' || arg === '-p') {
      const next = args[++i];
      if (next && !isNaN(Number(next))) {
        port = Number(next);
      }
    } else if (arg.startsWith('--port=')) {
      const val = arg.split('=')[1];
      if (val && !isNaN(Number(val))) {
        port = Number(val);
      }
    }
  }

  return { port, force };
}

async function runDev() {
  const { port, force } = parseArgs(process.argv.slice(2));

  console.log(`[Dev] Verifying port ${port} availability (force: ${force})...`);
  const cleanupResult = await cleanPortConflict(port, { force, rootDir });

  if (!cleanupResult.success) {
    console.error(`\n❌ [Dev] Startup blocked: ${cleanupResult.message || `Port ${port} is occupied.`}\n`);
    process.exit(1);
  }

  console.log('[Dev] Starting Vite Dev Server...');
  const server = await createServer({
    configFile: path.resolve(rootDir, 'vite.config.ts'),
    server: {
      port
    }
  });

  await server.listen();
  const address = server.httpServer?.address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  const devUrl = `http://localhost:${actualPort}`;
  console.log(`[Dev] Vite server running at: ${devUrl}`);

  console.log('[Dev] Compiling Main and Preload with esbuild...');
  await esbuild.build({
    entryPoints: [path.resolve(rootDir, 'src/main/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron', 'node-pty'],
    outfile: path.resolve(rootDir, 'dist/main/index.js'),
    sourcemap: true
  });

  await esbuild.build({
    entryPoints: [path.resolve(rootDir, 'src/preload/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
    outfile: path.resolve(rootDir, 'dist/preload/index.js'),
    sourcemap: true
  });

  console.log('[Dev] Launching Electron...');
  const electronProcess = spawn(electron, ['.'], {
    cwd: rootDir,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl,
      NODE_ENV: 'development'
    },
    stdio: 'inherit'
  });

  electronProcess.on('close', (code) => {
    console.log(`[Dev] Electron exited with code ${code}`);
    server.close();
    process.exit(code || 0);
  });
}

runDev().catch((err) => {
  console.error('[Dev] Error in dev server runner:', err);
  process.exit(1);
});
