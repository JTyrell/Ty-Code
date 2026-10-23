/**
 * Error Taxonomy Engine (Phase Diagnostics 1)
 *
 * Classifies every failure into exactly one diagnostic error code
 * with a human-readable 'what is needed' message and actionable remedy.
 *
 * Brand: Ty-Code
 */

import type { DiagnosticErrorCode, DiagnosticStep } from '../../../shared/types/diagnostics';

export interface DiagnosticErrorContext {
  step?: DiagnosticStep;
  statusCode?: number;
  errorMessage?: string;
  responseBody?: string;
  headers?: Record<string, string>;
  signupUrl?: string;
  providerName?: string;
  configuredModel?: string;
  validFreeModels?: string[];
  rawEvidenceChunk?: string;
}

export interface ClassifiedError {
  code: DiagnosticErrorCode;
  humanMessage: string;
  remedy: string;
  actionUrl?: string;
  actionLabel?: string;
  suggestedAction?: 'open-settings' | 'open-diagnostics' | 'check-network' | 'reconnect-oauth' | 'select-model';
  suggestedFallback?: string;
  validFreeModels?: string[];
  retryAfterSec?: number;
  rawEvidence?: string;
}

export const ERROR_CODE_DESCRIPTIONS: Record<DiagnosticErrorCode, string> = {
  CONFIG_MISSING: 'No API key configured for a provider that requires one',
  CONFIG_INVALID: 'Key rejected (401/403)',
  MODEL_UNAVAILABLE: 'Model ID not found or not free (404)',
  NETWORK_BLOCKED: 'DNS/conn/CSP/proxy failure',
  RATE_LIMITED: '429',
  QUOTA_EXCEEDED: 'quota error',
  FORMAT_MISMATCH: 'SSE/tool-call parse failure',
  TIMEOUT: 'no first token within 30s',
  PROVIDER_DOWN: '5xx',
  IPC_UNREGISTERED: 'Electron IPC handler unregistered or channel mismatch',
  MOCK_PATH_DETECTED: 'Mock or simulated response path detected short-circuiting real network'
};

/**
 * Standard suggested fallback providers for rate limits or outages
 */
export const DEFAULT_FALLBACK_PROVIDERS: Record<string, string> = {
  'opencode-free': 'Ty-Code Free (zero-config community free tier)',
  'opencode': 'Ty-Code Free (zero-config community free tier)',
  'openrouter-free': 'OpenKilo (zero-config anonymous free tier)',
  'groq-free': 'OpenKilo or OpenRouter Free',
  'together-ai-free': 'Groq (Free Tier) or OpenKilo',
  'fireworks-ai-free': 'OpenKilo or Groq',
  'huggingface-free': 'OpenKilo or Together AI',
  'google-ai-studio-free': 'OpenRouter Free or OpenKilo',
  'anthropic-claude-free': 'OpenRouter Free (gemma-4-31b-it:free)'
};

/**
 * Classifies any error encountered during diagnostic tests into the fixed taxonomy.
 */
