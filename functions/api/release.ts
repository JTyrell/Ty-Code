import { jsonResponse } from '../_lib/security-headers';

const RELEASES_API = 'https://api.github.com/repos/ty-code/ty-code/releases/latest';
const RELEASES_PAGE = 'https://github.com/ty-code/ty-code/releases';
const ALLOWED_ASSET_HOSTS = new Set([
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com'
]);
const MAX_MANIFEST_BYTES = 256 * 1024;
const RELEASE_CACHE = 'public, max-age=60, s-maxage=300';

interface GithubAsset {
  name?: unknown;
  size?: unknown;
  browser_download_url?: unknown;
}

interface GithubRelease {
  tag_name?: unknown;
  name?: unknown;
  published_at?: unknown;
  html_url?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  assets?: unknown;
}

interface DownloadAsset {
  name: string;
  platform: 'Windows' | 'macOS' | 'Linux';
  format: string;
  architecture: string;
  size: number;
  downloadUrl: string;
  sha256: string;
}

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpEtag?: string;
  text(): Promise<string>;
  json<T = unknown>(): Promise<T>;
}

interface R2Object {
  size: number;
  httpEtag?: string;
}

interface R2BucketBinding {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

interface PagesContext {
  request: Request;
  env?: {
    GITHUB_TOKEN?: string;
    DOWNLOADS_BUCKET?: R2BucketBinding;
  };
}

function classifyInstaller(name: string): Omit<DownloadAsset, 'name' | 'size' | 'downloadUrl' | 'sha256'> | null {
  if (/^Ty-Code-Setup-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.exe$/.test(name)) {
    return { platform: 'Windows', format: 'Installer', architecture: 'x64' };
  }
  if (/^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-portable\.exe$/.test(name)) {
    return { platform: 'Windows', format: 'Portable', architecture: 'x64' };
  }
  if (/^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-mac\.(?:dmg|zip)$/.test(name)) {
    return { platform: 'macOS', format: name.endsWith('.dmg') ? 'DMG' : 'ZIP', architecture: 'Universal' };
  }
  if (/^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-x64\.(?:AppImage|deb|rpm)$/.test(name)) {
    const extension = name.slice(name.lastIndexOf('.') + 1);
    const format = extension === 'AppImage' ? 'AppImage' : extension.toUpperCase();
    return { platform: 'Linux', format, architecture: 'x64' };
  }
  return null;
}

export function parseSha256Manifest(manifest: string): Map<string, string> {
  const hashes = new Map<string, string>();
  for (const line of manifest.split(/\r?\n/)) {
    if (!line) continue;
    const match = /^([a-fA-F0-9]{64})[\t ]+\*?(.+)$/.exec(line);
    if (!match) throw new Error('The release checksum manifest contains an invalid line.');
    const name = match[2];
    if (hashes.has(name)) throw new Error('The release checksum manifest contains a duplicate filename.');
    hashes.set(name, match[1].toLowerCase());
  }
  return hashes;
}

function parseRelease(value: unknown): {
  tag: string;
  name: string;
  publishedAt: string;
  releaseUrl: string;
  assets: GithubAsset[];
} {
  if (!value || typeof value !== 'object') throw new Error('GitHub returned invalid release metadata.');
  const release = value as GithubRelease;
  if (release.draft !== false || release.prerelease !== false) throw new Error('GitHub release is not a public stable release.');
  if (typeof release.tag_name !== 'string' || !/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(release.tag_name)) {
    throw new Error('GitHub release tag is invalid.');
  }
  const expectedReleasePath = `/ty-code/ty-code/releases/tag/${encodeURIComponent(release.tag_name)}`;
  if (typeof release.html_url !== 'string') throw new Error('GitHub release URL is invalid.');
  const releaseUrl = new URL(release.html_url);
  if (releaseUrl.origin !== 'https://github.com' || releaseUrl.pathname !== expectedReleasePath
    || releaseUrl.search || releaseUrl.hash || releaseUrl.username || releaseUrl.password) {
    throw new Error('GitHub release URL is outside the official repository.');
  }
  if (typeof release.published_at !== 'string' || !Number.isFinite(Date.parse(release.published_at))) {
    throw new Error('GitHub release date is invalid.');
  }
  if (!Array.isArray(release.assets)) throw new Error('GitHub release assets are invalid.');
  return {
    tag: release.tag_name,
    name: typeof release.name === 'string' && release.name.trim() ? release.name : release.tag_name,
    publishedAt: release.published_at,
    releaseUrl: releaseUrl.href,
    assets: release.assets as GithubAsset[]
  };
}

function isReleaseAssetUrl(value: unknown, tag: string, name: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com'
      && url.pathname === `/ty-code/ty-code/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(name)}`
      && !url.search && !url.hash && !url.username && !url.password;
  } catch {
    return false;
  }
}

