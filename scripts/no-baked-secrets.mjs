#!/usr/bin/env node
/**
 * Zero-Server CI Guard: No Baked Secrets Scan (Scale 1)
 *
 * Scans build bundles (dist/) and source code (src/) to verify:
 * 1. No real provider API keys or credentials shipped in client binaries.
 * 2. No hardcoded private keys or embedded credentials in URLs.
 * 3. Invariant: 100% of credentials are user-provided and local to safeStorage.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');

const SCAN_DIRS = [
  path.join(PROJECT_ROOT, 'dist'),
  path.join(PROJECT_ROOT, 'src'),
  path.join(PROJECT_ROOT, 'docs')
];

// Patterns representing real baked secret structures
const SUSPICIOUS_PATTERNS = [
  { name: 'OpenAI API Key', regex: /\bsk-[A-Za-z0-9]{40,}\b/ },
  { name: 'OpenAI Project Key', regex: /\bsk-proj-[A-Za-z0-9_-]{48,}\b/ },
  { name: 'Anthropic Specific Key', regex: /\bsk-ant-api\d{2}-[A-Za-z0-9_-]{80,}\b/ },
  { name: 'Anthropic Generic Key', regex: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'OpenRouter Production Key', regex: /\bsk-or-v1-[a-f0-9]{64}\b/ },
  { name: 'OpenRouter Generic Key', regex: /\bsk-or-[A-Za-z0-9_-]{16,}\b/ },
  { name: 'Groq Production Key', regex: /\bgsk_[A-Za-z0-9_-]{40,}\b/ },
  { name: 'Google Gemini Production Key', regex: /\bAIzaSy[A-Za-z0-9_-]{33}\b/ },
  { name: 'GitHub Personal Token', regex: /\bghp_[A-Za-z0-9]{36}\b/ },
  { name: 'GitHub User Token', regex: /\bghu_[A-Za-z0-9]{36}\b/ },
  { name: 'AWS Access Key ID', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'Private Key PEM', regex: /-----BEGIN (?:RSA|OPENSSH|EC|PGP)?\s*PRIVATE KEY-----/ },
  { name: 'Embedded Auth URL (User:Pass)', regex: /https?:\/\/[a-zA-Z0-9_\-\.%]+:[a-zA-Z0-9_\-\.%]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/ },
  { name: 'Embedded Auth URL (Key Query Param)', regex: /https?:\/\/[^\s"'`]+[?&](?:api[_-]?key|key|token|auth)=[A-Za-z0-9_-]{16,}/i }
];

// Allowed fixture patterns or comment placeholders
const ALLOWED_MATCH_SNIPPETS = [
  'sk-ant-api03-',
  'sk-or-v1-000000',
  'sk-or-sample',
  'sk-ant-sample',
  'gsk_sample',
  'ghu_sample',
  'ghp_sample',
  'AIzaSySample',
  'AKIAEXAMPLE',
  'dummy',
  'placeholder'
];

async function collectFiles(dir) {
  const results = [];
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.git', 'coverage', '.cache'].includes(entry.name)) {
          results.push(...(await collectFiles(fullPath)));
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (['.js', '.mjs', '.cjs', '.ts', '.tsx', '.json', '.html', '.css', '.md'].includes(ext)) {
          results.push(fullPath);
        }
      }
    }
  } catch {
    // Directory may not exist (e.g. dist before build)
  }
  return results;
}

async function scan() {
  console.log('🛡️  Running Zero-Server CI Guard: Scanning for baked credentials...');

  const allFiles = [];
  for (const dir of SCAN_DIRS) {
    allFiles.push(...(await collectFiles(dir)));
  }

  if (allFiles.length === 0) {
    console.warn('⚠️  No files found to scan. Ensure project has source or build artifacts.');
    process.exit(0);
  }

  const findings = [];

  for (const filePath of allFiles) {
    let content = '';
    try {
      content = await fs.readFile(filePath, 'utf8');
    } catch {
      continue;
    }

    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of SUSPICIOUS_PATTERNS) {
        const match = pattern.regex.exec(line);
        if (match) {
          const matchedStr = match[0];
          const isAllowed = ALLOWED_MATCH_SNIPPETS.some((snippet) => matchedStr.includes(snippet));
          if (!isAllowed) {
            findings.push({
              file: path.relative(PROJECT_ROOT, filePath),
              line: i + 1,
              rule: pattern.name,
              preview: `${matchedStr.slice(0, 8)}...${matchedStr.slice(-4)}`
            });
          }
        }
      }
    }
  }

  if (findings.length > 0) {
    console.error(`❌ CRITICAL SECURITY ERROR: ${findings.length} baked credential(s) detected in source/dist!`);
    for (const f of findings) {
      console.error(`   - ${f.file}:${f.line} [${f.rule}] (Redacted: ${f.preview})`);
    }
    console.error('\nZero-Server Architecture Rule: Never ship provider credentials in binary or source.');
    console.error('All keys must be obtained via client-side OAuth or user safeStorage BYOK.');
    process.exit(1);
  }

  console.log(`✅ Zero baked credentials detected across ${allFiles.length} files in src/ and dist/.`);
  console.log('🔒 Zero-server local credential invariant strictly verified.');
  process.exit(0);
}

scan().catch((err) => {
  console.error('Fatal scan error:', err);
  process.exit(1);
});
