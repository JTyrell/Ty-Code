/**
 * Virtualized Chat Message List (Phase 1: Extreme Rendering & DOM Optimization)
 *
 * Implements @tanstack/react-virtual list virtualization with dynamic row height measurement,
 * CSS containment, and jitter-free auto-scrolling to sustain 60fps rendering during 300+ token/s
 * streaming bursts.
 *
 * Brand: Ty-Code
 */

import React, {
  useState,
  useRef,
  useEffect,
  useLayoutEffect,
  useCallback,
  forwardRef,
  useImperativeHandle,
  type ReactNode,
  type UIEvent
} from 'react';
import { useVirtualizer, type VirtualItem } from '@tanstack/react-virtual';
import type { ChatMessage, ProposedDiff } from '../../../../preload/types';
import { ChatMessageItem } from './ChatMessage';
import { ScrollFollowPill } from './ScrollFollowPill';

export interface ChatMessageListProps {
  messages: ChatMessage[];
  lastAssistantId?: string;
  isRunning?: boolean;
  currentStatus?: string;
  contextTokens?: number;
  onRegenerate?: () => void;
  onInspectDiff?: (diff: ProposedDiff) => void;
  onApplyDiff?: (diff: ProposedDiff) => void;
  onRetryError?: () => void;
  header?: ReactNode;
  footer?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  /** Estimated row height in pixels before element measurement */
  estimateRowHeight?: number;
}

export interface ChatMessageListHandle {
  scrollToBottom: (smooth?: boolean) => void;
  scrollToIndex: (index: number, smooth?: boolean) => void;
  getScrollElement: () => HTMLDivElement | null;
  isAtBottom: () => boolean;
  autoFollow: () => void;
  rePin: (smooth?: boolean) => void;
}