async function readTextLimited(response: Response, limit: number): Promise<string> {
  if (!response.body) throw new Error('The release checksum file is empty.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      throw new Error('The release checksum file exceeds the size limit.');
    }
    chunks.push(result.value);
  }
  const content = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    content.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(content);
}

async function fetchChecksumAsset(url: string, context?: PagesContext): Promise<Response> {
  let currentUrl = url;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const headers: Record<string, string> = {
      'User-Agent': 'Ty-Code-Website/1.0 (+https://ty-code.com)'
    };
    if (context?.env?.GITHUB_TOKEN) {
      headers['Authorization'] = `Bearer ${context.env.GITHUB_TOKEN}`;
    }
    const response = await fetch(currentUrl, {
      headers,
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000)
    });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    if (redirects === 3) throw new Error('The release checksum URL redirected too many times.');
    const location = response.headers.get('Location');
    if (!location) throw new Error('The release checksum URL returned an invalid redirect.');
    const nextUrl = new URL(location, currentUrl);
    if (nextUrl.protocol !== 'https:' || nextUrl.username || nextUrl.password || nextUrl.hash
      || !ALLOWED_ASSET_HOSTS.has(nextUrl.hostname)) {
      throw new Error('The release checksum URL redirected outside GitHub release storage.');
    }
    currentUrl = nextUrl.href;
  }
  throw new Error('The release checksum URL could not be retrieved.');
}

