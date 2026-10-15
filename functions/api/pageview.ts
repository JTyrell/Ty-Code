import { emptyResponse } from '../_lib/security-headers';

interface AnalyticsEngineBinding {
  writeDataPoint(data: {
    blobs?: string[];
    doubles?: number[];
    indexes?: string[];
  }): void;
}

interface PageContext {
  request: Request;
  env: {
    SITE_ANALYTICS?: AnalyticsEngineBinding;
    'ty-code-analytics-eng'?: AnalyticsEngineBinding;
  };
}

function privacySignalPresent(request: Request): boolean {
  return request.headers.get('DNT') === '1' || request.headers.get('Sec-GPC') === '1';
}

async function readBodyLimit(request: Request, limit: number): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const result = await reader.read();
    if (result.done) break;
    total += result.value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
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

export async function onRequestPost(context: PageContext): Promise<Response> {
  const { request, env } = context;
  if (request.method !== 'POST') return emptyResponse(405);

  let requestOrigin: string;
  try {
    requestOrigin = new URL(request.url).origin;
  } catch {
    return emptyResponse(400);
  }
  if (request.headers.get('Origin') !== requestOrigin) return emptyResponse(403);
  if (privacySignalPresent(request)) return emptyResponse(204);
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') || '')) return emptyResponse(415);

  const raw = await readBodyLimit(request, 128);
  if (raw === null) return emptyResponse(413);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return emptyResponse(400);
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return emptyResponse(400);
  const event = payload as Record<string, unknown>;
  if (event.event !== 'page_view' || Object.keys(event).length !== 1) return emptyResponse(400);

  try {
    const analytics = env.SITE_ANALYTICS ?? env['ty-code-analytics-eng'];
    analytics?.writeDataPoint({
      blobs: ['website', 'page_view'],
      doubles: [1]
    });
  } catch {
    // Analytics failures never affect page delivery and are not logged with request details.
  }
  return emptyResponse(204);
}
