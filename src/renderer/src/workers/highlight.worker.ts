/**
 * Syntax Highlighting Web Worker
 *
 * Offloads heavy syntax highlighting (highlight.js) from the main renderer thread
 * to eliminate main-thread micro-stutters during fast AI token streaming.
 *
 * Brand: Ty-Code
 */

import hljs from 'highlight.js';

export interface HighlightBlockItem {
  blockId: string;
  code: string;
  language?: string;
}

export interface HighlightWorkerRequest {
  id: string;
  code?: string;
  language?: string;
  blocks?: HighlightBlockItem[];
}

export interface HighlightedBlockResult {
  blockId: string;
  language: string;
  html: string;
}

export interface HighlightWorkerResponse {
  id: string;
  language?: string;
  html?: string;
  blocks?: HighlightedBlockResult[];
  error?: string;
}

function highlightSingle(code: string, language?: string): { html: string; language: string } {
  const normalizedLang = (language || '').toLowerCase().trim();
  if (normalizedLang && hljs.getLanguage(normalizedLang)) {
    try {
      const result = hljs.highlight(code, {
        language: normalizedLang,
        ignoreIllegals: true
      });
      return { html: result.value, language: normalizedLang };
    } catch {
      // Fallback to highlightAuto
    }
  }

  try {
    const auto = hljs.highlightAuto(code);
    return {
      html: auto.value,
      language: auto.language || normalizedLang || 'plaintext'
    };
  } catch {
    return {
      html: code,
      language: normalizedLang || 'plaintext'
    };
  }
}

self.onmessage = (event: MessageEvent<HighlightWorkerRequest>) => {
  const data = event.data;
  const id = data?.id || 'default';

  try {
    // Batch mode: multiple code blocks in one request
    if (Array.isArray(data.blocks)) {
      const results: HighlightedBlockResult[] = data.blocks.map((block) => {
        const { html, language } = highlightSingle(block.code, block.language);
        return {
          blockId: block.blockId,
          language,
          html
        };
      });

      const response: HighlightWorkerResponse = {
        id,
        blocks: results
      };
      self.postMessage(response);
      return;
    }

    // Single code block mode
    const code = data.code ?? '';
    const { html, language } = highlightSingle(code, data.language);

    const response: HighlightWorkerResponse = {
      id,
      language,
      html
    };
    self.postMessage(response);
  } catch (err: unknown) {
    const error = err instanceof Error ? err.message : String(err);
    const response: HighlightWorkerResponse = {
      id,
      html: data.code || '',
      language: data.language || 'plaintext',
      error
    };
    self.postMessage(response);
  }
};
