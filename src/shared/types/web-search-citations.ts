/**
 * Prompt E (Step 4) — cited web search rules, as one honest module.
 *
 * Two halves of the same contract, kept together and Electron-free so both
 * the main approval gate and the renderer citation footer can be unit-tested
 * against the exact code that runs in production:
 *
 * 1. `webSearchApprovalReason` — web_search/brave_web_search is the single
 *    networked tool and is approval-gated PER INVOCATION in the agent loop.
 * 2. `extractCitations` — parses the inline [n] markers and the "Sources:"
 *    footer the system prompt requires, so the renderer can verify (and
 *    display) that cited answers actually carry source links.
 */

export const WEB_SEARCH_TOOL_NAMES: ReadonlySet<string> = new Set(['brave_web_search', 'web_search']);

/** True when this tool call is the networked web search. */
export function isWebSearchToolCall(name: string): boolean {
  return WEB_SEARCH_TOOL_NAMES.has(name);
}

/**
 * Approval reason for a web-search tool call, or null for any other tool.
 * The agent loop wires this into its approval chain; a non-null return means
 * the invocation MUST pause for explicit user approval before the engine
 * touches the network. Empty queries still approve (with an honest label) —
 * the gate is per invocation, not per query quality.
 */
export function webSearchApprovalReason(name: string, query: unknown): string | null {
  if (!isWebSearchToolCall(name)) return null;
  const trimmed = typeof query === 'string' ? query.trim() : '';
  return `Search the web for "${trimmed || '(empty query)'}". This leaves the machine: results come from the live internet and will be cited in the answer.`;
}

/** Model-facing instruction appended when a search was denied or failed. */
export const WEB_SEARCH_DEGRADE_NOTE =
  'Answer from your own knowledge instead, and do NOT invent citations or claim sources you did not actually retrieve.';

// ---------------------------------------------------------------------------
// Citation footer parsing (renderer display + verification)
// ---------------------------------------------------------------------------

export interface ParsedSource {
  /** 1-based number exactly as it appears in the footer. */
  index: number;
  title: string;
  url: string;
}

export interface CitationReport {
  /** Inline [1]-style markers present in the body (excluding the footer). */
  inlineMarkers: number[];
  /** Sources parsed from the footer; empty when no footer exists. */
  sources: ParsedSource[];
}

const FOOTER_LINE = /^\s*\[(\d+)\]\s*(?:\[([^\]]+)\]\(([^)]+)\)|(?:-\s*|—\s*)?(https?:\/\/\S+)(\s*(?:-\s*|—\s*)[^\n]*)?)\s*(?:-\s*|—\s*)?(.*)$/;
// Title-first plain form: `[n] Title - https://url`. Two shapes reach the
// same groups: g2/g3 = markdown link, g4 = bare url, g6 = trailing text.
const PLAIN_TITLE_FIRST = /^\s*\[(\d+)\]\s+([^-—\n].*?)\s*(?:-|—)\s+(https?:\/\/\S+)\s*$/;

/**
 * Extract the citation structure from a final answer. Understands both the
 * contract form from the system prompt:
 *
 *   Sources:
 *   [1] Title - https://example.com
 *
 * and the markdown-link form tools/agents often emit:
 *
 *   [1] [Title](https://example.com)
 *
 * Never fabricates: a footer line without a URL is skipped, and text without
 * a "Sources:" section reports zero sources — the absence itself is the
 * signal that the answer made no web claims.
 */
export function extractCitations(text: string): CitationReport {
  const lines = text.split(/\r?\n/);
  const footerStart = findSourcesFooter(lines);
  const body = footerStart === -1 ? lines : lines.slice(0, footerStart);
  const footer = footerStart === -1 ? [] : lines.slice(footerStart);

  const inlineMarkers: number[] = [];
  for (const match of body.join('\n').matchAll(/\[(\d{1,3})\]/g)) {
    const n = Number(match[1]);
    if (n >= 1 && !inlineMarkers.includes(n)) inlineMarkers.push(n);
  }

  const sources: ParsedSource[] = [];
  for (const line of footer) {
    if (/^\s*sources:/i.test(line)) continue;
    // Preferred authored form: `[n] Title - https://url` (title first).
    const plain = PLAIN_TITLE_FIRST.exec(line);
    if (plain) {
      const index = Number(plain[1]);
      const url = plain[3].trim();
      if (!sources.some((s) => s.index === index)) sources.push({ index, title: plain[2].trim() || url, url });
      continue;
    }
    const parsed = FOOTER_LINE.exec(line);
    if (!parsed) continue;
    const index = Number(parsed[1]);
    // Group order differs between the two accepted footer shapes.
    const url = (parsed[3] ?? parsed[4] ?? '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    const title = parsed[2]?.trim() || parsed[6]?.trim() || url;
    if (!sources.some((s) => s.index === index)) {
      sources.push({ index, title: title || url, url });
    }
  }
  return { inlineMarkers, sources };
}

function findSourcesFooter(lines: string[]): number {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (/^\s*#{0,}\s*sources:\s*$/i.test(lines[i]) || /^\s*\**\s*Sources\s*:?\s*\**\s*$/i.test(lines[i])) {
      return i;
    }
  }
  return -1;
}
