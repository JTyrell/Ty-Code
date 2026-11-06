/**
 * Extension Controls Service unit tests
 * Covers the pure helpers behind the VS Code parity "…" menu (version compare,
 * bisect half-splitting) and the service-level update / bulk-toggle / bisect
 * state machines with mocked manager and registry clients.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mockInstalled: Array<{ id: string; enabled: boolean; isBuiltIn: boolean; manifest: { version: string; displayName?: string } }> = [];
const toggleCalls: Array<{ id: string; enabled: boolean }> = [];
const toggleBehavior: { throwMetadataOnlyFor: Set<string> } = { throwMetadataOnlyFor: new Set() };

vi.mock('../extension-manager', () => ({
  extensionManager: {
    init: vi.fn(async () => undefined),
    getInstalledExtensions: () => mockInstalled.slice(),
    toggleExtension: vi.fn(async (id: string, enabled: boolean) => {
      toggleCalls.push({ id, enabled });
      if (toggleBehavior.throwMetadataOnlyFor.has(id)) {
        throw new Error(`Extension '${id}' execution is disabled (metadata-only record).`);
      }
      const ext = mockInstalled.find((e) => e.id === id);
      if (ext) ext.enabled = enabled;
    })
  }
}));

const metadataMock = vi.fn(async (_ns: string, _name: string) => null as unknown);

vi.mock('../marketplace/openvsx-client', () => ({
  openVsxClient: {
    getMetadata: (ns: string, name: string) => metadataMock(ns, name)
  }
}));

import {
  isVersionNewer,
  splitCandidates,
  ExtensionControlsService
} from './extension-controls';

function addExtension(id: string, version: string, opts: { enabled?: boolean; isBuiltIn?: boolean } = {}) {
  mockInstalled.push({
    id,
    enabled: opts.enabled ?? true,
    isBuiltIn: opts.isBuiltIn ?? false,
    manifest: { version, displayName: `Ext ${id}` }
  });
}

describe('isVersionNewer', () => {
  it('detects minor and patch bumps', () => {
    expect(isVersionNewer('1.2.0', '1.1.9')).toBe(true);
    expect(isVersionNewer('2.0.0', '1.9.9')).toBe(true);
    expect(isVersionNewer('1.0.1', '1.0.0')).toBe(true);
  });

  it('is false for equal or older versions', () => {
    expect(isVersionNewer('1.1.0', '1.1.0')).toBe(false);
    expect(isVersionNewer('1.0.9', '1.1.0')).toBe(false);
    expect(isVersionNewer('0.9.0', '1.0.0')).toBe(false);
  });

  it('compares numeric cores without lexical traps', () => {
    expect(isVersionNewer('1.10.0', '1.9.0')).toBe(true);
    expect(isVersionNewer('10.0.0', '9.0.0')).toBe(true);
  });

  it('handles differing segment counts and pre-release suffixes', () => {
    expect(isVersionNewer('1.2', '1.1.9')).toBe(true);
    expect(isVersionNewer('1.2.0', '1.2')).toBe(false);
    expect(isVersionNewer('1.2.0-rc1', '1.1.0')).toBe(true);
    expect(isVersionNewer('1.2.0-rc1', '1.2.0')).toBe(false);
  });

  it('is false when either side is missing', () => {
    expect(isVersionNewer(undefined, '1.0.0')).toBe(false);
    expect(isVersionNewer('1.1.0', undefined)).toBe(false);
    expect(isVersionNewer('', '')).toBe(false);
  });
});

describe('splitCandidates', () => {
  it('puts the larger half in testHalf for odd counts', () => {
    const { testHalf, keepHalf } = splitCandidates(['a', 'b', 'c']);
    expect(testHalf).toEqual(['a', 'b']);
    expect(keepHalf).toEqual(['c']);
  });

  it('splits even counts evenly', () => {
    const { testHalf, keepHalf } = splitCandidates(['a', 'b', 'c', 'd']);
    expect(testHalf).toEqual(['a', 'b']);
    expect(keepHalf).toEqual(['c', 'd']);
  });

  it('handles single and empty inputs', () => {
    expect(splitCandidates(['only'])).toEqual({ testHalf: ['only'], keepHalf: [] });
    expect(splitCandidates([])).toEqual({ testHalf: [], keepHalf: [] });
  });
});

describe('ExtensionControlsService - auto-update preference', () => {
  let dir: string;
  let service: ExtensionControlsService;

  beforeEach(async () => {
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const path = await import('node:path');
    dir = await fs.mkdtemp(path.join(os.tmpdir(), `tycode-controls-${Date.now()}-${Math.random().toString(36).slice(2)}`));
    service = new ExtensionControlsService(dir);
  });

  it('defaults to enabled when no controls.json exists', async () => {
    expect(await service.getAutoUpdateEnabled()).toBe(true);
  });

  it('persists disable / re-enable round trips', async () => {
    expect(await service.setAutoUpdateEnabled(false)).toBe(false);
    expect(await service.getAutoUpdateEnabled()).toBe(false);
    expect(await service.setAutoUpdateEnabled(true)).toBe(true);
    expect(await service.getAutoUpdateEnabled()).toBe(true);
  });
});

describe('ExtensionControlsService - checkForUpdates', () => {
  beforeEach(() => {
    mockInstalled.length = 0;
    toggleCalls.length = 0;
    metadataMock.mockReset();
    metadataMock.mockResolvedValue(null);
  });

  it('reports an update only when the registry version is newer', async () => {
    addExtension('esbenp.prettier-vscode', '11.0.0');
    addExtension('built.in', '1.0.0', { isBuiltIn: true });
    metadataMock.mockImplementation(async (ns: string, name: string) =>
      ns === 'esbenp' && name === 'prettier-vscode'
        ? { id: 'esbenp.prettier-vscode', version: '11.5.0', displayName: 'Prettier', downloadUrl: 'https://x/y', sha256: 'abc', iconUrl: undefined }
        : null
    );

    const service = new ExtensionControlsService();
    const updates = await service.checkForUpdates();

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      id: 'esbenp.prettier-vscode',
      installedVersion: '11.0.0',
      latestVersion: '11.5.0',
      downloadUrl: 'https://x/y'
    });
    // built-in extensions are never queried
    expect(metadataMock.mock.calls.some(([ns]) => ns === 'built')).toBe(false);
  });

  it('skips malformed ids and registry failures without throwing', async () => {
    addExtension('nodot', '1.0.0');
    addExtension('good.ext', '1.0.0');
    metadataMock.mockImplementation(async (ns: string) => {
      if (ns === 'good') throw new Error('registry down');
      return null;
    });

    const service = new ExtensionControlsService();
    await expect(service.checkForUpdates()).resolves.toEqual([]);
  });
});

describe('ExtensionControlsService - toggleAllExtensions', () => {
  beforeEach(() => {
    mockInstalled.length = 0;
    toggleCalls.length = 0;
    toggleBehavior.throwMetadataOnlyFor.clear();
  });

  it('disables enabled extensions and skips already-compliant ones', async () => {
    addExtension('a.a', '1.0.0', { enabled: true });
    addExtension('b.b', '1.0.0', { enabled: false });

    const service = new ExtensionControlsService();
    const result = await service.toggleAllExtensions(false);

    expect(result.changed).toBe(1);
    expect(toggleCalls).toEqual([{ id: 'a.a', enabled: false }]);
  });

  it('classifies "execution is disabled" failures as metadata-only skips', async () => {
    addExtension('real.one', '1.0.0', { enabled: false });
    addExtension('meta.two', '1.0.0', { enabled: false });
    toggleBehavior.throwMetadataOnlyFor.add('meta.two');

    const service = new ExtensionControlsService();
    const result = await service.toggleAllExtensions(true);

    expect(result.changed).toBe(1);
    expect(result.skippedMetadataOnly).toEqual(['meta.two']);
    expect(result.failed).toEqual([]);
  });
});

describe('ExtensionControlsService - bisect session', () => {
  beforeEach(() => {
    mockInstalled.length = 0;
    toggleCalls.length = 0;
    toggleBehavior.throwMetadataOnlyFor.clear();
  });

  it('startBisect disables the first half of the suspects', async () => {
    ['a.a', 'b.b', 'c.c', 'd.d'].forEach((id) => addExtension(id, '1.0.0'));

    const service = new ExtensionControlsService();
    const state = await service.startBisect();

    expect(state.active).toBe(true);
    expect(state.round).toBe(1);
    expect(state.suspects).toHaveLength(4);
    expect(state.disabledThisRound).toEqual(['a.a', 'b.b']);
    expect(mockInstalled.filter((e) => !e.enabled).map((e) => e.id)).toEqual(['a.a', 'b.b']);
  });

  it('rejects bisect when no user extensions exist', async () => {
    addExtension('built.in', '1.0.0', { isBuiltIn: true });
    const service = new ExtensionControlsService();
    await expect(service.startBisect()).rejects.toThrow(/no installable/i);
  });

  it('narrows to the enabled half when the issue persists', async () => {
    ['a.a', 'b.b', 'c.c', 'd.d'].forEach((id) => addExtension(id, '1.0.0'));
    const service = new ExtensionControlsService();
    await service.startBisect();

    const state = await service.reportBisectRound(true);

    // issue present while a.a/b.b disabled → culprit among c.c/d.d
    expect(state.candidates).toEqual(['c.c', 'd.d']);
    expect(state.round).toBe(2);
    expect(state.disabledThisRound).toEqual(['c.c']);
    expect(state.active).toBe(true);
  });

  it('narrows to the disabled half when the issue disappears', async () => {
    ['a.a', 'b.b', 'c.c', 'd.d'].forEach((id) => addExtension(id, '1.0.0'));
    const service = new ExtensionControlsService();
    await service.startBisect();

    const state = await service.reportBisectRound(false);

    // issue gone → culprit was among the disabled half
    expect(state.candidates).toEqual(['a.a', 'b.b']);
    expect(state.disabledThisRound).toEqual(['a.a']);
  });

  it('identifies the culprit when one candidate remains', async () => {
    ['a.a', 'b.b', 'c.c'].forEach((id) => addExtension(id, '1.0.0'));
    const service = new ExtensionControlsService();
    const started = await service.startBisect();
    expect(started.disabledThisRound).toEqual(['a.a', 'b.b']);

    // issue gone → candidates = disabled half (a.a, b.b), next round disables a.a
    const round2 = await service.reportBisectRound(false);
    expect(round2.candidates).toEqual(['a.a', 'b.b']);

    // issue gone again → culprit is a.a
    const final = await service.reportBisectRound(false);
    expect(final.active).toBe(false);
    expect(final.identified).toBe('a.a');
  });

  it('stopBisect restores the recorded baseline', async () => {
    addExtension('a.a', '1.0.0', { enabled: true });
    addExtension('b.b', '1.0.0', { enabled: true });
    const service = new ExtensionControlsService();
    await service.startBisect(); // disables a.a

    const stopped = await service.stopBisect(true);
    expect(stopped?.active).toBe(false);
    expect(mockInstalled.find((e) => e.id === 'a.a')?.enabled).toBe(true);
    expect(service.getBisectState()).toBeNull();
  });

  it('reporting without an active session fails loudly', async () => {
    const service = new ExtensionControlsService();
    await expect(service.reportBisectRound(true)).rejects.toThrow(/no extension bisect/i);
  });
});
