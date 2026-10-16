/**
 * Ty-Code Desktop IDE - useAvailableWidth Hook
 * Tracks available width of an element (or fallback container/window) via ResizeObserver.
 * Drives responsive breakpoints for telemetry and status bar items.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type TelemetryBreakpoint = 'wide' | 'medium' | 'narrow' | 'hidden';

export interface UseAvailableWidthOptions {
  initialWidth?: number;
  onWidthChange?: (width: number) => void;
}

export interface UseAvailableWidthResult<T extends HTMLElement = HTMLElement> {
  ref: React.RefObject<T>;
  width: number;
  breakpoint: TelemetryBreakpoint;
}

/**
 * Categorizes available width into telemetry responsive tiers:
 * - wide: > 420px -> "Tokens 12,340 / 50,000" with label
 * - medium: 300px - 420px -> compact notation "12.3k / 50k"
 * - narrow: 240px - 300px -> icon + percentage "24%" with tooltip
 * - hidden: < 240px -> hidden; available in overflow menu
 */
export function getTelemetryBreakpoint(width: number): TelemetryBreakpoint {
  if (width > 420) return 'wide';
  if (width >= 300) return 'medium';
  if (width >= 240) return 'narrow';
  return 'hidden';
}

export function useAvailableWidth<T extends HTMLElement = HTMLElement>(
  options: UseAvailableWidthOptions = {}
): UseAvailableWidthResult<T> {
  const { initialWidth = typeof window !== 'undefined' ? window.innerWidth : 800, onWidthChange } = options;

  const ref = useRef<T>(null);
  const [width, setWidth] = useState<number>(initialWidth);
  const [breakpoint, setBreakpoint] = useState<TelemetryBreakpoint>(() => getTelemetryBreakpoint(initialWidth));

  const updateWidth = useCallback(
    (newWidth: number) => {
      const rounded = Math.round(newWidth);
      setWidth(rounded);
      const nextBp = getTelemetryBreakpoint(rounded);
      setBreakpoint(nextBp);
      onWidthChange?.(rounded);
    },
    [onWidthChange]
  );

  useEffect(() => {
    const el = ref.current;
    if (!el) {
      // Fallback to window resize if no ref is mounted
      const handleWindowResize = () => {
        updateWidth(window.innerWidth);
      };
      window.addEventListener('resize', handleWindowResize);
      updateWidth(window.innerWidth);
      return () => window.removeEventListener('resize', handleWindowResize);
    }

    // Initial measurement
    const rect = el.getBoundingClientRect();
    if (rect.width > 0) {
      updateWidth(rect.width);
    }

    let rafId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      if (!entries.length) return;
      const entry = entries[0];
      const measured = entry.contentRect.width || el.clientWidth;

      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }

      rafId = requestAnimationFrame(() => {
        if (measured >= 0) {
          updateWidth(measured);
        }
      });
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [updateWidth]);

  return {
    ref,
    width,
    breakpoint
  };
}
