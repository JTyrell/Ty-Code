/**
 * Model Rotation & OmniRoute Failover Manager (Step 5)
 *
 * Implements high-priority provider and harness fallback chains:
 * 1. Community Key (ty-code-free)
 * 2. FCC Multi-Harness Layer (1.3B+ tokens across 11 harnesses)
 * 3. Anonymous OpenKilo pool
 * 4. User-Keyed Providers (OpenRouter, Groq, Google, Ollama)
 *
 * Automatically rotates through FCC harnesses (Claude Code -> Codex -> VSCode -> Pi -> OpenCode -> ...)
 * when a specific harness rate-limits or fails, before degrading to the next provider tier.
 *
 * Attribution:
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 */

import { fccSidecarManager } from './fcc-sidecar-manager';
import type { WorkspaceProfile } from './context-engine/types';
import { getOrScanWorkspaceProfile } from './context-engine/workspace-scanner';
import { getCorrections, getCorrectionEntries } from './context-engine/correction-memory';

export function formatKeyDirectories(keyDirectories: Record<string, string> = {}): string {
  const entries = Object.entries(keyDirectories);
  if (entries.length === 0) return 'Standard layout';
  return entries.map(([key, val]) => `${key} (${val})`).join(', ');
}

export function buildOmniContextPrompt(
  profile: WorkspaceProfile,
  corrections: Array<string | { rule: string; category?: string }>
): string {
  const architecture = profile.architecture || 'Modular Application';
  const frameworks = profile.frameworks && profile.frameworks.length > 0
    ? profile.frameworks.join(', ')
    : 'None detected';
  const databases = profile.databases && profile.databases.length > 0
    ? profile.databases.join(', ')
    : 'None detected';
  const keyDirectories = formatKeyDirectories(profile.keyDirectories);

  let prompt = `[WORKSPACE CONTEXT]\nYou are working in a ${architecture} project using ${frameworks}.\nDatabase: ${databases}.\nKey Directories: ${keyDirectories}.`;

  if (profile.missingContext && profile.missingContext.length > 0) {
    prompt += `\nMissing Context: ${profile.missingContext.join('; ')}.`;
  }

  if (corrections && corrections.length > 0) {
    const formattedCorrections = corrections.map((c) => {
      if (typeof c === 'string') {
        return `- ${c}`;
      }
      const categoryTag = c.category ? `[${c.category.toUpperCase()}] ` : '';
      const rule = c.rule.startsWith('[') ? c.rule : `${categoryTag}${c.rule}`;
      return `- ${rule}`;
    });
    prompt += `\n\n[USER PREFERENCES & CORRECTIONS]\nYou MUST adhere to the following project rules learned from previous interactions:\n${formattedCorrections.join('\n')}`;
  }

  return prompt;
}

export const FALLBACK_CHAIN: string[] = [
  'ty-code-free',    // Community key (ZeroFriction)
  'fcc',             // FCC multi-harness (1.3B+ free tokens)
  'openkilo',        // Anonymous free pool
  'openrouter-free', // User-keyed free router
  'groq-free',       // Groq ultra-fast
  'google-ai-studio',// Gemini free tier
  'ollama'           // Local offline
];

export const FCC_HARNESSES = [
  'claude-code',
  'codex',
  'vscode',
  'pi',
  'opencode',
  'cline',
  'aider',
  'hermes',
  'deepseek',
  'grok-build',
  'muse-code'
] as const;

export type FCCHarnessType = typeof FCC_HARNESSES[number];

export interface HarnessFailureRecord {
  harness: string;
  error: string;
  timestamp: number;
}

export class ModelRotationManager {
  private static instance: ModelRotationManager | null = null;
  private failedHarnesses: Map<string, HarnessFailureRecord> = new Map();
  private readonly HARNESS_COOLDOWN_MS = 60_000; // 1 minute cooldown

  public static getInstance(): ModelRotationManager {
    if (!ModelRotationManager.instance) {
      ModelRotationManager.instance = new ModelRotationManager();
    }
    return ModelRotationManager.instance;
  }

  public getFallbackChain(): string[] {
    return [...FALLBACK_CHAIN];
  }

  public getSupportedHarnesses(): string[] {
    return [...FCC_HARNESSES];
  }

  /**
   * Returns whether FCC quota is currently reported as exhausted
   */
  public isFccQuotaExhausted(): boolean {
    const health = fccSidecarManager.getLastHealth();
    if (health?.quota) {
      return health.quota.remaining <= 0;
    }
    return false;
  }

  /**
   * Rotates to the next healthy harness within FCC
   */
  public getNextHarness(
    currentHarness?: string,
    excludedHarnesses?: Set<string>
  ): string | null {
    const now = Date.now();
    const candidateList = FCC_HARNESSES.filter((h) => {
      if (excludedHarnesses && excludedHarnesses.has(h)) return false;
      const record = this.failedHarnesses.get(h);
      if (record && now - record.timestamp < this.HARNESS_COOLDOWN_MS) {
        return false;
      }
      return true;
    });

    if (candidateList.length === 0) {
      return null;
    }

    if (!currentHarness) {
      return candidateList[0];
    }

    const currentIndex = candidateList.indexOf(currentHarness as FCCHarnessType);
    if (currentIndex === -1 || currentIndex === candidateList.length - 1) {
      return candidateList[0];
    }
    return candidateList[currentIndex + 1];
  }

  /**
   * Rotates to the next provider in the fallback chain
   */
  public getNextProvider(
    currentProvider: string,
    excludedProviders?: Set<string>
  ): string | null {
    const norm = currentProvider.toLowerCase().trim();
    const index = FALLBACK_CHAIN.findIndex((p) => p.toLowerCase() === norm);
    const startIdx = index >= 0 ? index + 1 : 0;

    for (let i = startIdx; i < FALLBACK_CHAIN.length; i++) {
      const candidate = FALLBACK_CHAIN[i];
      if (excludedProviders && excludedProviders.has(candidate)) continue;
      if (candidate === 'fcc' && this.isFccQuotaExhausted()) continue;
      return candidate;
    }
    return null;
  }

  public recordHarnessFailure(harness: string, error: string): void {
    console.warn(`[FCC-ROTATION] Harness failure recorded for "${harness}": ${error}`);
    this.failedHarnesses.set(harness, {
      harness,
      error,
      timestamp: Date.now()
    });
  }

  public recordHarnessSuccess(harness: string): void {
    this.failedHarnesses.delete(harness);
  }

  public clearCooldowns(): void {
    this.failedHarnesses.clear();
  }

  /**
   * Fetches the current WorkspaceProfile and CorrectionMemory for the workspace,
   * then composes the Omni-Orchestrator context injection block.
   */
  public async getOmniContextInjection(workspacePath: string): Promise<string> {
    try {
      const [profile, entries] = await Promise.all([
        getOrScanWorkspaceProfile(workspacePath).catch(() => null),
        getCorrectionEntries(workspacePath).catch(() => [])
      ]);

      if (!profile) {
        if (entries.length > 0) {
          const formatted = entries.map((c) => `- [${c.category.toUpperCase()}] ${c.rule}`).join('\n');
          return `[USER PREFERENCES & CORRECTIONS]\nYou MUST adhere to the following project rules learned from previous interactions:\n${formatted}`;
        }
        return '';
      }

      return buildOmniContextPrompt(profile, entries);
    } catch (err) {
      console.warn('[ModelRotationManager] Failed to build Omni context injection:', err);
      return '';
    }
  }
}

export const modelRotationManager = ModelRotationManager.getInstance();

