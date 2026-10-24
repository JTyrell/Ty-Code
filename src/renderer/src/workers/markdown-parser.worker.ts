/**
 * Markdown Parser Web Worker (with KaTeX Math Support)
 *
 * Offloads heavy Markdown parsing and LaTeX typesetting from the main renderer thread
 * to ensure 60fps stutter-free token streaming.
 *
 * Brand: Ty-Code
 */

import { marked } from 'marked';
import katex from 'katex';

// Configure marked with GitHub Flavored Markdown (GFM) and line breaks
marked.setOptions({
  gfm: true,
  breaks: true
});

export interface MarkdownWorkerRequest {
  id: string;
  markdown: string;
}

export interface MarkdownWorkerResponse {
  id: string;
  html: string;
  error?: string;
}

function renderMathWithKaTeX(rawMarkdown: string): string {
  if (!rawMarkdown) return '';

  const codeBlocks = new Map<string, string>();
  let codeIndex = 0;

  // 1. Protect code blocks (multiline fences and inline backtick code) from math parsing
  let text = rawMarkdown.replace(/(```[\s\S]*?```|`[^`\n]+`)/g, (match) => {
    const placeholder = `TYCODECODEPLACEHOLDER${codeIndex++}TOKEN`;
    codeBlocks.set(placeholder, match);
    return placeholder;
  });

  const mathBlocks = new Map<string, string>();
  let mathIndex = 0;

  // 2. Block math: $$ ... $$ and \[ ... \]
  text = text.replace(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\])/g, (match) => {
    let clean = match.trim();
    if (clean.startsWith('$$') && clean.endsWith('$$')) {
      clean = clean.slice(2, -2).trim();
    } else if (clean.startsWith('\\[') && clean.endsWith('\\]')) {
      clean = clean.slice(2, -2).trim();
    }

    let rendered = match;
    try {
      rendered = katex.renderToString(clean, { displayMode: true, throwOnError: false });
    } catch {
      rendered = match;
    }
    const placeholder = `TYCODEMATHBLOCK${mathIndex++}TOKEN`;
    mathBlocks.set(placeholder, rendered);
    return placeholder;
  });

  // 3. Inline math: $\(\pi^2\)$, $(\pi^2)$, \( ... \), or $ ... $
  text = text.replace(/(\$\\\([\s\S]+?\\\)\$|\$\([\s\S]+?\)\$|\\\([\s\S]+?\\\)|(?<!\\)\$([^\$\n]+?)(?<!\\)\$)/g, (match) => {
    let clean = match.trim();
    if (clean.startsWith('$\\(') && clean.endsWith('\\)$')) {
      clean = clean.slice(3, -3).trim();
    } else if (clean.startsWith('$(') && clean.endsWith(')$')) {
      clean = clean.slice(2, -2).trim();
    } else if (clean.startsWith('\\(') && clean.endsWith('\\)')) {
      clean = clean.slice(2, -2).trim();
    } else if (clean.startsWith('$') && clean.endsWith('$')) {
      clean = clean.slice(1, -1).trim();
    }

    // Skip if it looks like currency (e.g. $10 or $20.00)
    if (/^\d+(?:\.\d+)?$/.test(clean)) return match;

    let rendered = match;
    try {
      rendered = katex.renderToString(clean, { displayMode: false, throwOnError: false });
    } catch {
      rendered = match;
    }
    const placeholder = `TYCODEMATHINLINE${mathIndex++}TOKEN`;
    mathBlocks.set(placeholder, rendered);
    return placeholder;
  });

  // 4. Restore code blocks before marked parsing so code fences are parsed properly
  for (const [placeholder, code] of codeBlocks.entries()) {
    text = text.split(placeholder).join(code);
  }

  // 5. Parse markdown with marked
  let html = marked.parse(text);
  if (typeof html !== 'string') {
    html = String(html);
  }

  // 6. Restore rendered KaTeX math HTML into the final HTML
  for (const [placeholder, mathHtml] of mathBlocks.entries()) {
    html = html.split(placeholder).join(mathHtml);
  }

  return html;
}

// Dedicated worker global scope handler
self.onmessage = async (event: MessageEvent<MarkdownWorkerRequest | string>) => {
  const data = event.data;
  const id = typeof data === 'object' && data !== null ? data.id : 'default';
  const rawMarkdown = typeof data === 'object' && data !== null ? data.markdown : String(data);

  try {
    const parsedHtml = renderMathWithKaTeX(rawMarkdown || '');
    const response: MarkdownWorkerResponse = {
      id,
      html: parsedHtml
    };
    self.postMessage(response);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    const response: MarkdownWorkerResponse = {
      id,
      html: rawMarkdown || '',
      error
    };
    self.postMessage(response);
  }
};
