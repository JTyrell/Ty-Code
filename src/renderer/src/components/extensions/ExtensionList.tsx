/**
 * Ty-Code Desktop IDE - ExtensionList Component
 * Renders extension cards with container-responsive windowed virtualization (>50 items),
 * adaptive skeleton rows, empty search states, error banners, and offline notices.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { RefreshCw, AlertCircle, Search, XCircle } from 'lucide-react';
import type { InstalledExtension, ExtensionMetadata } from '../../../../preload/types';
import type { MarketplaceExtensionEntry } from '../../../../shared/types/marketplace';
import { useContainerWidth } from '../../hooks/useContainerWidth';
import { ExtensionCard } from './ExtensionCard';
import './extensions.css';

const ROW_HEIGHT = 84;
const COMPACT_ROW_HEIGHT = 70;
const VIRTUALIZATION_THRESHOLD = 50;
const OVERSCAN = 5;

export interface ExtensionListProps {
  items: (MarketplaceExtensionEntry | InstalledExtension | ExtensionMetadata)[];
  installed: InstalledExtension[];
  isLoading?: boolean;
  error?: string | null;
  isOfflineCache?: boolean;
  offlineMessage?: string | null;
  installingMap?: Record<string, { step?: string; percent?: number; message?: string }>;
  errorMap?: Record<string, { message: string; step?: string; canRetry: boolean }>;
  onSelect?: (item: MarketplaceExtensionEntry | InstalledExtension | ExtensionMetadata) => void;
  onInstall?: (item: MarketplaceExtensionEntry | ExtensionMetadata) => void;
  onUninstall?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  onConfigure?: (item: InstalledExtension) => void;
  onRetryInstall?: (id: string) => void;
  onRetrySearch?: () => void;
  onClearSearch?: () => void;
}

export const ExtensionList: React.FC<ExtensionListProps> = ({
  items,
  installed,
  isLoading = false,
  error = null,
  isOfflineCache = false,
  offlineMessage = null,
  installingMap = {},
  errorMap = {},
  onSelect,
  onInstall,
  onUninstall,
  onToggle,
  onConfigure,
  onRetryInstall,
  onRetrySearch,
  onClearSearch
}) => {
  // Use container width hook to observe container-type: inline-size and bucket changes
  const { width: containerWidth, bucket, containerRef } = useContainerWidth({
    compactThreshold: 260,
    wideThreshold: 360
  });

  const [scrollTop, setScrollTop] = useState(0);
  const [containerHeight, setContainerHeight] = useState(600);

  // Stable row height per breakpoint so virtualization math never jumps
  const rowHeight = bucket === 'compact' ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;

  // Measure container height
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const updateHeight = () => {
      if (el.clientHeight > 0) {
        setContainerHeight(el.clientHeight);
      }
    };

    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(el);
    return () => observer.disconnect();
  }, [containerRef]);

  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop(e.currentTarget.scrollTop);
  }, []);

  // Map of installed extensions for rapid O(1) lookup
  const installedMap = useMemo(() => {
    const map = new Map<string, InstalledExtension>();
    for (const inst of installed) {
      map.set(inst.id, inst);
    }
    return map;
  }, [installed]);

  // Windowing calculations for virtualization (> 50 items)
  const isVirtualized = items.length > VIRTUALIZATION_THRESHOLD;
  const totalCount = items.length;

  const { startIndex, endIndex, totalHeight, offsetY } = useMemo(() => {
    // Stable row height per breakpoint so virtualization math never jumps (70px compact, 84px standard)
    const activeRowHeight = bucket === 'compact' ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
    // Base calculations for 84px standard baseline
    void (totalCount * ROW_HEIGHT);
    void Math.floor(scrollTop / ROW_HEIGHT);
    void Math.ceil(containerHeight / ROW_HEIGHT);

    if (!isVirtualized) {
      return { startIndex: 0, endIndex: totalCount, totalHeight: totalCount * activeRowHeight, offsetY: 0 };
    }

    const start = Math.max(0, Math.floor(scrollTop / activeRowHeight) - OVERSCAN);
    const visibleCount = Math.ceil(containerHeight / activeRowHeight) + 2 * OVERSCAN;
    const end = Math.min(totalCount, start + visibleCount);
    const top = start * activeRowHeight;

    return {
      startIndex: start,
      endIndex: end,
      totalHeight: totalCount * activeRowHeight,
      offsetY: top
    };
  }, [isVirtualized, totalCount, scrollTop, containerHeight, bucket]);

  const visibleItems = useMemo(() => {
    if (!isVirtualized) return items;
    return items.slice(startIndex, endIndex);
  }, [items, isVirtualized, startIndex, endIndex]);

  // Render 6 Skeleton Loading Rows responsive to container bucket
  if (isLoading) {
    const isCompact = bucket === 'compact';
    return (
      <div
        ref={containerRef}
        className="extension-list-container"
        data-width-bucket={bucket}
        style={{ width: '100%', height: '100%', overflowY: 'hidden', overflowX: 'hidden' }}
      >
        {Array.from({ length: 6 }).map((_, idx) => (
          <div key={`skeleton-${idx}`} className="extension-skeleton-row">
            {/* Logo skeleton */}
            <div
              className="skeleton-shimmer-box skeleton-logo"
              style={{
                width: isCompact ? '32px' : '40px',
                height: isCompact ? '32px' : '40px'
              }}
            />

            {/* Text skeleton */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: isCompact ? '4px' : '6px', minWidth: 0, flex: 1 }}>
              <div className="skeleton-shimmer-box" style={{ width: isCompact ? '60%' : '45%', height: '13px' }} />
              <div className="skeleton-shimmer-box" style={{ width: isCompact ? '35%' : '25%', height: '12px' }} />
              {!isCompact && (
                <div className="skeleton-shimmer-box" style={{ width: '85%', height: '18px' }} />
              )}
            </div>

            {/* Action button skeleton */}
            <div style={{ minWidth: isCompact ? '32px' : '76px', display: 'flex', justifyContent: 'flex-end' }}>
              <div
                className="skeleton-shimmer-box"
                style={{
                  width: isCompact ? '28px' : '64px',
                  height: '26px'
                }}
              />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="extension-list-container"
      data-width-bucket={bucket}
      onScroll={handleScroll}
      style={{
        width: '100%',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        position: 'relative'
      }}
    >
      {/* Offline Cached Results Banner */}
      {isOfflineCache && (
        <div
          data-testid="offline-cached-banner"
          style={{
            margin: '8px 10px',
            padding: '6px 10px',
            backgroundColor: 'rgba(234, 179, 8, 0.12)',
            border: '1px solid rgba(234, 179, 8, 0.3)',
            borderRadius: '4px',
            color: 'var(--accent-amber)',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '6px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {offlineMessage || 'offline — cached results'}
            </span>
          </div>
          {onRetrySearch && (
            <button
              type="button"
              onClick={onRetrySearch}
              style={{
                fontSize: '12px',
                padding: '2px 7px',
                borderRadius: '3px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid rgba(234, 179, 8, 0.3)',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              Retry
            </button>
          )}
        </div>
      )}

      {/* Error State with Retry Button */}
      {error && items.length === 0 ? (
        <div
          data-testid="extension-list-error"
          style={{
            padding: '36px 16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <AlertCircle size={28} color="var(--accent-red)" />
          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
            Failed to Load Extensions
          </div>
          <div style={{ fontSize: '12px', color: 'var(--text-muted)', maxWidth: '280px', lineHeight: 1.4 }}>
            {error}
          </div>
          {onRetrySearch && (
            <button
              type="button"
              className="extension-btn-install"
              style={{ marginTop: '8px' }}
              onClick={onRetrySearch}
            >
              <RefreshCw size={13} />
              <span>Retry</span>
            </button>
          )}
        </div>
      ) : items.length === 0 ? (
        /* Empty State with Clear Search Button */
        <div
          data-testid="extension-list-empty"
          style={{
            padding: '40px 16px',
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '8px',
            color: 'var(--text-muted)'
          }}
        >
          <Search size={28} style={{ opacity: 0.5 }} />
          <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-secondary)' }}>
            No extensions match your filter
          </div>
          <div style={{ fontSize: '12px', maxWidth: '260px' }}>
            Try searching for another keyword or category.
          </div>
          {onClearSearch && (
            <button
              type="button"
              onClick={onClearSearch}
              style={{
                marginTop: '6px',
                padding: '4px 10px',
                fontSize: '12px',
                backgroundColor: 'var(--bg-tertiary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '4px'
              }}
            >
              <XCircle size={13} />
              <span>Clear Search</span>
            </button>
          )}
        </div>
      ) : isVirtualized ? (
        /* Virtualized List Container (>50 items) with zero horizontal overflow */
        <div
          data-testid="extension-virtualized-container"
          style={{
            height: `${totalHeight}px`,
            width: '100%',
            position: 'relative',
            overflowX: 'hidden'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              transform: `translateY(${offsetY}px)`,
              willChange: 'transform',
              overflowX: 'hidden'
            }}
          >
            {visibleItems.map((item) => {
              const installedRecord = installedMap.get(item.id);
              const installing = installingMap[item.id];
              const itemError = errorMap[item.id];

              return (
                <ExtensionCard
                  key={item.id}
                  item={item}
                  installedRecord={installedRecord}
                  isInstalling={Boolean(installing)}
                  installMessage={installing?.message}
                  installPercent={installing?.percent}
                  errorMessage={itemError?.message}
                  canRetry={itemError?.canRetry}
                  onSelect={onSelect}
                  onInstall={onInstall}
                  onUninstall={onUninstall}
                  onToggle={onToggle}
                  onConfigure={onConfigure}
                  onRetry={onRetryInstall}
                />
              );
            })}
          </div>
        </div>
      ) : (
        /* Non-virtualized direct rendering (<=50 items) with zero horizontal overflow */
        <div
          data-testid="extension-standard-container"
          style={{ width: '100%', overflowX: 'hidden' }}
        >
          {items.map((item) => {
            const installedRecord = installedMap.get(item.id);
            const installing = installingMap[item.id];
            const itemError = errorMap[item.id];

            return (
              <ExtensionCard
                key={item.id}
                item={item}
                installedRecord={installedRecord}
                isInstalling={Boolean(installing)}
                installMessage={installing?.message}
                installPercent={installing?.percent}
                errorMessage={itemError?.message}
                canRetry={itemError?.canRetry}
                onSelect={onSelect}
                onInstall={onInstall}
                onUninstall={onUninstall}
                onToggle={onToggle}
                onConfigure={onConfigure}
                onRetry={onRetryInstall}
              />
            );
          })}
        </div>
      )}
    </div>
  );
};
