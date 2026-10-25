#!/usr/bin/env node
/**
 * Ty-Code Campaign Pipeline: Manifest Generator
 * Scans dist/campaign/ for all generated deliverables (.html, .pdf, .docx),
 * computes cryptographic SHA-256 hashes, records file sizes, and generates
 * dist/campaign/manifest.json.
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const DIST_CAMPAIGN = path.join(ROOT, 'dist', 'campaign');
const MANIFEST_PATH = path.join(DIST_CAMPAIGN, 'manifest.json');

const KNOWN_TARGETS = [
  { id: 'README', exts: ['.html', '.pdf', '.docx'] },
  { id: 'ENTERPRISE-WHITEPAPER', exts: ['.html', '.pdf', '.docx'] },
  { id: 'INVESTOR-PITCH-DECK', exts: ['.html', '.pdf', '.docx', '.pptx'] },
  { id: 'MARKETING-LANDING-PAGE-COPY', exts: ['.html', '.pdf', '.docx'] },
];

function sha256(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

export function generateManifest() {
  console.log('[build-manifest] Generating campaign delivery manifest...');

  if (!fs.existsSync(DIST_CAMPAIGN)) {
    console.error(`[build-manifest] ERROR: Campaign directory does not exist: ${DIST_CAMPAIGN}`);
    process.exit(1);
  }

  const generatedAt = new Date().toISOString();
  const artifacts = [];

  for (const item of KNOWN_TARGETS) {
    for (const ext of item.exts) {
      const filename = `${item.id}${ext}`;
      const filePath = path.join(DIST_CAMPAIGN, filename);

      if (!fs.existsSync(filePath)) {
        console.warn(`[build-manifest] WARNING: Missing expected artifact: ${filename}`);
        continue;
      }

      const stats = fs.statSync(filePath);
      const hash = sha256(filePath);

      artifacts.push({
        file: filename,
        bytes: stats.size,
        sha256: hash,
        generatedAt,
      });

      console.log(`[build-manifest]   ✓ ${filename} [${stats.size.toLocaleString()} bytes] SHA256: ${hash.slice(0, 16)}...`);
    }
  }

  const manifestPayload = {
    pipeline: 'Ty-Code Local Campaign Build Pipeline',
    version: '1.0.0',
    generatedAt,
    totalArtifacts: artifacts.length,
    artifacts,
  };

  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifestPayload, null, 2) + '\n', 'utf-8');
  console.log(`[build-manifest] Manifest successfully emitted to dist/campaign/manifest.json (${artifacts.length} artifacts recorded).\n`);
  return manifestPayload;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  generateManifest();
}
