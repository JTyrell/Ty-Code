/**
 * ScrambleText (Prompt 3: Latency Optimisation & Matrix Decode Animation)
 *
 * Visual glyph-scramble decode animation with zero latency impact:
 * - Reads only from text already flushed into the render buffer (never gates tokens).
 * - Tracks per-character lock timestamps: lockAt = now + 90ms + (index % 5) * 12ms.
 * - Bounded work: only the last 200 characters are ever scrambled; older text is locked.
 * - Spaces and newlines are never scrambled so layout never jumps.
 * - A single requestAnimationFrame loop runs ONLY while unlocked characters exist,
 *   cancelling itself automatically once all characters lock.
 * - Pauses on document.hidden, honors prefers-reduced-motion: reduce.
 * - Accessibility: aria-label with full real text and aria-live="off".
 *
 * Brand: Ty-Code
 */

import React, { useEffect, useRef, useState, useMemo } from 'react';

export interface ScrambleTextProps {
  text: string;
  enabled: boolean;
  streaming: boolean;
  className?: string;
  style?: React.CSSProperties;
}

export const SCRAMBLE_CHARSET = 'アイウエオカキクケコサシスセソ0123456789ABCDEF#$%&';
export const SCRAMBLE_WINDOW = 200;

function isSpaceOrNewline(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

function checkReducedMotion(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  } catch {
    return false;
  }
}

export const ScrambleText: React.FC<ScrambleTextProps> = ({
  text,
  enabled,
  streaming,
  className,
  style
}) => {
  const [renderedText, setRenderedText] = useState<string>(text);

  const rafIdRef = useRef<number | null>(null);
  const lockMapRef = useRef<Map<number, number>>(new Map());
  const prevLengthRef = useRef<number>(0);
  const textRef = useRef<string>(text);
  const enabledRef = useRef<boolean>(enabled);
  const streamingRef = useRef<boolean>(streaming);

  textRef.current = text;
  enabledRef.current = enabled;
  streamingRef.current = streaming;

  // Track prefers-reduced-motion dynamically
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => checkReducedMotion());

  useEffect(() => {
    try {
      if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
      mql.addEventListener('change', handler);
      return () => mql.removeEventListener('change', handler);
    } catch {
      return undefined;
    }
  }, []);

  const isAnimated = enabled && streaming && !reducedMotion;

  const cancelLoop = () => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  };

  // Main animation frame handler
  const startLoopIfNeeded = () => {
    if (rafIdRef.current !== null) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!enabledRef.current || !streamingRef.current || reducedMotion) return;

    const tick = () => {
      rafIdRef.current = null;

      if (typeof document !== 'undefined' && document.hidden) return;
      if (!enabledRef.current || !streamingRef.current) {
        setRenderedText(textRef.current);
        lockMapRef.current.clear();
        return;
      }

      const currentText = textRef.current;
      const now = performance.now();
      const lockMap = lockMapRef.current;
      const windowStart = Math.max(0, currentText.length - SCRAMBLE_WINDOW);

      let hasUnlocked = false;
      const chars = currentText.split('');

      for (let i = windowStart; i < chars.length; i++) {
        const lockAt = lockMap.get(i);
        if (lockAt !== undefined) {
          if (now < lockAt) {
            hasUnlocked = true;
            const randIdx = Math.floor(Math.random() * SCRAMBLE_CHARSET.length);
            chars[i] = SCRAMBLE_CHARSET[randIdx];
          } else {
            // Locked: remove from map so it costs 0 operations on subsequent frames
            lockMap.delete(i);
          }
        }
      }

      setRenderedText(chars.join(''));

      // Run next frame ONLY while unlocked characters exist
      if (hasUnlocked && streamingRef.current) {
        rafIdRef.current = requestAnimationFrame(tick);
      }
    };

    rafIdRef.current = requestAnimationFrame(tick);
  };

  // Manage lock timestamps when text or streaming state changes
  useEffect(() => {
    // If not animated or not streaming, lock immediately and cancel rAF
    if (!isAnimated) {
      cancelLoop();
      lockMapRef.current.clear();
      prevLengthRef.current = text.length;
      setRenderedText(text);
      return;
    }

    const now = performance.now();
    const lockMap = lockMapRef.current;
    const windowStart = Math.max(0, text.length - SCRAMBLE_WINDOW);

    // If text shrunk (reset/cleared), clean state
    if (text.length < prevLengthRef.current) {
      lockMap.clear();
      prevLengthRef.current = 0;
    }

    // Prune entries older than the 200-char window to keep memory strictly O(1)
    for (const key of lockMap.keys()) {
      if (key < windowStart) {
        lockMap.delete(key);
      }
    }

    // Assign lockAt for newly arrived characters within the trailing window
    const startIndex = Math.max(windowStart, prevLengthRef.current);
    for (let i = startIndex; i < text.length; i++) {
      const ch = text[i];
      if (isSpaceOrNewline(ch)) continue;
      if (!lockMap.has(i)) {
        lockMap.set(i, now + 90 + (i % 5) * 12);
      }
    }

    prevLengthRef.current = text.length;

    // Start rAF loop if unlocked characters exist
    if (lockMap.size > 0) {
      startLoopIfNeeded();
    } else {
      setRenderedText(text);
    }
  }, [text, isAnimated]);

  // Pause loop when document is hidden (background tab) and resume on visible
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelLoop();
      } else if (isAnimated && lockMapRef.current.size > 0) {
        startLoopIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isAnimated]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cancelLoop();
    };
  }, []);

  return (
    <span
      className={`scramble-text${isAnimated ? ' scramble-text-active' : ''} ${className || ''}`}
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...style
      }}
      aria-label={text}
      aria-live="off"
    >
      {renderedText}
    </span>
  );
};

export default ScrambleText;
