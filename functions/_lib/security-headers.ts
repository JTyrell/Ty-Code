export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(), microphone=(), camera=()',
  'Cross-Origin-Resource-Policy': 'same-origin'
};

export function jsonResponse(body: unknown, status: number, cacheControl = 'no-store'): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Content-Type', 'application/json; charset=utf-8');
  headers.set('Cache-Control', cacheControl);
  return new Response(JSON.stringify(body), { status, headers });
}

export function emptyResponse(status: number, cacheControl = 'no-store'): Response {
  const headers = new Headers(SECURITY_HEADERS);
  headers.set('Cache-Control', cacheControl);
  return new Response(null, { status, headers });
}
