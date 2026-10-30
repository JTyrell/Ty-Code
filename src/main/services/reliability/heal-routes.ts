/**
 * Sticky-state healing (Route Truth, Prompt 1 Step 4).
 *
 * A sticky invalid_key entry is only "true" when the ORIGINAL classification
 * was auth-shaped (401/403 + auth body/code). This module re-probes every
 * sticky route and clears:
 *   - legacy entries whose original classification was protocol_error (raw
 *     401/403-poisonings from before the central classifier existed), and
 *   - entries whose probe succeeds now (key is actually fine, or was fixed
 *     server-side).
 *
 * Entries past the 24h TTL are auto-aged out by the store itself.
 * Never throws; returns a healing report the advisor card can act on.
 */

import { probeSavedKey } from '../credential-vault';
import { providerHealthStore } from '../../providers/provider-health-store';
import { reliabilityLedger } from './reliability-ledger';

export interface HealRoutesResult {
  healed: Array<{ providerId: string; modelId?: string }>;
  remaining: string[];
}

let healInFlight: Promise<HealRoutesResult> | null = null;

/**
 * Re-probe every sticky invalid_key route; clear the entries whose probe
 * succeeds, or whose original classification was protocol_error. Concurrent
 * calls share one run.
 */
export async function healRoutes(): Promise<HealRoutesResult> {
  if (healInFlight) return healInFlight;
  healInFlight = (async (): Promise<HealRoutesResult> => {
    const healed: Array<{ providerId: string; modelId?: string }> = [];
    const remaining: string[] = [];
    try {
      const roster = providerHealthStore.listInvalid();
      for (const entry of roster) {
        // Legacy false-sticky: the original classification was protocol_error
        // (pre-classifier behavior persisted those). Clear without probing.
        if (entry.failureClass === 'protocol_error') {
          providerHealthStore.clear(entry.providerId);
          reliabilityLedger.record({
            at: Date.now(),
            kind: 'probe',
            route: entry.providerId,
            outcome: 'ok',
            detail: 'cleared misclassified sticky entry (original classification was protocol_error)'
          });
          healed.push({ providerId: entry.providerId });
          continue;
        }
        const probe = await probeSavedKey(entry.providerId, 5000).catch(() => ({
          valid: false as const,
          status: undefined as number | undefined,
          message: 'probe error'
        }));
        if (probe.valid) {
          providerHealthStore.clear(entry.providerId);
          reliabilityLedger.record({
            at: Date.now(),
            kind: 'probe',
            route: entry.providerId,
            outcome: 'ok',
            detail: 'sticky route healed: re-probe succeeded'
          });
          healed.push({ providerId: entry.providerId });
        } else {
          remaining.push(entry.providerId);
          reliabilityLedger.record({
            at: Date.now(),
            kind: 'probe',
            route: entry.providerId,
            outcome: 'failed',
            detail: `sticky route still invalid on re-probe (${probe.message})`
          });
        }
      }
    } finally {
      healInFlight = null;
    }
    return { healed, remaining };
  })();
  return healInFlight;
}

/** Test-only reset. */
export function __resetRouteHealerForTest(): void {
  healInFlight = null;
}