async function getVerifiedRelease(context?: PagesContext): Promise<{
  status: 'verified';
  tag: string;
  name: string;
  publishedAt: string;
  releaseUrl: string;
  assets: DownloadAsset[];
}> {
  const headers: Record<string, string> = {
    'User-Agent': 'Ty-Code-Website/1.0 (+https://ty-code.com)',
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  if (context?.env?.GITHUB_TOKEN) {
    headers['Authorization'] = `Bearer ${context.env.GITHUB_TOKEN}`;
  }
  const releaseResponse = await fetch(RELEASES_API, {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(8_000)
  });
  if ([301, 302, 303, 307, 308].includes(releaseResponse.status)) {
    throw new Error('GitHub releases request redirected unexpectedly.');
  }
  if (releaseResponse.status === 404) {
    throw new Error('GitHub releases request failed (404).');
  }
  if (!releaseResponse.ok) throw new Error(`GitHub releases request failed (${releaseResponse.status}).`);

  const releaseBody = await readTextLimited(releaseResponse, 1024 * 1024);
  let releaseJson: unknown;
  try {
    releaseJson = JSON.parse(releaseBody);
  } catch {
    throw new Error('GitHub returned invalid release metadata.');
  }
  const release = parseRelease(releaseJson);
  const checksumAsset = release.assets.find((asset) => asset.name === 'SHA256SUMS.txt');
  if (!checksumAsset || typeof checksumAsset.size !== 'number' || checksumAsset.size < 1 || checksumAsset.size > MAX_MANIFEST_BYTES) {
    throw new Error('The official release does not contain a valid SHA256SUMS.txt file.');
  }
  if (!isReleaseAssetUrl(checksumAsset.browser_download_url, release.tag, 'SHA256SUMS.txt')) {
    throw new Error('The release checksum URL is outside the official repository.');
  }

  const checksumResponse = await fetchChecksumAsset(checksumAsset.browser_download_url, context);
  if (!checksumResponse.ok) throw new Error('The release checksum file could not be retrieved.');
  const hashes = parseSha256Manifest(await readTextLimited(checksumResponse, MAX_MANIFEST_BYTES));

  const assets: DownloadAsset[] = [];
  for (const asset of release.assets) {
    if (typeof asset.name !== 'string') continue;
    const details = classifyInstaller(asset.name);
    const sha256 = hashes.get(asset.name);
    if (!details || !sha256 || typeof asset.size !== 'number' || asset.size < 0) continue;
    if (!isReleaseAssetUrl(asset.browser_download_url, release.tag, asset.name)) continue;
    assets.push({
      name: asset.name,
      ...details,
      size: asset.size,
      downloadUrl: asset.browser_download_url,
      sha256
    });
  }
  if (assets.length === 0) throw new Error('No installer has a matching release checksum.');
  return { status: 'verified', ...release, assets };
}

interface R2ReleaseManifest {
  tag?: string;
  tag_name?: string;
  name?: string;
  publishedAt?: string;
  published_at?: string;
  releaseUrl?: string;
  html_url?: string;
  assets?: Array<{ name?: string; size?: number }>;
}

async function getVerifiedR2Release(bucket: R2BucketBinding): Promise<{
  status: 'verified';
  tag: string;
  name: string;
  publishedAt: string;
  releaseUrl: string;
  assets: DownloadAsset[];
} | null> {
  const [checksumObj, manifestObj] = await Promise.all([
    bucket.get('SHA256SUMS.txt'),
    bucket.get('release.json')
  ]);
  if (!checksumObj || !manifestObj) return null;

  const checksumText = await checksumObj.text();
  const hashes = parseSha256Manifest(checksumText);
  const manifestJson = (await manifestObj.json()) as R2ReleaseManifest;

  const tag = (manifestJson.tag || manifestJson.tag_name || 'v0.1.0') as string;
  if (!/^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag)) {
    throw new Error('R2 release manifest tag is invalid.');
  }
  const name = (manifestJson.name || `Ty-Code ${tag.replace(/^v/, '')}`) as string;
  const publishedAt = (manifestJson.publishedAt || manifestJson.published_at || new Date().toISOString()) as string;
  const releaseUrl = (manifestJson.releaseUrl || manifestJson.html_url || `${RELEASES_PAGE}/tag/${tag}`) as string;

  const rawAssets = Array.isArray(manifestJson.assets) ? manifestJson.assets : [];
  const assets: DownloadAsset[] = [];

  for (const asset of rawAssets) {
    if (!asset || typeof asset.name !== 'string') continue;
    const details = classifyInstaller(asset.name);
    const sha256 = hashes.get(asset.name);
    if (!details || !sha256) continue;
    assets.push({
      name: asset.name,
      ...details,
      size: typeof asset.size === 'number' ? asset.size : 0,
      downloadUrl: `/api/download/${encodeURIComponent(asset.name)}`,
      sha256
    });
  }

  if (assets.length === 0) return null;
  return { status: 'verified', tag, name, publishedAt, releaseUrl, assets };
}

export async function onRequestGet(context: PagesContext): Promise<Response> {
  if (context.request.method !== 'GET') {
    return jsonResponse({ status: 'error', message: 'Only GET is supported.' }, 405);
  }
  if (context.env?.DOWNLOADS_BUCKET) {
    try {
      const r2Release = await getVerifiedR2Release(context.env.DOWNLOADS_BUCKET);
      if (r2Release) {
        return jsonResponse(r2Release, 200, RELEASE_CACHE);
      }
    } catch {
      // Fall through to GitHub verification
    }
  }
  try {
    return jsonResponse(await getVerifiedRelease(context), 200, RELEASE_CACHE);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Release verification failed.';
    if (/\((?:404|403)\)/.test(message)) {
      return jsonResponse({
        status: 'missing_release',
        message: 'No public release is available from the configured GitHub source yet.',
        releaseUrl: RELEASES_PAGE
      }, 404);
    }
    return jsonResponse({
      status: 'error',
      message: 'The official release could not be verified. No download links are available.'
    }, 502);
  }
}

