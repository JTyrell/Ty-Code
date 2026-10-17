import { detectLocalOllamaModels } from './local-model-detector';

export interface VerifiedModelConfig {
  modelId: string;
  name: string;
  url: string;
  requiresKey: boolean;
  providerId: string;
}

export const VERIFIED_FREE_MODELS: VerifiedModelConfig[] = [
  {
    modelId: 'deepseek/deepseek-r1-0528:free',
    name: 'DeepSeek R1 (OpenKilo Free)',
    url: 'https://api.kilo.ai/api/gateway/chat/completions',
    requiresKey: false,
    providerId: 'openkilo'
  },
  {
    modelId: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Llama 3.3 70B Instruct (OpenRouter Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  },
  {
    modelId: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek R1 (OpenRouter Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  },
  {
    modelId: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen 2.5 Coder 32B (OpenRouter Free)',
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requiresKey: true,
    providerId: 'openrouter'
  },
  {
    modelId: 'llama-3.3-70b-versatile',
    name: 'Llama 3.3 70B Versatile (Groq)',
    url: 'https://api.groq.com/openai/v1/chat/completions',
    requiresKey: true,
    providerId: 'groq'
  }
];

let cachedModels: VerifiedModelConfig[] | null = null;

export async function getVerifiedModels(): Promise<VerifiedModelConfig[]> {
  if (cachedModels) {
    return cachedModels;
  }
  const localModels = await detectLocalOllamaModels();
  cachedModels = [...VERIFIED_FREE_MODELS, ...localModels];
  return cachedModels;
}

export function clearModelCache(): void {
  cachedModels = null;
}
