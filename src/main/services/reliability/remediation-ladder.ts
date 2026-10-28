/**
 * Remediation Ladder (Autonomous Free-Tier Reliability, Prompt 1).
 *
 * The SINGLE orchestrator for the silent remediation sequence. Every step is
 * route-policy SILENT: the user sees nothing while any step recovers the
 * turn. Only after ALL steps fail does exactly ONE advisor card go out (once
 * per session per root-cause hash; non-modal, single, deduplicated).
 *
 * Ordered steps:
 *   1. community_key_refresh : invalidated Community Key re-bootstrap; retry
 *      ty-code-free once.
 *   2. sidecar_heal          : FCC sidecar health-check + start once; retry
 *      through the FCC free fleet.
 *   3. provider_rotation     : health-aware fallback-chain walk (keyless ->
 *      free -> keyed-with-own-key), skipping cooling/dead providers.
 *   4. cooldown_wait         : honor registered cooldowns, wait up to 20s,
 *      then a single silent retry of the original route.
 *   5. advisor               : ONE card with the step trail + one-click
 *      actions.
 *
 * Gateway wiring (provider-gateway.ts):
 *   - acquireCooldownRetry()  : at the pre-stream 429 branch (same-route
 *     silent retry before burning a handoff hop).
 *   - onChainExhausted()      : at both exhaustion sites (pre-stream and
 *     mid-stream) before the "All providers failed" throw.
 *
 * Every step is appended to the reliability ledger (local-only JSONL).
 */

import { createHash } from 'node:crypto';
import type { VerifiedModelConfig } from '../verified-models';
import { fccSidecarManager } from '../fcc-sidecar-manager';
import { invalidateCommunityKey, fetchCommunityKey } from '../credential-vault';
import { providerHealthStore } from '../../providers/provider-health-store';
import { modelRotationManager } from '../model-rotation-manager';
import { quotaTracker } from '../orchestration/quota-tracker';
import { pickHandoffCandidate, providerHasOwnKey } from '../../providers/provider-gateway';
import { reliabilitySentinel } from './reliability-sentinel';
import { reliabilityLedger, type ReliabilityLedgerOutcome } from './reliability-ledger';
import { broadcastReliability } from './bus';
import type { ReliabilityAdvisorPayload, ReliabilityLadderStep } from '../../../shared/types/agent-events';

const TY_CODE_FREE_PROVIDER_ID = 'ty-code-free';
const TY_CODE_FREE_MODEL_ID = 'google/gemma-4-31b-it:free'; // mirrors provider-gateway consts (not exported)
const MAX_COOLDOWN_WAIT_MS = 20_000;
const COOLDOWN_GRACE_MS = 10_000;
const MAX_TRACKED_TASKS = 100;
const MAX_SESSION_HASHES = 50;

export type LadderStepId = 'community_key_refresh' | 'sidecar_heal' | 'provider_rotation' | 'cooldown_wait';

export interface CooldownRetryRequest {
  taskId: string;
  providerId: string;
  modelId: string;
  retryAfterSec?: number;
}

export interface ChainExhaustedContext {
  taskId: string;
  failureProviderId: string;
  failureModelId: string;
  httpStatus: number | null;
  errorMessage?: string | null;
  tokensStreamed: number;
  allModels: VerifiedModelConfig[];
}

export interface RecoveryAttempt {
  providerId: string;
  modelId: string;
  step?: LadderStepId | 'recovery';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function routeKey(providerId: string, modelId: string): string {
  return `${(providerId || '').toLowerCase()}::${modelId || ''}`;
}

function isTyCodeFree(providerId: string): boolean {
  const p = (providerId || '').toLowerCase();
  return p === 'ty-code-free' || p === 'tycode-free';
}

function isFccProvider(providerId: string): boolean {
  const p = (providerId || '').toLowerCase();
  return p === 'fcc' || p === 'fcc-proxy' || p === 'anthropic-claude';
}

class RemediationLadder {
  private cooldownRetriedRoutes = new Set<string>();
  private stepsByTask = new Map<string, Map<LadderStepId, ReliabilityLadderStep>>();
  private lastAdvisorHashByProvider = new Map<string, { hash: string; ts: number }>();
  private advisorEmittedHashes: string[] = [];

