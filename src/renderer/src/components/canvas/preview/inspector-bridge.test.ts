// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  CanvasInspectorBridge,
  GuestMessageSchema,
  CANVAS_INSPECTOR_SOURCE
} from './inspector-bridge';

function hostEvent(data: unknown, origin: string): void {
  window.dispatchEvent(new MessageEvent('message', { data, origin }) as MessageEvent);
}

const validHover = {
  source: 'tycode-canvas-inspector',
  type: 'hover',
  payload: {
    type: 'hover',
    selector: '#app > main > section > button',
    tag: 'button',
    componentName: 'StartButton',
    styles: { color: '#333', 'background-color': '#fff' },
    bbox: { x: 12, y: 30, w: 90, h: 40 },
    innerText: 'Start',
    at: 1
  }
};

describe('canvas inspector bridge (Prompt 4)', () => {
  let bridge: CanvasInspectorBridge;

  beforeEach(() => {
    bridge = new CanvasInspectorBridge();
    bridge.attach('http://127.0.0.1:5173');
  });

  afterEach(() => {
    bridge.detach();
  });

  it('rejects messages from unexpected origins (zero telemetry / hard boundary)', () => {
    hostEvent(validHover, 'http://evil.example');
    expect(bridge.drain().hover).toBeNull();
  });

  it('accepts validated hover records only from the preview origin', () => {
    hostEvent(validHover, 'http://127.0.0.1:5173');
    const snap = bridge.drain();
    expect(snap.hover).not.toBeNull();
    expect(snap.hover?.selector).toBe('#app > main > section > button');
    expect(snap.hover?.componentName).toBe('StartButton');
    expect(bridge.drain().hover).toBeNull();
  });

  it('silently drops malformed guest payloads via Zod', () => {
    expect(GuestMessageSchema.safeParse({ type: 'hover', payload: { selector: '' } }).success).toBe(false);
    expect(GuestMessageSchema.safeParse({ type: 'boom' }).success).toBe(false);
    hostEvent({ type: 'boom', whatever: true }, 'http://127.0.0.1:5173');
    expect(bridge.isActive() ? bridge.drain().hover : null).toBeNull();
  });

  it('enforces the message shape ceiling for the DOM tree mirror', () => {
    const node = { selector: 'div', tag: 'div', children: [], preview: 'hi' };
    const parsed = GuestMessageSchema.safeParse({
      type: 'tree',
      payload: { nodes: Array.from({ length: 81 }, () => node) }
    });
    expect(parsed.success).toBe(false);
    const ok = GuestMessageSchema.safeParse({
      type: 'tree',
      payload: { nodes: Array.from({ length: 40 }, () => node) }
    });
    expect(ok.success).toBe(true);
  });

  it('pause() gates the drain stream even for validated messages', () => {
    bridge.pause();
    hostEvent(validHover, 'http://127.0.0.1:5173');
    expect(bridge.isPaused).toBe(true);
    bridge.resume();
    // Message was already buffered before pause — resume + new message drains.
    hostEvent(validHover, 'http://127.0.0.1:5173');
    expect(bridge.drain().hover).not.toBeNull();
  });

  it('select clears pending hover (click beats hover in the overlay)', () => {
    hostEvent(validHover, 'http://127.0.0.1:5173');
    hostEvent({ ...validHover, type: 'select', payload: { ...validHover.payload, type: 'select', selector: '#x' } }, 'http://127.0.0.1:5173');
    const snap = bridge.drain();
    expect(snap.hover).toBeNull();
    expect(snap.select?.selector).toBe('#x');
  });

  it('injection script is idempotent (double-run becomes a no-op)', () => {
    expect(CANVAS_INSPECTOR_SOURCE).toContain('__tycodeCanvasInspector');
    expect(CANVAS_INSPECTOR_SOURCE.split('__tycodeCanvasInspector = true').length).toBe(2);
  });

  it('host→guest command payloads carry the tycode-canvas-host channel marker', async () => {
    const frame = window;
    const seen: unknown[] = [];
    const listener = (e: MessageEvent): void => { seen.push(e.data); };
    window.addEventListener('message', listener);
    CanvasInspectorBridge.command(frame, 'pause');
    await new Promise((resolve) => setTimeout(resolve, 20));
    window.removeEventListener('message', listener);
    expect(seen[0]).toEqual({ channel: 'tycode-canvas-host', command: 'pause' });
  });
});
