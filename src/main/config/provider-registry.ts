import type { PreConfiguredProvider } from '../../preload/types';

/**
 * Pre-configured AI Provider Registry
 * Hardcoded registry of supported AI providers for zero-config or low-friction onboarding.
 */
export const PRECONFIGURED_PROVIDERS: PreConfiguredProvider[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    setupType: 'api_key',
    notes: 'Fetch models from /models endpoint. Highlight free models (e.g., deepseek/deepseek-r1:free).',
    signupUrl: 'https://openrouter.ai/keys',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct:free',
    icon: 'openrouter'
  },
  {
    id: 'openkilo',
    name: 'OpenKilo Gateway',
    baseUrl: 'https://api.kilo.ai/api/gateway',
    setupType: 'zero_config',
    notes: 'Kilo Gateway: 40+ free models without API key, plus OAuth for 350+ paid models.',
    signupUrl: 'https://openkilo.com',
    defaultModel: 'deepseek/deepseek-r1-0528:free',
    icon: 'openkilo'
  },
  {
    id: 'opencode',
    name: 'OpenCode',
    baseUrl: 'https://api.opencode.ai/v1',
    setupType: 'api_key',
    notes: 'Standard OpenAI-compatible format.',
    signupUrl: 'https://opencode.ai',
    defaultModel: 'opencode-v1',
    icon: 'opencode'
  },
  {
    id: 'groq',
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    setupType: 'api_key',
    notes: 'Highlight ultra-fast free tier models (llama-3.3-70b-versatile, etc.).',
    signupUrl: 'https://console.groq.com/keys',
    defaultModel: 'llama-3.3-70b-versatile',
    icon: 'groq'
  },
  {
    id: 'ollama',
    name: 'Ollama (Local)',
    baseUrl: 'http://localhost:11434/v1',
    setupType: 'zero_config',
    notes: 'No API key required. Just check if localhost:11434 is reachable.',
    signupUrl: 'https://ollama.com/download',
    defaultModel: 'qwen2.5-coder:latest',
    icon: 'ollama'
  }
];

export function getPreconfiguredProvider(id: string): PreConfiguredProvider | undefined {
  return PRECONFIGURED_PROVIDERS.find((p) => p.id === id);
}

export function getAllPreconfiguredProviders(): PreConfiguredProvider[] {
  return [...PRECONFIGURED_PROVIDERS];
}

export function isPreconfiguredProvider(id: string): boolean {
  return PRECONFIGURED_PROVIDERS.some((p) => p.id === id);
}
