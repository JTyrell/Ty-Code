import React, { useRef, useState, useEffect, useCallback } from 'react';
import './HoverMarquee.css';

export interface HoverMarqueeProps {
  text: string;
  className?: string;
  title?: string;
  style?: React.CSSProperties;
  as?: 'h4' | 'span' | 'div' | 'h3';
  speed?: number; // pixels per second
}

export const HoverMarquee: React.FC<HoverMarqueeProps> = ({
  text,
  className = '',
  title,
  style,
  as: Component = 'span',
  speed = 32
}) => {
  const containerRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLSpanElement>(null);
  const [distance, setDistance] = useState(0);

  const measure = useCallback(() => {
    if (!containerRef.current || !contentRef.current) return;
    const containerW = containerRef.current.clientWidth;
    const contentW = contentRef.current.scrollWidth;
    const overflowDiff = contentW - containerW;

    if (overflowDiff > 2) {
      setDistance(overflowDiff + 10);
    } else {
      setDistance(0);
    }
  }, []);

  useEffect(() => {
    measure();

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      ro = new ResizeObserver(() => {
        measure();
      });
      ro.observe(containerRef.current);
    }

    const onResize = () => measure();
    window.addEventListener('resize', onResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', onResize);
    };
  }, [text, measure]);

  const canMarquee = distance > 0;
  const duration = canMarquee ? Math.max(2.5, Math.min(8, distance / speed)) : 0;

  return (
    <Component
      ref={containerRef as any}
      className={`hover-marquee-root ${canMarquee ? 'can-marquee' : ''} ${className}`}
      title={title || text}
      style={{
        ...style,
        ...(canMarquee
          ? {
              ['--marquee-dist' as any]: `-${distance}px`,
              ['--marquee-duration' as any]: `${duration}s`
            }
          : {})
      }}
      onMouseEnter={measure}
    >
      <span ref={contentRef} className="hover-marquee-content">
        {text}
      </span>
    </Component>
  );
};
