/**
 * Markdown Parser Web Worker
 *
 * Offloads heavy Markdown parsing from the main renderer thread to ensure 60fps
 * stutter-free token streaming.
 *
 * Brand: Ty-Code
 */

import { marked } from 'marked';

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

// Dedicated worker global scope handler
self.onmessage = async (event: MessageEvent<MarkdownWorkerRequest | string>) => {
  const data = event.data;
  const id = typeof data === 'object' && data !== null ? data.id : 'default';
  const rawMarkdown = typeof data === 'object' && data !== null ? data.markdown : String(data);

  try {
    const parsedHtml = await marked.parse(rawMarkdown || '');
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
