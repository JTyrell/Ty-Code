import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('Smart Sticky-Scroll Auto-Follow Logic', () => {
  let mockScrollContainer: {
    scrollHeight: number;
    scrollTop: number;
    clientHeight: number;
    scrollTo: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockScrollContainer = {
      scrollHeight: 1000,
      scrollTop: 700,
      clientHeight: 300,
      scrollTo: vi.fn((opts: { top: number; behavior?: ScrollBehavior }) => {
        mockScrollContainer.scrollTop = opts.top;
      })
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('calculates distanceFromBottom and pins when within 64px threshold', () => {
    // scrollHeight = 1000, clientHeight = 300
    // at bottom: scrollTop = 700 -> distanceFromBottom = 0 (< 64)
    const el = mockScrollContainer;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isPinned = distanceFromBottom < 64;

    expect(distanceFromBottom).toBe(0);
    expect(isPinned).toBe(true);
  });

  it('unpins and flags detached when user scrolls up beyond 64px', () => {
    // User scrolls up by 100px: scrollTop = 600
    mockScrollContainer.scrollTop = 600;
    const el = mockScrollContainer;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const isPinned = distanceFromBottom < 64;
    const isDetached = !isPinned;

    expect(distanceFromBottom).toBe(100);
    expect(isPinned).toBe(false);
    expect(isDetached).toBe(true);
  });

  it('flips detached state ONLY when boolean changes value, preventing per-pixel re-renders', () => {
    let stateUpdates = 0;
    let detachedState = false;
    let detachedRef = false;

    const onScrollTick = (distanceFromBottom: number) => {
      const isPinned = distanceFromBottom < 64;
      const isDetached = !isPinned;
      if (detachedRef !== isDetached) {
        detachedRef = isDetached;
        detachedState = isDetached;
        stateUpdates++;
      }
    };

    // User is at bottom (distance 0px) -> no change
    onScrollTick(0);
    expect(stateUpdates).toBe(0);
    expect(detachedState).toBe(false);

    // User scrolls to 20px from bottom -> still < 64px, no change
    onScrollTick(20);
    expect(stateUpdates).toBe(0);

    // User crosses threshold to 70px -> flips detached to true
    onScrollTick(70);
    expect(stateUpdates).toBe(1);
    expect(detachedState).toBe(true);

    // User continues scrolling up: 80px, 90px, 150px, 300px -> zero extra state updates!
    onScrollTick(80);
    onScrollTick(90);
    onScrollTick(150);
    onScrollTick(300);
    expect(stateUpdates).toBe(1); // Still exactly 1!

    // User scrolls back down to 40px (< 64px) -> flips detached to false
    onScrollTick(40);
    expect(stateUpdates).toBe(2);
    expect(detachedState).toBe(false);

    // User continues scrolling at 10px, 0px -> zero extra updates
    onScrollTick(10);
    onScrollTick(0);
    expect(stateUpdates).toBe(2);
  });

  it('auto-follow on buffer flush sets scrollTop = scrollHeight with behavior auto when pinned', () => {
    let pinnedToBottom = true;
    const el = mockScrollContainer;

    const performAutoFollow = () => {
      if (!pinnedToBottom) return;
      el.scrollTop = el.scrollHeight;
    };

    // New token chunk arrives and grows scrollHeight from 1000 to 1050
    el.scrollHeight = 1050;
    performAutoFollow();
    expect(el.scrollTop).toBe(1050);

    // Another chunk arrives, scrollHeight grows to 1100
    el.scrollHeight = 1100;
    performAutoFollow();
    expect(el.scrollTop).toBe(1100);
  });

  it('auto-follow freezes immediately when user is detached (scrolled up)', () => {
    let pinnedToBottom = false; // User scrolled up
    mockScrollContainer.scrollTop = 500;
    const el = mockScrollContainer;

    const performAutoFollow = () => {
      if (!pinnedToBottom) return;
      el.scrollTop = el.scrollHeight;
    };

    // Tokens stream in and content expands
    el.scrollHeight = 1200;
    performAutoFollow();

    // Scroll position MUST NOT change!
    expect(el.scrollTop).toBe(500);

    el.scrollHeight = 1500;
    performAutoFollow();
    expect(el.scrollTop).toBe(500);
  });

  it('ResizeObserver callback re-pins when content expands while pinned, but does nothing when detached', () => {
    let pinnedToBottom = true;
    const el = mockScrollContainer;

    const onResizeObserved = () => {
      if (!pinnedToBottom) return;
      el.scrollTop = el.scrollHeight;
    };

    // Syntax highlight or markdown parse on [DONE] increases content height
    el.scrollHeight = 1400;
    onResizeObserved();
    expect(el.scrollTop).toBe(1400);

    // If detached, syntax highlight finishing does not jump the user's view
    pinnedToBottom = false;
    el.scrollTop = 600;
    el.scrollHeight = 1600;
    onResizeObserved();
    expect(el.scrollTop).toBe(600);
  });

  it('explicit re-pin (user sends message or clicks pill) sets pinnedToBottom = true and smooth scrolls', () => {
    let pinnedToBottom = false;
    let detachedState = true;
    const el = mockScrollContainer;
    el.scrollTop = 400;
    el.scrollHeight = 1600;

    const explicitRePin = (smooth = true) => {
      pinnedToBottom = true;
      detachedState = false;
      if (smooth) {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      } else {
        el.scrollTop = el.scrollHeight;
      }
    };

    explicitRePin(true);
    expect(pinnedToBottom).toBe(true);
    expect(detachedState).toBe(false);
    expect(el.scrollTo).toHaveBeenCalledWith({ top: 1600, behavior: 'smooth' });
    expect(el.scrollTop).toBe(1600);
  });
});
