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

let cachedOllamaModels: VerifiedModelConfig[] | null = null;
let lastOllamaProbeMs = 0;
let inFlightOllamaProbe: Promise<VerifiedModelConfig[]> | null = null;
const OLLAMA_CACHE_TTL_MS = 60_000;

/**
 * Dynamically detects local Ollama models by querying the local daemon tags endpoint.
 * Times out quickly (400ms on IPv4 127.0.0.1) and caches results to avoid hanging startup or request cycles.
 */
export async function detectLocalOllamaModels(): Promise<VerifiedModelConfig[]> {
  if (cachedOllamaModels && Date.now() - lastOllamaProbeMs < OLLAMA_CACHE_TTL_MS) {
    return cachedOllamaModels;
  }
  if (inFlightOllamaProbe) {
    return inFlightOllamaProbe;
  }

  inFlightOllamaProbe = (async () => {
    try {
      const response = await fetch('http://127.0.0.1:11434/api/tags', {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        },
        signal: AbortSignal.timeout(400)
      });

      if (!response.ok) {
        cachedOllamaModels = [];
        lastOllamaProbeMs = Date.now();
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
            url: 'http://127.0.0.1:11434/v1/chat/completions',
            requiresKey: false,
            providerId: 'ollama'
          };
        })
        .filter((m) => Boolean(m.modelId));

      console.log(`[LOCAL-DETECTOR] Successfully detected ${mappedModels.length} local Ollama model(s).`);
      cachedOllamaModels = mappedModels;
      lastOllamaProbeMs = Date.now();
      return mappedModels;
    } catch (_err: unknown) {
      cachedOllamaModels = [];
      lastOllamaProbeMs = Date.now();
      return [];
    } finally {
      inFlightOllamaProbe = null;
    }
  })();

  return inFlightOllamaProbe;
}
