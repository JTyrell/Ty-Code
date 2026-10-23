/**
 * Omni-Debugger Intelligent Model Router (Step 1)
 *
 * Directs each analysis engine and diagnostic task to the optimal model:
 * 1. Static Analysis: Fast, lightweight code model (Qwen 2.5 Coder Free, Llama 3.3 70B Free)
 * 2. Dynamic Execution: Strong code understanding model (DeepSeek R1 Free)
 * 3. Architectural Analysis: High-capacity reasoning model (Claude 3.5 Sonnet if keys present, DeepSeek R1 fallback)
 * 4. AI Reasoning: Best available model based on user keys (Claude > GPT-4o > DeepSeek R1 > Free Tier)
 *
 * Strict Rule: Automatically prioritizes free models if the user has no paid keys configured.
 *
 * Brand: Ty-Code
 */

import { getModelsAvailability, type AvailableModelConfig } from '../model-availability-manager';
import type { VerifiedModelConfig } from '../verified-models';
import { providerHasOwnKey } from '../../providers/provider-gateway';

export type DebuggerTaskType = 'static' | 'dynamic' | 'arch' | 'ai_reasoning';
export type DebuggerModelMode = 'auto' | 'manual';

export interface DebuggerModelPreferences {
  mode: DebuggerModelMode;
  manualModelId?: string;
  manualProviderId?: string;
  lastActiveModel?: {
    modelId: string;
    name: string;
    providerId: string;
    taskType: DebuggerTaskType;
  };
}

export const DEFAULT_FREE_FALLBACK: VerifiedModelConfig = {
  modelId: 'google/gemma-4-31b-it:free',
  name: 'Gemma 4 31B (Ty-Code Free)',
  url: 'https://openrouter.ai/api/v1/chat/completions',
  requiresKey: true,
  providerId: 'ty-code-free'
};

let currentPreferences: DebuggerModelPreferences = {
  mode: 'auto'
};

/**
 * Checks whether the user has configured any paid/personal keys.
 * If false, the router strictly enforces free model selection.
 */
