#!/usr/bin/env node
/**
 * Ty-Code Campaign Pipeline: Step 3 (MD -> DOCX)
 * Converts campaign documents into Microsoft Word (.docx) format.
 * Detects whether Pandoc is installed on the host:
 *   - If available: shells out to `pandoc <file>.md -o dist/campaign/<file>.docx --toc`
 *   - If unavailable: falls back to `html-to-docx` npm conversion of the branded HTML.
 * Explicitly logs which conversion path was utilized.
 */

import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';
import HTMLtoDOCX from 'html-to-docx';
import { buildAllHtml } from './build-html.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const DIST_CAMPAIGN = path.join(ROOT, 'dist', 'campaign');

const CAMPAIGN_FILES = [
  {
    id: 'README',
    src: path.join(ROOT, 'README.md'),
    title: 'Ty-Code: Sovereign Local-First AI IDE',
  },
  {
    id: 'ENTERPRISE-WHITEPAPER',
    src: path.join(ROOT, 'docs', 'ENTERPRISE-WHITEPAPER.md'),
    title: 'Ty-Code Enterprise Architecture & Security Whitepaper',
  },
  {
    id: 'INVESTOR-PITCH-DECK',
    src: path.join(ROOT, 'docs', 'INVESTOR-PITCH-DECK.md'),
    title: 'Ty-Code: Investor & Stakeholder Pitch Deck',
  },
  {
    id: 'MARKETING-LANDING-PAGE-COPY',
    src: path.join(ROOT, 'docs', 'MARKETING-LANDING-PAGE-COPY.md'),
    title: 'Ty-Code: Marketing Landing Page Copy & Wireframe Guide',
  },
];

export function findPandoc() {
  try {
    const res = spawnSync('pandoc', ['--version'], { stdio: 'pipe', encoding: 'utf-8' });
    if (res.status === 0) {
      return 'pandoc';
    }
  } catch {
    // Pandoc not directly on PATH
  }

  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || '';
    const cand1 = path.join(localAppData, 'Pandoc', 'pandoc.exe');
    if (fs.existsSync(cand1)) return cand1;

    const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
    const cand2 = path.join(progFiles, 'Pandoc', 'pandoc.exe');
    if (fs.existsSync(cand2)) return cand2;

    const progFiles86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const cand3 = path.join(progFiles86, 'Pandoc', 'pandoc.exe');
    if (fs.existsSync(cand3)) return cand3;
  }

  return null;
}

export async function buildAllDocx() {
  console.log('[build-docx] Starting Ty-Code Campaign DOCX generation...');
  fs.mkdirSync(DIST_CAMPAIGN, { recursive: true });

  const pandocBin = findPandoc();

  if (pandocBin) {
    console.log(`[build-docx] Conversion Engine: PANDOC (found at "${pandocBin}")`);
    for (const item of CAMPAIGN_FILES) {
      const docxPath = path.join(DIST_CAMPAIGN, `${item.id}.docx`);
      const args = [item.src, '-f', 'gfm', '-o', docxPath, '--toc'];

      const res = spawnSync(pandocBin, args, { cwd: ROOT, stdio: 'pipe', encoding: 'utf-8' });
      if (res.status !== 0) {
        console.error(`[build-docx] ERROR: Pandoc failed for ${item.id}:`, res.stderr);
        process.exit(1);
      }

      const bytes = fs.statSync(docxPath).size;
      console.log(`[build-docx]   ✓ [Pandoc] Generated ${item.id}.docx (${bytes.toLocaleString()} bytes)`);
    }
  } else {
    console.log('[build-docx] Conversion Engine: HTML-TO-DOCX (Pandoc not detected on host; using npm fallback)');

    // Ensure HTML sources exist
    const missingHtml = CAMPAIGN_FILES.some(
      (item) => !fs.existsSync(path.join(DIST_CAMPAIGN, `${item.id}.html`))
    );
    if (missingHtml) {
      console.log('[build-docx] Branded HTML missing; generating before DOCX fallback conversion...');
      buildAllHtml();
    }

    for (const item of CAMPAIGN_FILES) {
      const htmlPath = path.join(DIST_CAMPAIGN, `${item.id}.html`);
      const docxPath = path.join(DIST_CAMPAIGN, `${item.id}.docx`);

      const htmlContent = fs.readFileSync(htmlPath, 'utf-8');
      const docxBuffer = await HTMLtoDOCX(htmlContent, null, {
        title: item.title,
        description: 'Ty-Code Official Deliverable',
        table: { row: { cantSplit: true } },
        footer: true,
        pageNumber: true,
      });

      fs.writeFileSync(docxPath, docxBuffer);
      const bytes = fs.statSync(docxPath).size;
      console.log(`[build-docx]   ✓ [html-to-docx] Generated ${item.id}.docx (${bytes.toLocaleString()} bytes)`);
    }
  }

  console.log('[build-docx] All 4 DOCX artifacts verified in dist/campaign/\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildAllDocx();
}
