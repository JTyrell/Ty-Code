/**
 * Prompt C Step 1 — Wiki service tests.
 *
 * The locked route is mocked (no network, no Electron); the file walker + writes
 * run against a real temp workspace so drift and the on-disk wiki are exercised
 * for real. Guarantees asserted:
 *  - generate writes all six sections + index.json and flips status to fresh;
 *  - a fresh wiki short-circuits WITHOUT calling the model again;
 *  - editing >= threshold source files makes status stale (hash-driven, no model);
 *  - section-level search ranks the section containing the matched term first;
 *  - with no configured route, generate reports an honest failure and writes NO
 *    fabricated document.
 */

import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ---- locked-route seam ----
const route = vi.hoisted(() => ({
  active: { providerId: 'mock-prov', modelId: 'mock-model', isAutoMode: false },
  calls: 0,
  bodyFor: (user: string): string => {
    if (user.includes('OVERVIEW section')) return 'Overview body contains ZEBRA.';
    if (user.includes('ARCHITECTURE section')) return 'Architecture body contains KOALA.';
    if (user.includes('MODULES')) return 'Modules body lists packages.';
    if (user.includes('DATA FLOW section')) return 'Data flow body.';
    if (user.includes('API SURFACE section')) return 'API surface body.';
    if (user.includes('CONVENTIONS')) return 'Conventions body.';
    return 'Generic section body.';
  }
}));

vi.mock('../../providers/provider-gateway', () => ({
  getActiveModel: () => route.active,
  sendChatRequest: async (_p: string, _m: string, messages: Array<{ role: string; content: string }>) => {
    route.calls++;
    const user = messages.map((mm) => mm.content).join('\n');
    return route.bodyFor(user);
  }
}));

// ---- context-engine profile seam (no real scanning / no git dependency) ----
vi.mock('../context-engine/workspace-scanner', () => ({
  getOrScanWorkspaceProfile: async () => ({
    primaryLanguage: 'TypeScript',
    frameworks: ['Electron'],
    databases: [],
    architecture: 'Monorepo',
    keyDirectories: { src: 'src' },
    missingContext: [],
    lastScanned: Date.now()
  })
}));

import { wikiService } from './wiki-service';
import { WIKI_DIR, WIKI_SECTIONS } from '../../../shared/types/wiki';

let dir = '';
const wikiPath = (...seg: string[]) => path.join(dir, WIKI_DIR, ...seg);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tycode-wiki-'));
  fs.writeFileSync(path.join(dir, 'package.json'), '{"name":"demo"}', 'utf-8');
  // Six source files so the workspace has real content to snapshot.
  for (let i = 0; i < 6; i++) {
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', `file${i}.ts`), `export const a${i} = 1;\n`, 'utf-8');
  }
  route.calls = 0;
  route.active = { providerId: 'mock-prov', modelId: 'mock-model', isAutoMode: false };
});

afterEach(() => {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    /* best-effort temp cleanup */
  }
});

describe('wiki-service', () => {
  it('reports a missing wiki as stale and non-existent', async () => {
    const status = await wikiService.status(dir);
    expect(status.exists).toBe(false);
    expect(status.stale).toBe(true);
    expect(status.sections).toHaveLength(0);
  });

  it('generates all six sections + index.json, then reports fresh', async () => {
    const res = await wikiService.generate(dir, { force: true });
    expect(res.generated).toBe(true);
    expect(res.reason).toBe('generated');
    expect(route.calls).toBe(WIKI_SECTIONS.length);
    for (const s of WIKI_SECTIONS) {
      expect(fs.existsSync(wikiPath(`${s}.md`))).toBe(true);
    }
    expect(fs.existsSync(wikiPath('index.json'))).toBe(true);

    const after = await wikiService.status(dir);
    expect(after.exists).toBe(true);
    expect(after.stale).toBe(false);
    expect(after.changedFiles).toBe(0);
    expect(after.sections.map((x) => x.id).sort()).toEqual([...WIKI_SECTIONS].sort());
  });

  it('skips the model entirely when fresh and not forced', async () => {
    await wikiService.generate(dir, { force: true });
    const before = route.calls;
    const res = await wikiService.generate(dir, { force: false });
    expect(res.generated).toBe(false);
    expect(res.reason).toBe('fresh');
    expect(route.calls).toBe(before); // no additional LLM calls
  });

  it('detects drift from content hashes once the threshold of files changes', async () => {
    await wikiService.generate(dir, { force: true });
    // Mutate 5 source files (the default WIKI_DRIFT_FILE_THRESHOLD).
    for (let i = 0; i < 5; i++) {
      fs.writeFileSync(path.join(dir, 'src', `file${i}.ts`), `export const a${i} = 2;\n`, 'utf-8');
    }
    const status = await wikiService.status(dir);
    expect(status.stale).toBe(true);
    expect(status.changedFiles).toBeGreaterThanOrEqual(5);
  });

  it('ranks the section containing the matched term first', async () => {
    await wikiService.generate(dir, { force: true });
    const hits = await wikiService.search(dir, 'KOALA', 3);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].section).toBe('architecture');
    expect(hits[0].snippet.toLowerCase()).toContain('koala');
  });

  it('fails honestly with no route and writes no fabricated document', async () => {
    route.active = { providerId: '', modelId: '', isAutoMode: true };
    const res = await wikiService.generate(dir, { force: true });
    expect(res.generated).toBe(false);
    expect(res.reason).toBe('llm-unavailable');
    expect(route.calls).toBe(0);
    expect(fs.existsSync(wikiPath('index.json'))).toBe(false);
    expect(fs.existsSync(wikiPath('overview.md'))).toBe(false);
  });
});
