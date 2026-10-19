/**
 * FCC Provider Catalog & ToS Curation Sync Service (Phase FCC-1)
 *
 * Curates FCC's complete 61-provider model supply catalog with:
 * - ToS compliance curation ('compliant' | 'verified' | 'conditional' | 'risky')
 * - Automatic disabling of risky providers by default with explanatory tooltips
 * - Aggregate free-token framing derived from catalog totals
 * - Nightly 24h automatic catalog sync + on-demand sync (real endpoint probes)
 * - Probe persistence across restarts (userData/fcc-probe-cache.json)
 * - Model capability metadata: reasoning, coding, fast, large-context
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import { app } from 'electron';
import fs from 'node:fs';

export type FCCToSStatus = 'compliant' | 'verified' | 'conditional' | 'risky';

export interface FCCModelInfo {
  id: string;
  name: string;
  contextWindow: number;
  maxOutputTokens: number;
  isFree: boolean;
  capabilities: {
    reasoning?: boolean;
    coding?: boolean;
    tools?: boolean;
    vision?: boolean;
    fast?: boolean;
    largeContext?: boolean;
    speedTokensPerSec?: number;
  };
  provenance: 'FCC' | 'your key' | 'anonymous' | 'subscription';
  costTier: 'free' | 'low' | 'medium' | 'high';
  description?: string;
}

export interface FCCProviderHealthInfo {
  id: string;
  name: string;
  category: 'api_key' | 'oauth' | 'web_cookie' | 'local';
  authMethod: 'api_key' | 'oauth' | 'web_cookie' | 'none';
  health: 'healthy' | 'degraded' | 'stopped' | 'untested';
  latencyMs: number;
  successRate: number; // 0 - 100
  quotaRemainingPercent: number; // 0 - 100
  probedAt?: number;
  monthlyFreeTokens: number;
  isFreeTierAvailable: boolean;
  tosStatus: FCCToSStatus;
  tosExplanation?: string;
  enabled: boolean;
  defaultEndpoint: string;
  signupUrl?: string;
  models: FCCModelInfo[];
}

export const INITIAL_61_FCC_CATALOG: FCCProviderHealthInfo[] = [
  // 1. OpenRouter Free Tier
  {
    id: 'openrouter',
    name: 'OpenRouter Free Tier',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 380,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 200_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://openrouter.ai/api/v1',
    signupUrl: 'https://openrouter.ai/keys',
    models: [
      {
        id: 'nvidia/nemotron-3-ultra-550b-a55b:free',
        name: 'DeepSeek R1 (Free OpenRouter)',
        contextWindow: 64_000,
        maxOutputTokens: 16_384,
        isFree: true,
        capabilities: { reasoning: true, coding: true, tools: true, speedTokensPerSec: 42 },
        provenance: 'FCC',
        costTier: 'free',
        description: 'Multi-step chain-of-thought mathematical reasoning'
      },
      {
        id: 'qwen/qwen-2.5-coder-32b-instruct:free',
        name: 'Qwen 2.5 Coder 32B Instruct',
        contextWindow: 32_768,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, tools: true, speedTokensPerSec: 72 },
        provenance: 'FCC',
        costTier: 'free',
        description: 'State-of-the-art open coding specialist'
      },
      {
        id: 'dots-studio/dots-3-note-preview:free',
        name: 'Llama 3.3 70B Instruct',
        contextWindow: 131_072,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, tools: true, largeContext: true, speedTokensPerSec: 55 },
        provenance: 'FCC',
        costTier: 'free',
        description: 'Large-scale instruction-tuned general model'
      }
    ]
  },

  // 2. Groq LPU Ultra-Fast
  {
    id: 'groq',
    name: 'Groq Cloud Free Tier',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 75,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 150_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.groq.com/openai/v1',
    signupUrl: 'https://console.groq.com/keys',
    models: [
      {
        id: 'llama-3.3-70b-versatile',
        name: 'Llama 3.3 70B Versatile (Groq)',
        contextWindow: 128_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, fast: true, tools: true, speedTokensPerSec: 310 },
        provenance: 'FCC',
        costTier: 'free',
        description: '300+ tokens/sec ultra-fast execution on LPUs'
      },
      {
        id: 'llama-3.1-8b-instant',
        name: 'Llama 3.1 8B Instant',
        contextWindow: 128_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { fast: true, tools: true, speedTokensPerSec: 520 },
        provenance: 'FCC',
        costTier: 'free',
        description: 'Sub-100ms ultra-low latency autocomplete'
      }
    ]
  },

  // 3. Google AI Studio
  {
    id: 'google-ai-studio',
    name: 'Google AI Studio',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 240,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 300_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://generativelanguage.googleapis.com/v1beta/openai',
    signupUrl: 'https://aistudio.google.com/app/apikey',
    models: [
      {
        id: 'gemini-2.0-flash',
        name: 'Gemini 2.0 Flash',
        contextWindow: 1_048_576,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, fast: true, largeContext: true, tools: true, vision: true, speedTokensPerSec: 130 },
        provenance: 'FCC',
        costTier: 'free',
        description: '1M token context window with multimodal vision'
      },
      {
        id: 'gemini-1.5-pro',
        name: 'Gemini 1.5 Pro',
        contextWindow: 2_097_152,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { reasoning: true, coding: true, largeContext: true, tools: true, vision: true, speedTokensPerSec: 45 },
        provenance: 'FCC',
        costTier: 'free',
        description: '2M token massive context architectural analyzer'
      }
    ]
  },

  // 4. OpenKilo Gateway (Anonymous / Free)
  {
    id: 'openkilo',
    name: 'OpenKilo Gateway',
    category: 'api_key',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 320,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 500_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.kilo.ai/api/gateway',
    signupUrl: 'https://openkilo.com',
    models: [
      {
        id: 'kilo-auto/free',
        name: 'Kilo Auto (Kilo Free Router)',
        contextWindow: 256_000,
        maxOutputTokens: 16_384,
        isFree: true,
        capabilities: { reasoning: true, coding: true, tools: true, speedTokensPerSec: 45 },
        provenance: 'anonymous',
        costTier: 'free',
        description: 'Zero-cost smart router that picks the best live free model per request'
      },
      {
        id: 'qwen3-coder:free',
        name: 'Qwen 3 Coder (Kilo Free)',
        contextWindow: 128_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, tools: true, speedTokensPerSec: 68 },
        provenance: 'anonymous',
        costTier: 'free',
        description: 'Zero-config code synthesis & diff generation'
      }
    ]
  },

  // 5. Cerebras Wafer-Scale
  {
    id: 'cerebras',
    name: 'Cerebras Inference',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 60,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 100_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.cerebras.ai/v1',
    signupUrl: 'https://cloud.cerebras.ai',
    models: [
      {
        id: 'cerebras-llama3.1-70b',
        name: 'Llama 3.1 70B (Cerebras CS-3)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true, speedTokensPerSec: 450 },
        provenance: 'FCC',
        costTier: 'free',
        description: '450+ tokens/sec wafer-scale engine'
      }
    ]
  },

  // 6. SambaNova Systems
  {
    id: 'sambanova',
    name: 'SambaNova Cloud',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 95,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 80_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.sambanova.ai/v1',
    signupUrl: 'https://cloud.sambanova.ai',
    models: [
      {
        id: 'Meta-Llama-3.1-405B-Instruct',
        name: 'Llama 3.1 405B Instruct',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { reasoning: true, coding: true, speedTokensPerSec: 120 },
        provenance: 'FCC',
        costTier: 'free',
        description: 'Ultra-large 405B parameter frontier reasoning'
      }
    ]
  },

  // 7. Mistral AI Free Tier
  {
    id: 'mistral',
    name: 'Mistral AI (La Plateforme)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 290,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 40_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.mistral.ai/v1',
    signupUrl: 'https://console.mistral.ai',
    models: [
      {
        id: 'codestral-latest',
        name: 'Codestral 22B',
        contextWindow: 32_768,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, tools: true, speedTokensPerSec: 85 },
        provenance: 'FCC',
        costTier: 'free',
        description: 'Specialized code completion and generation model'
      }
    ]
  },

  // 8. Together AI
  {
    id: 'together',
    name: 'Together AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 210,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.together.xyz/v1',
    signupUrl: 'https://api.together.xyz',
    models: [
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        name: 'Qwen 2.5 Coder 32B (Together)',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, tools: true, speedTokensPerSec: 90 },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 9. Cohere
  {
    id: 'cohere',
    name: 'Cohere Trial Tier',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 340,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 30_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.cohere.com/v1',
    signupUrl: 'https://dashboard.cohere.com',
    models: [
      {
        id: 'command-r-plus',
        name: 'Command R+ (Trial)',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, tools: true, largeContext: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 10. Fireworks AI
  {
    id: 'fireworks',
    name: 'Fireworks AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 140,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 40_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.fireworks.ai/inference/v1',
    signupUrl: 'https://fireworks.ai',
    models: [
      {
        id: 'accounts/fireworks/models/qwen2p5-coder-32b-instruct',
        name: 'Qwen 2.5 Coder (Fireworks)',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true, speedTokensPerSec: 140 },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 11. Hyperbolic
  {
    id: 'hyperbolic',
    name: 'Hyperbolic GPU Network',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 160,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.hyperbolic.xyz/v1',
    signupUrl: 'https://hyperbolic.xyz',
    models: [
      {
        id: 'deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3 (Hyperbolic)',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, speedTokensPerSec: 80 },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 12. Novita AI
  {
    id: 'novita',
    name: 'Novita AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 190,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 30_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.novita.ai/v3/openai',
    signupUrl: 'https://novita.ai',
    models: [
      {
        id: 'deepseek/deepseek-r1',
        name: 'DeepSeek R1 (Novita)',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { reasoning: true, coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 13. Perplexity AI
  {
    id: 'perplexity',
    name: 'Perplexity API',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 410,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.perplexity.ai',
    signupUrl: 'https://perplexity.ai/settings/api',
    models: [
      {
        id: 'sonar-reasoning',
        name: 'Sonar Reasoning',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { reasoning: true, largeContext: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 14. Cloudflare Workers AI
  {
    id: 'cloudflare',
    name: 'Cloudflare Workers AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 150,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.cloudflare.com/client/v4/accounts',
    signupUrl: 'https://dash.cloudflare.com',
    models: [
      {
        id: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
        name: 'Llama 3.3 70B Fast (Cloudflare)',
        contextWindow: 64_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true, speedTokensPerSec: 160 },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 15. Hugging Face Inference API
  {
    id: 'huggingface',
    name: 'Hugging Face Inference',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 360,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api-inference.huggingface.co/v1',
    signupUrl: 'https://huggingface.co/settings/tokens',
    models: [
      {
        id: 'Qwen/Qwen2.5-Coder-32B-Instruct',
        name: 'Qwen 2.5 Coder 32B (HF)',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, tools: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 16. Replicate
  {
    id: 'replicate',
    name: 'Replicate Free Credits',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 450,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.replicate.com/v1',
    signupUrl: 'https://replicate.com',
    models: [
      {
        id: 'meta/meta-llama-3.1-405b-instruct',
        name: 'Llama 3.1 405B (Replicate)',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { reasoning: true, coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 17. SiliconFlow
  {
    id: 'siliconflow',
    name: 'SiliconFlow Cloud',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 230,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.siliconflow.cn/v1',
    signupUrl: 'https://siliconflow.cn',
    models: [
      {
        id: 'deepseek-ai/DeepSeek-V3',
        name: 'DeepSeek V3 (SiliconFlow)',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, tools: true, speedTokensPerSec: 65 },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 18. GitHub Copilot (OAuth)
  {
    id: 'github-copilot',
    name: 'GitHub Copilot',
    category: 'oauth',
    authMethod: 'oauth',
    health: 'untested',
    latencyMs: 280,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'verified',
    enabled: true,
    defaultEndpoint: 'https://api.githubcopilot.com',
    signupUrl: 'https://github.com/features/copilot',
    models: [
      {
        id: 'claude-3.5-sonnet',
        name: 'Claude 3.5 Sonnet (Copilot)',
        contextWindow: 128_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { reasoning: true, coding: true, tools: true, speedTokensPerSec: 60 },
        provenance: 'subscription',
        costTier: 'free'
      }
    ]
  },

  // 19. Local Ollama (Offline / Unlimited)
  {
    id: 'ollama',
    name: 'Local Ollama',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 35,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:11434/v1',
    signupUrl: 'https://ollama.com',
    models: [
      {
        id: 'qwen2.5-coder:7b',
        name: 'Qwen 2.5 Coder 7B (Local Ollama)',
        contextWindow: 32_768,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, fast: true, tools: true, speedTokensPerSec: 85 },
        provenance: 'FCC',
        costTier: 'free',
        description: '100% private offline local execution'
      }
    ]
  },

  // 20. Local LM Studio
  {
    id: 'lm-studio',
    name: 'LM Studio (Local Server)',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 40,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:1234/v1',
    signupUrl: 'https://lmstudio.ai',
    models: [
      {
        id: 'local-model',
        name: 'Active Model (LM Studio)',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 21. Local vLLM
  {
    id: 'vllm',
    name: 'vLLM High-Throughput Server',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 25,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:8000/v1',
    signupUrl: 'https://vllm.ai',
    models: [
      {
        id: 'vllm-default',
        name: 'vLLM High-Speed Endpoint',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 22. Local LocalAI
  {
    id: 'localai',
    name: 'LocalAI Container',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 50,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:8080/v1',
    signupUrl: 'https://localai.io',
    models: [
      {
        id: 'localai-default',
        name: 'LocalAI Compatible Service',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 23. Local Jan AI
  {
    id: 'jan-ai',
    name: 'Jan AI (Local Assistant)',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 45,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:1337/v1',
    signupUrl: 'https://jan.ai',
    models: [
      {
        id: 'jan-default',
        name: 'Jan Local Model',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 24. Local llama.cpp Server
  {
    id: 'llamacpp',
    name: 'llama.cpp HTTP Server',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 20,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:8081/v1',
    signupUrl: 'https://github.com/ggerganov/llama.cpp',
    models: [
      {
        id: 'llama-cpp-server',
        name: 'llama.cpp Native Binary',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 25. Local Text Generation WebUI
  {
    id: 'oobabooga',
    name: 'Text Generation WebUI (Oobabooga)',
    category: 'local',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 60,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 999_999_999,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'http://localhost:5000/v1',
    signupUrl: 'https://github.com/oobabooga/text-generation-webui',
    models: [
      {
        id: 'ooba-default',
        name: 'Oobabooga Loaded Model',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 26. DeepSeek Native API
  {
    id: 'deepseek-native',
    name: 'DeepSeek Platform API',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 310,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.deepseek.com/v1',
    signupUrl: 'https://platform.deepseek.com',
    models: [
      {
        id: 'deepseek-chat',
        name: 'DeepSeek V3 Native',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, tools: true, speedTokensPerSec: 60 },
        provenance: 'your key',
        costTier: 'low'
      },
      {
        id: 'deepseek-reasoner',
        name: 'DeepSeek R1 Native',
        contextWindow: 64_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { reasoning: true, coding: true, tools: true },
        provenance: 'your key',
        costTier: 'low'
      }
    ]
  },

  // 27. OpenCode Framework
  {
    id: 'opencode',
    name: 'OpenCode Framework Hub',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 0,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 1_000_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.opencode.ai/v1',
    signupUrl: 'https://opencode.ai',
    models: [
      {
        id: 'grok-code',
        name: 'Grok Code (OpenCode Zen)',
        contextWindow: 128_000,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, reasoning: true, tools: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 28. Anthropic Claude (BYOK)
  {
    id: 'anthropic',
    name: 'Anthropic Claude (BYOK)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 420,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 0,
    isFreeTierAvailable: false,
    tosStatus: 'verified',
    enabled: true,
    defaultEndpoint: 'https://api.anthropic.com/v1',
    signupUrl: 'https://console.anthropic.com',
    models: [
      {
        id: 'claude-3-5-sonnet-20241022',
        name: 'Claude 3.5 Sonnet',
        contextWindow: 200_000,
        maxOutputTokens: 8192,
        isFree: false,
        capabilities: { reasoning: true, coding: true, tools: true, largeContext: true },
        provenance: 'your key',
        costTier: 'medium'
      }
    ]
  },

  // 29. OpenAI ChatGPT (BYOK)
  {
    id: 'openai',
    name: 'OpenAI (BYOK)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 380,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 0,
    isFreeTierAvailable: false,
    tosStatus: 'verified',
    enabled: true,
    defaultEndpoint: 'https://api.openai.com/v1',
    signupUrl: 'https://platform.openai.com/api-keys',
    models: [
      {
        id: 'gpt-4o',
        name: 'GPT-4o',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        isFree: false,
        capabilities: { reasoning: true, coding: true, tools: true, vision: true },
        provenance: 'your key',
        costTier: 'medium'
      }
    ]
  },

  // 30. NVIDIA NIM
  {
    id: 'nvidia-nim',
    name: 'NVIDIA NIM Developer Cloud',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 180,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 50_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://integrate.api.nvidia.com/v1',
    signupUrl: 'https://build.nvidia.com',
    models: [
      {
        id: 'meta/llama-3.3-70b-instruct',
        name: 'Llama 3.3 70B (NVIDIA NIM)',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true, tools: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 31. AI21 Labs
  {
    id: 'ai21',
    name: 'AI21 Studio',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 310,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.ai21.com/studio/v1',
    signupUrl: 'https://studio.ai21.com',
    models: [
      {
        id: 'jamba-1.5-large',
        name: 'Jamba 1.5 Large',
        contextWindow: 256_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, largeContext: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 32. Lepton AI
  {
    id: 'lepton',
    name: 'Lepton AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 160,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 30_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.lepton.ai/v1',
    signupUrl: 'https://lepton.ai',
    models: [
      {
        id: 'llama3-70b',
        name: 'Llama 3 70B (Lepton)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 33. Anyscale Endpoints
  {
    id: 'anyscale',
    name: 'Anyscale Endpoints',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 250,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.endpoints.anyscale.com/v1',
    signupUrl: 'https://anyscale.com',
    models: [
      {
        id: 'meta-llama/Meta-Llama-3-70B-Instruct',
        name: 'Llama 3 70B (Anyscale)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 34. DeepInfra (Conditional)
  {
    id: 'deepinfra',
    name: 'DeepInfra (Conditional Free)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 380,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'conditional',
    tosExplanation: 'Free tier requires SMS phone number validation and IP fraud check.',
    enabled: true,
    defaultEndpoint: 'https://api.deepinfra.com/v1/openai',
    signupUrl: 'https://deepinfra.com',
    models: [
      {
        id: 'meta-llama/Meta-Llama-3.1-70B-Instruct',
        name: 'Llama 3.1 70B (DeepInfra)',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 35. Voyage AI
  {
    id: 'voyage',
    name: 'Voyage AI Embeddings & Rerank',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 180,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 10_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.voyageai.com/v1',
    signupUrl: 'https://voyageai.com',
    models: [
      {
        id: 'voyage-code-2',
        name: 'Voyage Code 2',
        contextWindow: 16_384,
        maxOutputTokens: 1024,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 36. Baseten
  {
    id: 'baseten',
    name: 'Baseten Bridge',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 240,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://bridge.baseten.co/v1',
    signupUrl: 'https://baseten.co',
    models: [
      {
        id: 'baseten-llama-3',
        name: 'Llama 3 8B (Baseten)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 37. Modal
  {
    id: 'modal',
    name: 'Modal Labs Inference',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 210,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.modal.com/v1',
    signupUrl: 'https://modal.com',
    models: [
      {
        id: 'modal-qwen-coder',
        name: 'Qwen Coder on Modal',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 38. RunPod
  {
    id: 'runpod',
    name: 'RunPod Serverless',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 290,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.runpod.ai/v2',
    signupUrl: 'https://runpod.io',
    models: [
      {
        id: 'runpod-llama3-70b',
        name: 'Llama 3 70B (RunPod)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 39. Lambda Labs
  {
    id: 'lambda',
    name: 'Lambda Cloud API',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 270,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.lambdalabs.com/v1',
    signupUrl: 'https://lambdalabs.com',
    models: [
      {
        id: 'lambda-hermes-3',
        name: 'Hermes 3 70B (Lambda)',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { reasoning: true, coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 40. Predibase
  {
    id: 'predibase',
    name: 'Predibase Fine-Tuning Cloud',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 310,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.predibase.com/v1',
    signupUrl: 'https://predibase.com',
    models: [
      {
        id: 'predibase-coder',
        name: 'Predibase LoRA Coder',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 41. Aleph Alpha
  {
    id: 'aleph-alpha',
    name: 'Aleph Alpha Luminous',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 460,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 10_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.aleph-alpha.com',
    signupUrl: 'https://aleph-alpha.com',
    models: [
      {
        id: 'luminous-extended',
        name: 'Luminous Extended',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: false },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 42. MonsterAPI
  {
    id: 'monsterapi',
    name: 'MonsterAPI Inference',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 350,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.monsterapi.ai/v1',
    signupUrl: 'https://monsterapi.ai',
    models: [
      {
        id: 'monster-llama3',
        name: 'Llama 3 8B (MonsterAPI)',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 43. Scaleway Generative AI
  {
    id: 'scaleway',
    name: 'Scaleway Generative AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 330,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.scaleway.ai/v1',
    signupUrl: 'https://scaleway.com',
    models: [
      {
        id: 'llama-3.1-70b-instruct',
        name: 'Llama 3.1 70B (Scaleway)',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 44. FriendliAI
  {
    id: 'friendliai',
    name: 'FriendliAI Dedicated Endpoints',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 140,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://inference.friendli.ai/v1',
    signupUrl: 'https://friendli.ai',
    models: [
      {
        id: 'meta-llama-3.1-8b-instruct',
        name: 'Llama 3.1 8B (Friendli)',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 45. OctoAI (Cloud)
  {
    id: 'octoai',
    name: 'OctoAI Compute Service',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 220,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://text.octoai.run/v1',
    signupUrl: 'https://octoai.cloud',
    models: [
      {
        id: 'meta-llama-3-70b-instruct',
        name: 'Llama 3 70B (OctoAI)',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 46. IBM WatsonX
  {
    id: 'watsonx',
    name: 'IBM WatsonX AI Studio',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 440,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'verified',
    enabled: true,
    defaultEndpoint: 'https://watsonx.ai/v1',
    signupUrl: 'https://ibm.com/watsonx',
    models: [
      {
        id: 'granite-34b-code',
        name: 'IBM Granite 34B Code',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 47. Databricks Mosaic
  {
    id: 'databricks',
    name: 'Databricks Mosaic AI',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 370,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'verified',
    enabled: true,
    defaultEndpoint: 'https://databricks.com/serving-endpoints',
    signupUrl: 'https://databricks.com',
    models: [
      {
        id: 'dbrx-instruct',
        name: 'DBRX Instruct',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, reasoning: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 48. Upstage Solar
  {
    id: 'upstage',
    name: 'Upstage Solar',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 270,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.upstage.ai/v1/solar',
    signupUrl: 'https://upstage.ai',
    models: [
      {
        id: 'solar-10.7b-instruct',
        name: 'Solar 10.7B Instruct',
        contextWindow: 4096,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 49. 01.AI (Yi)
  {
    id: '01-ai',
    name: '01.AI (Yi Models)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 310,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.01.ai/v1',
    signupUrl: 'https://01.ai',
    models: [
      {
        id: 'yi-large',
        name: 'Yi Large',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, reasoning: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 50. Moonshot / Kimi
  {
    id: 'moonshot',
    name: 'Moonshot AI (Kimi)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 360,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.moonshot.cn/v1',
    signupUrl: 'https://platform.moonshot.cn',
    models: [
      {
        id: 'moonshot-v1-128k',
        name: 'Moonshot V1 128K',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, largeContext: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 51. Zhipu AI / GLM
  {
    id: 'zhipu',
    name: 'Zhipu AI (GLM-4)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 330,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://open.bigmodel.cn/api/paas/v4',
    signupUrl: 'https://open.bigmodel.cn',
    models: [
      {
        id: 'glm-4-flash',
        name: 'GLM-4 Flash (Free)',
        contextWindow: 128_000,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true, fast: true, largeContext: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 52. Baichuan
  {
    id: 'baichuan',
    name: 'Baichuan Intelligent',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 370,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.baichuan-ai.com/v1',
    signupUrl: 'https://baichuan-ai.com',
    models: [
      {
        id: 'Baichuan4',
        name: 'Baichuan 4',
        contextWindow: 32_768,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 53. Minimax
  {
    id: 'minimax',
    name: 'MiniMax Open Platform',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 320,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 20_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.minimax.chat/v1',
    signupUrl: 'https://minimax.io',
    models: [
      {
        id: 'abab6.5s-chat',
        name: 'MiniMax abab 6.5s',
        contextWindow: 245_760,
        maxOutputTokens: 8192,
        isFree: true,
        capabilities: { coding: true, largeContext: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 54. StepFun
  {
    id: 'stepfun',
    name: 'StepFun (Step-1)',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 380,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.stepfun.com/v1',
    signupUrl: 'https://stepfun.com',
    models: [
      {
        id: 'step-1-8k',
        name: 'Step-1 8K',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 55. Qiniu Cloud
  {
    id: 'qiniu',
    name: 'Qiniu Cloud AI Platform',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 340,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 15_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api.qiniu.com/v1',
    signupUrl: 'https://qiniu.com',
    models: [
      {
        id: 'qiniu-llama3',
        name: 'Llama 3 8B (Qiniu)',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 56. DeepL Free Translation
  {
    id: 'deepl',
    name: 'DeepL API Free',
    category: 'api_key',
    authMethod: 'api_key',
    health: 'untested',
    latencyMs: 210,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 10_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'compliant',
    enabled: true,
    defaultEndpoint: 'https://api-free.deepl.com/v2',
    signupUrl: 'https://deepl.com/pro-api',
    models: [
      {
        id: 'deepl-translate',
        name: 'DeepL Linguistic Specialist',
        contextWindow: 8192,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // -------------------------------------------------------------------------
  // RISKY PROVIDERS (Reverse-engineered or scraping endpoints — DISABLED BY DEFAULT)
  // -------------------------------------------------------------------------

  // 57. HuggingChat (Web Session Scraping)
  {
    id: 'huggingchat',
    name: 'HuggingChat Web Session',
    category: 'web_cookie',
    authMethod: 'web_cookie',
    health: 'untested',
    latencyMs: 580,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 100_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'risky',
    tosExplanation: 'Reverse-engineered web session scraping. Violates upstream HuggingChat ToS regarding automated non-API clients. Disabled by default.',
    enabled: false,
    defaultEndpoint: 'https://huggingface.co/chat/api',
    signupUrl: 'https://huggingface.co/chat',
    models: [
      {
        id: 'huggingchat-qwen',
        name: 'Qwen 2.5 72B (HuggingChat Web)',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free',
        description: 'Session cookie scraper. Use with caution.'
      }
    ]
  },

  // 58. DuckDuckGo AI (Web Chat Wrapper)
  {
    id: 'duckduckgo-ai',
    name: 'DuckDuckGo AI Chat (Web)',
    category: 'web_cookie',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 620,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 30_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'risky',
    tosExplanation: 'Unofficial web client wrapper without SLA or developer agreement. Frequent token drops. Disabled by default.',
    enabled: false,
    defaultEndpoint: 'https://duckduckgo.com/duckchat/v1',
    signupUrl: 'https://duckduckgo.com/chat',
    models: [
      {
        id: 'ddg-claude-3-haiku',
        name: 'Claude 3 Haiku (DDG Web)',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: true, fast: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 59. Phind Web Search
  {
    id: 'phind-web',
    name: 'Phind Code Search (Web)',
    category: 'web_cookie',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 680,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 25_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'risky',
    tosExplanation: 'Unofficial frontend scraper endpoint without developer terms. Disabled by default.',
    enabled: false,
    defaultEndpoint: 'https://www.phind.com/api',
    signupUrl: 'https://phind.com',
    models: [
      {
        id: 'phind-70b',
        name: 'Phind 70B Model (Web)',
        contextWindow: 16_384,
        maxOutputTokens: 4096,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 60. You.com Web Agent
  {
    id: 'you-web',
    name: 'You.com Web Agent',
    category: 'web_cookie',
    authMethod: 'web_cookie',
    health: 'untested',
    latencyMs: 740,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 25_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'risky',
    tosExplanation: 'Reverse-engineered browser endpoint with frequent Cloudflare CAPTCHAs. Disabled by default.',
    enabled: false,
    defaultEndpoint: 'https://you.com/api/streamingSearch',
    signupUrl: 'https://you.com',
    models: [
      {
        id: 'you-smart-search',
        name: 'You.com Smart Search',
        contextWindow: 16_384,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: false },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  },

  // 61. Blackbox AI Web
  {
    id: 'blackbox-web',
    name: 'Blackbox AI (Web)',
    category: 'web_cookie',
    authMethod: 'none',
    health: 'untested',
    latencyMs: 650,
    successRate: 0,
    quotaRemainingPercent: 0,
    monthlyFreeTokens: 30_000_000,
    isFreeTierAvailable: true,
    tosStatus: 'risky',
    tosExplanation: 'Unauthenticated reverse-engineered web endpoint. High probability of silent rate limits. Disabled by default.',
    enabled: false,
    defaultEndpoint: 'https://www.blackbox.ai/api/chat',
    signupUrl: 'https://blackbox.ai',
    models: [
      {
        id: 'blackbox-code',
        name: 'Blackbox Code (Web)',
        contextWindow: 8192,
        maxOutputTokens: 2048,
        isFree: true,
        capabilities: { coding: true },
        provenance: 'FCC',
        costTier: 'free'
      }
    ]
  }
];

export class FCCCatalogSyncService {
  private catalog: Map<string, FCCProviderHealthInfo> = new Map();
  private lastSyncTimestamp = 0;
  private syncTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.initializeCatalog();
    this.loadProbeCache();
    this.scheduleNightlySync();
    // Opportunistic early probe shortly after boot so the dashboard reports
    // measured data without requiring a manual sync.
    const bootTimer = setTimeout(() => {
      void this.syncCatalog();
    }, 30_000);
    if (bootTimer.unref) {
      bootTimer.unref();
    }
  }

  private getProbeCachePath(): string {
    try {
      return `${app.getPath('userData')}/fcc-probe-cache.json`;
    } catch {
      return '';
    }
  }

  private loadProbeCache(): void {
    try {
      const filePath = this.getProbeCachePath();
      if (!filePath) return;
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw) as {
        lastSyncTimestamp?: number;
        results?: Record<string, { health: FCCProviderHealthInfo['health']; latencyMs?: number; probedAt: number }>;
      };
      if (!parsed?.results) return;
      for (const [id, result] of Object.entries(parsed.results)) {
        const provider = this.catalog.get(id);
        if (!provider) continue;
        provider.health = result.health;
        if (typeof result.latencyMs === 'number') {
          provider.latencyMs = result.latencyMs;
        }
        provider.probedAt = result.probedAt;
      }
      this.lastSyncTimestamp = parsed.lastSyncTimestamp || Date.now();
    } catch {
      // No cache file yet — catalog keeps its 'untested' seeds.
    }
  }

  private persistProbeCache(): void {
    try {
      const filePath = this.getProbeCachePath();
      if (!filePath) return;
      const results: Record<string, { health: FCCProviderHealthInfo['health']; latencyMs: number; probedAt: number }> = {};
      for (const [id, provider] of this.catalog.entries()) {
        if (provider.health === 'untested') continue;
        results[id] = { health: provider.health, latencyMs: provider.latencyMs, probedAt: Date.now() };
      }
      fs.writeFileSync(
        filePath,
        JSON.stringify({ lastSyncTimestamp: this.lastSyncTimestamp, results }, null, 2),
        'utf8'
      );
    } catch {
      // Non-fatal — persistence failure must not break syncing.
    }
  }

  private initializeCatalog(): void {
    for (const provider of INITIAL_61_FCC_CATALOG) {
      this.catalog.set(provider.id, { ...provider });
    }
    this.lastSyncTimestamp = Date.now();
  }

  public getCatalog(): FCCProviderHealthInfo[] {
    return Array.from(this.catalog.values());
  }

  public getProvider(id: string): FCCProviderHealthInfo | undefined {
    return this.catalog.get(id);
  }

  public getProviderCount(): number {
    return this.catalog.size;
  }

  public getFreeModelsCount(): number {
    let count = 0;
    for (const provider of this.catalog.values()) {
      if (provider.enabled && provider.health !== 'stopped') {
        count += provider.models.filter((m) => m.isFree).length;
      }
    }
    return count;
  }

  public getAggregateFreeTokens(): number {
    let total = 0;
    for (const provider of this.catalog.values()) {
      total += provider.monthlyFreeTokens || 0;
    }
    return total;
  }

  public setProviderEnabled(providerId: string, enabled: boolean): boolean {
    const provider = this.catalog.get(providerId);
    if (!provider) return false;
    provider.enabled = enabled;
    return true;
  }

  public updateProviderHealth(providerId: string, health: 'healthy' | 'degraded' | 'stopped' | 'untested', latencyMs?: number): void {
    const provider = this.catalog.get(providerId);
    if (!provider) return;
    provider.health = health;
    if (latencyMs !== undefined) {
      provider.latencyMs = latencyMs;
    }
  }

  private static readonly PROBE_TIMEOUT_MS = 3500;
  private static readonly PROBE_CONCURRENCY = 8;

  private async probeEndpoint(endpoint: string): Promise<{ reachable: boolean; latencyMs: number }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FCCCatalogSyncService.PROBE_TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      await fetch(endpoint, {
        method: 'GET',
        signal: controller.signal,
        headers: { 'user-agent': 'Ty-Code-FCC-CatalogSync' }
      });
      // Any HTTP response (incl. 4xx auth walls) proves the host is live.
      return { reachable: true, latencyMs: Date.now() - startedAt };
    } catch {
      return { reachable: false, latencyMs: Date.now() - startedAt };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * On-demand or scheduled catalog sync. Performs REAL endpoint probes for
   * every catalog provider with a usable endpoint (local and remote), writes
   * measured latency and reachability back, and persists the results.
   */
  public async syncCatalog(): Promise<{ count: number; timestamp: number; probed: number }> {
    this.lastSyncTimestamp = Date.now();
    // Refresh health and ensure risky providers remain disabled by default
    const probes: Array<{ provider: FCCProviderHealthInfo; endpoint: string }> = [];
    for (const provider of this.catalog.values()) {
      if (provider.tosStatus === 'risky' && provider.enabled === undefined) {
        provider.enabled = false;
      }
      if (provider.defaultEndpoint) {
        probes.push({ provider, endpoint: provider.defaultEndpoint });
      }
    }

    let probedCount = 0;
    const concurrency = FCCCatalogSyncService.PROBE_CONCURRENCY;
    for (let start = 0; start < probes.length; start += concurrency) {
      const batch = probes.slice(start, start + concurrency);
      await Promise.all(
        batch.map(async ({ provider, endpoint }) => {
          const { reachable, latencyMs } = await this.probeEndpoint(endpoint);
          provider.health = reachable ? 'healthy' : 'stopped';
          if (reachable && latencyMs > 0) {
            provider.latencyMs = latencyMs;
          }
          provider.probedAt = Date.now();
          probedCount++;
        })
      );
    }
    this.persistProbeCache();
    return {
      count: this.catalog.size,
      timestamp: this.lastSyncTimestamp,
      probed: probedCount
    };
  }

  public getLastSyncTimestamp(): number {
    return this.lastSyncTimestamp;
  }

  private scheduleNightlySync(): void {
    // 24-hour interval
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    this.syncTimer = setInterval(() => {
      void this.syncCatalog();
    }, TWENTY_FOUR_HOURS);
    if (this.syncTimer.unref) {
      this.syncTimer.unref();
    }
  }

  public dispose(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }
}

export const fccCatalogSync = new FCCCatalogSyncService();
