#!/usr/bin/env node
/**
 * Ty-Code Campaign Pipeline: Step 1 (Markdown -> Branded HTML)
 * Converts campaign markdown documents into standalone branded HTML documents
 * with print-optimized CSS, typography scale, code block/table preservation,
 * and an executive cover page + table of contents for the whitepaper.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { marked } from 'marked';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..', '..');
const DIST_CAMPAIGN = path.join(ROOT, 'dist', 'campaign');

const CAMPAIGN_FILES = [
  {
    id: 'README',
    src: path.join(ROOT, 'README.md'),
    title: 'Ty-Code: Sovereign Local-First AI IDE',
    subtitle: 'Zero-Telemetry Desktop IDE Built on Monaco, Electron, and Pluggable LLMs',
    isWhitepaper: false,
  },
  {
    id: 'ENTERPRISE-WHITEPAPER',
    src: path.join(ROOT, 'docs', 'ENTERPRISE-WHITEPAPER.md'),
    title: 'Ty-Code Enterprise Architecture & Security Whitepaper',
    subtitle: 'Threat Modeling, Process Isolation, Hardware Credential Sealing, and Multi-Harness Sovereign Compute',
    isWhitepaper: true,
  },
  {
    id: 'INVESTOR-PITCH-DECK',
    src: path.join(ROOT, 'docs', 'INVESTOR-PITCH-DECK.md'),
    title: 'Ty-Code: Investor & Stakeholder Pitch Deck',
    subtitle: '12-Slide Strategic Overview, Unit Economics, and Market Moat',
    isWhitepaper: false,
  },
  {
    id: 'MARKETING-LANDING-PAGE-COPY',
    src: path.join(ROOT, 'docs', 'MARKETING-LANDING-PAGE-COPY.md'),
    title: 'Ty-Code: Marketing Landing Page Copy & Wireframe Guide',
    subtitle: 'Conversion-Optimized B2B Messaging, Feature Grid, and Compliance Matrix',
    isWhitepaper: false,
  },
];

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function extractHeadings(markdown) {
  const headings = [];
  const lines = markdown.split('\n');
  for (const line of lines) {
    const match = line.match(/^(#{1,3})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const rawText = match[2].trim();
      const cleanText = rawText
        .replace(/\*\*/g, '')
        .replace(/\[(.*?)\]\(.*?\)/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
      headings.push({
        level,
        text: cleanText,
        slug: slugify(cleanText),
      });
    }
  }
  return headings;
}

function generateTocHtml(headings) {
  let html = `
  <nav class="toc-container" aria-label="Table of Contents">
    <div class="toc-title">Table of Contents</div>
    <ul class="toc-list">
  `;
  for (const h of headings) {
    // Include h1 and h2 in TOC for clear readability
    if (h.level <= 2) {
      const indentClass = `toc-item-${h.level}`;
      html += `    <li class="${indentClass}"><a href="#${h.slug}">${h.text}</a></li>\n`;
    }
  }
  html += `  </ul>
  </nav>
  `;
  return html;
}

function generateCoverPageHtml(fileMeta) {
  return `
  <section class="page-cover">
    <div class="cover-shield-icon">
      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
        <path d="m9 12 2 2 4-4"/>
      </svg>
    </div>
    <div class="cover-badge">Confidential • Enterprise Architecture Review</div>
    <h1 class="cover-title">${fileMeta.title}</h1>
    <p class="cover-subtitle">${fileMeta.subtitle}</p>
    <div class="cover-divider"></div>
    <div class="cover-meta-grid">
      <div class="cover-meta-item">
        <span class="meta-label">DOCUMENT ID</span>
        <span class="meta-value">TY-ARCH-2026-V1</span>
      </div>
      <div class="cover-meta-item">
        <span class="meta-label">VERSION</span>
        <span class="meta-value">1.0.0 Production</span>
      </div>
      <div class="cover-meta-item">
        <span class="meta-label">SECURITY LEVEL</span>
        <span class="meta-value">Enterprise Standard</span>
      </div>
      <div class="cover-meta-item">
        <span class="meta-label">DATE</span>
        <span class="meta-value">${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
      </div>
    </div>
    <div class="cover-footer-note">
      Strictly Local-First • Zero Cloud Exfiltration • Hardware Credential Sealing
    </div>
  </section>
  `;
}

