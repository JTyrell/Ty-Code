import type { ProviderSettings } from '../../../preload/types';
import type { ProviderCandidate } from './strategies/types';
import { providerRegistry } from './provider-registry';

export interface VisionCandidate {
  providerId: string;
  modelId: string;
  score: number;
  free: boolean;
}

export interface ImageAnalysisTried {
  providerId: string;
  modelId: string;
  error: string;
}

export interface ImageAnalysisOutcome {
  usedAnalysis: boolean;
  contextText: string;
  providerId?: string;
  modelId?: string;
  tried: ImageAnalysisTried[];
}

const ANALYSIS_TIMEOUT_MS = 45_000;
const MAX_ANALYSIS_CANDIDATES = 4;
const MIN_VALID_CONTEXT_CHARS = 40;

const VISION_MODEL_ID_RE = /gemini|gpt-4o|gpt-4\.1|gpt-4-vision|claude|gemma-3|-vl|vision|glm-4v|pixtral|qwen-?vl|llava|phi-3-vision/m;

export function looksLikeVisionModel(modelId: string): boolean {
  return VISION_MODEL_ID_RE.test((modelId || '').toLowerCase());
}

export function rankVisionCandidates(candidates: ProviderCandidate[], limit = MAX_ANALYSIS_CANDIDATES): VisionCandidate[] {
  const deduped = new Map<string, VisionCandidate>();
  for (const candidate of candidates) {
    const registryFlag = Boolean(candidate.model?.capabilities?.vision);
    if (!registryFlag && !looksLikeVisionModel(candidate.model?.id || '')) continue;
    const free = Boolean(candidate.model?.capabilities?.isFree || candidate.provider?.isFreeTierAvailable)
      || ['openkilo', 'openkilo-free', 'kilo', 'fcc-proxy', 'ollama', 'ty-code-free'].includes((candidate.provider?.id || '').toLowerCase());
    const score =
      (registryFlag ? 30 : 10)
      + Math.min(20, Math.round((candidate.model?.contextWindow || 0) / 64_000))
      + (free ? 6 : 0)
      + Math.round(Math.min(600, candidate.model?.capabilities?.speedTokensPerSec || 0) / 40);
    const key = `${candidate.provider?.id || ''}::${candidate.model?.id || ''}`;
    const previous = deduped.get(key);
    if (!previous || previous.score < score) {
      deduped.set(key, { providerId: candidate.provider?.id || '', modelId: candidate.model?.id || '', score, free });
    }
  }
  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || a.modelId.localeCompare(b.modelId))
    .slice(0, Math.max(1, limit));
}

export async function listVisionCandidates(settings: ProviderSettings, limit = MAX_ANALYSIS_CANDIDATES): Promise<VisionCandidate[]> {
  try {
    const { omniRouteRouter } = await import('./router');
    return rankVisionCandidates(omniRouteRouter.getCandidates(settings), limit);
  } catch {
    return [];
  }
}

export function buildAnalysisPrompt(imageCount: number): string {
  return [
    `You are the Ty-Code image analysis agent. Analyze the ${imageCount} attached image${imageCount === 1 ? '' : 's'} precisely — the attachments map to "image 1", "image 2", ... in order.`,
    'Produce a factual, developer-oriented report in plain text:',
    '1. Overall: what is shown (UI screen, code, terminal, error dialog, diagram, design, photo) and any app or branding visible.',
    '2. For UI shots: layout regions, visible labels/buttons/routes, typography and colour cues, and any noticeable layout or styling bugs (spacing, overlap, truncation, contrast).',
    '3. For code or terminal shots: transcribe the relevant code and commands and the exact error text you can read.',
    '4. All readable text verbatim (URLs, stack traces, JSON, numbers). Mark anything unreadable as illegible instead of guessing.',
    '5. Your best assessment of the developer concern behind each image and what a coding assistant should do about it.',
    'Do not apologise, do not mention being an AI, and do not use markdown headings.'
  ].join('\n');
}

export function buildImageContextPrefix(contextText: string, providerId?: string, modelId?: string): string {
  const source = providerId && modelId ? `${providerId}/${modelId}` : 'vision model';
  return `[IMAGE CONTEXT — analyzed by ${source}]\n${(contextText || '').trim()}\n[/IMAGE CONTEXT]`;
}

export function doesModelSupportVision(providerId: string | undefined, modelId: string | undefined): boolean {
  const id = (modelId || '').toLowerCase();
  if (!id) return false;
  try {
    const provider = providerRegistry.getProvider((providerId || '').toLowerCase());
    const model = provider?.supportedModels.find((entry) => id === entry.id.toLowerCase() || id.endsWith(entry.id.toLowerCase()));
    if (model) return Boolean(model.capabilities?.vision);
  } catch {
    // Fall through to the id heuristics.
  }
  return looksLikeVisionModel(id);
}

async function callVisionModel(
  candidate: VisionCandidate,
  prompt: string,
  images: string[],
  signal: AbortSignal | undefined
): Promise<string> {
  const gateway = await import('../../providers/provider-gateway');
  const prior = gateway.getActiveModel();
  gateway.setActiveModel({ providerId: candidate.providerId, modelId: candidate.modelId, isAutoMode: false });
  const timeoutController = new AbortController();
  const timer = setTimeout(() => timeoutController.abort(), ANALYSIS_TIMEOUT_MS);
  if (typeof timer.unref === 'function') timer.unref();
  if (signal) {
    if (signal.aborted) timeoutController.abort();
    else signal.addEventListener('abort', () => timeoutController.abort(), { once: true });
  }
  try {
    return await gateway.sendChatRequest(
      candidate.providerId,
      candidate.modelId,
      [{ role: 'user', content: prompt, images }],
      false,
      undefined,
      undefined,
      0,
      timeoutController.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      `vision-analysis-${Date.now()}`,
      'chat'
    );
  } finally {
    clearTimeout(timer);
    gateway.setActiveModel(prior);
  }
}

export async function analyzeImageContext(
  images: string[],
  settings: ProviderSettings,
  signal: AbortSignal | undefined,
  onProgress?: (message: string) => void
): Promise<ImageAnalysisOutcome> {
  const candidates = await listVisionCandidates(settings);
  const tried: ImageAnalysisTried[] = [];
  if (!candidates.length) {
    return { usedAnalysis: false, contextText: '', tried };
  }
  const prompt = buildAnalysisPrompt(images.length);
  for (const candidate of candidates) {
    if (signal?.aborted) break;
    onProgress?.(`Analyzing ${images.length} image${images.length === 1 ? '' : 's'} with ${candidate.providerId}/${candidate.modelId}…`);
    try {
      const analysis = await callVisionModel(candidate, prompt, images, signal);
      const trimmed = (analysis || '').trim();
      if (trimmed.length >= MIN_VALID_CONTEXT_CHARS) {
        return { usedAnalysis: true, contextText: trimmed, providerId: candidate.providerId, modelId: candidate.modelId, tried };
      }
      tried.push({ providerId: candidate.providerId, modelId: candidate.modelId, error: 'Model returned an empty analysis.' });
    } catch (err: unknown) {
      tried.push({ providerId: candidate.providerId, modelId: candidate.modelId, error: err instanceof Error ? err.message : String(err) });
    }
    if (signal?.aborted) break;
  }
  return { usedAnalysis: false, contextText: '', tried };
}
