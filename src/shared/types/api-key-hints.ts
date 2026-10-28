/**
 * API key format hints + paste sanitization (Autonomous Free-Tier
 * Reliability, Prompt 2).
 *
 * Shared by the renderer (ModelSelector / Settings hint chips) and the Main
 * Process (credential-vault save path). Pure, dependency-free.
 */

export interface ApiKeyFormatHint {
  prefixes: string[];
  hint: string;
}

export const API_KEY_FORMAT_HINTS: Record<string, ApiKeyFormatHint> = {
  openrouter: { prefixes: ['sk-or-'], hint: 'OpenRouter keys look like sk-or-v1-…' },
  'google-ai-studio': { prefixes: ['AIza'], hint: 'Google AI Studio keys start with AIza…' },
  gemini: { prefixes: ['AIza'], hint: 'Gemini keys start with AIza…' },
  groq: { prefixes: ['gsk_'], hint: 'Groq keys start with gsk_…' },
  huggingface: { prefixes: ['hf_'], hint: 'Hugging Face tokens start with hf_…' },
  hf: { prefixes: ['hf_'], hint: 'Hugging Face tokens start with hf_…' },
  anthropic: { prefixes: ['sk-ant-'], hint: 'Anthropic keys look like sk-ant-…' },
  claude: { prefixes: ['sk-ant-'], hint: 'Anthropic keys look like sk-ant-…' },
  openai: { prefixes: ['sk-'], hint: 'OpenAI keys look like sk-…' },
  deepseek: { prefixes: ['sk-'], hint: 'DeepSeek keys look like sk-…' }
};

export type ApiKeySanitizeFinding = 'ok' | 'quote_wrapped' | 'bearered' | 'inline_whitespace' | 'trailing_punctuation' | 'too_short';

export interface SanitizedApiKey {
  /** The cleaned key (may be empty when the paste was unusable). */
  key: string;
  /** True when at least one cleanup rule changed the input. */
  changed: boolean;
  /** The FIRST meaningful cleanup detected (used for a console hint line). */
  finding: ApiKeySanitizeFinding;
}

/**
 * Cleans the classic paste mistakes without ever truncating a real key:
 * surrounding quotes, `Bearer ` prefixes, inline whitespace, trailing
 * punctuation, and stray whitespace.
 */
export function sanitizeApiKey(raw: string): SanitizedApiKey {
  const input = String(raw ?? '');
  let findings: ApiKeySanitizeFinding[] = [];
  let key = input.trim();

  if (key.length === 0) {
    return { key: '', changed: false, finding: 'too_short' };
  }

  if (/^["'].*["']$/.test(key) && key.length > 2) {
    findings.push('quote_wrapped');
    key = key.slice(1, -1).trim();
  }

  if (/^bearer\s+/i.test(key)) {
    findings.push('bearered');
    key = key.replace(/^bearer\s+/i, '').trim();
  }

  if ((key.startsWith(',') || key.endsWith(',')) || (key.endsWith(';') && !/;.*=/.test(key)) || key.endsWith(')')) {
    findings.push('trailing_punctuation');
    key = key.replace(/[,;\)]+$/g, '').replace(/^[,;]+/g, '').trim();
  }

  if (/\s/.test(key)) {
    findings.push('inline_whitespace');
    key = key.replace(/\s+/g, '');
  }

  if (key.length === 0) {
    findings = ['too_short'];
  }

  const finding: ApiKeySanitizeFinding = findings[0] || 'ok';
  return { key, changed: finding !== 'ok' && finding !== 'too_short', finding };
}

/** Format hint for a provider id (normalizes the -free suffix). */
export function keyFormatHintFor(providerId: string): ApiKeyFormatHint | undefined {
  const norm = (providerId || '').toLowerCase().trim().replace(/-free$/, '');
  return API_KEY_FORMAT_HINTS[norm] || API_KEY_FORMAT_HINTS[providerId.startsWith('hf_') ? 'hf' : norm];
}
