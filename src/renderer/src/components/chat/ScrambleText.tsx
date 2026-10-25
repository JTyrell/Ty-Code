/**
 * ScrambleText (Rewrite: Decode-Frontier Engine)
 *
 * Visual glyph-scramble decode animation with zero latency impact:
 * - State is maintained entirely in refs (lockedRef, arrivalRef, glyphsRef, rAF).
 * - Only the display string touches React state, updated inside the rAF loop.
 * - DECODE_RATE = 140 chars/sec during active streaming.
 * - DONE_RATE = 600 chars/sec settle sweep after stream completes.
 * - MAX_BAND = 90 characters maximum simultaneously scrambled glyphs (burst catch-up).
 * - FLICKER_MS = 55 cadence for re-randomizing band glyphs.
 * - Green cursor rendered at the FRONTIER (floor(locked)), not at the arrival end.
 * - Settle sweep bounded to <= ~0.7s on [DONE] transition.
 * - Calls onSettled() when frontier reaches arrival after stream completes.
 * - Pauses on document.hidden, honors prefers-reduced-motion and disabled setting.
 * - aria-label carries real text, aria-live="off".
 *
 * Brand: Ty-Code
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';

export interface ScrambleTextProps {
  text: string;
  enabled: boolean;
  streaming: boolean;
  className?: string;
  style?: React.CSSProperties;
  onSettled?: () => void;
}

export const DECODE_RATE = 140; // chars/sec while streaming
export const DONE_RATE = 600;   // chars/sec settle sweep after stream ends
export const MAX_BAND = 90;     // max simultaneously scrambled glyphs
export const FLICKER_MS = 55;   // re-randomize band cadence
export const SCRAMBLE_CHARSET = 'アイウエオカキクケコサシスセソタチツテト0123456789ABCDEFHKMXZ#$%&@<>*+';
export const SCRAMBLE_WINDOW = MAX_BAND; // backward compatibility

function isSpaceOrNewline(ch: string): boolean {
  return ch === ' ' || ch === '\n' || ch === '\r' || ch === '\t';
}

function getRandomGlyph(): string {
  const idx = Math.floor(Math.random() * SCRAMBLE_CHARSET.length);
  return SCRAMBLE_CHARSET[idx];
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

interface DisplayState {
  real: string;
  band: string;
  showCursor: boolean;
}

function buildDisplayParts(
  text: string,
  locked: number,
  glyphs: string[],
  showCursor: boolean
): DisplayState {
  const arrival = text.length;
  const floorLocked = Math.min(arrival, Math.max(0, Math.floor(locked)));
  const real = text.slice(0, floorLocked);

  let band = '';
  for (let i = floorLocked; i < arrival; i++) {
    const ch = text[i];
    if (isSpaceOrNewline(ch)) {
      band += ch;
    } else {
      const slot = i - floorLocked;
      band += glyphs[slot] || getRandomGlyph();
    }
  }

  return { real, band, showCursor };
}

export const ScrambleText: React.FC<ScrambleTextProps> = ({
  text,
  enabled,
  streaming,
  className,
  style,
  onSettled
}) => {
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

  const isAnimated = enabled && !reducedMotion;

  // Initial locked count
  const initialLocked = !isAnimated || !streaming
    ? text.length
    : Math.max(0, text.length - MAX_BAND);

  // Frontier engine state strictly in refs (never React state)
  const lockedRef = useRef<number>(initialLocked);
  const arrivalRef = useRef<number>(text.length);
  const glyphsRef = useRef<string[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const lastTsRef = useRef<number>(0);
  const lastFlickerRef = useRef<number>(0);
  const wasStreamingRef = useRef<boolean>(streaming);
  const isSettledRef = useRef<boolean>(!streaming);

  const textRef = useRef<string>(text);
  const enabledRef = useRef<boolean>(enabled);
  const streamingRef = useRef<boolean>(streaming);
  const onSettledRef = useRef<(() => void) | undefined>(onSettled);

  textRef.current = text;
  enabledRef.current = enabled;
  streamingRef.current = streaming;
  onSettledRef.current = onSettled;

  // React state: only the display string / parts for rendering
  const [display, setDisplay] = useState<DisplayState>(() => {
    if (!isAnimated || !streaming) {
      return { real: text, band: '', showCursor: false };
    }
    const floorLocked = Math.min(text.length, Math.max(0, Math.floor(initialLocked)));
    const bandLen = text.length - floorLocked;
    const initialGlyphs: string[] = [];
    for (let s = 0; s < bandLen; s++) {
      initialGlyphs.push(getRandomGlyph());
    }
    glyphsRef.current = initialGlyphs;
    return buildDisplayParts(text, initialLocked, initialGlyphs, true);
  });

  const cancelLoop = useCallback(() => {
    if (rafIdRef.current !== null) {
      cancelAnimationFrame(rafIdRef.current);
      rafIdRef.current = null;
    }
  }, []);

  const startLoopIfNeeded = useCallback(() => {
    if (rafIdRef.current !== null) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!enabledRef.current || reducedMotion) return;
    if (isSettledRef.current) return;

    lastTsRef.current = 0;

    const tick = (ts: DOMHighResTimeStamp) => {
      rafIdRef.current = null;

      if (typeof document !== 'undefined' && document.hidden) return;
      if (!enabledRef.current || reducedMotion) {
        lockedRef.current = textRef.current.length;
        setDisplay({ real: textRef.current, band: '', showCursor: false });
        isSettledRef.current = true;
        onSettledRef.current?.();
        return;
      }

      const lastTs = lastTsRef.current;
      lastTsRef.current = ts;
      const dt = lastTs === 0 ? 0 : Math.min(0.1, Math.max(0, (ts - lastTs) / 1000));

      const currentText = textRef.current;
      const arrival = currentText.length;
      arrivalRef.current = arrival;
      const isCurrentlyStreaming = streamingRef.current;

      // 4. On transition to streaming === false ([DONE]):
      if (wasStreamingRef.current && !isCurrentlyStreaming) {
        wasStreamingRef.current = false;
        if (arrival - lockedRef.current > 400) {
          lockedRef.current = arrival - 400;
        }
      } else if (!wasStreamingRef.current && isCurrentlyStreaming) {
        wasStreamingRef.current = true;
        isSettledRef.current = false;
      }

      // 2. locked = min(arrival, locked + (streaming ? DECODE_RATE : DONE_RATE) * dt)
      const rate = isCurrentlyStreaming ? DECODE_RATE : DONE_RATE;
      let locked = Math.min(arrival, lockedRef.current + rate * dt);

      // 3. Burst catch-up: if arrival - locked > MAX_BAND, set locked = arrival - MAX_BAND
      if (arrival - locked > MAX_BAND) {
        locked = arrival - MAX_BAND;
      }
      lockedRef.current = locked;

      // 7. When !streaming && locked >= arrival: cancel rAF loop and call onSettled()
      if (!isCurrentlyStreaming && locked >= arrival) {
        lockedRef.current = arrival;
        isSettledRef.current = true;
        setDisplay({ real: currentText, band: '', showCursor: false });
        cancelLoop();
        onSettledRef.current?.();
        return;
      }

      // 5. Build display
      const floorLocked = Math.min(arrival, Math.max(0, Math.floor(locked)));
      const bandLength = arrival - floorLocked;

      if (ts - lastFlickerRef.current >= FLICKER_MS) {
        lastFlickerRef.current = ts;
        while (glyphsRef.current.length < bandLength) {
          glyphsRef.current.push(getRandomGlyph());
        }
        for (let s = 0; s < bandLength; s++) {
          glyphsRef.current[s] = getRandomGlyph();
        }
      } else {
        while (glyphsRef.current.length < bandLength) {
          glyphsRef.current.push(getRandomGlyph());
        }
      }

      const showCursor = isCurrentlyStreaming || bandLength > 0;
      setDisplay(buildDisplayParts(currentText, locked, glyphsRef.current, showCursor));

      rafIdRef.current = requestAnimationFrame(tick);
    };

    rafIdRef.current = requestAnimationFrame(tick);
  }, [cancelLoop, reducedMotion]);

  // Handle incoming text and streaming transitions
  useEffect(() => {
    const currentText = text;
    const isCurrentlyStreaming = streaming;
    const isAnim = enabled && !reducedMotion;

    if (!isAnim) {
      cancelLoop();
      lockedRef.current = currentText.length;
      arrivalRef.current = currentText.length;
      isSettledRef.current = true;
      setDisplay({ real: currentText, band: '', showCursor: false });
      if (!isCurrentlyStreaming) {
        onSettledRef.current?.();
      }
      return;
    }

    // Historical completed message on mount or re-render: skip animation
    if (!isCurrentlyStreaming && isSettledRef.current && lockedRef.current >= currentText.length) {
      cancelLoop();
      setDisplay({ real: currentText, band: '', showCursor: false });
      return;
    }

    // If text shrunk (reset/cleared)
    if (currentText.length < arrivalRef.current) {
      lockedRef.current = 0;
      glyphsRef.current = [];
    }
    arrivalRef.current = currentText.length;

    // Transition to streaming === false ([DONE])
    if (wasStreamingRef.current && !isCurrentlyStreaming) {
      wasStreamingRef.current = false;
      if (currentText.length - lockedRef.current > 400) {
        lockedRef.current = currentText.length - 400;
      }
    } else if (!wasStreamingRef.current && isCurrentlyStreaming) {
      wasStreamingRef.current = true;
      isSettledRef.current = false;
    }

    // Burst catch-up on text arrival
    if (currentText.length - lockedRef.current > MAX_BAND) {
      lockedRef.current = currentText.length - MAX_BAND;
    }

    // Check if already settled
    if (!isCurrentlyStreaming && lockedRef.current >= currentText.length) {
      cancelLoop();
      lockedRef.current = currentText.length;
      isSettledRef.current = true;
      setDisplay({ real: currentText, band: '', showCursor: false });
      onSettledRef.current?.();
      return;
    }

    // Update display immediately for newly arrived characters (zero latency)
    const floorLocked = Math.min(currentText.length, Math.max(0, Math.floor(lockedRef.current)));
    const bandLength = currentText.length - floorLocked;
    while (glyphsRef.current.length < bandLength) {
      glyphsRef.current.push(getRandomGlyph());
    }

    const showCursor = isCurrentlyStreaming || bandLength > 0;
    setDisplay(buildDisplayParts(currentText, lockedRef.current, glyphsRef.current, showCursor));

    startLoopIfNeeded();
  }, [text, streaming, enabled, reducedMotion, cancelLoop, startLoopIfNeeded]);

  // Pause loop when document is hidden (background tab) and resume on visible
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        cancelLoop();
        lastTsRef.current = 0;
      } else if (enabledRef.current && !reducedMotion && !isSettledRef.current) {
        lastTsRef.current = 0;
        startLoopIfNeeded();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [reducedMotion, cancelLoop, startLoopIfNeeded]);

  // Cleanup on unmount (disposable pattern)
  useEffect(() => {
    return () => {
      cancelLoop();
    };
  }, [cancelLoop]);

  const renderedReal = !isAnimated ? text : display.real;
  const renderedBand = !isAnimated ? '' : display.band;
  const renderedCursor = !isAnimated ? false : display.showCursor;

  return (
    <span
      className={`scramble-text${isAnimated && !isSettledRef.current ? ' scramble-text-active' : ''} ${className || ''}`}
      style={{
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        ...style
      }}
      aria-label={text}
      aria-live="off"
    >
      {renderedReal}
      {renderedCursor && (
        <span
          className="scramble-frontier-cursor"
          style={{
            display: 'inline-block',
            width: '6px',
            height: '13px',
            marginLeft: '1px',
            marginRight: '1px',
            verticalAlign: 'text-bottom',
            backgroundColor: '#22c55e',
            borderRadius: '1px',
            opacity: 0.9,
            boxShadow: '0 0 6px rgba(34, 197, 94, 0.6)'
          }}
          aria-hidden="true"
        />
      )}
      {renderedBand}
    </span>
  );
};

export default ScrambleText;

