/**
 * Autonomous Provider & Model Catalog Verifier
 *
 * Keeps the app's stored expectations of offered AI models in sync with
 * reality. For every provider the user has connected (API key saved or
 * keyless tier enabled), it queries the provider's LIVE /models endpoint,
 * diffs the result against the baked expectations in verified-models.ts,
 * and corrects the provider & models database near instantaneously:
 *
 *  - removed: stored models the provider no longer offers
 *  - added:   new models the provider now offers (with live names/titles)
 *  - renamed: names/titles that changed
 *
 * Everything is REAL endpoint data. No fabricated entries are ever injected.
 */

import { app } from 'electron';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { credentialStore } from '../auth/credential-store';
import { ProviderGateway } from '../../providers/provider-gateway';
import {
  exportBakedExpectations,
  setModelCatalogCorrections,
  getModelCatalogCorrections,
  type VerifiedModelConfig,
  type ModelCatalogCorrection
} from '../verified-models';
import { fccCatalogSync } from '../fcc/catalog-sync';
import { getAllPreconfiguredProviders } from '../../config/provider-registry';

export interface CatalogVerificationResult {
  providerId: string;
  providerName: string;
  status: 'PASS' | 'FAIL' | 'NO_KEY';
  verifiedAt: number;
  liveCount: number;
  expectedCount: number;
  addedModels: Array<{ modelId: string; name: string }>;
  removedModelIds: string[];
  renamedModels: Array<{ modelId: string; expectedName: string; liveName: string }>;
  corrected: boolean;
  error?: string;
}

interface PersistedVerifications {
  version: 1;
  updatedAt: number;
  corrections: Record<string, ModelCatalogCorrection>;
  results: CatalogVerificationResult[];
}

const PERSIST_FILE = 'model-catalog-verifications.json';
const PERIODIC_INTERVAL_MS = 15 * 60 * 1000;

class ModelCatalogVerifier {
  private results: CatalogVerificationResult[] = [];
  private updatedAt = 0;
  private activated = false;
  private periodic: NodeJS.Timeout | null = null;
  private listeners: Set<(results: CatalogVerificationResult[]) => void> = new Set();
  private saveTimer: NodeJS.Timeout | null = null;

  /** Loads persisted corrections from disk and applies them immediately. */
  activate(): void {
    if (this.activated) return;
    this.activated = true;
    void (async () => {
      const persisted = await this.loadPersisted();
      if (persisted) {
        this.updatedAt = persisted.updatedAt || 0;
        this.results = persisted.results || [];
        if (persisted.corrections && Object.keys(persisted.corrections).length > 0) {
          setModelCatalogCorrections(persisted.corrections);
        }
      }
    })();
  }

  onVerified(listener: (results: CatalogVerificationResult[]) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): { updatedAt: number; results: CatalogVerificationResult[] } {
    return { updatedAt: this.updatedAt, results: [...this.results] };
  }

  /**
   * Verifies every candidate provider in parallel-batched sequence. The user's
   * decrypted API key (if any) is used; keyless tiers are probed anonymously.
   */
  async verifyAll(): Promise<CatalogVerificationResult[]> {
    this.activate();
    const candidates = this.collectCandidateProviders();
    const results: CatalogVerificationResult[] = [];
    const batchSize = 4;
    for (let i = 0; i < candidates.length; i += batchSize) {
      const batch = candidates.slice(i, i + batchSize);
      const batchResults = await Promise.all(batch.map((c) => this.verifyOne(c)));
      results.push(...batchResults);
    }
    this.applyAndPersist(results);
    return results;
  }

  /** Verifies a single provider (used for near-instant reactions to key changes). */
  async verifyProvider(providerId: string): Promise<CatalogVerificationResult | null> {
    this.activate();
    const candidate = this.collectCandidateProviders().find((c) => c.providerId === providerId);
    if (!candidate) return null;
    const result = await this.verifyOne(candidate);
    const merged = [...this.results.filter((r) => r.providerId !== providerId), result]
      .sort((a, b) => a.providerId.localeCompare(b.providerId));
    this.applyAndPersist(merged);
    return result;
  }

