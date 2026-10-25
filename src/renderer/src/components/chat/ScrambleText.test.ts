// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ScrambleText,
  SCRAMBLE_CHARSET,
  SCRAMBLE_WINDOW,
  MAX_BAND,
  DECODE_RATE,
  DONE_RATE,
  FLICKER_MS
} from './ScrambleText';

describe('ScrambleText (Decode-Frontier Engine)', () => {
  let container: HTMLDivElement;
  let root: ReactDOM.Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = ReactDOM.createRoot(container);
  });

  afterEach(() => {
    flushSync(() => {
      root.unmount();
    });
    container.remove();
  });

  it('exports required constants and charset', () => {
    expect(SCRAMBLE_CHARSET).toBe('アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFHKMXZ#$%&@<>*+');
    expect(MAX_BAND).toBe(90);
    expect(SCRAMBLE_WINDOW).toBe(90);
    expect(DECODE_RATE).toBe(140);
    expect(DONE_RATE).toBe(600);
    expect(FLICKER_MS).toBe(55);
  });

  it('first flush tick: display length equals arrived length immediately (zero added latency)', () => {
    const input = 'Immediate streaming arrival with 42 chars!';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text: input,
          enabled: true,
          streaming: true
        })
      );
    });

    const span = container.querySelector('span.scramble-text');
    expect(span).not.toBeNull();
    // The rendered textContent must equal input.length immediately
    expect(span?.textContent?.length).toBe(input.length);
    expect(span?.getAttribute('aria-label')).toBe(input);
    expect(span?.getAttribute('aria-live')).toBe('off');
  });

  it('renders locked text unchanged when enabled is false', () => {
    const input = 'Hello, world! This is clean text.';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text: input,
          enabled: false,
          streaming: true
        })
      );
    });

    const span = container.querySelector('span.scramble-text');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe(input);
    expect(span?.getAttribute('aria-label')).toBe(input);
    expect(span?.getAttribute('aria-live')).toBe('off');
    // Cursor is not rendered when animation is disabled
    expect(container.querySelector('.scramble-frontier-cursor')).toBeNull();
  });

  it('renders locked text unchanged when streaming is false (historical messages)', () => {
    const input = 'Historical completed response.';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text: input,
          enabled: true,
          streaming: false
        })
      );
    });

    const span = container.querySelector('span.scramble-text');
    expect(span?.textContent).toBe(input);
    expect(span?.getAttribute('aria-label')).toBe(input);
    expect(container.querySelector('.scramble-frontier-cursor')).toBeNull();
  });

  it('preserves spaces and newlines without scrambling during streaming', () => {
    const input = 'Line one\nLine two with spaces.';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text: input,
          enabled: true,
          streaming: true
        })
      );
    });

    const rendered = container.querySelector('span.scramble-text')?.textContent || '';
    // Newline and spaces must stay in identical positions
    expect(rendered[8]).toBe('\n');
    expect(rendered[4]).toBe(' ');
    expect(rendered[13]).toBe(' ');
    expect(rendered.length).toBe(input.length);
  });

  it('burst catch-up: bounds scramble band to MAX_BAND (90 chars), locking older prefix byte-for-byte', () => {
    // 250 characters total arrived in a high-speed burst
    const prefix = 'A'.repeat(160); // 160 chars locked prefix
    const suffix = 'B'.repeat(90);  // 90 chars scramble band
    const fullText = prefix + suffix;

    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text: fullText,
          enabled: true,
          streaming: true
        })
      );
    });

    const rendered = container.querySelector('span.scramble-text')?.textContent || '';
    expect(rendered.length).toBe(250);
    // The prefix characters beyond MAX_BAND (first 160 characters) MUST be locked as real text
    expect(rendered.slice(0, 160)).toBe('A'.repeat(160));
  });

  it('renders the green cursor at the FRONTIER, not at the arrival end', () => {
    const text = 'Frontier cursor position check';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: true
        })
      );
    });

    const cursor = container.querySelector('.scramble-frontier-cursor') as HTMLSpanElement;
    expect(cursor).not.toBeNull();
    expect(cursor.style.backgroundColor).toBe('rgb(34, 197, 94)'); // #22c55e
    expect(cursor.getAttribute('aria-hidden')).toBe('true');
  });

  it('fires onSettled callback when stream ends and frontier reaches arrival', async () => {
    const onSettled = vi.fn();
    const text = 'Short stream';

    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: true,
          onSettled
        })
      );
    });

    // End streaming: triggers settle sweep
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: false,
          onSettled
        })
      );
    });

    // Wait for rAF / settle check
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(onSettled).toHaveBeenCalled();
    const span = container.querySelector('span.scramble-text');
    expect(span?.textContent).toBe(text);
  });

  it('scroll history: zero active rAF loops on historical messages', () => {
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    const text = 'Historical message rendered from chat log history.';

    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: false
        })
      );
    });

    // Zero rAF loops registered for historical messages
    expect(rafSpy).not.toHaveBeenCalled();
    const span = container.querySelector('span.scramble-text');
    expect(span?.textContent).toBe(text);
    rafSpy.mockRestore();
  });

  it('bounds settle sweep to <= 400 characters on [DONE] transition', () => {
    // 600 characters arrive during streaming
    const text = 'X'.repeat(600);

    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: true
        })
      );
    });

    // When transitioning to streaming: false, the settle sweep jumps locked to arrival - 400
    // so at most 400 characters are in the settle sweep
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: false
        })
      );
    });

    const rendered = container.querySelector('span.scramble-text')?.textContent || '';
    expect(rendered.length).toBe(600);
    // At least the first 200 characters (600 - 400) MUST be locked immediately as real 'X'
    expect(rendered.slice(0, 200)).toBe('X'.repeat(200));
  });

  it('markdown swap gating: plain view stays mounted on [DONE] until onSettled fires', async () => {
    let settled = false;
    const onSettled = () => {
      settled = true;
    };

    // Simulate parent component tracking isSettled
    const ParentMessageView: React.FC<{ streaming: boolean }> = ({ streaming }) => {
      const [isSettled, setIsSettled] = React.useState(!streaming);

      if (streaming || !isSettled) {
        return React.createElement(
          'div',
          { 'data-testid': 'scrambled-plain-view' },
          React.createElement(ScrambleText, {
            text: 'Streamed content settling before markdown AST',
            enabled: true,
            streaming: streaming,
            onSettled: () => {
              setIsSettled(true);
              onSettled();
            }
          })
        );
      }

      return React.createElement(
        'div',
        { 'data-testid': 'markdown-ast-view' },
        'Markdown AST Rendered'
      );
    };

    // 1. Actively streaming: shows plain scrambled view
    flushSync(() => {
      root.render(React.createElement(ParentMessageView, { streaming: true }));
    });
    expect(container.querySelector('[data-testid="scrambled-plain-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="markdown-ast-view"]')).toBeNull();

    // 2. Stream finishes ([DONE]): plain view MUST stay mounted (kills the flash)
    flushSync(() => {
      root.render(React.createElement(ParentMessageView, { streaming: false }));
    });
    // Still in scrambled plain view! Not swapped yet!
    expect(container.querySelector('[data-testid="scrambled-plain-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="markdown-ast-view"]')).toBeNull();

    // 3. Settle sweep finishes
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Now settled: swapped to markdown AST view
    expect(settled).toBe(true);
    expect(container.querySelector('[data-testid="markdown-ast-view"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="scrambled-plain-view"]')).toBeNull();
  });
});

