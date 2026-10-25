#!/usr/bin/env node
/**
 * Ty-Code Campaign Pipeline: Step 2 (HTML -> PDF via Electron printToPDF)
 * Executes Electron headlessly without requiring Chromium/Puppeteer downloads,
 * using the project's existing Electron runtime to render pixel-perfect PDFs.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import electronPath from 'electron';
import { buildAllHtml } from './build-html.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const DIST_CAMPAIGN = path.join(ROOT, 'dist', 'campaign');
const RUNNER_SCRIPT = path.join(__dirname, 'electron-pdf-runner.cjs');

const TARGETS = [
  'README',
  'ENTERPRISE-WHITEPAPER',
  'INVESTOR-PITCH-DECK',
  'MARKETING-LANDING-PAGE-COPY',
];

export function buildAllPdf() {
  console.log('[build-pdf] Starting Ty-Code Campaign HTML -> PDF conversion (Electron printToPDF)...');

  // Verify HTML files exist; if not, build them first
  const missingHtml = TARGETS.some(
    (id) => !fs.existsSync(path.join(DIST_CAMPAIGN, `${id}.html`))
  );
  if (missingHtml) {
    console.log('[build-pdf] HTML deliverables missing; triggering build-html first...');
    buildAllHtml();
  }

  // Resolve electron executable
  let electronBin = electronPath;
  if (typeof electronBin !== 'string' || !fs.existsSync(electronBin)) {
    const localCmd = path.join(
      ROOT,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'electron.cmd' : 'electron'
    );
    if (fs.existsSync(localCmd)) {
      electronBin = localCmd;
    } else {
      console.error('[build-pdf] ERROR: Electron binary not found in node_modules.');
      process.exit(1);
    }
  }

  console.log(`[build-pdf] Spawning headless Electron runtime at: ${electronBin}`);

  const result = spawnSync(electronBin, [RUNNER_SCRIPT], {
    cwd: ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      ELECTRON_ENABLE_LOGGING: '0',
    },
  });

  if (result.status !== 0) {
    console.error(`[build-pdf] ERROR: Electron PDF generation failed with exit code ${result.status}`);
    process.exit(result.status || 1);
  }

  // Verify all PDF deliverables exist
  for (const id of TARGETS) {
    const pdfPath = path.join(DIST_CAMPAIGN, `${id}.pdf`);
    if (!fs.existsSync(pdfPath) || fs.statSync(pdfPath).size === 0) {
      console.error(`[build-pdf] ERROR: Expected PDF file was not created or empty: ${pdfPath}`);
      process.exit(1);
    }
  }

  console.log('[build-pdf] All 4 PDF artifacts verified in dist/campaign/\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildAllPdf();
}