function getBrandStyles() {
  return `
    :root {
      --bg-dark: #0b0d10;
      --surface-dark: #111827;
      --surface-border: #1f2937;
      --text-main: #f8fafc;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --emerald: #10b981;
      --emerald-glow: rgba(16, 185, 129, 0.15);
      --cyan: #06b6d4;
      --code-bg: #0d1117;
    }

    * {
      box-sizing: border-box;
    }

    body {
      margin: 0;
      padding: 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Inter, Arial, sans-serif;
      font-size: 15px;
      line-height: 1.65;
      background-color: var(--bg-dark);
      color: #e2e8f0;
      -webkit-font-smoothing: antialiased;
    }

    .campaign-wrapper {
      max-width: 980px;
      margin: 0 auto;
      padding: 48px 32px;
    }

    /* Typography Scale */
    h1, h2, h3, h4, h5, h6 {
      color: var(--text-main);
      font-weight: 700;
      line-height: 1.3;
      margin-top: 1.8em;
      margin-bottom: 0.6em;
      break-after: avoid;
      page-break-after: avoid;
    }

    h1 {
      font-size: 2.2rem;
      border-bottom: 1px solid var(--surface-border);
      padding-bottom: 0.3em;
    }

    h2 {
      font-size: 1.6rem;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 0.25em;
    }

    h3 { font-size: 1.25rem; }
    h4 { font-size: 1.1rem; }

    p, li {
      color: #cbd5e1;
      margin-bottom: 1em;
    }

    a {
      color: #38bdf8;
      text-decoration: none;
    }

    a:hover {
      text-decoration: underline;
    }

    strong {
      color: #ffffff;
      font-weight: 600;
    }

    hr {
      border: 0;
      height: 1px;
      background: var(--surface-border);
      margin: 2.5em 0;
    }

    /* Styled Tables */
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 2em 0;
      background: var(--surface-dark);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    th, td {
      padding: 12px 16px;
      border: 1px solid var(--surface-border);
      text-align: left;
      font-size: 0.95rem;
    }

    th {
      background-color: #1e293b;
      color: #f8fafc;
      font-weight: 600;
    }

    tr:nth-child(even) {
      background-color: #0f172a;
    }

    /* Code Blocks and Monospace */
    pre {
      background-color: var(--code-bg);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 16px 20px;
      overflow-x: auto;
      font-family: "JetBrains Mono", Consolas, "Courier New", monospace;
      font-size: 0.9rem;
      line-height: 1.5;
      color: #e2e8f0;
      margin: 1.8em 0;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    code {
      font-family: "JetBrains Mono", Consolas, "Courier New", monospace;
      font-size: 0.9em;
      background-color: rgba(255, 255, 255, 0.08);
      color: #38bdf8;
      padding: 2px 6px;
      border-radius: 4px;
    }

    pre code {
      background: none;
      color: inherit;
      padding: 0;
      border-radius: 0;
    }

    /* Blockquotes */
    blockquote {
      border-left: 4px solid var(--emerald);
      background: var(--emerald-glow);
      margin: 1.8em 0;
      padding: 14px 22px;
      border-radius: 0 8px 8px 0;
      color: #94a3b8;
      break-inside: avoid;
      page-break-inside: avoid;
    }

    blockquote p:last-child {
      margin-bottom: 0;
    }

    /* Whitepaper Cover Page */
    .page-cover {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      text-align: center;
      min-height: 82vh;
      border-bottom: 2px solid var(--emerald);
      margin-bottom: 48px;
      padding: 60px 20px;
      break-after: page;
      page-break-after: always;
    }

    .cover-shield-icon {
      margin-bottom: 24px;
    }

    .cover-badge {
      background: var(--emerald-glow);
      color: var(--emerald);
      padding: 6px 18px;
      border-radius: 9999px;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      border: 1px solid rgba(16, 185, 129, 0.35);
      margin-bottom: 24px;
    }

    .cover-title {
      font-size: 2.8rem;
      font-weight: 800;
      color: #ffffff;
      line-height: 1.2;
      margin: 0 0 16px 0;
      border: none;
      padding: 0;
    }

    .cover-subtitle {
      font-size: 1.25rem;
      color: var(--text-muted);
      max-width: 720px;
      margin: 0 0 36px 0;
      line-height: 1.5;
    }

    .cover-divider {
      width: 80px;
      height: 3px;
      background: var(--emerald);
      margin-bottom: 36px;
      border-radius: 2px;
    }

    .cover-meta-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px 36px;
      background: var(--surface-dark);
      border: 1px solid var(--surface-border);
      padding: 20px 32px;
      border-radius: 8px;
      margin-bottom: 40px;
      max-width: 580px;
      width: 100%;
      text-align: left;
    }

    .cover-meta-item {
      display: flex;
      flex-direction: column;
    }

    .meta-label {
      font-size: 0.72rem;
      color: var(--text-dim);
      font-weight: 700;
      letter-spacing: 0.05em;
      text-transform: uppercase;
    }

    .meta-value {
      font-size: 0.95rem;
      color: #f1f5f9;
      font-weight: 600;
      margin-top: 2px;
    }

    .cover-footer-note {
      font-size: 0.85rem;
      color: var(--emerald);
      font-weight: 600;
      letter-spacing: 0.04em;
    }

    /* Table of Contents */
    .toc-container {
      background: var(--surface-dark);
      border: 1px solid var(--surface-border);
      border-radius: 8px;
      padding: 28px 36px;
      margin: 36px 0 48px 0;
      break-after: page;
      page-break-after: always;
    }

    .toc-title {
      font-size: 1.3rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 18px;
      border-bottom: 1px solid var(--surface-border);
      padding-bottom: 10px;
    }

    .toc-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .toc-item-1 {
      font-weight: 600;
      margin-top: 12px;
    }

    .toc-item-1 a {
      color: #f1f5f9;
    }

    .toc-item-2 {
      font-weight: 400;
      margin-left: 24px;
      margin-top: 6px;
    }

    .toc-item-2 a {
      color: #94a3b8;
    }

    /* Print-Specific Formatting */
    @media print {
      body {
        background-color: #ffffff !important;
        color: #111827 !important;
        font-size: 10.5pt !important;
        line-height: 1.55 !important;
      }

      .campaign-wrapper {
        max-width: 100% !important;
        padding: 0 !important;
        margin: 0 !important;
      }

      h1, h2, h3, h4, h5, h6 {
        color: #0f172a !important;
        border-color: #e2e8f0 !important;
        break-after: avoid !important;
        page-break-after: avoid !important;
      }

      p, li {
        color: #1f2937 !important;
      }

      a {
        color: #0284c7 !important;
        text-decoration: underline !important;
      }

      table {
        background: #ffffff !important;
        border: 1px solid #cbd5e1 !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      th, td {
        border: 1px solid #cbd5e1 !important;
        color: #1f2937 !important;
        padding: 8px 12px !important;
      }

      th {
        background-color: #f1f5f9 !important;
        color: #0f172a !important;
      }

      tr:nth-child(even) {
        background-color: #f8fafc !important;
      }

      pre {
        background-color: #f8fafc !important;
        color: #0f172a !important;
        border: 1px solid #cbd5e1 !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      code {
        background-color: #f1f5f9 !important;
        color: #0369a1 !important;
        border: 1px solid #e2e8f0 !important;
      }

      pre code {
        border: none !important;
        background: none !important;
        color: inherit !important;
      }

      blockquote {
        background-color: #f0fdf4 !important;
        border-left: 4px solid #10b981 !important;
        color: #166534 !important;
        break-inside: avoid !important;
        page-break-inside: avoid !important;
      }

      .page-cover {
        min-height: 90vh !important;
        border-bottom: none !important;
        break-after: page !important;
        page-break-after: always !important;
      }

      .cover-badge {
        background: #ecfdf5 !important;
        color: #059669 !important;
        border-color: #6ee7b7 !important;
      }

      .cover-title {
        color: #0f172a !important;
      }

      .cover-subtitle {
        color: #475569 !important;
      }

      .cover-meta-grid {
        background: #f8fafc !important;
        border: 1px solid #cbd5e1 !important;
      }

      .meta-value {
        color: #0f172a !important;
      }

      .toc-container {
        background: #f8fafc !important;
        border: 1px solid #cbd5e1 !important;
        break-after: page !important;
        page-break-after: always !important;
      }

      .toc-title {
        color: #0f172a !important;
        border-color: #cbd5e1 !important;
      }

      .toc-item-1 a {
        color: #0f172a !important;
      }

      .toc-item-2 a {
        color: #475569 !important;
      }
    }
  `;
}

