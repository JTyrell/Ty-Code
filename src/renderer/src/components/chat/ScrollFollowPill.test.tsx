// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React, { act } from 'react';
import ReactDOM from 'react-dom/client';
import { ScrollFollowPill, SUPPRESSION_MS } from './ScrollFollowPill';

interface HarnessOptions {
  shown?: boolean;
  onActivate?: () => void;
  onSuppressionEnd?: () => boolean;
}

describe('ScrollFollowPill', () => {
  let host: HTMLDivElement;
  let root: ReactDOM.Root;
  let scrollElement: HTMLDivElement;
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;
  let captures: WeakMap<Element, Set<number>>;

  const renderPill = async (options: HarnessOptions = {}) => {
    await act(async () => {
      root.render(
        <ScrollFollowPill
          shown={options.shown ?? true}
          getScrollElement={() => scrollElement}
          onActivate={options.onActivate ?? vi.fn()}
          onSuppressionEnd={options.onSuppressionEnd ?? (() => false)}
        />
      );
    });
    return host.querySelector('button') as HTMLButtonElement | null;
  };

  const dispatchPointer = async (
    target: Element,
    type: 'pointerdown' | 'pointerup' | 'pointercancel',
    pointerId = 7,
    isPrimary = true,
    button = 0
  ) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, {
      pointerId: { value: pointerId },
      isPrimary: { value: isPrimary },
      button: { value: button }
    });
    await act(async () => target.dispatchEvent(event));
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers();
    host = document.createElement('div');
    scrollElement = document.createElement('div');
    document.body.append(host, scrollElement);
    root = ReactDOM.createRoot(host);

    captures = new WeakMap();
    Object.defineProperties(HTMLElement.prototype, {
      setPointerCapture: {
        configurable: true,
        value: vi.fn(function (this: Element, pointerId: number) {
          const values = captures.get(this) ?? new Set<number>();
          values.add(pointerId);
          captures.set(this, values);
        })
      },
      hasPointerCapture: {
        configurable: true,
        value: vi.fn(function (this: Element, pointerId: number) {
          return captures.get(this)?.has(pointerId) ?? false;
        })
      },
      releasePointerCapture: {
        configurable: true,
        value: vi.fn(function (this: Element, pointerId: number) {
          captures.get(this)?.delete(pointerId);
        })
      }
    });

    animationFrames = new Map();
    nextFrameId = 1;
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      animationFrames.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => animationFrames.delete(id)));
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    scrollElement.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
    vi.restoreAllMocks();
  });

  it('captures only the primary pointer and activates from its captured pointer-up path once', async () => {
    const onActivate = vi.fn();
    const button = await renderPill({ onActivate });
    expect(button?.dataset.phase).toBe('shown');

    await dispatchPointer(button!, 'pointerdown', 4, false);
    expect(button?.dataset.phase).toBe('shown');

    await dispatchPointer(button!, 'pointerdown');
    expect(button?.dataset.phase).toBe('pressing');
    expect(button?.hasPointerCapture(7)).toBe(true);

    await dispatchPointer(button!, 'pointerup');
    expect(button?.hasPointerCapture(7)).toBe(false);
    expect(button?.dataset.phase).toBe('suppressing');
    expect(onActivate).toHaveBeenCalledTimes(1);

    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('releases a cancelled capture without activation and returns to shown', async () => {
    const onActivate = vi.fn();
    const button = await renderPill({ onActivate });
    await dispatchPointer(button!, 'pointerdown');
    await dispatchPointer(button!, 'pointercancel');

    expect(button?.hasPointerCapture(7)).toBe(false);
    expect(button?.dataset.phase).toBe('shown');
    expect(onActivate).not.toHaveBeenCalled();
  });

  it('uses native keyboard click activation without pointer-path double execution', async () => {
    const onActivate = vi.fn();
    const button = await renderPill({ onActivate });

    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(onActivate).toHaveBeenCalledTimes(1);
    expect(button?.dataset.phase).toBe('suppressing');

    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    expect(onActivate).toHaveBeenCalledTimes(1);
  });

  it('suppresses for exactly 700ms when scrollend does not arrive', async () => {
    const onSuppressionEnd = vi.fn(() => false);
    const button = await renderPill({ onSuppressionEnd });
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));

    await act(async () => vi.advanceTimersByTime(SUPPRESSION_MS - 1));
    expect(host.querySelector('button')?.getAttribute('data-phase')).toBe('suppressing');
    expect(onSuppressionEnd).not.toHaveBeenCalled();

    await act(async () => vi.advanceTimersByTime(1));
    expect(onSuppressionEnd).toHaveBeenCalledTimes(1);
    expect(host.querySelector('button')).toBeNull();
  });

  it('ends suppression on scrollend and cancels the 700ms fallback', async () => {
    const onSuppressionEnd = vi.fn(() => false);
    const button = await renderPill({ onSuppressionEnd });
    await act(async () => button?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    await act(async () => scrollElement.dispatchEvent(new Event('scrollend')));

    expect(onSuppressionEnd).toHaveBeenCalledTimes(1);
    expect(host.querySelector('button')).toBeNull();
    await act(async () => vi.advanceTimersByTime(SUPPRESSION_MS));
    expect(onSuppressionEnd).toHaveBeenCalledTimes(1);
  });

  it('cleans timers, scrollend listeners, animation frames, and pointer capture on unmount', async () => {
    const removeListener = vi.spyOn(scrollElement, 'removeEventListener');
    const button = await renderPill();
    await dispatchPointer(button!, 'pointerdown');
    expect(animationFrames.size).toBe(1);

    await act(async () => root.unmount());
    expect(button?.hasPointerCapture(7)).toBe(false);
    expect(animationFrames.size).toBe(0);

    root = ReactDOM.createRoot(host);
    const nextButton = await renderPill();
    await act(async () => nextButton?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 })));
    await act(async () => root.unmount());
    expect(removeListener).toHaveBeenCalledWith('scrollend', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    root = ReactDOM.createRoot(host);
  });

  it('reports development geometry drift on the next animation frame', async () => {
    const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const button = await renderPill();
    const stable = { left: 20, top: 40, width: 120, height: 28, right: 140, bottom: 68, x: 20, y: 40, toJSON: () => ({}) } as DOMRect;
    const shifted = { ...stable, left: 22, right: 142, x: 22 } as DOMRect;
    vi.spyOn(button!, 'getBoundingClientRect').mockReturnValueOnce(stable).mockReturnValue(shifted);

    await dispatchPointer(button!, 'pointerdown');
    const frame = [...animationFrames.values()][0];
    frame?.(performance.now());

    expect(report).toHaveBeenCalledWith(
      '[ScrollFollowPill] Geometry changed during a captured pointer press.'
    );
  });
});
