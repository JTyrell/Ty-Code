/**
 * Unit & Integration Tests: Dev Server Port Collision Auto-Cleanup
 *
 * Validates:
 * 1. isPortInUse detection
 * 2. getPidsOnPort PID extraction
 * 3. isDevProcess discrimination (dev vs user process)
 * 4. cleanPortConflict termination of orphaned dev server and port reclaiming
 * 5. cleanPortConflict preservation of non-dev user processes
 * 6. Audit logging to scripts/dev-cleanup.log
 *
 * Brand: Ty-Code
 */

import net from 'node:net';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  isPortInUse,
  getPidsOnPort,
  isDevProcess,
  cleanPortConflict,
  logCleanupAction
} from '../scripts/port-cleanup.mjs';

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

export async function runPortCleanupTests(): Promise<{ passed: number; total: number }> {
  console.log('\n========================================================================');
  console.log('=== TEST SUITE: DEV SERVER PORT COLLISION AUTO-CLEANUP               ===');
  console.log('========================================================================\n');

  const projectRoot = path.resolve(__dirname, '..');
  // Dynamically allocate ephemeral test port to prevent collisions with prior test runs or TIME_WAIT sockets
  const testPort = 59100 + Math.floor(Math.random() * 800);

  // 1. isPortInUse test
  console.log('--- 1. Port Availability Detection ---');
  assert(!(await isPortInUse(testPort)), `Port ${testPort} is initially reported as free`);

  const dummyServer = http.createServer((_, res) => res.end('ok'));
  await new Promise<void>((resolve) => dummyServer.listen(testPort, '127.0.0.1', () => resolve()));

  assert(await isPortInUse(testPort), `Port ${testPort} is reported as in use when server listening`);

  // 2. getPidsOnPort test
  console.log('\n--- 2. PID Discovery on Port ---');
  const detectedPids = getPidsOnPort(testPort);
  console.log(`  Discovered PIDs on port ${testPort}:`, detectedPids);
  assert(detectedPids.length > 0, `Discovered at least 1 PID on port ${testPort}`);
  assert(detectedPids.includes(process.pid), `Detected PIDs includes current process PID (${process.pid})`);

  await new Promise<void>((resolve) => dummyServer.close(() => resolve()));
  assert(!(await isPortInUse(testPort)), `Port ${testPort} is free after close`);

  // 3. Process pattern discrimination
  console.log('\n--- 3. Dev vs User Process Discrimination ---');
  assert(isDevProcess('node .../vite/bin/vite.js', 'node.exe'), 'Matches Vite process');
  assert(isDevProcess('electron . --enable-logging', 'electron.exe'), 'Matches Electron process');
  assert(isDevProcess('node scripts/dev.mjs', 'node.exe'), 'Matches dev.mjs script');
  assert(isDevProcess('C:\\project\\ty-code\\node_modules\\esbuild', 'esbuild.exe'), 'Matches esbuild process');
  assert(!isDevProcess('python -m http.server 5173', 'python.exe'), 'Preserves Python server process');
  assert(!isDevProcess('postgres -D /usr/local/var/postgres', 'postgres.exe'), 'Preserves PostgreSQL process');
  assert(!isDevProcess('java -jar spring-boot-app.jar', 'java.exe'), 'Preserves Java process');

  // 4. Stale dev process termination and port reclaiming
  console.log('\n--- 4. Stale Dev Process Auto-Cleanup & Port Reclaiming ---');
  const tmpDir = path.resolve(projectRoot, '.tmp-live-e2e');
  fs.mkdirSync(tmpDir, { recursive: true });

  const fakeViteScript = path.join(tmpDir, 'fake-vite-server.cjs');
  fs.writeFileSync(
    fakeViteScript,
    `const http = require('http');
const s = http.createServer((q, r) => r.end('orphan')).listen(${testPort}, '127.0.0.1', () => {
  process.stdout.write('ORPHAN_READY\\n');
});`
  );

  const fakeUserScript = path.join(tmpDir, 'custom-database-service.cjs');
  fs.writeFileSync(
    fakeUserScript,
    `const http = require('http');
const s = http.createServer((q, r) => r.end('user')).listen(${testPort}, '127.0.0.1', () => {
  process.stdout.write('USER_READY\\n');
});`
  );

  // Spawn child pretending to be an orphaned vite dev server (with script arg)
  const orphanChild = spawn(process.execPath, [fakeViteScript, '--dev-server=vite'], {
    stdio: ['ignore', 'pipe', 'inherit']
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for ORPHAN_READY')), 5000);
      orphanChild.stdout?.on('data', (d) => {
        if (d.toString().includes('ORPHAN_READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
      orphanChild.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    assert(await isPortInUse(testPort), `Orphan child bound to port ${testPort}`);

    // Execute cleanPortConflict with force: true
    const cleanupRes = await cleanPortConflict(testPort, { force: true, rootDir: projectRoot });
    console.log('  Cleanup result:', cleanupRes);

    assert(cleanupRes.success, 'cleanPortConflict returned success: true');
    assert(cleanupRes.killedPids.includes(orphanChild.pid!), `Killed PIDs includes orphan child PID (${orphanChild.pid})`);
    assert(!(await isPortInUse(testPort)), `Port ${testPort} is free following cleanPortConflict`);
  } finally {
    try {
      orphanChild.kill();
    } catch {}
  }

  // 5. Non-dev user process protection
  console.log('\n--- 5. Non-Dev User Process Protection ---');
  const userChild = spawn(process.execPath, [fakeUserScript, '--custom-db-service'], {
    stdio: ['ignore', 'pipe', 'inherit']
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timeout waiting for USER_READY')), 5000);
      userChild.stdout?.on('data', (d) => {
        if (d.toString().includes('USER_READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
      userChild.on('error', (err) => {
        clearTimeout(timer);
        reject(err);
      });
    });

    const userCleanupRes = await cleanPortConflict(testPort, { force: false, rootDir: projectRoot });
    assert(!userCleanupRes.success, 'cleanPortConflict preserved non-dev user process and returned success: false');
    assert(Boolean(userCleanupRes.message && userCleanupRes.message.includes('--port')), 'Returned actionable message suggesting --port');
    assert(await isPortInUse(testPort), 'User process was NOT terminated and port remains bound');
  } finally {
    try {
      userChild.kill();
    } catch {}
  }

  // 6. Audit log verification
  console.log('\n--- 6. Audit Log Verification ---');
  const logPath = path.resolve(projectRoot, 'scripts/dev-cleanup.log');
  assert(fs.existsSync(logPath), 'scripts/dev-cleanup.log exists');

  const logContent = fs.readFileSync(logPath, 'utf8');
  assert(logContent.includes('[FORCE_AUTOKILL]') || logContent.includes('[AUTO_CLEANUP]'), 'Audit log records cleanup actions');
  assert(logContent.includes('[USER_PROCESS_PRESERVED]'), 'Audit log records user process preservation');

  console.log('\n========================================================================');
  console.log(`=== PORT CLEANUP SUITE PASSED: ${passedTests}/${totalTests} TESTS               ===`);
  console.log('========================================================================\n');

  return { passed: passedTests, total: totalTests };
}

if (typeof require !== 'undefined' && require.main === module) {
  runPortCleanupTests()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