export function classifyDiagnosticError(
  providerId: string,
  error: unknown,
  context: DiagnosticErrorContext = {}
): ClassifiedError {
  const errMsg = (error instanceof Error ? error.message : typeof error === 'string' ? error : context.errorMessage || '').trim();
  const lowerMsg = errMsg.toLowerCase();
  // Gateway messages embed the HTTP status inline, e.g. "[GATEWAY] ... API error
  // (401): User not found." — honor it when no explicit statusCode was passed.
  const inlineStatus = parseInt((errMsg.match(/\((\d{3})\)/) || [])[1] || '', 10);
  const status = Number.isFinite(inlineStatus) ? inlineStatus : context.statusCode;
  const rawBody = context.responseBody || context.rawEvidenceChunk || '';
  const lowerBody = rawBody.toLowerCase();
  const signupUrl = context.signupUrl || 'https://openrouter.ai/keys';
  const fallback = DEFAULT_FALLBACK_PROVIDERS[providerId] || 'OpenKilo (Kilo Gateway Free Tier)';

  // 0a. IPC_UNREGISTERED
  if (
    lowerMsg.includes('ipc_unregistered') ||
    lowerMsg.includes('no handler registered') ||
    lowerMsg.includes('ipc error') ||
    lowerMsg.includes('ipcrenderer.invoke') ||
    lowerMsg.includes('unregistered frame') ||
    lowerMsg.includes('no main window')
  ) {
    return {
      code: 'IPC_UNREGISTERED',
      humanMessage: 'Electron IPC handler unregistered or channel mismatch',
      remedy: 'Verify ipcMain.handle is registered in main/index.ts before renderer calls it',
      rawEvidence: errMsg
    };
  }

  // 0b. MOCK_PATH_DETECTED
  if (
    lowerMsg.includes('mock_path_detected') ||
    lowerMsg.includes('mock response') ||
    lowerMsg.includes('fake provider') ||
    lowerMsg.includes('simulated response')
  ) {
    return {
      code: 'MOCK_PATH_DETECTED',
      humanMessage: 'Mock or simulated response path detected short-circuiting real network',
      remedy: 'Remove mock/fake short-circuit in provider pipeline to allow genuine network fetch',
      rawEvidence: errMsg
    };
  }

  // 1. CONFIG_MISSING
  if (
    lowerMsg.includes('config_missing') ||
    lowerMsg.includes('no api key configured') ||
    lowerMsg.includes('api key is required') ||
    lowerMsg.includes('missing api key')
  ) {
    return {
      code: 'CONFIG_MISSING',
      humanMessage: 'No API key configured for a provider that requires one',
      remedy: 'Add a key in Settings > Providers (one-click link included)',
      actionUrl: 'ty-code://settings/providers',
      actionLabel: 'Connect Provider'
    };
  }

  // 2. TIMEOUT (30s first token limit or explicit timeout)
  if (
    context.step === 'streaming' &&
    (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || lowerMsg.includes('30s') || lowerMsg.includes('aborted'))
  ) {
    return {
      code: 'TIMEOUT',
      humanMessage: 'no first token within 30s',
      remedy: 'Provider too slow or hung; last raw bytes attached',
      rawEvidence: rawBody || errMsg || 'Connection timed out after 30000ms with 0 tokens received.'
    };
  }

  // 3. FORMAT_MISMATCH (SSE / tool-call parse failure)
  if (
    context.step === 'streaming' &&
    (lowerMsg.includes('sse') || lowerMsg.includes('parse') || lowerMsg.includes('json') || lowerMsg.includes('chunk') || lowerMsg.includes('format'))
  ) {
    return {
      code: 'FORMAT_MISMATCH',
      humanMessage: 'SSE/tool-call parse failure',
      remedy: 'Provider response format changed; raw chunk attached; code fix needed in sse-parser.ts',
      rawEvidence: rawBody || errMsg
    };
  }

  if (
    context.step === 'tool_call' &&
    (lowerMsg.includes('tool_call') || lowerMsg.includes('tool') || lowerMsg.includes('function') || lowerMsg.includes('schema') || lowerMsg.includes('format'))
  ) {
    return {
      code: 'FORMAT_MISMATCH',
      humanMessage: 'SSE/tool-call parse failure',
      remedy: 'Provider response format changed; raw chunk attached; code fix needed in sse-parser.ts',
      rawEvidence: rawBody || errMsg
    };
  }

  // 4. RATE_LIMITED (429 or explicit rate limit)
  if (status === 429 || lowerMsg.includes('rate limit') || lowerMsg.includes('too many requests') || lowerBody.includes('rate_limit')) {
    let retryAfter = 60;
    if (context.headers && context.headers['retry-after']) {
      const parsed = parseInt(context.headers['retry-after'], 10);
      if (!isNaN(parsed) && parsed > 0) retryAfter = parsed;
    } else {
      const match = lowerMsg.match(/try again in (\d+)/i) || lowerBody.match(/try again in (\d+)/i) || lowerMsg.match(/after (\d+)s/i);
      if (match) retryAfter = parseInt(match[1], 10);
    }
    return {
      code: 'RATE_LIMITED',
      humanMessage: '429',
      remedy: `Rate limited; retry-after ${retryAfter}s; fallback provider suggested: ${fallback}`,
      actionUrl: 'ty-code://dashboard/quota',
      actionLabel: 'View Quota Dashboard',
      retryAfterSec: retryAfter,
      suggestedFallback: fallback,
      rawEvidence: rawBody || errMsg
    };
  }

  // 5. QUOTA_EXCEEDED (insufficient quota, balance, free credits expired)
  const isFailoverExhausted = lowerMsg.includes('failover exhausted');
  if (
    lowerMsg.includes('insufficient_quota') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('quota exhausted') ||
    (!isFailoverExhausted && (
      lowerMsg.includes('quota') ||
      lowerMsg.includes('credit') ||
      lowerMsg.includes('balance') ||
      lowerMsg.includes('exhausted')
    )) ||
    lowerBody.includes('quota') ||
    lowerBody.includes('insufficient_quota')
  ) {
    const alternatives = ['OpenKilo Free', 'Groq Free Tier', 'OpenRouter Free Tier'].join(', ');
    return {
      code: 'QUOTA_EXCEEDED',
      humanMessage: 'quota error',
      remedy: `Free quota exhausted for today; next reset midnight UTC; alternatives: ${alternatives}`,
      suggestedFallback: fallback,
      rawEvidence: rawBody || errMsg
    };
  }

  // 6. CONFIG_INVALID (401/403 or invalid credentials)
  if (
    status === 401 ||
    status === 403 ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('forbidden') ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('invalid key') ||
    lowerMsg.includes('authentication') ||
    lowerMsg.includes('user not found') ||
    lowerMsg.includes('key rejected') ||
    lowerMsg.includes('credentials') ||
    lowerBody.includes('invalid_api_key')
  ) {
    return {
      code: 'CONFIG_INVALID',
      humanMessage: 'Key rejected (401/403)',
      remedy: `The provider rejected your credentials ("${errMsg.slice(0, 160)}"). Re-save your key in Settings > Providers, or switch to Auto — FCC fails over to keyless free supply automatically.`,
      actionUrl: 'ty-code://settings/providers',
      actionLabel: 'Connect Provider',
      rawEvidence: rawBody || errMsg
    };
  }

  // 7. MODEL_UNAVAILABLE (404 or model not found)
  if (
    status === 404 ||
    lowerMsg.includes('model_unavailable') ||
    lowerMsg.includes('model unavailable') ||
    lowerMsg.includes('model not found') ||
    lowerMsg.includes('model is not valid') ||
    lowerMsg.includes('does not exist') ||
    lowerMsg.includes('not free') ||
    lowerBody.includes('model_not_found') ||
    lowerBody.includes('model_unavailable')
  ) {
    const freeList = context.validFreeModels && context.validFreeModels.length > 0
      ? context.validFreeModels.join(', ')
      : 'kilo-auto/free, poolside/laguna-s-2.1:free, nvidia/nemotron-3.5-super-vl:free';
    const provName = context.providerName || (providerId === 'openrouter' ? 'OpenRouter' : providerId ? providerId.charAt(0).toUpperCase() + providerId.slice(1) : 'Provider');
    return {
      code: 'MODEL_UNAVAILABLE',
      humanMessage: 'Model ID not found or not free (404)',
      remedy: `Model unavailable on ${provName}; here are the currently valid free models: ${freeList}`,
      validFreeModels: context.validFreeModels,
      actionUrl: 'settings:providers',
      actionLabel: 'Select Model',
      suggestedAction: 'select-model',
      rawEvidence: rawBody || errMsg
    };
  }

  // 8. PROVIDER_DOWN (5xx server error)
  if (
    (typeof status === 'number' && status >= 500 && status < 600) ||
    lowerMsg.includes('bad gateway') ||
    lowerMsg.includes('service unavailable') ||
    lowerMsg.includes('internal server error') ||
    lowerMsg.includes('502') ||
    lowerMsg.includes('503') ||
    lowerMsg.includes('504')
  ) {
    return {
      code: 'PROVIDER_DOWN',
      humanMessage: '5xx',
      remedy: 'Provider outage; auto-failover engaged',
      actionUrl: 'ty-code://settings/providers',
      actionLabel: 'Switch Model',
      suggestedFallback: fallback,
      rawEvidence: rawBody || errMsg
    };
  }

  // 9. NETWORK_BLOCKED (DNS, connection refused, proxy, offline, fetch failed)
  if (
    lowerMsg.includes('econnrefused') ||
    lowerMsg.includes('econnreset') ||
    lowerMsg.includes('wsarecv') ||
    lowerMsg.includes('wsasend') ||
    lowerMsg.includes('forcibly closed') ||
    lowerMsg.includes('connection reset') ||
    lowerMsg.includes('enotfound') ||
    lowerMsg.includes('eai_again') ||
    lowerMsg.includes('fetch failed') ||
    lowerMsg.includes('network') ||
    lowerMsg.includes('blocked') ||
    lowerMsg.includes('proxy') ||
    lowerMsg.includes('dns') ||
    lowerMsg.includes('certificate') ||
    lowerMsg.includes('ssl')
  ) {
    const isOpenCode = (providerId || '').toLowerCase().includes('opencode') || lowerMsg.includes('opencode') || lowerMsg.includes('cloudcode');
    return {
      code: 'NETWORK_BLOCKED',
      humanMessage: 'DNS/conn/CSP/proxy failure',
      remedy: isOpenCode
        ? `OpenCode CLI connection was interrupted (${errMsg.slice(0, 120)}). Switch to Ty-Code Free for built-in community access.`
        : `Network path blocked: ${errMsg || 'Connection refused or DNS failure'}; check proxy/firewall`,
      suggestedAction: isOpenCode ? 'open-settings' : 'check-network',
      actionLabel: isOpenCode ? 'Switch to Ty-Code Free' : 'Retry',
      actionUrl: isOpenCode ? 'ty-code://switch-provider/ty-code-free' : 'ty-code://action/retry',
      suggestedFallback: 'ty-code-free',
      rawEvidence: errMsg || 'Network unreachable'
    };
  }

  // Default fallback classification: an unknown failure is a provider-side
  // problem, not proof of a blocked network. Auto-failover already tried the
  // pool; suggest model switch instead of a misleading DNS diagnosis.
  return {
    code: 'PROVIDER_DOWN',
    humanMessage: 'Unhandled provider failure',
    remedy: `Unexpected provider error: ${errMsg.slice(0, 200)}. Retry, switch model in Settings, or run Diagnostics for the full trace.`,
    actionUrl: 'ty-code://settings/providers',
    actionLabel: 'Switch Model',
    suggestedFallback: fallback,
    rawEvidence: rawBody || errMsg
  };
}
