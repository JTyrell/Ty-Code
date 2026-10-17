/**
 * Mid-Turn Failover & Resume Engine (Phase FCC-4)
 *
 * Implements outage resilience and continuous turn resumption for free tiers:
 * 1. On mid-stream 429 / 5xx / timeout / network drop:
 *    - Snapshots conversation + partial text streamed so far.
 *    - Re-issues on the next healthy candidate across the graceful hierarchy:
 *      FCC catalog -> Native configured / subscription -> Anonymous tier
 *    - Provides continuation context so output seamlessly appends to current turn.
 * 2. Emits visible notice: 'provider throttled — continued with <model>'.
 * 3. Enforces strict limit: max 2 handoffs per turn, then raises real taxonomy error.
 * 4. Records per-segment ledger attribution in UsageLedger.
 * 5. Records handoff chain in diagnostic monitor / tracer.
 *
 * Brand: Ty-Code
 */

import type { ChatCompletionMessage } from '../providers/provider-gateway';
import type { ProviderCandidate } from '../services/orchestration/strategies/types';
import { usageLedger } from '../services/usage/ledger';
import { diagnosticsHealthMonitor } from '../services/diagnostics/health-monitor';
import { connectivityTracer } from '../services/diagnostics/connectivity-tracer';

export interface FailoverSegment {
  providerId: string;
  modelId: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  error?: string;
  timestamp: number;
}

export interface HandoffRecord {
  fromProvider: string;
  fromModel: string;
  toProvider: string;
  toModel: string;
  reason: string;
  partialTextLength: number;
  timestamp: number;
}

export interface TurnSnapshot {
  turnId: string;
  originalMessages: ChatCompletionMessage[];
  partialText: string;
  partialThought: string;
  handoffCount: number;
  maxHandoffs: number;
  handoffChain: HandoffRecord[];
  segments: FailoverSegment[];
  currentProviderId: string;
  currentModelId: string;
  turnStartTime: number;
  activeSegmentStartTime: number;
}

export class FailoverResumeManager {
  private static instance: FailoverResumeManager;

  private constructor() {}

  public static getInstance(): FailoverResumeManager {
    if (!FailoverResumeManager.instance) {
      FailoverResumeManager.instance = new FailoverResumeManager();
    }
    return FailoverResumeManager.instance;
  }

  /**
   * Initializes a snapshot at the beginning of an agent turn.
   */
  public createSnapshot(
    turnId: string,
    messages: ChatCompletionMessage[],
    initialProviderId: string,
    initialModelId: string
  ): TurnSnapshot {
    const now = Date.now();
    return {
      turnId,
      originalMessages: [...messages],
      partialText: '',
      partialThought: '',
      handoffCount: 0,
      maxHandoffs: 2,
      handoffChain: [],
      segments: [],
      currentProviderId: initialProviderId,
      currentModelId: initialModelId,
      turnStartTime: now,
      activeSegmentStartTime: now
    };
  }

  /**
   * Records streaming tokens into the active snapshot.
   */
  public recordTokens(snapshot: TurnSnapshot, deltaText?: string, deltaThought?: string): void {
    if (deltaText) {
      snapshot.partialText += deltaText;
    }
    if (deltaThought) {
      snapshot.partialThought += deltaThought;
    }
  }

  /**
   * Checks whether another mid-turn handoff is permissible.
   * Requirement: max 2 handoffs/turn then real taxonomy error.
   */
  public canHandoff(snapshot: TurnSnapshot): boolean {
    return snapshot.handoffCount < snapshot.maxHandoffs;
  }

  /**
   * Completes the current segment and records per-segment usage in the ledger.
   */
  public async finalizeSegment(
    snapshot: TurnSnapshot,
    error?: string
  ): Promise<FailoverSegment> {
    const now = Date.now();
    const latencyMs = Math.max(1, now - snapshot.activeSegmentStartTime);
    const completionTokens = Math.max(0, Math.round(snapshot.partialText.length / 3.8));
    const promptTokens = Math.max(1, Math.round(JSON.stringify(snapshot.originalMessages).length / 3.8));

    const segment: FailoverSegment = {
      providerId: snapshot.currentProviderId,
      modelId: snapshot.currentModelId,
      promptTokens,
      completionTokens,
      latencyMs,
      error,
      timestamp: now
    };

    snapshot.segments.push(segment);

    // Record per-segment attribution in UsageLedger
    try {
      await usageLedger.recordTransaction({
        providerId: snapshot.currentProviderId,
        modelId: snapshot.currentModelId,
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        latencyMs,
        success: !error,
        error
      });
    } catch {
      // Non-blocking
    }

    return segment;
  }

