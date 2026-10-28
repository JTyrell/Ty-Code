#!/usr/bin/env node
/**
 * chaos-hook-guard (Autonomous Free-Tier Reliability): CI guard asserting the
 * dev chaos injector is dev-fenced end to end.
 *
 * 1. src/main/index.ts registers `devChaos:fire` ONLY inside an
 *    `if (!app.isPackaged)` block, with the trusted-frame check and the
 *    DevChaosRequestSchema Zod validation.
 * 2. src/main/services/reliability/reliability-sentinel.ts double-guards
 *    queueChaosFault with a packaged-build refusal.
 * 3. Renderer usages of `devChaosInject` live only under src/renderer/src/dev/.
 *
 * Fails the build otherwise. Part of the `test` / `guards` npm chains.
 */

import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const fail = (msg) => {
  console.error(`[chaos-hook-guard] FAIL: ${msg}`);
  process.exit(1);
};

// ---- Guard 1: main-process registration is inside !app.isPackaged ----
const mainIndexPath = path.join(root, 'src', 'main', 'index.ts');
if (!fs.existsSync(mainIndexPath)) fail(`missing ${mainIndexPath}`);
const lines = fs.readFileSync(mainIndexPath, 'utf-8').split(/\r?\n/);
const hits = [];
lines.forEach((line, i) => {
  if (line.includes('devChaos:fire')) hits.push(i);
});
if (hits.length !== 1) fail(`expected exactly 1 'devChaos:fire' registration in src/main/index.ts, found ${hits.length}`);
const handlerIdx = hits[0];

let guardIdx = -1;
for (let i = handlerIdx; i >= Math.max(0, handlerIdx - 80); i--) {
  if (lines[i].includes('if (!app.isPackaged) {')) {
    guardIdx = i;
    break;
  }
}
if (guardIdx === -1) fail("'devChaos:fire' is not preceded by an `if (!app.isPackaged) {` guard");

let depth = 0;
let closedAt = -1;
for (let i = guardIdx; i < lines.length; i++) {
  for (const ch of lines[i]) {
    if (ch === '{') depth += 1;
    else if (ch === '}') depth -= 1;
  }
  if (depth === 0 && i > guardIdx) {
    closedAt = i;
    break;
  }
}
if (closedAt === -1 || closedAt < handlerIdx) fail("'devChaos:fire' registration lies outside the !app.isPackaged block");

const blockText = lines.slice(guardIdx, closedAt + 1).join('\n');
if (!blockText.includes('isTrustedExtensionFrame')) fail('chaos handler lacks the isTrustedExtensionFrame check');
if (!blockText.includes('DevChaosRequestSchema.safeParse')) fail('chaos handler lacks DevChaosRequestSchema validation');

// ---- Guard 2: sentinel queues refuse packaged builds ----
const sentinelPath = path.join(root, 'src', 'main', 'services', 'reliability', 'reliability-sentinel.ts');
if (!fs.existsSync(sentinelPath)) fail(`missing ${sentinelPath}`);
const sentinelLines = fs.readFileSync(sentinelPath, 'utf-8').split(/\r?\n/);
const queueIdx = sentinelLines.findIndex((l) => l.includes('public queueChaosFault'));
if (queueIdx === -1) fail('reliability-sentinel.ts lacks queueChaosFault');
const queueWindow = (sentinelLines.slice(queueIdx, queueIdx + 12) || []).join('\n');
if (!queueWindow.includes('isPackagedBuild()')) fail('queueChaosFault lacks the packaged-build refusal (isPackagedBuild())');

// ---- Guard 3: renderer usage confined to dev tooling ----
const rendererRoot = path.join(root, 'src', 'renderer', 'src');
const offenders = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) {
      const content = fs.readFileSync(full, 'utf-8');
      if (content.includes('devChaosInject') && !full.split(path.sep).includes('dev')) {
        offenders.push(path.relative(root, full));
      }
    }
  }
};
if (fs.existsSync(rendererRoot)) {
  walk(rendererRoot);
  if (offenders.length > 0) fail(`devChaosInject used outside src/renderer/src/dev/: ${offenders.join(', ')}`);
}

console.log('[chaos-hook-guard] OK: chaos injector is dev-fenced (packaging guard + zod payload + dev-only renderer usage).');
