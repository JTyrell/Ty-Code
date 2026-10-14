import { createServer } from 'vite';
import * as esbuild from 'esbuild';
import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function runDev() {
  console.log('[Dev] Starting Vite Dev Server...');
  const server = await createServer({
    configFile: path.resolve(rootDir, 'vite.config.ts')
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5173;
  const devUrl = `http://localhost:${port}`;
  console.log(`[Dev] Vite server running at: ${devUrl}`);

  console.log('[Dev] Compiling Main and Preload with esbuild...');
  await esbuild.build({
    entryPoints: [path.resolve(rootDir, 'src/main/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'cjs',
    external: ['electron'],
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
  // Find electron binary from node_modules
  const electronBinary = process.platform === 'win32'
    ? path.resolve(rootDir, 'node_modules', '.bin', 'electron.cmd')
    : path.resolve(rootDir, 'node_modules', '.bin', 'electron');

  const electronProcess = spawn(electronBinary, ['.'], {
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
