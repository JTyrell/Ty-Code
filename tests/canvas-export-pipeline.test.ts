import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasComponentNode } from '../src/main/services/canvas-sync-manager';
import type { CanvasTargetId } from '../src/shared/canvas-platform-registry';
import type { CanvasExportDialectRequest } from '../src/shared/types/canvas-export';

/**
 * Prompt 4 extension — export orchestrator pipeline tests (amendments 3 + 4).
 *
 * Drives the REAL `exportCanvasToDialect` against a stubbed provider seam (only
 * `ProviderGateway` + the design-prompt helper, both under `tests/` so the
 * src/main no-mock production guard is untouched) and asserts the exact path:
 *   agent-valid -> agent | agent-invalid -> ONE retry-with-failures -> skeleton
 *   gateway error/empty -> skeleton | abort mid-flight -> CanvasExportCancelled
 * No disk, no real network.
 */

const gateway = vi.hoisted(() => ({
  responders: [] as Array<(ctx: { messages: Array<Record<string, string>>; signal: AbortSignal; index: number }) => string | Promise<string>>,
  calls: [] as Array<{ messages: Array<Record<string, string>>; signal: AbortSignal }>,
  activeModel: { isAutoMode: false, providerId: 'openrouter', modelId: 'test/model' } as unknown
}));

vi.mock('../src/main/providers/provider-gateway', () => ({
  ProviderGateway: {
    getActiveModel: () => gateway.activeModel,
    sendChatRequest: (...args: unknown[]) => {
      const messages = args[2] as Array<Record<string, string>>;
      const signal = args[7] as AbortSignal;
      const index = gateway.calls.length;
      gateway.calls.push({ messages, signal });
      const responder = gateway.responders[Math.min(index, gateway.responders.length - 1)];
      return Promise.resolve().then(() => responder({ messages, signal, index }));
    }
  }
}));

vi.mock('../src/main/agent/canvas-agent-engine', () => ({
  buildCanvasProjectDesignPrompt: async () => ''
}));

const { exportCanvasToDialect, cancelCanvasExport, CanvasExportCancelled } = await import(
  '../src/main/agent/canvas-export/canvas-export-service'
);

const AST: CanvasComponentNode[] = [
  { id: 'c1', type: 'container', props: {}, children: [{ id: 'b1', type: 'button', props: { text: 'Go' } }] }
];

function makeRequest(targetId: CanvasTargetId, requestId = 'req-1'): CanvasExportDialectRequest {
  return { requestId, targetId, nodes: AST, componentName: 'Home', workspaceRoot: '/tmp/ws' } as unknown as CanvasExportDialectRequest;
}

const VALID_TSX = '```tsx\nexport default function Home() {\n  return (\n    <button>Go</button>\n  );\n}\n```';
const LEAKY_VUE = '```vue\n<div className="hero">Hi</div>\n```';

beforeEach(() => {
  gateway.responders = [];
  gateway.calls = [];
  gateway.activeModel = { isAutoMode: false, providerId: 'openrouter', modelId: 'test/model' };
});

describe('export pipeline', () => {
  it('accepts a valid agent response (single call, source=agent)', async () => {
    gateway.responders = [() => VALID_TSX];
    const result = await exportCanvasToDialect(makeRequest('react-web'));
    expect(result.source).toBe('agent');
    expect(result.code).toContain('export default function Home');
    expect(result.note).toBeUndefined();
    expect(gateway.calls).toHaveLength(1);
  });

  it('a TSX-leak triggers ONE retry-with-failures then the skeleton fallback', async () => {
    gateway.responders = [() => LEAKY_VUE, () => LEAKY_VUE];
    const result = await exportCanvasToDialect(makeRequest('vue'));
    expect(result.source).toBe('skeleton');
    expect(result.note).toBe('baseline dialect (offline)');
    // One base call + exactly one retry (never a third).
    expect(gateway.calls).toHaveLength(2);
    const retryMessages = gateway.calls[1].messages;
    expect(retryMessages.some((m) => /violated/i.test(m.content) && /Regenerate/i.test(m.content))).toBe(true);
  });

  it('a successful retry after the first invalid output is adopted (source=agent)', async () => {
    // First response omits the react-web markers -> invalid; the retry fixes it.
    const firstBad = '```tsx\nnot a component at all\n```';
    gateway.responders = [() => firstBad, () => VALID_TSX];
    const result = await exportCanvasToDialect(makeRequest('react-web'));
    expect(result.source).toBe('agent');
    expect(gateway.calls).toHaveLength(2);
  });

  it('a gateway error / empty route enters the ladder and returns the baseline dialect', async () => {
    gateway.responders = [
      () => {
        throw new Error('429 rate limited');
      }
    ];
    const result = await exportCanvasToDialect(makeRequest('flutter'));
    expect(result.source).toBe('skeleton');
    expect(result.dialectLabel).toContain('Flutter');
    expect(gateway.calls).toHaveLength(1);
  });

  it('aborting mid-flight rejects with CanvasExportCancelled and never writes the skeleton', async () => {
    gateway.responders = [
      ({ signal }) =>
        new Promise<string>((_resolve, reject) => {
          const onAbort = () => reject(new Error('aborted'));
          if (signal.aborted) return onAbort();
          signal.addEventListener('abort', onAbort, { once: true });
        })
    ];
    const requestId = 'abort-req';
    const pending = exportCanvasToDialect(makeRequest('swiftui', requestId));
    // The synchronous prologue has already registered the controller; cancel it now.
    cancelCanvasExport(requestId);
    await expect(pending).rejects.toBeInstanceOf(CanvasExportCancelled);
  });
});