  // ---------- Gateway hook: pre-stream 429 ----------

  /**
   * True when the caller should retry the SAME route after honoring the
   * cooldown at most once per (task, route). Waits min(Retry-After or
   * registered cooldown, max 20s); never throws.
   */
  public async acquireCooldownRetry(req: CooldownRetryRequest): Promise<boolean> {
    const key = `${req.taskId}::${routeKey(req.providerId, req.modelId)}`;
    this.trimTracked(this.cooldownRetriedRoutes);
    if (this.cooldownRetriedRoutes.has(key)) return false;
    this.cooldownRetriedRoutes.add(key);

    const headerMs = (req.retryAfterSec && req.retryAfterSec > 0 ? req.retryAfterSec * 1000 : 0);
    const sentinelMs = reliabilitySentinel.getCooldownRemainingSec(req.providerId, req.modelId) * 1000;
    const requested = Math.max(headerMs, sentinelMs);
    const waitMs = Math.max(COOLDOWN_GRACE_MS, Math.min(requested || COOLDOWN_GRACE_MS, MAX_COOLDOWN_WAIT_MS));

    reliabilityLedger.record({
      at: Date.now(),
      kind: 'cooldown',
      turnId: req.taskId,
      route: routeKey(req.providerId, req.modelId),
      outcome: 'started',
      detail: `waiting ${waitMs}ms before a silent same-route retry (429)`
    });
    await sleep(waitMs);
    reliabilityLedger.record({
      at: Date.now(),
      kind: 'cooldown',
      turnId: req.taskId,
      route: routeKey(req.providerId, req.modelId),
      outcome: 'ok',
      detail: `waited ${waitMs}ms`
    });
    return true;
  }

  // ---------- Gateway hook: chain exhaustion ----------

  /**
   * Runs the remaining untried silent steps for this task. Returns one final
   * recovery attempt, or null after emitting the single advisor card.
   */
  public async onChainExhausted(ctx: ChainExhaustedContext): Promise<RecoveryAttempt | null> {
    let recovery: RecoveryAttempt | null = null;

    if (!this.stepDone(ctx.taskId, 'community_key_refresh') && this.mayRefreshCommunityKey(ctx)) {
      this.markStepDone(ctx.taskId, 'community_key_refresh');
      recovery = await this.tryCommunityKeyRefresh(ctx) ?? recovery;
    }

    if (!recovery && !this.stepDone(ctx.taskId, 'sidecar_heal') && this.mayHealSidecar(ctx)) {
      this.markStepDone(ctx.taskId, 'sidecar_heal');
      recovery = await this.trySidecarHeal(ctx) ?? recovery;
    }

    if (!recovery && !this.stepDone(ctx.taskId, 'provider_rotation')) {
      this.markStepDone(ctx.taskId, 'provider_rotation');
      recovery = await this.tryProviderRotation(ctx) ?? recovery;
    }

    if (!recovery && !this.stepDone(ctx.taskId, 'cooldown_wait')) {
      this.markStepDone(ctx.taskId, 'cooldown_wait');
      recovery = await this.tryCooldownWait(ctx) ?? recovery;
    }

    if (!recovery) {
      this.emitAdvisorCard(ctx);
      return null;
    }

    return {
      providerId: recovery.providerId,
      modelId: recovery.modelId,
      step: 'recovery'
    };
  }

  // ---------- Step implementations ----------

  private mayRefreshCommunityKey(ctx: ChainExhaustedContext): boolean {
    const norm = (ctx.failureProviderId || '').toLowerCase().replace(/-free$/, '');
    if (isTyCodeFree(ctx.failureProviderId) || norm === 'openrouter') return true;
    // A failed community-key fetch can strand the whole free pool; refresh
    // opportunistically whenever the failure looks auth-shaped.
    return ctx.httpStatus === 401 || ctx.httpStatus === 403;
  }

