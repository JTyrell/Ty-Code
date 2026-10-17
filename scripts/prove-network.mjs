#!/usr/bin/env node
/**
 * Real network proof (no mocks). Performs genuine HTTPS requests and prints
 * URL, headers (Authorization redacted), body, status and raw response text.
 * Usage: node scripts/prove-network.mjs   (optional env: OPENROUTER_API_KEY, KILO_API_KEY)
 * Writes docs/traces/network-proof.json with every attempt.
 */
import fs from 'node:fs';
import dns from 'node:dns/promises';

const attempts = [];

async function dnsCheck(host) {
  try {
    const r = await dns.lookup(host);
    console.log(`[DNS] ${host} -> ${r.address}`);
    return { host, ok: true, address: r.address };
  } catch (e) {
    console.log(`[DNS] ${host} FAILED: ${e.code || e.message}`);
    return { host, ok: false, error: e.code || e.message };
  }
}

async function call(name, url, model, key) {
  const headers = { 'Content-Type': 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const body = { model, stream: false, max_tokens: 32, messages: [{ role: 'user', content: 'Reply with the single word: pong' }] };
  const shown = { ...headers, ...(key ? { Authorization: 'Bearer ***redacted***' } : {}) };
  console.log(`\n[REQ ${name}] POST ${url}\n  headers=${JSON.stringify(shown)}\n  body=${JSON.stringify(body)}`);
  const t0 = performance.now();
  const rec = { name, url, model, hasKey: Boolean(key) };
  try {
    const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
    const text = await res.text();
    rec.status = res.status;
    rec.ms = Math.round(performance.now() - t0);
    rec.rawResponse = text.slice(0, 1500);
    console.log(`[RES ${name}] status=${res.status} in ${rec.ms}ms\n  raw=${rec.rawResponse}`);
  } catch (e) {
    rec.error = `${e.name}: ${e.message}${e.cause ? ' / cause=' + (e.cause.code || e.cause.message) : ''}`;
    console.log(`[ERR ${name}] ${rec.error}`);
  }
  attempts.push(rec);
}

const dnsResults = [];
for (const h of ['openrouter.ai', 'api.kilo.ai', 'api.openkilo.com']) dnsResults.push(await dnsCheck(h));

const orKey = process.env.OPENROUTER_API_KEY;
if (orKey) await call('openrouter', 'https://openrouter.ai/api/v1/chat/completions', 'meta-llama/llama-3.3-70b-instruct:free', orKey);
await call('kilo-anon', 'https://api.kilo.ai/v1/chat/completions', 'deepseek/deepseek-r1-0528:free', process.env.KILO_API_KEY);
await call('openkilo.com (current registry URL)', 'https://api.openkilo.com/v1/chat/completions', 'deepseek/deepseek-r1-0528:free', process.env.KILO_API_KEY);

fs.mkdirSync('docs/traces', { recursive: true });
fs.writeFileSync('docs/traces/network-proof.json', JSON.stringify({ at: new Date().toISOString(), dns: dnsResults, attempts }, null, 2));
console.log('\nWrote docs/traces/network-proof.json');
