/**
 * Ty-Claude Desktop IDE - Unified AIBadge Component
 * Platform-aware AI indicator pill supporting docked (TitleBar/StatusBar)
 * and floating (top-right/bottom-right) variants with safe OS insets.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Cpu } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useUsageDashboardStore } from '../state/usage-dashboard-store';
import type { PlatformInsets } from '../../../preload/types';
import styles from './AIBadge.module.css';

export type AIBadgeVariant =
  | 'floating-top'
  | 'floating-bottom'
  | 'docked-titlebar'
  | 'docked-statusbar'
  | 'inline';

export type AIBadgeState = 'idle' | 'streaming' | 'error';

export interface AIBadgeProps {
  variant?: AIBadgeVariant;
  model?: string;
  provider?: string;
  state?: AIBadgeState;
  latency?: string;
  isStatusBarVisible?: boolean;
  windowWidth?: number;
  rightOffset?: number;
  platform?: 'win32' | 'darwin' | 'linux';
  onClick?: () => void;
  className?: string;
  id?: string;
}

export const DEFAULT_PLATFORM_INSETS: Record<'win32' | 'darwin' | 'linux', PlatformInsets> = {
  win32: {
    platform: 'win32',
    titlebarHeight: 32,
    captionButtonWidth: 138,
    trafficLightWidth: 0,
    statusBarHeight: 24,
    resizeCornerArea: 16,
    scrollbarGutter: 12
  },
  darwin: {
    platform: 'darwin',
    titlebarHeight: 32,
    captionButtonWidth: 0,
    trafficLightWidth: 78,
    statusBarHeight: 24,
    resizeCornerArea: 16,
    scrollbarGutter: 12
  },
  linux: {
    platform: 'linux',
    titlebarHeight: 32,
    captionButtonWidth: 96,
    trafficLightWidth: 0,
    statusBarHeight: 24,
    resizeCornerArea: 16,
    scrollbarGutter: 12
  }
};

/**
 * Calculates platform-safe top and right offsets for floating AI badges.
 * Guarantees zero intersection with OS caption buttons, titlebar, scrollbars, and resize corner.
 */
export function computeBadgeInsets(
  variant: AIBadgeVariant,
  platform: 'win32' | 'darwin' | 'linux',
  isStatusBarVisible = true,
  rightOffset = 0
): { top?: number; bottom?: number; right: number } {
  const insets = DEFAULT_PLATFORM_INSETS[platform];

  if (variant === 'floating-top') {
    const top = insets.titlebarHeight + 8; // 40px
    // If rightOffset (e.g. ChatSidecar width) is active, anchor to top-right of adjacent pane
    // Otherwise reserve caption-button width on Windows/Linux + gap + scrollbar gutter
    const right =
      rightOffset > 0
        ? rightOffset + 12 + insets.scrollbarGutter
        : insets.captionButtonWidth + 12 + insets.scrollbarGutter;
    return { top, right };
  }

  if (variant === 'floating-bottom') {
    // Docked into status bar right zone by default; when floating:
    // bottom = status bar height + 8px (or 16px if hidden to keep clear of resize corner)
    const baseBottom = isStatusBarVisible ? insets.statusBarHeight + 8 : 16;
    const bottom = Math.max(insets.resizeCornerArea, baseBottom);
    const right = Math.max(insets.resizeCornerArea, 12 + insets.scrollbarGutter);
    return { bottom, right };
  }

  return { right: 0 };
}