  private async tryCommunityKeyRefresh(ctx: ChainExhaustedContext): Promise<RecoveryAttempt | null> {
    this.recordStep(ctx.taskId, 'community_key_refresh', 'started', 'invalidating cached community key', routeKey(ctx.failureProviderId, ctx.failureModelId));
    try {
      invalidateCommunityKey();
      const key = await fetchCommunityKey(true);
      if (key && key.trim()) {
        this.recordStep(ctx.taskId, 'community_key_refresh', 'ok', 'fresh community key bootstrapped', routeKey(ctx.failureProviderId, ctx.failureModelId));
        if (isTyCodeFree(ctx.failureProviderId)) {
          return { providerId: TY_CODE_FREE_PROVIDER_ID, modelId: TY_CODE_FREE_MODEL_ID };
        }
        return null;
      }
      this.recordStep(ctx.taskId, 'community_key_refresh', 'failed', 'remote fetch returned no key', routeKey(ctx.failureProviderId, ctx.failureModelId));
      return null;
    } catch (err) {
      this.recordStep(ctx.taskId, 'community_key_refresh', 'failed', err instanceof Error ? err.message : String(err), routeKey(ctx.failureProviderId, ctx.failureModelId));
      return null;
    }
  }

  private mayHealSidecar(ctx: ChainExhaustedContext): boolean {
    if (isFccProvider(ctx.failureProviderId)) return true;
    const msg = (ctx.errorMessage || '').toLowerCase();
    if (ctx.httpStatus === null && (msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout'))) return true;
    return false;
  }

  private async trySidecarHeal(ctx: ChainExhaustedContext): Promise<RecoveryAttempt | null> {
    this.recordStep(ctx.taskId, 'sidecar_heal', 'started', 'health-checking FCC sidecar', routeKey(ctx.failureProviderId, ctx.failureModelId));
    try {
      const health = await fccSidecarManager.checkHealth();
      const needsHeal = !fccSidecarManager.isActive() || !health;
      if (!needsHeal) {
        this.recordStep(ctx.taskId, 'sidecar_heal', 'skipped', 'sidecar healthy; failure was upstream', routeKey(ctx.failureProviderId, ctx.failureModelId));
        return null;
      }
      const started = await fccSidecarManager.start();
      if (!started) {
        this.recordStep(ctx.taskId, 'sidecar_heal', 'failed', 'sidecar restart failed', routeKey(ctx.failureProviderId, ctx.failureModelId));
        return null;
      }
      this.recordStep(ctx.taskId, 'sidecar_heal', 'ok', 'sidecar restarted', routeKey(ctx.failureProviderId, ctx.failureModelId));
      const fccModel = ctx.allModels.find(
        (m) => isFccProvider(m.providerId) && !providerHealthStore.isDead(m.providerId)
      );
      if (fccModel) return { providerId: fccModel.providerId, modelId: fccModel.modelId };
      this.recordStep(ctx.taskId, 'sidecar_heal', 'skipped', 'healed but no FCC route in catalog', routeKey(ctx.failureProviderId, ctx.failureModelId));
      return null;
    } catch (err) {
      this.recordStep(ctx.taskId, 'sidecar_heal', 'failed', err instanceof Error ? err.message : String(err), routeKey(ctx.failureProviderId, ctx.failureModelId));
      return null;
    }
  }

  private async tryProviderRotation(ctx: ChainExhaustedContext): Promise<RecoveryAttempt | null> {
    this.recordStep(ctx.taskId, 'provider_rotation', 'started', 'walking the fallback chain', routeKey(ctx.failureProviderId, ctx.failureModelId));
    try {
      const dead = providerHealthStore.deadProviderSet();
      const chain = modelRotationManager.getFallbackChain();
      for (const provider of chain) {
        if (provider === ctx.failureProviderId) continue;
        if (providerHealthStore.isDead(provider) || dead.has(provider)) continue;
        if (reliabilitySentinel.isProviderPoor(provider)) continue;
        const quota = quotaTracker.getProviderQuota(provider);
        if (quota && quota.percentUsed >= 98) continue;
        const model = this.firstViableModel(ctx.allModels, provider);
        if (model) {
          this.recordStep(ctx.taskId, 'provider_rotation', 'ok', `rotated to ${model.providerId}`, routeKey(model.providerId, model.modelId));
          return { providerId: model.providerId, modelId: model.modelId };
        }
      }
      // Last sweep: any eligible model outside the static chain
      // (same-model-alternate or keyless pool) via the FCC-managed selector.
      const alt = pickHandoffCandidate(ctx.allModels, ctx.failureProviderId, ctx.failureModelId);
      if (alt) {
        this.recordStep(ctx.taskId, 'provider_rotation', 'ok', `rotated to ${alt.providerId}`, routeKey(alt.providerId, alt.modelId));
        return { providerId: alt.providerId, modelId: alt.modelId };
      }
      this.recordStep(ctx.taskId, 'provider_rotation', 'failed', 'no eligible rotation target (pool exhausted)', routeKey(ctx.failureProviderId, ctx.failureModelId));
      return null;
    } catch (err) {
      this.recordStep(ctx.taskId, 'provider_rotation', 'failed', err instanceof Error ? err.message : String(err), routeKey(ctx.failureProviderId, ctx.failureModelId));
      return null;
    }
  }

  private firstViableModel(allModels: VerifiedModelConfig[], providerId: string): VerifiedModelConfig | undefined {
    const norm = providerId.toLowerCase();
    const matches = allModels.filter((m) => (m.providerId || '').toLowerCase() === norm);
    return matches
      .sort((a, b) => Number(Boolean(a.requiresKey)) - Number(Boolean(b.requiresKey)))
      .find((m) => !m.requiresKey || providerHasOwnKey(m.providerId));
  }

  private async tryCooldownWait(ctx: ChainExhaustedContext): Promise<RecoveryAttempt | null> {
    const sentinelSec = reliabilitySentinel.getCooldownRemainingSec(ctx.failureProviderId, ctx.failureModelId);
    const waitMs = Math.min(sentinelSec > 0 ? sentinelSec * 1000 : COOLDOWN_GRACE_MS, MAX_COOLDOWN_WAIT_MS);
    this.recordStep(ctx.taskId, 'cooldown_wait', 'started', `cooling ${Math.round(waitMs / 1000)}s before one silent retry`, routeKey(ctx.failureProviderId, ctx.failureModelId));
    await sleep(waitMs);
    this.recordStep(ctx.taskId, 'cooldown_wait', 'ok', `waited ${waitMs}ms`, routeKey(ctx.failureProviderId, ctx.failureModelId));
    return { providerId: ctx.failureProviderId, modelId: ctx.failureModelId };
  }

  // ---------- Advisor ----------

  private emitAdvisorCard(ctx: ChainExhaustedContext): void {
    const steps = this.stepsByTask.get(ctx.taskId);
    const stepsTaken: ReliabilityLadderStep[] = steps ? Array.from(steps.values()) : [];
    const taxonomyCode =
      ctx.httpStatus === 401 || ctx.httpStatus === 403
        ? 'auth.invalid_key'
        : ctx.httpStatus === 429
        ? 'pool.exhausted'
        : ctx.httpStatus === null
        ? 'network.sidecar_down'
        : 'provider.unavailable';
    const hash = createHash('sha256')
      .update(`${taxonomyCode}::${(ctx.failureProviderId || '').toLowerCase()}::${ctx.failureModelId || ''}`)
      .digest('hex')
      .slice(0, 12);
    this.trimHashes();
    if (this.advisorEmittedHashes.includes(hash)) {
      reliabilityLedger.record({ at: Date.now(), kind: 'advisor', turnId: ctx.taskId, route: routeKey(ctx.failureProviderId, ctx.failureModelId), outcome: 'skipped', detail: `advisor already shown this session (${hash})` });
      return;
    }
    this.advisorEmittedHashes.push(hash);
    const keyedProviders = ['openrouter', 'google-ai-studio', 'gemini', 'anthropic', 'claude', 'openai', 'deepseek'];
    const norm = (ctx.failureProviderId || '').toLowerCase().replace(/-free$/, '');
    const isKeyedFamily = keyedProviders.includes(norm);
    const card: Extract<ReliabilityAdvisorPayload, { kind: 'card' }> = {
      kind: 'card',
      rootCauseHash: hash,
      taskId: ctx.taskId,
      taxonomyCode,
      message:
        ctx.httpStatus === 429
          ? `All free routes are momentarily rate limited (last: ${ctx.failureProviderId}).`
          : ctx.httpStatus === 401 || ctx.httpStatus === 403
          ? `The saved key for ${ctx.failureProviderId} was rejected and every silent recovery step failed.`
          : ctx.httpStatus === null
          ? 'The FCC sidecar and all free routes are unreachable right now.'
          : `${ctx.failureProviderId} failed (HTTP ${ctx.httpStatus}) and every silent recovery step failed.`,
      remedy: isKeyedFamily
        ? 'Re-save the API key in Settings, or keep chatting on Ty-Code Free once a route recovers.'
        : 'Wait a moment — recovery is automatic. You can re-test providers or start a local model as a backstop.',
      actionLabel: isKeyedFamily ? 'Open Settings' : undefined,
      actionUrl: isKeyedFamily ? 'ty-code://settings/api-keys' : undefined,
      suggestedFallback: 'ty-code-free',
      providerId: ctx.failureProviderId,
      modelId: ctx.failureModelId,
      stepsTaken,
      ts: Date.now()
    };
    this.lastAdvisorHashByProvider.set((ctx.failureProviderId || '').toLowerCase(), { hash, ts: card.ts });
    broadcastReliability('reliability:advisor', card);
    reliabilityLedger.record({ at: Date.now(), kind: 'advisor', turnId: ctx.taskId, route: routeKey(ctx.failureProviderId, ctx.failureModelId), outcome: 'started', detail: `card ${hash} (${taxonomyCode})` });
  }

  /** Sentinel hook: a degraded/cooling route returned to 'ok'. */
  public onRouteRecovered(providerId: string, modelId: string): void {
    void modelId;
    const norm = (providerId || '').toLowerCase().replace(/-free$/, '');
    const entry =
      this.lastAdvisorHashByProvider.get((providerId || '').toLowerCase()) ||
      this.lastAdvisorHashByProvider.get(norm);
    if (!entry) return;
    const payload: Extract<ReliabilityAdvisorPayload, { kind: 'recovered' }> = {
      kind: 'recovered',
      rootCauseHash: entry.hash,
      providerId,
      message: `Recovered: ${providerId} is live again.`,
      ts: Date.now()
    };
    broadcastReliability('reliability:advisor', payload);
  }

  // ---------- Bookkeeping ----------

  private stepDone(taskId: string, step: LadderStepId): boolean {
    return this.stepsByTask.get(taskId)?.has(step) ?? false;
  }

  private markStepDone(taskId: string, step: LadderStepId): void {
    this.trimTrackedTasks(taskId);
    let steps = this.stepsByTask.get(taskId);
    if (!steps) {
      steps = new Map();
      this.stepsByTask.set(taskId, steps);
    }
    if (!steps.has(step)) steps.set(step, { step, outcome: 'started' });
  }

  private recordStep(taskId: string, step: LadderStepId, outcome: ReliabilityLedgerOutcome, detail: string, route?: string): void {
    reliabilityLedger.record({ at: Date.now(), kind: 'ladder_step', turnId: taskId, route, step, outcome, detail });
    const steps = this.stepsByTask.get(taskId);
    if (steps) {
      const prev = steps.get(step);
      const merged: ReliabilityLadderStep = { step, outcome: prev?.outcome && outcome === 'started' ? prev.outcome : outcome, detail: detail || prev?.detail };
      steps.set(step, merged);
    }
  }

  private trimTrackedTasks(taskId: string): void {
    if (this.stepsByTask.size >= MAX_TRACKED_TASKS && !this.stepsByTask.has(taskId)) {
      const oldest = this.stepsByTask.keys().next().value;
      if (oldest) this.stepsByTask.delete(oldest);
    }
  }

  private trimTracked(set: Set<string>): void {
    if (set.size >= MAX_TRACKED_TASKS) {
      const oldest = set.values().next().value;
      if (oldest) set.delete(oldest);
    }
  }

  private trimHashes(): void {
    if (this.advisorEmittedHashes.length >= MAX_SESSION_HASHES) {
      this.advisorEmittedHashes = this.advisorEmittedHashes.slice(-(MAX_SESSION_HASHES - 1));
    }
  }

  // ---------- Test hooks ----------

  public __resetForTest(): void {
    this.cooldownRetriedRoutes.clear();
    this.stepsByTask.clear();
    this.lastAdvisorHashByProvider.clear();
    this.advisorEmittedHashes = [];
  }
}

export const reliabilityLadder = new RemediationLadder();
