/**
 * Dedicated Worker Thread for Brave Browser Automation
 *
 * Runs all Playwright actions inside an isolated Node.js Worker Thread.
 * CRITICAL PERFORMANCE & RESPONSIVENESS REQUIREMENT:
 * Heavy browser automation, navigation, and DOM parsing are completely offloaded
 * from the Electron Main Thread, guaranteeing zero event-loop blocking (<16ms)
 * and 60fps UI rendering in the Electron shell.
 *
 * Brand: Ty-Code
 */

import { parentPort, isMainThread } from 'node:worker_threads';
import { launchBraveGuestMode, closeBraveSession, getPrimaryBraveSession } from './brave-automation';
import type { Page } from 'playwright-core';

export interface WorkerJobRequest {
  id: string;
  type: 'search' | 'navigate' | 'get_content' | 'close';
  payload?: any;
}

export interface SearchResultItem {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchJobResult {
  query: string;
  engine: 'brave' | 'duckduckgo';
  url: string;
  title: string;
  results: SearchResultItem[];
  text: string;
}

export interface NavigationJobResult {
  url: string;
  title: string;
  status: number;
  ok: boolean;
}

export interface ContentJobResult {
  url: string;
  title: string;
  content: string;
  text: string;
}

/**
 * Ensures an active, isolated Brave Guest session is available and returns the active page.
 */
async function getOrCreateActivePage(): Promise<Page> {
  let session = getPrimaryBraveSession();
  if (!session) {
    await launchBraveGuestMode(undefined, { headless: true });
    session = getPrimaryBraveSession();
  }

  if (!session) {
    throw new Error('Failed to initialize Brave Guest Mode automation session');
  }

  return session.activePage;
}

/**
 * Executes a privacy-first web search inside Brave Guest Mode.
 * Attempts Brave Search first; gracefully falls back to DuckDuckGo HTML if challenged.
 */
export async function executeSearch(query: string): Promise<SearchJobResult> {
  const page = await getOrCreateActivePage();
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error('Search query cannot be empty');
  }

  // 1. Attempt Brave Search
  const braveSearchUrl = `https://search.brave.com/search?q=${encodeURIComponent(trimmed)}`;
  await page.goto(braveSearchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
  await page.waitForTimeout(1000);

  let title = await page.title();
  let isChallenged = title.toLowerCase().includes('captcha') || title.toLowerCase().includes('robot');

  let engine: 'brave' | 'duckduckgo' = 'brave';
  let activeUrl = page.url();

  // 2. If challenged by anti-bot, fallback to DuckDuckGo HTML
  if (isChallenged) {
    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(trimmed)}`;
    await page.goto(ddgUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await page.waitForTimeout(1000);
    title = await page.title();
    engine = 'duckduckgo';
    activeUrl = page.url();
  }

  // 3. Extract search result snippets
  const results = await page.evaluate(() => {
    const items: SearchResultItem[] = [];

    // Brave search selector candidates
    const braveSnippets = document.querySelectorAll('[data-type="web"], .snippet, .result');
    for (const el of braveSnippets) {
      const titleEl = el.querySelector('a h2, a h3, .title, a');
      const snippetEl = el.querySelector('.snippet-description, .generic-desc, p');
      const linkEl = el.querySelector('a[href^="http"]');
      if (titleEl && linkEl) {
        items.push({
          title: titleEl.textContent?.trim() || '',
          url: linkEl.getAttribute('href') || '',
          snippet: snippetEl?.textContent?.trim() || ''
        });
      }
    }

    // DuckDuckGo fallback selectors if brave snippets yielded 0
    if (items.length === 0) {
      const ddgResults = document.querySelectorAll('.result, .web-result');
      for (const el of ddgResults) {
        const titleEl = el.querySelector('.result__title, .result__a, h2');
        const snippetEl = el.querySelector('.result__snippet');
        const linkEl = el.querySelector('.result__url, a[href^="http"]');
        if (titleEl) {
          items.push({
            title: titleEl.textContent?.trim() || '',
            url: linkEl?.getAttribute('href') || '',
            snippet: snippetEl?.textContent?.trim() || ''
          });
        }
      }
    }

    return items.slice(0, 10);
  });

  const text = await page.evaluate(() => document.body?.innerText?.slice(0, 10000) || '');

  return {
    query: trimmed,
    engine,
    url: activeUrl,
    title,
    results,
    text
  };
}

/**
 * Navigates the guest browser page to the specified URL.
 */
export async function executeNavigate(targetUrl: string): Promise<NavigationJobResult> {
  const page = await getOrCreateActivePage();

  let formattedUrl = targetUrl.trim();
  if (!/^https?:\/\//i.test(formattedUrl)) {
    formattedUrl = `http://${formattedUrl}`;
  }

  const response = await page.goto(formattedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  const title = await page.title();

  return {
    url: page.url(),
    title,
    status: response?.status() ?? 200,
    ok: response ? response.ok() : true
  };
}

/**
 * Extracts the current DOM content and inner text from the active page.
 */
export async function executeGetContent(): Promise<ContentJobResult> {
  const page = await getOrCreateActivePage();

  const title = await page.title();
  const content = await page.content();
  const text = await page.evaluate(() => document.body?.innerText || '');

  return {
    url: page.url(),
    title,
    content,
    text
  };
}

/**
 * Gracefully shuts down the browser session and wipes temporary guest files.
 */
export async function executeClose(): Promise<{ closed: boolean }> {
  await closeBraveSession();
  return { closed: true };
}

// ---------------------------------------------------------------------------
// Worker Thread Message Dispatcher
// ---------------------------------------------------------------------------
if (!isMainThread && parentPort) {
  parentPort.on('message', async (request: WorkerJobRequest) => {
    if (!request || !request.id || !request.type) return;

    try {
      let result: any;
      switch (request.type) {
        case 'search':
          result = await executeSearch(request.payload?.query || '');
          break;
        case 'navigate':
          result = await executeNavigate(request.payload?.url || '');
          break;
        case 'get_content':
          result = await executeGetContent();
          break;
        case 'close':
          result = await executeClose();
          break;
        default:
          throw new Error(`Unknown job type: ${(request as any).type}`);
      }

      parentPort?.postMessage({
        id: request.id,
        success: true,
        data: result
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      parentPort?.postMessage({
        id: request.id,
        success: false,
        error: errorMsg
      });
    }
  });

  process.on('uncaughtException', (err) => {
    console.error('[BraveWorker] Uncaught exception in worker thread:', err);
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[BraveWorker] Unhandled rejection in worker thread:', reason);
  });
}
