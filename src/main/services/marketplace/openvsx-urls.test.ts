/**
 * Open VSX client - file URL absolutization tests
 * Root cause of the "missing marketplace logos" bug: Open VSX returns files.*
 * as relative URIs which the renderer resolves against its own origin. The
 * client must hand back fully-qualified https URLs.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { OpenVsxClient } from './openvsx-client';

interface FakeResponse {
  ok: boolean;
  status: number;
  headers: { get: (name: string) => string | null };
  json: () => Promise<unknown>;
}

function jsonResponse(payload: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload
  };
}

function fakeCache() {
  return {
    get: async () => ({ entry: null, isExpired: false }),
    set: async () => undefined,
    touch: async () => undefined
  };
}

const BASE = 'https://open-vsx.org';

function installFetch(response: FakeResponse) {
  const spy = vi.fn(async () => response);
  vi.stubGlobal('fetch', spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('OpenVsxClient file URL absolutization', () => {
  it('absolutizes relative icon/download/readme/changelog URIs in metadata', async () => {
    installFetch(jsonResponse({
      namespace: 'esbenp',
      name: 'prettier-vscode',
      version: '11.5.0',
      displayName: 'Prettier',
      files: {
        icon: '/api/esbenp/prettier-vscode/latest/file/icon.png',
        download: '/api/esbenp/prettier-vscode/latest/file/download',
        readme: '/api/esbenp/prettier-vscode/latest/file/README',
        changelog: '/api/esbenp/prettier-vscode/latest/file/CHANGELOG',
        sha256: 'deadbeef'
      }
    }));

    const client = new OpenVsxClient({ baseUrl: BASE, cache: fakeCache() as never });
    const entry = await client.getMetadata('esbenp', 'prettier-vscode');

    expect(entry).not.toBeNull();
    expect(entry!.iconUrl).toBe(`${BASE}/api/esbenp/prettier-vscode/latest/file/icon.png`);
    expect(entry!.downloadUrl).toBe(`${BASE}/api/esbenp/prettier-vscode/latest/file/download`);
    expect(entry!.readmeUrl).toBe(`${BASE}/api/esbenp/prettier-vscode/latest/file/README`);
    expect(entry!.changelogUrl).toBe(`${BASE}/api/esbenp/prettier-vscode/latest/file/CHANGELOG`);
    expect(entry!.sha256).toBe('deadbeef');
  });

  it('passes through already-absolute https URLs untouched', async () => {
    const cdnIcon = 'https://openvsx.eclipsecontent.org/esbenp/prettier-vscode/latest/icon.png';
    installFetch(jsonResponse({
      namespace: 'esbenp',
      name: 'prettier-vscode',
      version: '1.0.0',
      files: { icon: cdnIcon }
    }));

    const client = new OpenVsxClient({ baseUrl: BASE, cache: fakeCache() as never });
    const entry = await client.getMetadata('esbenp', 'prettier-vscode');

    expect(entry!.iconUrl).toBe(cdnIcon);
    expect(entry!.downloadUrl).toBeUndefined();
  });

  it('drops garbage file values instead of producing broken relative srcs', async () => {
    installFetch(jsonResponse({
      namespace: 'foo',
      name: 'bar',
      version: '1.0.0',
      files: { icon: 'not-a-uri-relative', download: '', changelog: 42 }
    }));

    const client = new OpenVsxClient({ baseUrl: BASE, cache: fakeCache() as never });
    const entry = await client.getMetadata('foo', 'bar');

    expect(entry!.iconUrl).toBeUndefined();
    expect(entry!.downloadUrl).toBeUndefined();
    expect(entry!.changelogUrl).toBeUndefined();
  });

  it('absolutizes every entry in a search result page', async () => {
    installFetch(jsonResponse({
      totalSize: 2,
      extensions: [
        { namespace: 'a', name: 'one', version: '1.0.0', files: { icon: '/api/a/one/latest/file/icon' } },
        { namespace: 'b', name: 'two', version: '1.0.0', files: { download: '/api/b/two/latest/file/download' } }
      ]
    }));

    const client = new OpenVsxClient({ baseUrl: BASE, cache: fakeCache() as never });
    const result = await client.search({ query: 'test' });

    expect(result.extensions).toHaveLength(2);
    expect(result.extensions[0].iconUrl).toBe(`${BASE}/api/a/one/latest/file/icon`);
    expect(result.extensions[0].downloadUrl).toBeUndefined();
    expect(result.extensions[1].downloadUrl).toBe(`${BASE}/api/b/two/latest/file/download`);
  });
});
