import { SECURITY_HEADERS, emptyResponse, jsonResponse } from '../../_lib/security-headers';

interface R2ObjectBody {
  body: ReadableStream;
  size: number;
  httpEtag?: string;
}

interface R2Object {
  size: number;
  httpEtag?: string;
}

interface R2BucketBinding {
  get(key: string): Promise<R2ObjectBody | null>;
  head(key: string): Promise<R2Object | null>;
}

interface Env {
  DOWNLOADS_BUCKET?: R2BucketBinding;
}

interface EventContext {
  request: Request;
  env: Env;
  params: {
    file: string;
  };
}

const ALLOWED_FILENAMES = new Set([
  'SHA256SUMS.txt',
  'release.json'
]);

const ALLOWED_PATTERNS = [
  /^Ty-Code-Setup-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?\.exe$/i,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-portable\.exe$/i,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?-win\.zip$/i,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:-mac)?\.(?:dmg|zip)$/i,
  /^Ty-Code-\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?(?:-x64)?\.(?:AppImage|deb|rpm)$/i,
  /^ty-code[_-]\d+\.\d+\.\d+[_-].*\.(?:deb|rpm)$/i
];

function isAllowedFile(name: string): boolean {
  if (ALLOWED_FILENAMES.has(name)) return true;
  return ALLOWED_PATTERNS.some((pattern) => pattern.test(name));
}

function getContentType(filename: string): string {
  if (filename.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
  if (filename.endsWith('.dmg')) return 'application/x-apple-diskimage';
  if (filename.endsWith('.zip')) return 'application/zip';
  if (filename.endsWith('.AppImage')) return 'application/x-executable';
  if (filename.endsWith('.deb')) return 'application/vnd.debian.binary-package';
  if (filename.endsWith('.rpm')) return 'application/x-rpm';
  if (filename.endsWith('.txt')) return 'text/plain; charset=utf-8';
  return 'application/octet-stream';
}

export async function onRequestGet(context: EventContext): Promise<Response> {
  const filename = context.params?.file;
  if (!filename || !isAllowedFile(filename)) {
    return jsonResponse({ status: 'error', message: 'Requested download file is invalid or not found.' }, 400);
  }

  if (!context.env?.DOWNLOADS_BUCKET) {
    return jsonResponse({ status: 'error', message: 'Download storage is not configured.' }, 503);
  }

  try {
    const object = await context.env.DOWNLOADS_BUCKET.get(filename);
    if (!object) {
      return jsonResponse({ status: 'error', message: 'The requested installer is not currently in the download bucket.' }, 404);
    }

    const headers = new Headers(SECURITY_HEADERS);
    headers.set('Content-Type', getContentType(filename));
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    if (object.httpEtag) {
      headers.set('ETag', object.httpEtag);
    }

    return new Response(object.body, { status: 200, headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Storage access error';
    return jsonResponse({ status: 'error', message }, 500);
  }
}

export async function onRequestHead(context: EventContext): Promise<Response> {
  const filename = context.params?.file;
  if (!filename || !isAllowedFile(filename)) {
    return emptyResponse(400);
  }

  if (!context.env?.DOWNLOADS_BUCKET) {
    return emptyResponse(503);
  }

  try {
    const object = await context.env.DOWNLOADS_BUCKET.head(filename);
    if (!object) {
      return emptyResponse(404);
    }

    const headers = new Headers(SECURITY_HEADERS);
    headers.set('Content-Type', getContentType(filename));
    headers.set('Content-Disposition', `attachment; filename="${filename}"`);
    headers.set('Content-Length', String(object.size));
    headers.set('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    if (object.httpEtag) {
      headers.set('ETag', object.httpEtag);
    }

    return new Response(null, { status: 200, headers });
  } catch {
    return emptyResponse(500);
  }
}