export const AIBadge: React.FC<AIBadgeProps> = ({
  variant = 'docked-statusbar',
  model: propModel,
  provider: propProvider,
  state: propState,
  latency: propLatency,
  isStatusBarVisible = true,
  windowWidth: propWindowWidth,
  rightOffset = 0,
  platform: propPlatform,
  onClick,
  className,
  id = 'ai-badge'
}) => {
  const settings = useChatStore((s) => s.settings);
  const isRunning = useChatStore((s) => s.isRunning);
  const quotaSnapshot = useUsageDashboardStore((s) => s.quotaSnapshot);
  const openDashboard = useUsageDashboardStore((s) => s.openDashboard);

  const [platformMetrics, setPlatformMetrics] = useState<PlatformInsets>(() => {
    const detectedPlatform =
      propPlatform ||
      (typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC')
        ? 'darwin'
        : typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('LINUX')
          ? 'linux'
          : 'win32');
    return DEFAULT_PLATFORM_INSETS[detectedPlatform];
  });

  const [currentWidth, setCurrentWidth] = useState<number>(() =>
    propWindowWidth !== undefined
      ? propWindowWidth
      : typeof window !== 'undefined'
        ? window.innerWidth
        : 1024
  );

  // Fetch true platform insets via IPC if available
  useEffect(() => {
    if (window.electronAPI?.getPlatformInsets) {
      void window.electronAPI.getPlatformInsets().then((res) => {
        if (res?.success && res.data) {
          setPlatformMetrics(res.data);
        }
      });
    }

    const handleResize = () => {
      setCurrentWidth(window.innerWidth);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const activeModel = propModel || settings?.activeModel || 'kilo-auto/free';
  const activeProvider = propProvider || settings?.activeProvider || 'openkilo';
  const modelShortName = activeModel.split('/').pop() || activeModel;
  const providerQuota = quotaSnapshot?.providers?.[activeProvider];
  const providerHealth = providerQuota?.healthStatus || 'untested';
  const providerHealthLabel = providerHealth.replace('_', ' ');
  const isFreeModel =
    activeModel.includes(':free') ||
    activeProvider === 'openkilo' ||
    activeProvider === 'fcc-proxy' ||
    activeProvider === 'ollama' ||
    (quotaSnapshot?.freeModeActive ?? true);

  const currentTier = useMemo(() => {
    const m = activeModel.toLowerCase();
    if (m.includes('r1') || m.includes('o1'))
      return { label: 'Tier S', name: 'Reasoning', color: '#38bdf8', bg: 'rgba(56, 189, 248, 0.15)', border: 'rgba(56, 189, 248, 0.3)' };
    if (m.includes('coder') || m.includes('code') || m.includes('sonnet') || m.includes('codellama'))
      return { label: 'Tier A', name: 'Coding', color: '#818cf8', bg: 'rgba(129, 140, 248, 0.15)', border: 'rgba(129, 140, 248, 0.3)' };
    if (m.includes('8b') || m.includes('flash') || m.includes('instant'))
      return { label: 'Tier C', name: 'Fast', color: '#fbbf24', bg: 'rgba(251, 191, 36, 0.15)', border: 'rgba(251, 191, 36, 0.3)' };
    return { label: 'Tier B', name: 'General', color: '#34d399', bg: 'rgba(52, 211, 153, 0.15)', border: 'rgba(52, 211, 153, 0.3)' };
  }, [activeModel]);

  const activeState: AIBadgeState = propState || (isRunning ? 'streaming' : 'idle');

  // Below 320px width collapse to icon-only pill
  const isNarrow = currentWidth < 320;

  // Auto-dock into titlebar flow if floating-top has insufficient space (< 500px or narrow workspace)
  const effectiveVariant: AIBadgeVariant =
    variant === 'floating-top' && (currentWidth < 500 || (rightOffset > 0 && currentWidth - rightOffset < 360))
      ? 'docked-titlebar'
      : variant;

  const isFloating = effectiveVariant === 'floating-top' || effectiveVariant === 'floating-bottom';

  const insets = useMemo(
    () =>
      computeBadgeInsets(
        effectiveVariant,
        propPlatform || platformMetrics.platform,
        isStatusBarVisible,
        rightOffset
      ),
    [effectiveVariant, propPlatform, platformMetrics.platform, isStatusBarVisible, rightOffset]
  );

  const dotClass =
    activeState === 'error' || providerHealth === 'exhausted'
      ? styles.dotError
      : providerHealth === 'untested'
        ? styles.dotIdle
        : providerHealth === 'cooling_down' || providerHealth === 'degraded'
          ? styles.dotWarning
          : activeState === 'streaming'
            ? styles.dotStreaming
            : styles.dotIdle;

  const tooltip = `AI Model: ${activeModel}\nProvider: ${activeProvider}\nProvider health: ${providerHealthLabel}\nLatency: ${propLatency || 'Not measured yet'}\nTier: ${currentTier.label} (${currentTier.name})\nFree model or mode: ${isFreeModel ? 'Yes' : 'No'}\nState: ${activeState.toUpperCase()}\nClick to open AI Orchestration Dashboard.`;

  const ariaLabel = `AI Model ${modelShortName}, ${currentTier.label}, provider ${providerHealthLabel}${isFreeModel ? ', free' : ''}, state: ${activeState}`;

  const handleClick = onClick || openDashboard;

  const badgeElement = (
    <button
      type="button"
      id={id}
      className={`${styles.badge} ${isFloating ? styles.floating : styles.docked} ${isNarrow ? styles.narrowPill : ''} ${className || ''}`}
      onClick={handleClick}
      title={tooltip}
      aria-label={ariaLabel}
      data-variant={effectiveVariant}
      data-state={activeState}
      data-provider-health={providerHealth}
      data-platform={platformMetrics.platform}
      data-narrow={isNarrow}
    >
      <div className={`${styles.statusDot} ${dotClass}`} aria-hidden="true" />
      <Cpu className={styles.icon} />
      {!isNarrow && (
        <>
          <span id="status-bar-active-model" className={styles.label}>{modelShortName}</span>
          <span
            id="status-bar-model-tier-badge"
            className={styles.tierTag}
            style={{
              backgroundColor: currentTier.bg,
              color: currentTier.color,
              border: `1px solid ${currentTier.border}`
            }}
            title={`${currentTier.label}: ${currentTier.name}`}
          >
            {currentTier.label}
          </span>
          {isFreeModel && <span id="status-bar-model-free-badge" className={styles.freeTag}>FREE</span>}
        </>
      )}
    </button>
  );

  if (isFloating) {
    return (
      <div
        className={styles.floatingWrapper}
        style={{
          top: insets.top !== undefined ? `${insets.top}px` : undefined,
          bottom: insets.bottom !== undefined ? `${insets.bottom}px` : undefined,
          right: `${insets.right}px`
        }}
        data-floating-container={effectiveVariant}
      >
        {badgeElement}
      </div>
    );
  }

  return badgeElement;
};
