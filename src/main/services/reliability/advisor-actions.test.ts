/**
 * Advisor action dedupe contract (Prompt 2 Step 1).
 *
 * Every advisor action id maps to EXACTLY ONE owning surface and the catalog
 * mapping stays injective — the old card rendered "Open Settings" twice
 * (taxonomy switch + hardcoded secondary button); these tests pin:
 *   - unique action ids across the catalog
 *   - injective channel mapping (no two action ids share an IPC channel)
 *   - every mapped channel is a registered reliability handler
 *   - buildAdvisorActions emits ONE primary max + distinct secondaries
 */

import { describe, expect, it } from 'vitest';
import {
  ADVISOR_ACTION_CATALOG,
  AdvisorActionSchema,
  ReliabilityAdvisorPayloadSchema,
  buildAdvisorActions
} from '../../../shared/types/agent-events';

// Channels that src/main/index.ts actually registers for the reliability
// advisor surface (kept in lock-step with the ipcMain.handle block).
const REGISTERED_RELIABILITY_CHANNELS = [
  'reliability:get-health',
  'reliability:get-ledger-tail',
  'reliability:get-stats',
  'reliability:repair-fcc',
  'reliability:heal-routes',
  'reliability:retest-providers',
  'reliability:start-ollama'
];

describe('advisor action catalog integrity', () => {
  it('action ids are unique across the catalog', () => {
    const ids = Object.values(ADVISOR_ACTION_CATALOG).map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every action id maps to exactly one IPC channel or one renderer effect', () => {
    const channels = (Object.values(ADVISOR_ACTION_CATALOG)
      .map((a) => a.channel)
      .filter((c) => typeof c === 'string')) as string[];
    // Injective: no two catalog entries share a channel (one handler per action).
    expect(new Set(channels).size).toBe(channels.length);
    // Every mapped channel is actually registered in the main process.
    for (const channel of channels) {
      expect(REGISTERED_RELIABILITY_CHANNELS).toContain(channel);
    }
  });

  it('action entries are schema-shaped (AdvisorActionSchema)', () => {
    for (const action of Object.values(ADVISOR_ACTION_CATALOG)) {
      expect(AdvisorActionSchema.safeParse(action).success).toBe(true);
    }
  });
});

describe('buildAdvisorActions emits dedupe-ready lists', () => {
  it('keyed families get ONE Open Settings primary + a distinct heal secondary', () => {
    const actions = buildAdvisorActions('auth.invalid_key');
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length); // no duplicates on one card
    expect(ids.filter((id) => id === 'open_settings')).toHaveLength(1);
    expect(actions.find((a) => a.id === 'open_settings')?.primary).toBe(true);
    expect(actions.find((a) => a.id === 'open_settings')?.channel).toBeNull();
    expect(ids).toContain('heal_routes');
  });

  it('sidecar failures additionally expose the FCC sidecar repair', () => {
    const actions = buildAdvisorActions('network.sidecar_down');
    const ids = actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('heal_routes');
    expect(ids).toContain('repair_fcc_sidecar');
    expect(ids.filter((id) => id === 'repair_fcc_sidecar')).toHaveLength(1);
    // No keyed-family primary on a non-key taxonomy.
    expect(ids).not.toContain('open_settings');
  });

  it('generic outages expose only the route-healer secondary', () => {
    const actions = buildAdvisorActions('provider.unavailable');
    expect(actions.map((a) => a.id)).toEqual(['heal_routes']);
  });
});

describe('advisor payloads stay Zod-valid with new fields', () => {
  it('a card with headline/carryingRoute/actions parses', () => {
    const parsed = ReliabilityAdvisorPayloadSchema.safeParse({
      kind: 'card',
      rootCauseHash: 'abc123',
      taskId: 't1',
      taxonomyCode: 'auth.invalid_key',
      message: 'm',
      remedy: 'r',
      providerId: 'openrouter',
      modelId: 'gpt',
      stepsTaken: [{ step: 'provider_rotation', outcome: 'ok', target: 'ty-code-free::m', retrySucceeded: false }],
      headline: '1 silent recovery step attempted, none restored service (auth.invalid_key).',
      carryingRoute: 'Carrying chat: ty-code-free (gpt)',
      actions: buildAdvisorActions('auth.invalid_key'),
      ts: 1
    });
    expect(parsed.success).toBe(true);
  });

  it('a recovered payload parses', () => {
    const parsed = ReliabilityAdvisorPayloadSchema.safeParse({
      kind: 'recovered',
      rootCauseHash: 'abc123',
      providerId: 'openrouter',
      message: 'Recovered: openrouter is live again.',
      ts: 1
    });
    expect(parsed.success).toBe(true);
  });
});
