export type ReleasePlatform = 'Windows' | 'macOS' | 'Linux';

export interface ReleaseAsset {
  name: string;
  platform: ReleasePlatform;
  format: string;
  architecture: string;
  size: number;
  downloadUrl: string;
  sha256: string;
}

export interface VerifiedRelease {
  status: 'verified';
  tag: string;
  name: string;
  publishedAt: string;
  releaseUrl: string;
  assets: ReleaseAsset[];
}

export interface MissingRelease {
  status: 'missing_release';
  message: string;
  releaseUrl: string;
}

export interface ReleaseError {
  status: 'error';
  message: string;
}

export type ReleasePayload = VerifiedRelease | MissingRelease | ReleaseError;

export class ReleaseRequestError extends Error {
  public readonly kind: 'missing_release' | 'error';
  public readonly releaseUrl?: string;

  constructor(kind: 'missing_release' | 'error', message: string, releaseUrl?: string) {
    super(message);
    this.name = 'ReleaseRequestError';
    this.kind = kind;
    this.releaseUrl = releaseUrl;
  }
}

const RELEASE_PAGE = 'https://github.com/ty-code/ty-code/releases';
const RELEASE_TAG_PATTERN = /^v?\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/;
const INSTALLER_PATTERNS = [
  /^Ty-Code-Setup-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.exe$/,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-portable\.exe$/,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-mac\.(?:dmg|zip)$/,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-x64\.(?:AppImage|deb|rpm)$/
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOfficialReleaseUrl(value: unknown, tag?: string, filename?: string): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    if (url.origin !== 'https://github.com' || url.search || url.hash || url.username || url.password) return false;
    const expectedPath = tag && filename
      ? `/ty-code/ty-code/releases/download/${encodeURIComponent(tag)}/${encodeURIComponent(filename)}`
      : tag
        ? `/ty-code/ty-code/releases/tag/${encodeURIComponent(tag)}`
        : '/ty-code/ty-code/releases';
    return url.pathname === expectedPath && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function isVerifiedRelease(value: unknown): value is VerifiedRelease {
  if (!isRecord(value) || value.status !== 'verified') return false;
  if (typeof value.tag !== 'string' || !RELEASE_TAG_PATTERN.test(value.tag)) return false;
  if (typeof value.name !== 'string' || !value.name.trim()) return false;
  if (typeof value.publishedAt !== 'string' || !Number.isFinite(Date.parse(value.publishedAt))) return false;
  if (!isOfficialReleaseUrl(value.releaseUrl, value.tag) || !Array.isArray(value.assets) || value.assets.length === 0) return false;

  const seen = new Set<string>();
  for (const unknownAsset of value.assets) {
    if (!isRecord(unknownAsset)) return false;
    const asset = unknownAsset;
    const assetName = asset.name;
    if (typeof assetName !== 'string' || !INSTALLER_PATTERNS.some((pattern) => pattern.test(assetName))) return false;
    if (seen.has(assetName)) return false;
    seen.add(assetName);
    if (asset.platform !== 'Windows' && asset.platform !== 'macOS' && asset.platform !== 'Linux') return false;
    if (typeof asset.format !== 'string' || !asset.format.trim()) return false;
    if (typeof asset.architecture !== 'string' || !asset.architecture.trim()) return false;
    if (typeof asset.size !== 'number' || !Number.isFinite(asset.size) || asset.size < 0) return false;
    if (typeof asset.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(asset.sha256)) return false;
    if (!isOfficialReleaseUrl(asset.downloadUrl, value.tag, assetName)) return false;
  }
  return true;
}

export async function fetchLatestRelease(signal?: AbortSignal): Promise<VerifiedRelease> {
  const response = await fetch('/api/release', {
    method: 'GET',
    headers: { Accept: 'application/json' },
    credentials: 'same-origin',
    cache: 'no-cache',
    signal
  });
  const payload: unknown = await response.json().catch(() => null);

  if (response.status === 404 && isRecord(payload) && payload.status === 'missing_release') {
    throw new ReleaseRequestError(
      'missing_release',
      typeof payload.message === 'string' ? payload.message : 'No public release is available from the configured GitHub source yet.',
      typeof payload.releaseUrl === 'string' && payload.releaseUrl === RELEASE_PAGE ? payload.releaseUrl : RELEASE_PAGE
    );
  }
  if (!response.ok) {
    throw new ReleaseRequestError('error', 'The official release could not be verified. No download links are available.');
  }
  if (!isVerifiedRelease(payload)) {
    throw new ReleaseRequestError('error', 'The release response did not contain a valid, checksummed package list.');
  }
  return payload;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Size unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${new Intl.NumberFormat('en', { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

export function formatReleaseDate(date: string): string {
  return new Intl.DateTimeFormat('en', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(date));
}
