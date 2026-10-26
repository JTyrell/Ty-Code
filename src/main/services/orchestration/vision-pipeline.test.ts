import { describe, expect, it } from 'vitest';
import type { ProviderCandidate } from './strategies/types';
import {
  buildAnalysisPrompt,
  buildImageContextPrefix,
  doesModelSupportVision,
  looksLikeVisionModel,
  rankVisionCandidates
} from './vision-pipeline';

interface CandidateOverrides {
  vision?: boolean;
  freeModel?: boolean;
  freeProvider?: boolean;
  contextWindow?: number;
  speed?: number;
}

function makeCandidate(providerId: string, modelId: string, overrides: CandidateOverrides = {}): ProviderCandidate {
  return {
    provider: {
      id: providerId,
      name: providerId.toUpperCase(),
      category: 'api_key',
      authMethod: 'api_key',
      defaultEndpoint: '',
      isFreeTierAvailable: overrides.freeProvider ?? false
    } as unknown as ProviderCandidate['provider'],
    model: {
      id: modelId,
      name: modelId,
      contextWindow: overrides.contextWindow ?? 128_000,
      maxOutputTokens: 16_384,
      capabilities: {
        reasoning: false,
        tools: true,
        vision: overrides.vision ?? false,
        codingScore: 90,
        speedTokensPerSec: overrides.speed ?? 80,
        isFree: overrides.freeModel ?? false
      },
      costTier: 'low',
      primaryTask: 'coding'
    } as unknown as ProviderCandidate['model']
  };
}

describe('looksLikeVisionModel', () => {
  it('flags known vision model families', () => {
    expect(looksLikeVisionModel('gemini-2.5-flash')).toBe(true);
    expect(looksLikeVisionModel('GPT-4o-2024-11-20')).toBe(true);
    expect(looksLikeVisionModel('claude-sonnet-4')).toBe(true);
    expect(looksLikeVisionModel('glm-4v-plus')).toBe(true);
    expect(looksLikeVisionModel('qwen-vl-max')).toBe(true);
    expect(looksLikeVisionModel('pixtral-large')).toBe(true);
    expect(looksLikeVisionModel('llava-13b')).toBe(true);
  });

  it('rejects non-vision identifiers', () => {
    expect(looksLikeVisionModel('gpt-3.5-turbo')).toBe(false);
    expect(looksLikeVisionModel('text-embedding-3-small')).toBe(false);
    expect(looksLikeVisionModel('o3-mini')).toBe(false);
    expect(looksLikeVisionModel('')).toBe(false);
  });
});

describe('rankVisionCandidates', () => {
  it('keeps only vision-capable candidates and sorts strongest first', () => {
    const gaze = makeCandidate('openai', 'gpt-4o', { vision: true, contextWindow: 128_000, speed: 80 });
    const blind = makeCandidate('acme', 'o3-mini', { vision: false, contextWindow: 200_000, speed: 50 });
    const heur = makeCandidate('acme', 'super-vl', { contextWindow: 8_000, speed: 0, freeProvider: true, freeModel: true });
    const ranked = rankVisionCandidates([gaze, blind, heur]);
    expect(ranked).toHaveLength(2);
    expect(ranked[0]).toMatchObject({ providerId: 'openai', modelId: 'gpt-4o' });
    expect(ranked[1]).toMatchObject({ providerId: 'acme', modelId: 'super-vl' });
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it('dedupes provider/model pairs and honours the limit', () => {
    const a = makeCandidate('openai', 'gpt-4o', { vision: true, contextWindow: 128_000, speed: 80 });
    const b = makeCandidate('openai', 'gpt-4o-mini', { vision: true, contextWindow: 128_000, speed: 130 });
    const bits = [a, b, a];
    const limited = rankVisionCandidates(bits, 1);
    expect(limited).toHaveLength(1);
    expect(limited[0].modelId).toBe('gpt-4o-mini');
    const full = rankVisionCandidates(bits, 8);
    expect(full).toHaveLength(2);
  });

  it('scores free models above paid models at equal capability', () => {
    const free = makeCandidate('kilo', 'gemma-3', { vision: false, freeModel: true, contextWindow: 8_000, speed: 10 });
    const paid = makeCandidate('acme', 'acme-vision-l', { vision: false, contextWindow: 8_000, speed: 10 });
    const ranked = rankVisionCandidates([paid, free]);
    expect(ranked[0]).toMatchObject({ providerId: 'kilo', modelId: 'gemma-3', free: true });
  });
});

describe('buildAnalysisPrompt', () => {
  it('states the image count and never says image/games', () => {
    const single = buildAnalysisPrompt(1);
    expect(single).toContain('1 attached image');
    expect(single).not.toContain('attached images,');
    const several = buildAnalysisPrompt(3);
    expect(several).toContain('3 attached images');
    expect(several).toContain('image 1');
    expect(several).toContain('transcribe');
  });
});

describe('buildImageContextPrefix', () => {
  it('wraps the analysis in the tagged block with attribution', () => {
    expect(buildImageContextPrefix(' the lines ', 'p1', 'm1')).toBe('[IMAGE CONTEXT — analyzed by p1/m1]\nthe lines\n[/IMAGE CONTEXT]');
    expect(buildImageContextPrefix('ctx')).toBe('[IMAGE CONTEXT — analyzed by vision model]\nctx\n[/IMAGE CONTEXT]');
  });
});

describe('doesModelSupportVision', () => {
  it('uses the registry capability first', () => {
    expect(doesModelSupportVision('openai', 'gpt-4o')).toBe(true);
    expect(doesModelSupportVision('openai', 'o3-mini')).toBe(false);
  });

  it('falls back to id heuristics for unknown models', () => {
    expect(doesModelSupportVision('ghost-provider', 'pixtral-large')).toBe(true);
    expect(doesModelSupportVision('ghost-provider', 'ghostcoder-xl')).toBe(false);
    expect(doesModelSupportVision('openai', '')).toBe(false);
  });
});