  private collectCandidateProviders(): Array<{ providerId: string; providerName: string; baseUrl: string; requiresKey: boolean }> {
    const seen = new Set<string>();
    const candidates: Array<{ providerId: string; providerName: string; baseUrl: string; requiresKey: boolean }> = [];

    // 1. Native preconfigured providers
    for (const p of getAllPreconfiguredProviders() || []) {
      if (!p?.id || !p.baseUrl || seen.has(p.id)) continue;
      if (p.id === 'ollama') continue; // Local Ollama is live-detected elsewhere
      seen.add(p.id);
      candidates.push({ providerId: p.id, providerName: p.name || p.id, baseUrl: p.baseUrl, requiresKey: p.setupType === 'api_key' });
    }

    // 2. FCC catalog enabled providers with a usable remote endpoint
    try {
      for (const p of fccCatalogSync.getCatalog() || []) {
        if (!p.enabled || !p.defaultEndpoint || seen.has(p.id)) continue;
        if (p.category === 'local' || p.defaultEndpoint.includes('localhost') || p.defaultEndpoint.includes('127.0.0.1')) continue;
        seen.add(p.id);
        candidates.push({
          providerId: p.id,
          providerName: p.name || p.id,
          baseUrl: p.defaultEndpoint.replace(/\/+$/, ''),
          requiresKey: p.authMethod === 'api_key'
        });
      }
    } catch {
      // FCC service unavailable: preconfigured list still gets verified
    }

    return candidates;
  }

  private async verifyOne(c: {
    providerId: string;
    providerName: string;
    baseUrl: string;
    requiresKey: boolean;
  }): Promise<CatalogVerificationResult> {
    const apiKey = credentialStore.getDecryptedKey(c.providerId) || undefined;
    if (c.requiresKey && !apiKey) {
      return {
        providerId: c.providerId,
        providerName: c.providerName,
        status: 'NO_KEY',
        verifiedAt: Date.now(),
        liveCount: 0,
        expectedCount: 0,
        addedModels: [],
        removedModelIds: [],
        renamedModels: [],
        corrected: false,
        error: 'No API key saved for this provider yet.'
      };
    }

    try {
      const expectations = exportBakedExpectations()[c.providerId] || [];
      const expectedIds = new Set(expectations.map((m) => m.modelId));

      let live: Array<{ id: string; name: string }>;
      const preconfigured = (getAllPreconfiguredProviders() || []).find((p) => p.id === c.providerId);
      if (preconfigured) {
        const discovered = await ProviderGateway.getAvailableModels(c.providerId, apiKey, c.baseUrl);
        live = discovered.map((m) => ({ id: m.id, name: m.name || m.id }));
      } else {
        live = await this.fetchOpenAiCompatibleModels(c.baseUrl, apiKey);
      }

      const liveById = new Map(live.map((m) => [m.id, m.name]));

      const addedModels = live
        .filter((m) => !expectedIds.has(m.id))
        .map((m) => ({ modelId: m.id, name: m.name || m.id }));
      const removedModelIds = [...expectedIds].filter((id) => !liveById.has(id));
      const renamedModels = live
        .filter((m) => expectedIds.has(m.id))
        .map((m) => {
          const expected = expectations.find((x) => x.modelId === m.id);
          return { modelId: m.id, expectedName: expected?.name || m.id, liveName: m.name };
        })
        .filter((r) => r.liveName && r.liveName !== r.expectedName);

      const corrected = addedModels.length > 0 || removedModelIds.length > 0 || renamedModels.length > 0;
      return {
        providerId: c.providerId,
        providerName: c.providerName,
        status: 'PASS',
        verifiedAt: Date.now(),
        liveCount: live.length,
        expectedCount: expectations.length,
        addedModels,
        removedModelIds,
        renamedModels,
        corrected
      };
    } catch (err: unknown) {
      return {
        providerId: c.providerId,
        providerName: c.providerName,
        status: 'FAIL',
        verifiedAt: Date.now(),
        liveCount: 0,
        expectedCount: 0,
        addedModels: [],
        removedModelIds: [],
        renamedModels: [],
        corrected: false,
        error: err instanceof Error ? err.message : String(err)
      };
    }
  }

