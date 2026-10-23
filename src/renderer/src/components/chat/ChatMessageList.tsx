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
    const headerRef = useRef<HTMLDivElement | null>(null);
    const [headerHeight, setHeaderHeight] = useState<number>(0);
    const isAtBottomRef = useRef<boolean>(true);
    const lastScrollTopRef = useRef<number>(0);

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

    // Auto-scroll handler: track if user manually scrolled up
    const handleScroll = (e: UIEvent<HTMLDivElement>) => {
      const el = e.currentTarget;
      const threshold = 72; // px threshold from bottom to consider "at bottom"
      const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
      isAtBottomRef.current = distanceFromBottom <= threshold;
      lastScrollTopRef.current = el.scrollTop;
      onScroll?.(e);
    };

    // Scroll to bottom helper
    const scrollToBottom = useCallback((smooth = false) => {
      const el = parentRef.current;
      if (!el) return;
      isAtBottomRef.current = true;
      if (messages.length > 0) {
        rowVirtualizer.scrollToIndex(messages.length - 1, {
          align: 'end',
          behavior: smooth ? 'smooth' : 'auto'
        });
      }
      // Guarantee scroll reaches bottom even if dynamic elements resize
      requestAnimationFrame(() => {
        if (el) {
          el.scrollTop = el.scrollHeight;
        }
      });
    }, [messages.length, rowVirtualizer]);

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
        isAtBottom: () => isAtBottomRef.current
      }),
      [scrollToBottom, rowVirtualizer]
    );

    // Auto-scroll on new messages or incoming streaming chunks when user is at bottom
    const latestMessage = messages[messages.length - 1];
    const latestContent = latestMessage?.content;
    const isStreaming = Boolean(
      isRunning || latestMessage?.isStreaming || (latestMessage?.id === lastAssistantId && isRunning)
    );

    useLayoutEffect(() => {
      if (!isAtBottomRef.current || messages.length === 0) return;
      const el = parentRef.current;
      if (!el) return;

      const rafId = requestAnimationFrame(() => {
        if (!isAtBottomRef.current || !el) return;
        rowVirtualizer.scrollToIndex(messages.length - 1, {
          align: 'end',
          behavior: 'auto'
        });
        el.scrollTop = el.scrollHeight;
      });

      return () => cancelAnimationFrame(rafId);
    }, [messages.length, latestContent, isStreaming, rowVirtualizer]);

    const virtualItems = rowVirtualizer.getVirtualItems();

    return (
      <div
        ref={parentRef}
        onScroll={handleScroll}
        className={`chat-feed ${className || ''}`}
        style={{
          height: '100%',
          overflowY: 'auto',
          overflowX: 'hidden',
          contain: 'strict',
          position: 'relative',
          ...style
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
                    contain: 'content'
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
    );
  }
);

ChatMessageList.displayName = 'ChatMessageList';

export default ChatMessageList;
