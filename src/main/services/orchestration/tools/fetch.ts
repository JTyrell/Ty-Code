import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';

export const fetchTool: OpenCodeTool = {
  name: 'fetch',
  description: 'Fetch data or web documentation from an HTTP or HTTPS URL.',
  definition: {
    type: 'function',
    function: {
      name: 'fetch',
      description: 'Fetch data or web documentation from an HTTP or HTTPS URL.',
      parameters: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            description: 'The HTTP or HTTPS URL to retrieve.'
          },
          headers: {
            type: 'object',
            description: 'Optional HTTP request headers.'
          },
          timeoutMs: {
            type: 'number',
            description: 'Request timeout in milliseconds (default: 15000).'
          }
        },
        required: ['url']
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    try {
      const urlStr = String(args.url || '');
      if (!urlStr) {
        return { output: 'Error: "url" parameter is required.', isError: true };
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlStr);
      } catch {
        return { output: `Error: Invalid URL format "${urlStr}".`, isError: true };
      }

      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return { output: `Error: Unsupported protocol "${parsedUrl.protocol}". Only http and https are allowed.`, isError: true };
      }

      const timeoutMs = typeof args.timeoutMs === 'number' && args.timeoutMs > 0 ? args.timeoutMs : 15_000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const abortHandler = () => controller.abort();
      if (context.abortSignal) {
        context.abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      try {
        const response = await fetch(parsedUrl.toString(), {
          method: 'GET',
          headers: {
            'User-Agent': 'Ty-Code/1.0 (OpenCode-Agent)',
            ...(typeof args.headers === 'object' && args.headers !== null ? (args.headers as Record<string, string>) : {})
          },
          signal: controller.signal
        });

        clearTimeout(timer);

        const contentType = response.headers.get('content-type') || '';
        let text = await response.text();

        if (text.length > 64_000) {
          text = text.slice(0, 64_000) + '\n\n[Content truncated at 64KB]';
        }

        return {
          output: `HTTP ${response.status} ${response.statusText}\nContent-Type: ${contentType}\n\n${text}`,
          isError: !response.ok,
          metadata: { status: response.status, contentType, length: text.length }
        };
      } finally {
        clearTimeout(timer);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error fetching URL: ${message}`, isError: true };
    }
  }
};
