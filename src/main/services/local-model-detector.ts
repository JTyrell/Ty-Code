import type { VerifiedModelConfig } from './verified-models';

export interface OllamaTagModel {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  digest?: string;
  details?: {
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaTagsResponse {
  models?: OllamaTagModel[];
}

/**
 * Dynamically detects local Ollama models by querying the local daemon tags endpoint.
 * Times out quickly (2 seconds) to avoid hanging application startup or request cycles.
 */
export async function detectLocalOllamaModels(): Promise<VerifiedModelConfig[]> {
  try {
    const response = await fetch('http://localhost:11434/api/tags', {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      },
      signal: AbortSignal.timeout(2000)
    });

    if (!response.ok) {
      console.log('[LOCAL-DETECTOR] Ollama not detected');
      return [];
    }

    const data = (await response.json()) as OllamaTagsResponse;
    const models = Array.isArray(data.models) ? data.models : [];

    const mappedModels: VerifiedModelConfig[] = models
      .map((m) => {
        const id = m.name || m.model || '';
        return {
          modelId: id,
          name: `${id} (Ollama Local)`,
          url: 'http://localhost:11434/v1/chat/completions',
          requiresKey: false,
          providerId: 'ollama'
        };
      })
      .filter((m) => Boolean(m.modelId));

    console.log(`[LOCAL-DETECTOR] Successfully detected ${mappedModels.length} local Ollama model(s).`);
    return mappedModels;
  } catch (_err: unknown) {
    console.log('[LOCAL-DETECTOR] Ollama not detected');
    return [];
  }
}
