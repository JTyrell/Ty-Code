// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { flushSync } from 'react-dom';
import {
  ScrambleText,
  SCRAMBLE_CHARSET,
  SCRAMBLE_WINDOW
} from './ScrambleText';

describe('ScrambleText', () => {
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

  it('exports the required charset and 200-character bounding window', () => {
    expect(SCRAMBLE_CHARSET).toBe('アイウエオカキクケコサシスセソ0123456789ABCDEF#$%&');
    expect(SCRAMBLE_WINDOW).toBe(200);
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

    const span = container.querySelector('span');
    expect(span).not.toBeNull();
    expect(span?.textContent).toBe(input);
    expect(span?.getAttribute('aria-label')).toBe(input);
    expect(span?.getAttribute('aria-live')).toBe('off');
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

    const span = container.querySelector('span');
    expect(span?.textContent).toBe(input);
    expect(span?.getAttribute('aria-label')).toBe(input);
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

    const rendered = container.querySelector('span')?.textContent || '';
    // Newline and spaces must stay in identical positions
    expect(rendered[8]).toBe('\n');
    expect(rendered[4]).toBe(' ');
    expect(rendered[13]).toBe(' ');
  });

  it('bounds scrambling to the last 200 characters, locking older prefix byte-for-byte', () => {
    // 250 characters total
    const prefix = 'A'.repeat(100) + 'B'.repeat(100); // 200 chars prefix
    const suffix = 'C'.repeat(50); // 50 chars suffix
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

    const rendered = container.querySelector('span')?.textContent || '';
    // Characters older than text.length - 200 (i.e. first 50 chars) must remain locked
    expect(rendered.slice(0, 50)).toBe('A'.repeat(50));
  });

  it('locks all characters immediately on [DONE] when streaming becomes false', () => {
    const text = 'Streaming message that finishes.';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: true
        })
      );
    });

    // Turn streaming off
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: false
        })
      );
    });

    const span = container.querySelector('span');
    expect(span?.textContent).toBe(text);
  });

  it('locks all characters immediately if enabled is toggled off mid-stream without layout jump', () => {
    const text = 'Active stream toggled off mid-way.';
    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: true,
          streaming: true
        })
      );
    });

    flushSync(() => {
      root.render(
        React.createElement(ScrambleText, {
          text,
          enabled: false,
          streaming: true
        })
      );
    });

    const span = container.querySelector('span');
    expect(span?.textContent).toBe(text);
  });
});
