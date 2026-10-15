/**
 * Ty-Code Desktop IDE - useContainerWidth Hook
 * Observes container width via ResizeObserver and categorizes into responsive buckets:
 * - 'compact': < 260px
 * - 'medium': 260px - 360px
 * - 'wide': > 360px
 *
 * Sets data-width-bucket attribute on the container element as a fallback for older engines.
 */

import { useState, useEffect, useRef, useCallback } from 'react';

export type WidthBucket = 'compact' | 'medium' | 'wide';

export interface UseContainerWidthOptions {
  compactThreshold?: number; // default: 260
  wideThreshold?: number;    // default: 360
  initialWidth?: number;     // default: 320
}

export interface UseContainerWidthResult {
  width: number;
  bucket: WidthBucket;
  containerRef: React.RefObject<HTMLDivElement>;
}

export function getWidthBucket(
  width: number,
  compactThreshold = 260,
  wideThreshold = 360
): WidthBucket {
  if (width < compactThreshold) return 'compact';
  if (width <= wideThreshold) return 'medium';
  return 'wide';
}

export function useContainerWidth(options: UseContainerWidthOptions = {}): UseContainerWidthResult {
  const {
    compactThreshold = 260,
    wideThreshold = 360,
    initialWidth = 320
  } = options;

  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number>(initialWidth);
  const [bucket, setBucket] = useState<WidthBucket>(() =>
    getWidthBucket(initialWidth, compactThreshold, wideThreshold)
  );

  const updateBucketAndAttr = useCallback(
    (newWidth: number) => {
      const newBucket = getWidthBucket(newWidth, compactThreshold, wideThreshold);
      setWidth(newWidth);
      setBucket(newBucket);

      if (containerRef.current) {
        containerRef.current.setAttribute('data-width-bucket', newBucket);
      }
    },
    [compactThreshold, wideThreshold]
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Initial measurement
    const measuredWidth = el.getBoundingClientRect().width || el.clientWidth;
    if (measuredWidth > 0) {
      updateBucketAndAttr(measuredWidth);
    }

    let animationFrameId: number | null = null;

    const observer = new ResizeObserver((entries) => {
      if (!entries.length) return;
      const entry = entries[0];
      const currentWidth = entry.contentRect.width || el.clientWidth;

      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }

      // Schedule measurement update on animation frame for fluid 60fps drag resize
      animationFrameId = requestAnimationFrame(() => {
        if (currentWidth > 0) {
          updateBucketAndAttr(currentWidth);
        }
      });
    });

    observer.observe(el);

    return () => {
      observer.disconnect();
      if (animationFrameId !== null) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [updateBucketAndAttr]);

  return {
    width,
    bucket,
    containerRef
  };
}
