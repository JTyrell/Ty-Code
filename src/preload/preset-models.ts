import type { ModelConfig } from './types';

export const DEFAULT_PRESET_MODELS: ModelConfig[] = [
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Top coding capabilities at ultra-low price' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 Reasoning (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Advanced mathematical & architectural reasoning' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Specialized competitive coding model' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'Free tier Llama 3.3 70B' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Long-Context Multimodal (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'High-speed free multimodal model' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', isFree: false, description: 'Ultra-fast token streaming (~300 tokens/sec)' },
  { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B (Groq)', provider: 'groq', isFree: false, description: 'Blazing fast dedicated coder' },
  { id: 'deepseek-chat', name: 'DeepSeek V3 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek endpoint' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek reasoning model' },
  { id: 'qwen2.5-coder:latest', name: 'Qwen 2.5 Coder (Local Ollama)', provider: 'ollama', isFree: true, description: '100% private offline local inference' },
  { id: 'deepseek-r1:latest', name: 'DeepSeek R1 (Local Ollama)', provider: 'ollama', isFree: true, description: 'Private offline reasoning model' },
  { id: 'claude-3-5-sonnet-20241022', name: 'FCC Proxy Claude 3.5 Sonnet', provider: 'fcc-proxy', isFree: true, description: 'Proxied through local free-claude-code instance' }
];