  /** OpenAI-compatible /models listing for FCC providers without a preconfig entry. */
  private async fetchOpenAiCompatibleModels(baseUrl: string, apiKey?: string): Promise<Array<{ id: string; name: string }>> {
    const headers: Record<string, string> = { 'Accept': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10_000)
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Models request failed (${res.status}): ${text.slice(0, 150)}`);
    }
    const data = (await res.json()) as { data?: Array<any>; models?: Array<any> };
    const list = Array.isArray(data.data) ? data.data : Array.isArray(data.models) ? data.models : [];
    return list
      .map((m: any) => ({ id: String(m?.id || m?.name || ''), name: String(m?.name || m?.id || '') }))
      .filter((m) => m.id);
  }

  /** Converts PASS results into database corrections and rebuilds the models DB. */
  private buildCorrections(results: CatalogVerificationResult[]): Record<string, ModelCatalogCorrection> {
    const existing = getModelCatalogCorrections();
    const expectations = exportBakedExpectations();
    const chatUrlFor = (baseUrl: string): string => {
      const cleanBase = baseUrl.replace(/\/+$/, '');
      return cleanBase.endsWith('/chat/completions') ? cleanBase : `${cleanBase}/chat/completions`;
    };

    const next: Record<string, ModelCatalogCorrection> = { ...(existing || {}) };
    for (const r of results) {
      if (r.status !== 'PASS') continue;
      const expectationsForProvider = expectations[r.providerId] || [];
      const baseUrl = expectationsForProvider[0]?.url?.replace(/\/chat\/completions$/, '') || '';
      next[r.providerId] = {
        added: r.addedModels.map((m) => {
          return {
            modelId: m.modelId,
            name: m.name || m.modelId,
            url: chatUrlFor(baseUrl || expectationsForProvider[0]?.url || ''),
            requiresKey: expectationsForProvider[0]?.requiresKey ?? true
          } as VerifiedModelConfig;
        }).filter((a) => a.url),
        removed: r.removedModelIds,
        renamed: r.renamedModels.map((rn) => ({ modelId: rn.modelId, name: rn.liveName }))
      };
    }
    return next;
  }

  private applyAndPersist(newResults: CatalogVerificationResult[]): void {
    const corrections = this.buildCorrections(newResults);
    setModelCatalogCorrections(corrections);
    this.results = newResults;
    this.updatedAt = Date.now();
    for (const listener of this.listeners) listener(this.results);
    void this.persistSoon();
  }

  /** Debounced disk write: near-instant reactions do not thrash the disk. */
  private persistSoon(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.persistNow();
    }, 500);
  }

  private async persistNow(): Promise<void> {
    try {
      const dir = app.getPath('userData');
      await fsPromises.mkdir(dir, { recursive: true });
      const payload: PersistedVerifications = {
        version: 1,
        updatedAt: this.updatedAt,
        corrections: getModelCatalogCorrections(),
        results: this.results
      };
      await fsPromises.writeFile(path.join(dir, PERSIST_FILE), JSON.stringify(payload, null, 2), 'utf-8');
    } catch {
      // Non-fatal: corrections remain active in memory for the session
    }
  }

  private async loadPersisted(): Promise<PersistedVerifications | null> {
    try {
      const dir = app.getPath('userData');
      const raw = await fsPromises.readFile(path.join(dir, PERSIST_FILE), 'utf-8');
      const parsed = JSON.parse(raw) as PersistedVerifications;
      if (!parsed || parsed.version !== 1) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  /** Periodic background re-verification so drift heals without any user action. */
  ensurePeriodic(): void {
    this.activate();
    if (this.periodic) return;
    this.periodic = setInterval(() => {
      void this.verifyAll().catch(() => undefined);
    }, PERIODIC_INTERVAL_MS);
    if (typeof this.periodic.unref === 'function') this.periodic.unref();
  }
}

export const modelCatalogVerifier = new ModelCatalogVerifier();