function buildHtmlDocument(fileMeta, rawMarkdown) {
  const headings = extractHeadings(rawMarkdown);

  // Configure marked renderer with slugs matching the TOC
  const renderer = {
    heading(token) {
      const cleanText = token.text.replace(/<[^>]*>/g, '').trim();
      const slug = slugify(cleanText);
      return `<h${token.depth} id="${slug}">${token.text}</h${token.depth}>\n`;
    },
  };

  marked.use({ renderer });

  const bodyHtml = marked.parse(rawMarkdown);

  let coverHtml = '';
  let tocHtml = '';

  if (fileMeta.isWhitepaper) {
    coverHtml = generateCoverPageHtml(fileMeta);
    tocHtml = generateTocHtml(headings);
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${fileMeta.title}</title>
  <style>
${getBrandStyles()}
  </style>
</head>
<body>
  <div class="campaign-wrapper">
${coverHtml}
${tocHtml}
    <main class="markdown-body">
${bodyHtml}
    </main>
  </div>
</body>
</html>`;
}

export function buildAllHtml() {
  console.log('[build-html] Starting Ty-Code Campaign Markdown -> HTML conversion...');
  fs.mkdirSync(DIST_CAMPAIGN, { recursive: true });

  const outputs = [];

  for (const item of CAMPAIGN_FILES) {
    if (!fs.existsSync(item.src)) {
      console.error(`[build-html] ERROR: Source file not found: ${item.src}`);
      process.exit(1);
    }

    const rawMd = fs.readFileSync(item.src, 'utf-8');
    const htmlContent = buildHtmlDocument(item, rawMd);
    const destPath = path.join(DIST_CAMPAIGN, `${item.id}.html`);

    fs.writeFileSync(destPath, htmlContent, 'utf-8');
    const bytes = fs.statSync(destPath).size;
    console.log(`[build-html]   ✓ Rendered ${item.id}.html (${bytes.toLocaleString()} bytes)`);

    outputs.push({
      id: item.id,
      htmlPath: destPath,
      bytes,
    });
  }

  console.log(`[build-html] Successfully generated ${outputs.length} branded HTML documents in dist/campaign/\n`);
  return outputs;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  buildAllHtml();
}
