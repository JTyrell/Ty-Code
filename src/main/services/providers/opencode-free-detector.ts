/**
 * OpenCode Free Tier Detector (Phase 6.3)
 *
 * Identifies, catalogs, and enables all free-tier model access from OpenCode's
 * configuration, including OpenRouter free models, Groq free tier, GitHub Copilot,
 * Google AI Studio, local Ollama models, and custom zero-cost providers.
 *
 * Brand: Ty-Code
 */

import type { OpenCodeConfig, OpenCodeFreeTierSummary, OpenCodeProviderConfig } from '../../../shared/types/opencode-sync';
import type { DiscoveredModel } from '../../../preload/types';

export const OPENCODE_CURATED_FREE_MODELS: Record<string, string[]> = {
  openrouter: [
    'nvidia/nemotron-3-ultra-550b-a55b:free',
    'google/gemma-4-31b-it:free',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'thinkingmachines/inkling-small:free',
    'dots-studio/dots-3-note-preview:free',
    'cohere/north-mini-code:free',
    'nvidia/nemotron-3.5-lightning:free'
  ],
  groq: [
    'llama-3.3-70b-versatile',
    'llama-3.1-8b-instant'
  ],
  gemini: [
    'gemini-2.0-flash-exp',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ],
  copilot: [
    'claude-3.5-sonnet',
    'gpt-4o',
    'o1-mini'
  ]
};

export class OpenCodeFreeDetector {
  private static instance: OpenCodeFreeDetector;

  public static getInstance(): OpenCodeFreeDetector {
    if (!OpenCodeFreeDetector.instance) {
      OpenCodeFreeDetector.instance = new OpenCodeFreeDetector();
    }
    return OpenCodeFreeDetector.instance;
  }

  /**
   * Analyzes an OpenCode configuration object and produces a summary of all available free tiers.
   */
  public analyzeFreeTiers(config: OpenCodeConfig | null): OpenCodeFreeTierSummary {
    const summary: OpenCodeFreeTierSummary = {
      hasOpenRouterFree: false,
      openRouterFreeModels: [],
      hasGroqFree: false,
      groqFreeModels: [],
      hasCopilotFree: false,
      hasGeminiFree: false,
      geminiFreeModels: [],
      hasOllamaLocal: false,
      ollamaModels: [],
      customFreeProviders: [],
      totalFreeModels: 0
    };

    if (!config) {
      return summary;
    }

    const allProviders = {
      ...(config.providers || {}),
      ...(config.customProviders || {})
    };

    // 1. Check OpenRouter
    const hasOr = Boolean(
      allProviders.openrouter ||
      allProviders['openrouter-free'] ||
      config.keys?.openrouter ||
      config.keys?.OPENROUTER_API_KEY
    );
    if (hasOr || config.defaultProvider === 'openrouter') {
      summary.hasOpenRouterFree = true;
      const configuredModels = (allProviders.openrouter as OpenCodeProviderConfig)?.models || [];
      const freeFromConfig = configuredModels.filter((m) => m.toLowerCase().includes(':free'));
      summary.openRouterFreeModels = Array.from(new Set([
        ...OPENCODE_CURATED_FREE_MODELS.openrouter,
        ...freeFromConfig
      ]));
    }

    // 2. Check Groq
    const hasGroq = Boolean(
      allProviders.groq ||
      allProviders['groq-free'] ||
      config.keys?.groq ||
      config.keys?.GROQ_API_KEY
    );
    if (hasGroq || config.defaultProvider === 'groq') {
      summary.hasGroqFree = true;
      const configuredModels = (allProviders.groq as OpenCodeProviderConfig)?.models || [];
      summary.groqFreeModels = Array.from(new Set([
        ...OPENCODE_CURATED_FREE_MODELS.groq,
        ...configuredModels
      ]));
    }

    // 3. Check GitHub Copilot
    const hasCopilot = Boolean(
      allProviders.copilot ||
      allProviders['github-copilot'] ||
      config.keys?.github ||
      config.keys?.copilot
    );
    if (hasCopilot) {
      summary.hasCopilotFree = true;
    }

    // 4. Check Google AI Studio (Gemini)
    const hasGemini = Boolean(
      allProviders.gemini ||
      allProviders.google ||
      config.keys?.gemini ||
      config.keys?.google
    );
    if (hasGemini) {
      summary.hasGeminiFree = true;
      const configuredModels = (allProviders.gemini as OpenCodeProviderConfig)?.models || [];
      summary.geminiFreeModels = Array.from(new Set([
        ...OPENCODE_CURATED_FREE_MODELS.gemini,
        ...configuredModels
      ]));
    }

    // 5. Check Local Ollama
    const hasOllama = Boolean(
      allProviders.ollama ||
      allProviders.local ||
      (allProviders.custom as OpenCodeProviderConfig)?.baseUrl?.includes('11434')
    );
    if (hasOllama) {
      summary.hasOllamaLocal = true;
      const configuredModels = (allProviders.ollama as OpenCodeProviderConfig)?.models || [];
      summary.ollamaModels = configuredModels.length > 0 ? configuredModels : ['qwen2.5-coder:latest', 'llama3:latest'];
    }

    // 6. Check Custom Free Providers
    for (const [id, prov] of Object.entries(allProviders)) {
      if (typeof prov === 'object' && prov !== null) {
        const p = prov as OpenCodeProviderConfig;
        if (p.isFree === true || p.models?.some((m) => m.toLowerCase().includes(':free'))) {
          summary.customFreeProviders.push(p.name || id);
        }
      }
    }

    // Calculate total free models found
    summary.totalFreeModels =
      (summary.hasOpenRouterFree ? summary.openRouterFreeModels.length : 0) +
      (summary.hasGroqFree ? summary.groqFreeModels.length : 0) +
      (summary.hasCopilotFree ? OPENCODE_CURATED_FREE_MODELS.copilot.length : 0) +
      (summary.hasGeminiFree ? summary.geminiFreeModels.length : 0) +
      (summary.hasOllamaLocal ? summary.ollamaModels.length : 0) +
      summary.customFreeProviders.length;

    return summary;
  }

