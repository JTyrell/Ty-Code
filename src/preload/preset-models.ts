import type { ModelConfig } from './types';

export const DEFAULT_PRESET_MODELS: ModelConfig[] = [
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Top coding capabilities at ultra-low price' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 Reasoning (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Advanced mathematical & architectural reasoning' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Specialized competitive coding model' },
  { id: 'dots-studio/dots-3-note-preview:free', name: 'Dots 3 Note Preview (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'Free tier general-purpose preview model' },
  { id: 'nvidia/nemotron-3.5-super-vl:free', name: 'Nemotron 3.5 Super VL (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'Free 1M-context reasoning and multimodal model' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', isFree: false, description: 'Ultra-fast token streaming (~300 tokens/sec)' },
  { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B (Groq)', provider: 'groq', isFree: false, description: 'Blazing fast dedicated coder' },
  { id: 'deepseek-chat', name: 'DeepSeek V3 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek endpoint' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek reasoning model' },
  { id: 'qwen2.5-coder:latest', name: 'Qwen 2.5 Coder (Local Ollama)', provider: 'ollama', isFree: true, description: '100% private offline local inference' },
  { id: 'deepseek-r1:latest', name: 'DeepSeek R1 (Local Ollama)', provider: 'ollama', isFree: true, description: 'Private offline reasoning model' },
  { id: 'claude-3-5-sonnet-20241022', name: 'FCC Proxy Claude 3.5 Sonnet', provider: 'fcc-proxy', isFree: true, description: 'Proxied through local free-claude-code instance' }
];