  /**
   * Prepares continuation messages and notice for the next healthy candidate.
   * Format: 'provider throttled — continued with <model>'
   */
  public prepareContinuation(
    snapshot: TurnSnapshot,
    nextCandidate: ProviderCandidate,
    reason: string,
    traceId?: string
  ): {
    continuationMessages: ChatCompletionMessage[];
    notice: string;
    handoffRecord: HandoffRecord;
  } {
    snapshot.handoffCount++;

    const fromProvider = snapshot.currentProviderId;
    const fromModel = snapshot.currentModelId;
    const toProvider = nextCandidate.provider.id;
    const toModel = nextCandidate.model.id;

    const handoffRecord: HandoffRecord = {
      fromProvider,
      fromModel,
      toProvider,
      toModel,
      reason,
      partialTextLength: snapshot.partialText.length,
      timestamp: Date.now()
    };
    snapshot.handoffChain.push(handoffRecord);

    // Update current active candidate in snapshot
    snapshot.currentProviderId = toProvider;
    snapshot.currentModelId = toModel;
    snapshot.activeSegmentStartTime = Date.now();

    // Model label for visible notice
    const modelLabel = toModel.split('/').pop() || toModel;
    const notice = `provider throttled — continued with ${modelLabel}`;

    // Record in diagnostics health monitor
    if (reason.includes('429') || reason.toLowerCase().includes('rate limit')) {
      diagnosticsHealthMonitor.recordRateLimit(fromProvider);
    } else {
      diagnosticsHealthMonitor.recordProviderDown(fromProvider);
    }

    // Record hop in connectivity tracer if traceId present
    if (traceId) {
      try {
        connectivityTracer.recordHop(traceId, 'H6', {
          status: 'PASS',
          metadata: {
            handoff: `${fromProvider} -> ${toProvider}`,
            fromModel,
            toModel,
            reason,
            partialLength: snapshot.partialText.length,
            turnHandoffCount: snapshot.handoffCount
          }
        });
      } catch {
        // Non-blocking
      }
    }

    // Build seamless continuation message history
    const continuationMessages: ChatCompletionMessage[] = [...snapshot.originalMessages];

    if (snapshot.partialText.trim().length > 0) {
      // Provide the partial output generated so far and prompt the continuation
      continuationMessages.push({
        role: 'assistant',
        content: snapshot.partialText
      });

      const tailSnippet = snapshot.partialText.slice(-150).trim();
      continuationMessages.push({
        role: 'user',
        content: `[System Continuation Request: The previous provider connection was throttled mid-stream. Please continue the response seamlessly from the following exact point without repeating or restarting: "...${tailSnippet}"]`
      });
    }

    return {
      continuationMessages,
      notice,
      handoffRecord
    };
  }

  /**
   * Formats the required visible notice: 'provider throttled — continued with <model>'
   */
  public formatFailoverNotice(modelId: string): string {
    const modelLabel = modelId.split('/').pop() || modelId;
    return `provider throttled — continued with ${modelLabel}`;
  }

  /**
   * Throws a structured taxonomy error when the max 2 handoffs have been exhausted.
   */
  public createExhaustedError(snapshot: TurnSnapshot, lastError: string): Error {
    const chainDescription = snapshot.handoffChain
      .map((h) => `${h.fromModel} -> ${h.toModel}`)
      .join(' -> ');

    const err = new Error(
      `[FAILOVER_EXHAUSTED] Mid-turn failover limit reached (2/2 handoffs). Chains: ${chainDescription || snapshot.currentModelId}. Last error: ${lastError}`
    );
    (err as any).taxonomyCode = 'RATE_LIMITED';
    (err as any).handoffChain = snapshot.handoffChain;
    return err;
  }
}

export const failoverResumeManager = FailoverResumeManager.getInstance();