  /**
   * Generates a normalized list of DiscoveredModel items for all free models found via OpenCode.
   */
  public extractDiscoveredFreeModels(config: OpenCodeConfig | null): DiscoveredModel[] {
    const summary = this.analyzeFreeTiers(config);
    const discovered: DiscoveredModel[] = [];

    if (summary.hasOpenRouterFree) {
      for (const m of summary.openRouterFreeModels) {
        discovered.push({
          id: m,
          name: `${m} (via OpenCode OpenRouter)`,
          provider: 'openrouter',
          isFree: true,
          category: 'Free',
          description: 'OpenCode-synchronized OpenRouter free tier model'
        });
      }
    }

    if (summary.hasGroqFree) {
      for (const m of summary.groqFreeModels) {
        discovered.push({
          id: m,
          name: `${m} (via OpenCode Groq)`,
          provider: 'groq',
          isFree: true,
          category: 'Free',
          description: 'OpenCode-synchronized Groq free tier model'
        });
      }
    }

    if (summary.hasGeminiFree) {
      for (const m of summary.geminiFreeModels) {
        discovered.push({
          id: m,
          name: `${m} (via OpenCode Gemini)`,
          provider: 'google-ai-studio-free',
          isFree: true,
          category: 'Free',
          description: 'OpenCode-synchronized Google AI Studio model'
        });
      }
    }

    if (summary.hasOllamaLocal) {
      for (const m of summary.ollamaModels) {
        discovered.push({
          id: m,
          name: `${m} (via OpenCode Ollama)`,
          provider: 'ollama',
          isFree: true,
          category: 'Free',
          description: 'OpenCode local Ollama model'
        });
      }
    }

    return discovered;
  }
}

export const opencodeFreeDetector = OpenCodeFreeDetector.getInstance();