export const ChatMessageList = forwardRef<ChatMessageListHandle, ChatMessageListProps>(
  (
    {
      messages = [],
      lastAssistantId,
      isRunning = false,
      currentStatus,
      contextTokens,
      onRegenerate,
      onInspectDiff,
      onApplyDiff,
      onRetryError,
      header,
      footer,
      className,
      style,
      onScroll,
      estimateRowHeight = 130
    },
    ref
  ) => {
    const parentRef = useRef<HTMLDivElement | null>(null);
    const innerWrapperRef = useRef<HTMLDivElement | null>(null);
    const headerRef = useRef<HTMLDivElement | null>(null);
    const [headerHeight, setHeaderHeight] = useState<number>(0);

    // Pin detection stays ref-based so token streaming does not render per pixel.
    const pinnedToBottom = useRef<boolean>(true);
    const scrollRafRef = useRef<number | null>(null);
    const userScrollIntentRef = useRef<boolean>(false);
    const userScrollIntentTimerRef = useRef<number | null>(null);
    const [detachedFromBottom, setDetachedFromBottom] = useState<boolean>(false);
    const detachedFromBottomRef = useRef<boolean>(false);

    // Track dynamic header height to offset virtualization coordinates accurately
    useLayoutEffect(() => {
      if (headerRef.current) {
        const el = headerRef.current;
        const updateHeight = () => setHeaderHeight(el.offsetHeight);
        updateHeight();
        const observer = new ResizeObserver(updateHeight);
        observer.observe(el);
        return () => observer.disconnect();
      } else {
        setHeaderHeight(0);
      }
    }, [header]);

    // Dynamic row virtualization
    const rowVirtualizer = useVirtualizer({
      count: messages.length,
      getScrollElement: () => parentRef.current,
      estimateSize: useCallback(() => estimateRowHeight, [estimateRowHeight]),
      overscan: 6,
      scrollMargin: headerHeight,
      getItemKey: useCallback((index: number) => messages[index]?.id ?? index, [messages])
    });

    // A scroll position may change because of streaming, resize, or an explicit
    // re-pin. Only wheel, touch, keyboard, or scrollbar intent may detach it.
    useEffect(() => {
      const el = parentRef.current;
      if (!el) return;

      const clearUserScrollIntent = () => {
        userScrollIntentRef.current = false;
        if (userScrollIntentTimerRef.current !== null) {
          window.clearTimeout(userScrollIntentTimerRef.current);
          userScrollIntentTimerRef.current = null;
        }
      };
      const markUserScrollIntent = () => {
        userScrollIntentRef.current = true;
        if (userScrollIntentTimerRef.current !== null) {
          window.clearTimeout(userScrollIntentTimerRef.current);
        }
        userScrollIntentTimerRef.current = window.setTimeout(clearUserScrollIntent, 160);
      };
      const handleKeyDown = (event: KeyboardEvent) => {
        if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)) {
          markUserScrollIntent();
        }
      };
      const handlePointerDown = (event: PointerEvent) => {
        const scrollbarWidth = Math.max(0, el.offsetWidth - el.clientWidth);
        const bounds = el.getBoundingClientRect();
        if (scrollbarWidth > 0 && event.clientX >= bounds.right - scrollbarWidth) {
          markUserScrollIntent();
        }
      };
      const handleScrollThrottled = (event: Event) => {
        if (scrollRafRef.current === null) {
          scrollRafRef.current = requestAnimationFrame(() => {
            scrollRafRef.current = null;
            const container = parentRef.current;
            if (!container) return;
            const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
            const isPinned = distanceFromBottom < 64;

            if (isPinned) {
              pinnedToBottom.current = true;
              if (detachedFromBottomRef.current) {
                detachedFromBottomRef.current = false;
                setDetachedFromBottom(false);
              }
            } else if (userScrollIntentRef.current) {
              pinnedToBottom.current = false;
              if (!detachedFromBottomRef.current) {
                detachedFromBottomRef.current = true;
                setDetachedFromBottom(true);
              }
            }
            clearUserScrollIntent();
          });
        }
        onScroll?.(event as unknown as UIEvent<HTMLDivElement>);
      };

      el.addEventListener('wheel', markUserScrollIntent, { passive: true });
      el.addEventListener('touchmove', markUserScrollIntent, { passive: true });
      el.addEventListener('keydown', handleKeyDown);
      el.addEventListener('pointerdown', handlePointerDown, { passive: true });
      el.addEventListener('scroll', handleScrollThrottled, { passive: true });
      return () => {
        el.removeEventListener('wheel', markUserScrollIntent);
        el.removeEventListener('touchmove', markUserScrollIntent);
        el.removeEventListener('keydown', handleKeyDown);
        el.removeEventListener('pointerdown', handlePointerDown);
        el.removeEventListener('scroll', handleScrollThrottled);
        clearUserScrollIntent();
        if (scrollRafRef.current !== null) {
          cancelAnimationFrame(scrollRafRef.current);
          scrollRafRef.current = null;
        }
      };
    }, [onScroll]);

    // Step 2 & 3: Auto-follow helper (behavior 'auto' during streaming)
    const autoFollow = useCallback(() => {
      if (!pinnedToBottom.current) return;
      const el = parentRef.current;
      if (!el) return;
      if (messages.length > 0) {
        rowVirtualizer.scrollToIndex(messages.length - 1, {
          align: 'end',
          behavior: 'auto'
        });
      }
      el.scrollTop = el.scrollHeight;
    }, [messages.length, rowVirtualizer]);

    const performBottomScroll = useCallback(
      (behavior: ScrollBehavior) => {
        const el = parentRef.current;
        if (!el) return;
        if (messages.length > 0) {
          rowVirtualizer.scrollToIndex(messages.length - 1, { align: 'end', behavior });
        }
        if (behavior === 'smooth') {
          el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
        } else {
          el.scrollTop = el.scrollHeight;
        }
      },
      [messages.length, rowVirtualizer]
    );

    // Explicit public re-pins hide the pill immediately; the pill itself owns
    // its pressing and suppression lifecycle.
    const scrollToBottom = useCallback(
      (smooth = false) => {
        pinnedToBottom.current = true;
        userScrollIntentRef.current = false;
        if (detachedFromBottomRef.current) {
          detachedFromBottomRef.current = false;
          setDetachedFromBottom(false);
        }
        performBottomScroll(smooth ? 'smooth' : 'auto');
      },
      [performBottomScroll]
    );

    // Expose handle methods to parent components
    useImperativeHandle(
      ref,
      () => ({
        scrollToBottom,
        scrollToIndex: (index: number, smooth = false) => {
          rowVirtualizer.scrollToIndex(index, {
            align: 'start',
            behavior: smooth ? 'smooth' : 'auto'
          });
        },
        getScrollElement: () => parentRef.current,
        isAtBottom: () => pinnedToBottom.current,
        autoFollow,
        rePin: (smooth = true) => scrollToBottom(smooth)
      }),
      [scrollToBottom, autoFollow, rowVirtualizer]
    );

    // Step 2: Auto-follow on buffer flush (commits new text to DOM)
    const latestMessage = messages[messages.length - 1];
    const latestContent = latestMessage?.content;
    const isStreaming = Boolean(
      isRunning || latestMessage?.isStreaming || (latestMessage?.id === lastAssistantId && isRunning)
    );

    useLayoutEffect(() => {
      autoFollow();
    }, [messages.length, latestContent, isStreaming, autoFollow]);

    // Step 2: ResizeObserver on inner content wrapper (post-stream height jumps, code block expansion)
    useEffect(() => {
      const innerEl = innerWrapperRef.current;
      if (!innerEl) return;

      const resizeObserver = new ResizeObserver(() => {
        if (!pinnedToBottom.current) return;
        const el = parentRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      });

      resizeObserver.observe(innerEl);

      // Also re-pin on window resize while pinned
      const handleWindowResize = () => {
        if (!pinnedToBottom.current) return;
        const el = parentRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
      };
      window.addEventListener('resize', handleWindowResize, { passive: true });

      return () => {
        resizeObserver.disconnect();
        window.removeEventListener('resize', handleWindowResize);
      };
    }, [messages.length > 0]);

    const handlePillActivate = useCallback(() => {
      pinnedToBottom.current = true;
      userScrollIntentRef.current = false;
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      performBottomScroll(reducedMotion ? 'auto' : 'smooth');
    }, [performBottomScroll]);

    const handlePillSuppressionEnd = useCallback(() => {
      const shouldRemainDetached = !pinnedToBottom.current;
      detachedFromBottomRef.current = shouldRemainDetached;
      setDetachedFromBottom(shouldRemainDetached);
      return shouldRemainDetached;
    }, []);

    const getScrollElement = useCallback(() => parentRef.current, []);

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
      <div
        className={`chat-feed-container ${className || ''}`}
        style={{
          position: 'relative',
          height: '100%',
          width: '100%',
          minHeight: 0,
          overflow: 'hidden',
          ...style
        }}
      >
        <div
          ref={parentRef}
          className="chat-feed"
          style={{
            height: '100%',
            overflowY: 'auto',
            overflowX: 'hidden',
            // Prompt 2: reserve a stable scrollbar gutter so the scrollbar
            // appearing/disappearing cannot shift the feed (or the pill) by a
            // pixel between overflow states.
            scrollbarGutter: 'stable',
            contain: 'strict',
            position: 'relative',
            scrollBehavior: 'auto'
          }}
          role="log"
          aria-live="polite"
          tabIndex={0}
        >
          {/* Optional Header (e.g. Empty State, Previous Session Offer) */}
          {header && (
            <div
              ref={headerRef}
              className="chat-feed-header contain-content"
              style={{ contain: 'content' }}
            >
              {header}
            </div>
          )}

          {/* Virtualized Message Canvas */}
          {messages.length > 0 && (
            <div
              ref={innerWrapperRef}
              className="chat-virtual-container"
              style={{
                height: `${rowVirtualizer.getTotalSize()}px`,
                width: '100%',
                position: 'relative'
              }}
            >
              {virtualItems.map((virtualRow: VirtualItem) => {
                const message = messages[virtualRow.index];
                if (!message) return null;

                const isLastAssistant = message.id === lastAssistantId;
                const isItemStreaming = isLastAssistant && (message.isStreaming ?? isRunning);
                const virtualRowStart = virtualRow.start - (rowVirtualizer.options.scrollMargin ?? 0);

                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    className="chat-virtual-row contain-content"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRowStart}px)`,
                      boxSizing: 'border-box',
                      contain: 'content',
                      contentVisibility: 'auto',
                      containIntrinsicSize: 'auto 130px'
                    }}
                  >
                    <ChatMessageItem
                      message={message}
                      isLastAssistant={isLastAssistant}
                      isRunning={isRunning}
                      isStreaming={isItemStreaming}
                      currentStatus={currentStatus}
                      contextTokens={contextTokens}
                      onRegenerate={onRegenerate}
                      onInspectDiff={onInspectDiff}
                      onApplyDiff={onApplyDiff}
                      onRetryError={onRetryError}
                    />
                  </div>
                );
              })}
            </div>
          )}

          {/* Optional Footer (e.g. Plan Reviews, Security Approvals, Active Errors) */}
          {footer && <div className="chat-feed-footer contain-content" style={{ contain: 'content' }}>{footer}</div>}
        </div>

        <ScrollFollowPill
          shown={detachedFromBottom}
          getScrollElement={getScrollElement}
          onActivate={handlePillActivate}
          onSuppressionEnd={handlePillSuppressionEnd}
        />
      </div>
    );
  }
);

ChatMessageList.displayName = 'ChatMessageList';

export default ChatMessageList;