export function hasUserPaidKeys(): boolean {
  const paidProviders = ['anthropic', 'openai', 'deepseek', 'google', 'mistral', 'openrouter'];
  for (const provider of paidProviders) {
    if (providerHasOwnKey(provider)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks whether a given model candidate belongs to the free supply tier.
 */
export function isFreeModel(model: VerifiedModelConfig): boolean {
  if (!model.requiresKey) return true;
  const pid = (model.providerId || '').toLowerCase();
  if (
    pid === 'ty-code-free' ||
    pid === 'opencode-free' ||
    pid === 'openkilo-free' ||
    pid === 'groq-free'
  ) {
    return true;
  }
  const mid = (model.modelId || '').toLowerCase();
  if (mid.endsWith(':free') || mid.endsWith('/free')) return true;
  return false;
}

/**
 * Retrieves the current Debugger model selection preferences.
 */
export function getDebuggerModelPreferences(): DebuggerModelPreferences {
  return { ...currentPreferences };
}

/**
 * Updates the Debugger model selection preferences (auto vs manual).
 */
export function setDebuggerModelPreferences(
  mode: DebuggerModelMode,
  manualModelId?: string,
  manualProviderId?: string
): DebuggerModelPreferences {
  currentPreferences = {
    ...currentPreferences,
    mode,
    manualModelId: mode === 'manual' ? manualModelId : undefined,
    manualProviderId: mode === 'manual' ? manualProviderId : undefined
  };
  return { ...currentPreferences };
}

/**
 * Records the model chosen for active analysis so the UI status badge can reflect it.
 */
export function recordActiveAnalysisModel(
  taskType: DebuggerTaskType,
  model: VerifiedModelConfig
): void {
  currentPreferences.lastActiveModel = {
    modelId: model.modelId,
    name: model.name,
    providerId: model.providerId,
    taskType
  };
}

/**
 * Selects the best verified model for a specific debugger analysis task.
 *
 * In 'manual' mode:
 * - Uses the user's selected manual model.
 *
 * In 'auto' mode:
 * - Static Analysis: Fast, cheap model (e.g., Qwen 2.5 Coder Free, Llama 3.3 70B Free).
 * - Dynamic Execution: Strong code understanding model (e.g., DeepSeek R1 Free).
 * - Architectural Analysis: High-capacity reasoning model (e.g., Claude 3.5 Sonnet if keys, fallback DeepSeek R1).
 * - AI Reasoning: Best available model based on user keys (Claude > GPT-4o > DeepSeek R1 > Free Tier).
 *
 * Invariant: If the user has no paid keys, auto-selection strictly prioritizes free models.
 */
export async function selectBestModelForTask(
  taskType: DebuggerTaskType,
  options?: { forceAuto?: boolean }
): Promise<VerifiedModelConfig> {
  const prefs = getDebuggerModelPreferences();

  // If in Manual mode and manualModelId is selected (and not forced auto), return manual model
  if (!options?.forceAuto && prefs.mode === 'manual' && prefs.manualModelId) {
    const allModels = await getModelsAvailability();
    const found = allModels.find(
      (m) =>
        m.modelId === prefs.manualModelId &&
        (!prefs.manualProviderId || m.providerId === prefs.manualProviderId)
    );

    if (found) {
      const selected: VerifiedModelConfig = {
        modelId: found.modelId,
        name: found.name,
        url: found.url,
        requiresKey: found.requiresKey,
        providerId: found.providerId
      };
      recordActiveAnalysisModel(taskType, selected);
      return selected;
    }

    const fallbackManual: VerifiedModelConfig = {
      modelId: prefs.manualModelId,
      name: prefs.manualModelId,
      url: 'https://openrouter.ai/api/v1/chat/completions',
      requiresKey: false,
      providerId: prefs.manualProviderId || 'auto'
    };
    recordActiveAnalysisModel(taskType, fallbackManual);
    return fallbackManual;
  }

  // Auto-selection mode
  const allModels = await getModelsAvailability();
  const available = allModels.filter((m) => m.availabilityStatus === 'available');
  const userHasKeys = hasUserPaidKeys();

  // Strict Rule: If user has no paid keys, prioritize free models
  const candidatePool = userHasKeys ? available : available.filter(isFreeModel);
  const pool = candidatePool.length > 0 ? candidatePool : available.length > 0 ? available : allModels;

  let selected: VerifiedModelConfig;

  switch (taskType) {
    case 'static': {
      // Static Analysis: fast, cheap model (e.g. Qwen 2.5 Coder Free, Llama 3.3 70B Free)
      const qwenCoder = pool.find(
        (m) => isFreeModel(m) && /qwen.*coder/i.test(`${m.modelId} ${m.name}`)
      );
      if (qwenCoder) {
        selected = qwenCoder;
        break;
      }

      const llama70b = pool.find(
        (m) => isFreeModel(m) && /llama.*3\.3.*70b/i.test(`${m.modelId} ${m.name}`)
      );
      if (llama70b) {
        selected = llama70b;
        break;
      }

      const fastCode = pool.find(
        (m) => isFreeModel(m) && /(code|coder|north-mini|laguna)/i.test(`${m.modelId} ${m.name}`)
      );
      if (fastCode) {
        selected = fastCode;
        break;
      }

      const groqFast = pool.find(
        (m) => (m.providerId === 'groq-free' || /groq/i.test(m.providerId)) && isFreeModel(m)
      );
      if (groqFast) {
        selected = groqFast;
        break;
      }

      const anyFree = pool.find((m) => isFreeModel(m));
      selected = anyFree || pool[0] || DEFAULT_FREE_FALLBACK;
      break;
    }

    case 'dynamic': {
      // Dynamic Execution: strong code understanding (e.g., DeepSeek R1 Free)
      const deepseekR1 = pool.find(
        (m) => isFreeModel(m) && /deepseek.*r1/i.test(`${m.modelId} ${m.name}`)
      );
      if (deepseekR1) {
        selected = deepseekR1;
        break;
      }

      const deepseekOther = pool.find(
        (m) => isFreeModel(m) && /deepseek/i.test(`${m.modelId} ${m.name}`)
      );
      if (deepseekOther) {
        selected = deepseekOther;
        break;
      }

      const strongCode = pool.find(
        (m) => isFreeModel(m) && /(laguna|north-mini|coder|code)/i.test(`${m.modelId} ${m.name}`)
      );
      if (strongCode) {
        selected = strongCode;
        break;
      }

      const nemotronUltra = pool.find(
        (m) => isFreeModel(m) && /nemotron.*ultra/i.test(`${m.modelId} ${m.name}`)
      );
      if (nemotronUltra) {
        selected = nemotronUltra;
        break;
      }

      const anyFree = pool.find((m) => isFreeModel(m));
      selected = anyFree || pool[0] || DEFAULT_FREE_FALLBACK;
      break;
    }

    case 'arch': {
      // Architectural Analysis: high-capacity reasoning model
      // (Claude 3.5 Sonnet if user has keys, fallback to DeepSeek R1)
      if (userHasKeys) {
        const claude = available.find((m) =>
          /claude-3[.-]5-sonnet/i.test(`${m.modelId} ${m.name}`)
        );
        if (claude) {
          selected = claude;
          break;
        }
      }

      // Fallback to DeepSeek R1 or high-capacity reasoning free model
      const deepseekR1 = pool.find(
        (m) => isFreeModel(m) && /deepseek.*r1/i.test(`${m.modelId} ${m.name}`)
      );
      if (deepseekR1) {
        selected = deepseekR1;
        break;
      }

      const nemotronUltra = pool.find(
        (m) => isFreeModel(m) && /nemotron.*(?:ultra|super)/i.test(`${m.modelId} ${m.name}`)
      );
      if (nemotronUltra) {
        selected = nemotronUltra;
        break;
      }

      const kiloAuto = pool.find((m) => isFreeModel(m) && /kilo-auto/i.test(m.modelId));
      if (kiloAuto) {
        selected = kiloAuto;
        break;
      }

      const gemma = pool.find((m) => isFreeModel(m) && /gemma-4/i.test(`${m.modelId} ${m.name}`));
      if (gemma) {
        selected = gemma;
        break;
      }

      const anyFree = pool.find((m) => isFreeModel(m));
      selected = anyFree || pool[0] || DEFAULT_FREE_FALLBACK;
      break;
    }

    case 'ai_reasoning': {
      // AI Reasoning: Best available model based on user keys (Claude > GPT-4o > DeepSeek R1 > Free tier)
      if (userHasKeys) {
        // 1. Claude
        const claude = available.find((m) =>
          /claude-3[.-](?:5|7)-sonnet/i.test(`${m.modelId} ${m.name}`)
        );
        if (claude) {
          selected = claude;
          break;
        }

        // 2. GPT-4o
        const gpt4o = available.find(
          (m) => /gpt-4o(?:-20\d\d)?$/i.test(m.modelId) || /(^|\/)gpt-4o/i.test(m.modelId)
        );
        if (gpt4o) {
          selected = gpt4o;
          break;
        }

        // 3. DeepSeek R1
        const deepseekR1 = available.find((m) =>
          /deepseek.*r1/i.test(`${m.modelId} ${m.name}`)
        );
        if (deepseekR1) {
          selected = deepseekR1;
          break;
        }
      }

      // 4. Free tier prioritized if no paid keys or paid models unavailable:
      // DeepSeek R1 Free > Nemotron 3 Ultra Free > Nemotron 3.5 Super VL Free > Gemma 4 31B Free > North Mini Code Free
      const freeR1 = pool.find(
        (m) => isFreeModel(m) && /deepseek.*r1/i.test(`${m.modelId} ${m.name}`)
      );
      if (freeR1) {
        selected = freeR1;
        break;
      }

      const freeNemotronUltra = pool.find(
        (m) => isFreeModel(m) && /nemotron-3-ultra/i.test(`${m.modelId} ${m.name}`)
      );
      if (freeNemotronUltra) {
        selected = freeNemotronUltra;
        break;
      }

      const freeNemotronSuper = pool.find(
        (m) => isFreeModel(m) && /nemotron-3\.5-super/i.test(`${m.modelId} ${m.name}`)
      );
      if (freeNemotronSuper) {
        selected = freeNemotronSuper;
        break;
      }

      const freeGemma = pool.find(
        (m) => isFreeModel(m) && /gemma-4-31b/i.test(`${m.modelId} ${m.name}`)
      );
      if (freeGemma) {
        selected = freeGemma;
        break;
      }

      const freeNorth = pool.find(
        (m) => isFreeModel(m) && /north-mini/i.test(`${m.modelId} ${m.name}`)
      );
      if (freeNorth) {
        selected = freeNorth;
        break;
      }

      const anyFree = pool.find((m) => isFreeModel(m));
      selected = anyFree || pool[0] || DEFAULT_FREE_FALLBACK;
      break;
    }
  }

  recordActiveAnalysisModel(taskType, selected);
  return selected;
}

/**
 * Returns current resolved models for all 4 debugger tasks simultaneously.
 */
export async function getAllTaskModelSelections(): Promise<
  Record<DebuggerTaskType, VerifiedModelConfig>
> {
  const [staticModel, dynamicModel, archModel, aiModel] = await Promise.all([
    selectBestModelForTask('static'),
    selectBestModelForTask('dynamic'),
    selectBestModelForTask('arch'),
    selectBestModelForTask('ai_reasoning')
  ]);

  return {
    static: staticModel,
    dynamic: dynamicModel,
    arch: archModel,
    ai_reasoning: aiModel
  };
}

export const debuggerModelRouter = {
  selectBestModelForTask,
  getAllTaskModelSelections,
  getDebuggerModelPreferences,
  setDebuggerModelPreferences,
  hasUserPaidKeys,
  isFreeModel
};
