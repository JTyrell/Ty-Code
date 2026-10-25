#!/usr/bin/env node
/**
 * Ty-Code Campaign Pipeline Master Orchestrator
 * Sequentially executes:
 *   1. Markdown -> Branded HTML (build-html.mjs)
 *   2. HTML -> PDF via Electron printToPDF (build-pdf.mjs)
 *   3. Markdown -> DOCX via Pandoc or html-to-docx fallback (build-docx.mjs)
 *   4. Cryptographic Manifest Generation (build-manifest.mjs)
 *
 * 100% Local, deterministic, zero-network, zero-cloud execution.
 */

import { buildAllHtml } from './build-html.mjs';
import { buildAllPdf } from './build-pdf.mjs';
import { buildAllDocx } from './build-docx.mjs';
import { generateManifest } from './build-manifest.mjs';

async function runCampaignPipeline() {
  const startTime = Date.now();
  console.log('========================================================================');
  console.log('  Ty-Code Campaign Deliverable Pipeline (PDF + DOCX + HTML)');
  console.log('========================================================================\n');

  try {
    // Stage 1: HTML
    console.log('--- [STAGE 1/4] Branded HTML Generation ---');
    buildAllHtml();

    // Stage 2: PDF via Electron printToPDF
    console.log('--- [STAGE 2/4] Headless Electron PDF Generation ---');
    buildAllPdf();

    // Stage 3: DOCX via Pandoc / html-to-docx
    console.log('--- [STAGE 3/4] Microsoft Word (.docx) Generation ---');
    await buildAllDocx();

    // Stage 4: Manifest
    console.log('--- [STAGE 4/4] Cryptographic Manifest & SHA-256 Checksums ---');
    const manifest = generateManifest();

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log('========================================================================');
    console.log(`  CAMPAIGN BUILD PIPELINE COMPLETED OK (${elapsed}s)`);
    console.log(`  Total Deliverables: ${manifest.totalArtifacts} files in dist/campaign/`);
    console.log('========================================================================');
  } catch (err) {
    console.error('\n[campaign-pipeline] FATAL PIPELINE FAILURE:', err);
    process.exit(1);
  }
}

runCampaignPipeline();
