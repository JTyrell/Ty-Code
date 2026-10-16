import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-code-test-release-'));

try {
  const releaseBundle = path.join(temporaryRoot, 'release.mjs');
  const downloadBundle = path.join(temporaryRoot, 'download.mjs');
  const libBundle = path.join(temporaryRoot, 'releases-lib.mjs');

  await Promise.all([
    build({
      entryPoints: [path.join(projectRoot, 'functions/api/release.ts')],
      outfile: releaseBundle,
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [path.join(projectRoot, 'functions/api/download/[file].ts')],
      outfile: downloadBundle,
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      logLevel: 'silent'
    }),
    build({
      entryPoints: [path.join(projectRoot, 'website/src/lib/releases.ts')],
      outfile: libBundle,
      bundle: true,
      platform: 'neutral',
      format: 'esm',
      target: 'es2022',
      logLevel: 'silent'
    })
  ]);

  const releaseModule = await import(pathToFileURL(releaseBundle).href);
  const downloadModule = await import(pathToFileURL(downloadBundle).href);
  const libModule = await import(pathToFileURL(libBundle).href);

  const checksumsContent = await fs.readFile(path.join(projectRoot, 'dist-release/SHA256SUMS.txt'), 'utf8');
  const releaseJsonContent = await fs.readFile(path.join(projectRoot, 'dist-release/release.json'), 'utf8');
  const releaseJson = JSON.parse(releaseJsonContent);

  const installerName = 'Ty-Code-Setup-1.0.0.exe';
  const installerSize = 119053185;

  const localFiles = new Map([
    ['SHA256SUMS.txt', { text: async () => checksumsContent, size: checksumsContent.length }],
    ['release.json', { text: async () => releaseJsonContent, json: async () => releaseJson, size: releaseJsonContent.length }],
    [installerName, { body: 'mock-exe-content', size: installerSize, httpEtag: '"exe-etag"' }]
  ]);

  const mockBucket = {
    get: async (key) => localFiles.get(key) || null,
    head: async (key) => {
      const f = localFiles.get(key);
      return f ? { size: f.size, httpEtag: f.httpEtag } : null;
    }
  };

  // 1. Test GET /api/release with R2 bucket binding
  console.log('1. Testing GET /api/release with R2 DOWNLOADS_BUCKET...');
  const releaseRes = await releaseModule.onRequestGet({
    request: new Request('http://localhost/api/release'),
    env: { DOWNLOADS_BUCKET: mockBucket }
  });
  assert.equal(releaseRes.status, 200, 'release endpoint returns 200');
  assert.equal(releaseRes.headers.get('cache-control'), 'public, max-age=60, s-maxage=300');
  assert.equal(releaseRes.headers.get('content-type'), 'application/json; charset=utf-8');

  const releasePayload = await releaseRes.json();
  assert.equal(releasePayload.status, 'verified');
  assert.equal(releasePayload.tag, 'v1.0.0');
  assert.equal(releasePayload.name, 'Ty-Code 1.0.0');
  assert.ok(releasePayload.assets.length >= 6, 'all release assets returned');

  // Verify platforms
  const platforms = new Set(releasePayload.assets.map((a) => a.platform));
  assert.ok(platforms.has('Windows'), 'Windows assets present');
  assert.ok(platforms.has('macOS'), 'macOS assets present');
  assert.ok(platforms.has('Linux'), 'Linux assets present');

  // 2. Validate with client-side isVerifiedRelease
  console.log('2. Testing client-side isVerifiedRelease validator...');
  assert.equal(libModule.isVerifiedRelease(releasePayload), true, 'client validator approves R2 verified release payload');

  // 3. Test GET /api/download/[file]
  console.log(`3. Testing GET /api/download/${installerName}...`);
  const downloadRes = await downloadModule.onRequestGet({
    request: new Request(`http://localhost/api/download/${installerName}`),
    params: { file: installerName },
    env: { DOWNLOADS_BUCKET: mockBucket }
  });
  assert.equal(downloadRes.status, 200);
  assert.equal(downloadRes.headers.get('content-disposition'), `attachment; filename="${installerName}"`);
  assert.equal(downloadRes.headers.get('content-type'), 'application/vnd.microsoft.portable-executable');
  assert.equal(downloadRes.headers.get('content-length'), String(installerSize));
  assert.equal(downloadRes.headers.get('x-content-type-options'), 'nosniff');

  // 4. Test HEAD /api/download/[file]
  console.log(`4. Testing HEAD /api/download/${installerName}...`);
  const headRes = await downloadModule.onRequestHead({
    request: new Request(`http://localhost/api/download/${installerName}`, { method: 'HEAD' }),
    params: { file: installerName },
    env: { DOWNLOADS_BUCKET: mockBucket }
  });
  assert.equal(headRes.status, 200);
  assert.equal(headRes.headers.get('content-length'), String(installerSize));

  // 5. Test security: reject unallowed file names
  console.log('5. Testing security against path traversal / unauthorized filenames...');
  const badRes = await downloadModule.onRequestGet({
    request: new Request('http://localhost/api/download/secrets.env'),
    params: { file: 'secrets.env' },
    env: { DOWNLOADS_BUCKET: mockBucket }
  });
  assert.equal(badRes.status, 400, 'rejects unauthorized filename');

  const traversalRes = await downloadModule.onRequestGet({
    request: new Request('http://localhost/api/download/../../../etc/passwd'),
    params: { file: '../../../etc/passwd' },
    env: { DOWNLOADS_BUCKET: mockBucket }
  });
  assert.equal(traversalRes.status, 400, 'rejects path traversal');

  console.log('\n[SUCCESS] End-to-end Release & Download wiring tests passed cleanly!');
} finally {
  await fs.rm(temporaryRoot, { recursive: true, force: true });
}
