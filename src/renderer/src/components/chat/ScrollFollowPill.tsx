import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowDown } from 'lucide-react';

export type ScrollFollowPillPhase = 'idle' | 'shown' | 'pressing' | 'suppressing';

export interface ScrollFollowPillProps {
  shown: boolean;
  getScrollElement: () => HTMLElement | null;
  onActivate: () => void;
  onSuppressionEnd: () => boolean;
}

const SUPPRESSION_MS = 700;
const GEOMETRY_EPSILON = 0.5;

function geometryChanged(before: DOMRect, after: DOMRect): boolean {
  return (
    Math.abs(before.left - after.left) > GEOMETRY_EPSILON ||
    Math.abs(before.top - after.top) > GEOMETRY_EPSILON ||
    Math.abs(before.width - after.width) > GEOMETRY_EPSILON ||
    Math.abs(before.height - after.height) > GEOMETRY_EPSILON
  );
}

export function ScrollFollowPill({
  shown,
  getScrollElement,
  onActivate,
  onSuppressionEnd
}: ScrollFollowPillProps): React.ReactElement | null {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const shownRef = useRef(shown);
  const activePointerRef = useRef<number | null>(null);
  const activePointerTargetRef = useRef<HTMLButtonElement | null>(null);
  const geometryFrameRef = useRef<number | null>(null);
  const suppressionTimerRef = useRef<number | null>(null);
  const scrollEndTargetRef = useRef<HTMLElement | null>(null);
  const scrollEndHandlerRef = useRef<(() => void) | null>(null);
  const [phase, setPhase] = useState<ScrollFollowPillPhase>(shown ? 'shown' : 'idle');

  shownRef.current = shown;

  const stopGeometryCheck = useCallback(() => {
    if (geometryFrameRef.current !== null) {
      cancelAnimationFrame(geometryFrameRef.current);
      geometryFrameRef.current = null;
    }
  }, []);

  const startGeometryCheck = useCallback(
    (button: HTMLButtonElement) => {
      if (!import.meta.env.DEV) return;
      stopGeometryCheck();
      const initialRect = button.getBoundingClientRect();

      const verifyGeometry = () => {
        if (activePointerRef.current === null || !button.isConnected) {
          geometryFrameRef.current = null;
          return;
        }
        const currentRect = button.getBoundingClientRect();
        if (geometryChanged(initialRect, currentRect)) {
          console.error('[ScrollFollowPill] Geometry changed during a captured pointer press.');
          geometryFrameRef.current = null;
          return;
        }
        geometryFrameRef.current = requestAnimationFrame(verifyGeometry);
      };

      geometryFrameRef.current = requestAnimationFrame(verifyGeometry);
    },
    [stopGeometryCheck]
  );

  const clearSuppressionResources = useCallback(() => {
    if (suppressionTimerRef.current !== null) {
      window.clearTimeout(suppressionTimerRef.current);
      suppressionTimerRef.current = null;
    }
    const target = scrollEndTargetRef.current;
    const handler = scrollEndHandlerRef.current;
    if (target && handler) target.removeEventListener('scrollend', handler);
    scrollEndTargetRef.current = null;
    scrollEndHandlerRef.current = null;
  }, []);

  const finishSuppression = useCallback(() => {
    clearSuppressionResources();
    setPhase(onSuppressionEnd() ? 'shown' : 'idle');
  }, [clearSuppressionResources, onSuppressionEnd]);

  const activate = useCallback(() => {
    clearSuppressionResources();
    setPhase('suppressing');

    const scrollElement = getScrollElement();
    if (scrollElement) {
      const handleScrollEnd = () => finishSuppression();
      scrollEndTargetRef.current = scrollElement;
      scrollEndHandlerRef.current = handleScrollEnd;
      scrollElement.addEventListener('scrollend', handleScrollEnd, { once: true });
    }
    suppressionTimerRef.current = window.setTimeout(finishSuppression, SUPPRESSION_MS);
    onActivate();
  }, [clearSuppressionResources, finishSuppression, getScrollElement, onActivate]);

  useEffect(() => {
    setPhase((current) => {
      if (shown && current === 'idle') return 'shown';
      if (!shown && current === 'shown') return 'idle';
      return current;
    });
  }, [shown]);

  useEffect(
    () => () => {
      clearSuppressionResources();
      stopGeometryCheck();
      const pointerId = activePointerRef.current;
      const button = activePointerTargetRef.current;
      if (pointerId !== null && button?.hasPointerCapture(pointerId)) {
        button.releasePointerCapture(pointerId);
      }
      activePointerRef.current = null;
      activePointerTargetRef.current = null;
    },
    [clearSuppressionResources, stopGeometryCheck]
  );

  const releasePointer = useCallback(
    (button: HTMLButtonElement, pointerId: number) => {
      if (button.hasPointerCapture(pointerId)) button.releasePointerCapture(pointerId);
      activePointerRef.current = null;
      activePointerTargetRef.current = null;
      stopGeometryCheck();
    },
    [stopGeometryCheck]
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (!event.isPrimary || event.button !== 0 || phase !== 'shown') return;
      event.preventDefault();
      event.stopPropagation();
      activePointerRef.current = event.pointerId;
      activePointerTargetRef.current = event.currentTarget;
      event.currentTarget.setPointerCapture(event.pointerId);
      setPhase('pressing');
      startGeometryCheck(event.currentTarget);
    },
    [phase, startGeometryCheck]
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      releasePointer(event.currentTarget, event.pointerId);
      activate();
    },
    [activate, releasePointer]
  );

  const handlePointerCancel = useCallback(
    (event: React.PointerEvent<HTMLButtonElement>) => {
      if (activePointerRef.current !== event.pointerId) return;
      event.preventDefault();
      event.stopPropagation();
      releasePointer(event.currentTarget, event.pointerId);
      setPhase(shownRef.current ? 'shown' : 'idle');
    },
    [releasePointer]
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (event.detail !== 0 || phase !== 'shown') return;
      activate();
    },
    [activate, phase]
  );

  if (phase === 'idle') return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      className="chat-jump-to-latest-pill"
      data-phase={phase}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onClick={handleClick}
      aria-label="Jump to latest messages"
      aria-hidden={phase === 'suppressing' ? true : undefined}
      tabIndex={phase === 'suppressing' ? -1 : 0}
    >
      <ArrowDown size={13} className="chat-jump-icon" aria-hidden="true" />
      <span>Jump to latest</span>
    </button>
  );
}

export { SUPPRESSION_MS };

export default ScrollFollowPill;
