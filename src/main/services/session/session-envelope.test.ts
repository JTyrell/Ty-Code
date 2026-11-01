/**
 * Session envelope contract tests — pure, no Electron, no disk.
 *
 * These lock the on-disk shape every other session module depends on: the
 * versioned envelope, the plaintext sidecar (with the non-sensitive run metadata
 * the history browser and live agent listing read WITHOUT decrypting), and the
 * encrypted payload carrying both chat and agent runtime state.
 */

import { describe, expect, it } from 'vitest';
import {
  SESSION_ENVELOPE_VERSION,
  SessionEnvelopeSchema,
  SessionPayloadSchema,
  SessionSidecarSchema
} from '../../../shared/types/session-envelope';

describe('session envelope contract', () => {
  const sidecar = {
    sessionId: 'session_1',
    wsHash: 'abcdef0123456789',
    title: 'Fix the parser',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_005_000,
    messageCount: 3,
    lockRouteId: null
  };

  it('accepts a well-formed v1 envelope', () => {
    const envelope = { v: SESSION_ENVELOPE_VERSION, cipher: 'safeStorage', meta: sidecar, payload: 'Z2V0LXJlYWR5', chunks: { count: 0, dir: '' } };
    expect(SessionEnvelopeSchema.safeParse(envelope).success).toBe(true);
  });

  it('rejects an envelope missing the cipher tag', () => {
    expect(SessionEnvelopeSchema.safeParse({ v: 1, meta: sidecar, payload: 'x' }).success).toBe(false);
  });

  it('rejects a wrong envelope version (a reader must migrate, not misparse)', () => {
    expect(SessionEnvelopeSchema.safeParse({ v: 2, cipher: 'safeStorage', meta: sidecar, payload: 'x' }).success).toBe(false);
  });

  it('carries optional run metadata on the sidecar for decrypt-free listing', () => {
    const enriched = { ...sidecar, agentMode: 'plan', todoCount: 51, totalTokensUsed: 4200, contextLimit: 128_000 };
    const parsed = SessionSidecarSchema.safeParse(enriched);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.todoCount).toBe(51);
      expect(parsed.data.agentMode).toBe('plan');
    }
  });

  it('still parses a legacy sidecar that predates the new metadata fields', () => {
    const parsed = SessionSidecarSchema.safeParse(sidecar);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.todoCount).toBeUndefined();
  });

  it('persists agent runtime state inside the encrypted payload', () => {
    const payload = SessionPayloadSchema.parse({
      sessionId: 's',
      workspacePath: '/ws',
      title: 't',
      agentMode: 'execute',
      messages: [],
      todos: [{ id: 'a', content: 'x', status: 'pending' }],
      createdAt: 1,
      updatedAt: 2,
      agentIterationCount: 7,
      agentToolCalls: [{ tool: 'read_file', timestamp: 3 }],
      completionContract: { originalObjective: 'do a thing' },
      changeHistory: [{ timestamp: 4, filePath: 'src/a.ts' }]
    });
    expect(payload.agentIterationCount).toBe(7);
    expect(payload.agentToolCalls?.[0]?.tool).toBe('read_file');
    expect(payload.completionContract?.originalObjective).toBe('do a thing');
    expect(payload.changeHistory?.[0]?.filePath).toBe('src/a.ts');
  });

  it('applies payload defaults so a minimal record is valid', () => {
    const minimal = SessionPayloadSchema.parse({
      sessionId: 's',
      workspacePath: '/ws',
      title: 't',
      agentMode: 'build',
      messages: [],
      todos: [],
      createdAt: 1,
      updatedAt: 1
    });
    expect(minimal.routeTrail).toEqual([]);
    expect(minimal.checkpointRefs).toEqual([]);
    expect(minimal.contextLimit).toBe(128_000);
    expect(minimal.lockRouteId).toBeNull();
  });
});
