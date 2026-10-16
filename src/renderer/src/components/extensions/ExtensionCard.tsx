/**
 * Ty-Code Desktop IDE - ExtensionCard Component
 * Displays a single extension item with responsive logo, 3-line metadata block,
 * WCAG AA accessible typography, and container-adaptive action column.
 */

import React from 'react';
import {
  Download,
  RefreshCw,
  CheckCircle,
  ToggleLeft,
  ToggleRight,
  Settings,
  AlertCircle
} from 'lucide-react';
import type { InstalledExtension, ExtensionMetadata } from '../../../../preload/types';
import type { MarketplaceExtensionEntry } from '../../../../shared/types/marketplace';
import { LogoWithFallback } from './LogoWithFallback';
import './extensions.css';

export interface ExtensionCardProps {
  item: MarketplaceExtensionEntry | InstalledExtension | ExtensionMetadata;
  installedRecord?: InstalledExtension;
  isInstalling?: boolean;
  installMessage?: string;
  installPercent?: number;
  errorMessage?: string;
  canRetry?: boolean;
  onSelect?: (item: MarketplaceExtensionEntry | InstalledExtension | ExtensionMetadata) => void;
  onInstall?: (item: MarketplaceExtensionEntry | ExtensionMetadata) => void;
  onUninstall?: (id: string) => void;
  onToggle?: (id: string, enabled: boolean) => void;
  onConfigure?: (item: InstalledExtension) => void;
  onRetry?: (id: string) => void;
}

/**
 * Formats numeric download count into compact human-readable representation:
 * e.g., 60816502 -> "60.8M", 3400000 -> "3.4M", 1200 -> "1.2k", 950 -> "950"
 */
export function formatDownloadCount(count?: number): string | null {
  if (count === undefined || count === null || isNaN(count) || count < 0) return null;
  if (count >= 1_000_000) {
    return `${(count / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }
  if (count >= 1_000) {
    return `${(count / 1_000).toFixed(1).replace(/\.0$/, '')}k`;
  }
  return String(count);
}

export const ExtensionCard: React.FC<ExtensionCardProps> = ({
  item,
  installedRecord,
  isInstalling = false,
  installMessage,
  installPercent,
  errorMessage,
  canRetry = false,
  onSelect,
  onInstall,
  onToggle,
  onConfigure,
  onRetry
}) => {
  // Extract normalized fields across installed and marketplace items
  const id = item.id;
  const isInstalledObj = 'manifest' in item;

  const displayName = isInstalledObj
    ? (item as InstalledExtension).manifest.displayName || (item as InstalledExtension).manifest.name
    : (item as MarketplaceExtensionEntry).displayName || (item as ExtensionMetadata).displayName || (item as ExtensionMetadata).name || id;

  const publisher = isInstalledObj
    ? (item as InstalledExtension).manifest.publisher
    : (item as MarketplaceExtensionEntry).publisher || (item as ExtensionMetadata).namespace || id.split('.')[0] || '';

  const version = isInstalledObj
    ? (item as InstalledExtension).manifest.version
    : item.version;

  const description = isInstalledObj
    ? (item as InstalledExtension).manifest.description || ''
    : (item as MarketplaceExtensionEntry).shortDescription || (item as ExtensionMetadata).description || '';

  const iconUrl = isInstalledObj
    ? (item as InstalledExtension).manifest.icon
    : item.iconUrl;

  const rawDownloadCount = isInstalledObj
    ? undefined
    : (item as MarketplaceExtensionEntry).downloadCount ?? (item as ExtensionMetadata).downloadCount;
  const formattedDownloads = formatDownloadCount(rawDownloadCount);

  const isBuiltIn = isInstalledObj ? (item as InstalledExtension).isBuiltIn : false;
  const isInstalled = Boolean(installedRecord || (item as MarketplaceExtensionEntry).installedState === 'installed');
  const isEnabled = installedRecord ? installedRecord.enabled : (item as MarketplaceExtensionEntry).enabledState === 'enabled';
  const hasSettings = Boolean(installedRecord?.manifest.contributes?.configuration?.properties);

  const installStatus = isInstalled
    ? isEnabled
      ? 'Installed and enabled'
      : 'Installed and disabled'
    : isInstalling
    ? 'Installation in progress'
    : 'Not installed';

  const cardAriaLabel = `${displayName} by ${publisher}. ${description || 'No description provided'}. Status: ${installStatus}`;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      // If uninstalled, trigger install; otherwise open detail modal
      if (!isInstalled && !isInstalling && onInstall && !isInstalledObj) {
        onInstall(item as MarketplaceExtensionEntry | ExtensionMetadata);
      } else if (onSelect) {
        onSelect(item);
      }
    }
  };

  return (
    <div
      className="extension-card"
      tabIndex={0}
      role="button"
      aria-label={cardAriaLabel}
      onClick={() => onSelect?.(item)}
      onKeyDown={handleKeyDown}
      data-testid={`extension-card-${id}`}
    >
      {/* Column 1: Responsive Logo with Fallback (40px default, 32px in compact container) */}
      <LogoWithFallback
        id={id}
        displayName={displayName}
        iconUrl={iconUrl}
        size={40}
      />

      {/* Column 2: 3-line Text Block */}
      <div className="extension-card-content">
        {/* Line 1: Name + Version Chip (hidden in compact/medium) + Built-in Badge */}
        <div className="extension-card-header">
          <span className="extension-card-title" title={displayName}>
            {displayName}
          </span>

          {version && (
            <span className="extension-version-chip" title={`Version ${version}`}>
              v{version}
            </span>
          )}

          {isBuiltIn && (
            <span className="extension-builtin-badge">
              BUILT-IN
            </span>
          )}
        </div>

        {/* Line 2: Publisher + Download Count (Full meta row at wide >360px) */}
        <div className="extension-card-meta-row">
          <span className="extension-card-publisher" title={publisher}>
            {publisher}
          </span>

          {formattedDownloads && (
            <span
              className="extension-download-count"
              title={`${rawDownloadCount?.toLocaleString()} downloads`}
            >
              <Download size={11} style={{ opacity: 0.8 }} />
              <span>{formattedDownloads}</span>
            </span>
          )}
        </div>

        {/* Line 3: Description Clamped to 2 lines (1 line in compact container) */}
        <div className="extension-card-desc" title={description}>
          {description || 'No description provided.'}
        </div>
      </div>

      {/* Column 3: Fixed Min-Width (76px, collapses to icon-only at <260px) */}
      <div className="extension-card-action" onClick={(e) => e.stopPropagation()}>
        {isInstalling ? (
          /* Installing spinner with download progress bar */
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: '3px',
              fontSize: '11px',
              color: 'var(--accent-primary)',
              whiteSpace: 'nowrap'
            }}
            title={installMessage || 'Installing…'}
            aria-label={`Installing ${displayName}`}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
              <RefreshCw size={12} className="animate-spin" />
              <span className="extension-installing-text">
                {installPercent !== undefined ? `${installPercent}%` : 'Installing'}
              </span>
            </div>
            {/* Progress Bar Track and Fill */}
            <div
              className="extension-progress-bar-track"
              style={{
                width: '64px',
                height: '4px',
                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                borderRadius: '2px',
                overflow: 'hidden'
              }}
            >
              <div
                className="extension-progress-bar-fill"
                style={{
                  width: `${Math.max(5, Math.min(100, installPercent ?? 20))}%`,
                  height: '100%',
                  backgroundColor: 'var(--accent-primary)',
                  borderRadius: '2px',
                  transition: 'width 0.2s ease'
                }}
              />
            </div>
          </div>
        ) : errorMessage ? (
          /* Error state with Retry button */
          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
            <span
              className="extension-failed-text"
              style={{ fontSize: '12px', color: 'var(--accent-red)' }}
              title={errorMessage}
            >
              Failed
            </span>
            {canRetry && (
              <button
                type="button"
                className="extension-btn-retry"
                onClick={() => onRetry?.(id)}
                title="Retry Installation"
                aria-label={`Retry installing ${displayName}`}
              >
                <RefreshCw size={12} />
                <span>Retry</span>
              </button>
            )}
          </div>
        ) : isInstalled ? (
          /* Installed checkmark + settings + enable toggle */
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            {hasSettings && installedRecord && (
              <button
                type="button"
                onClick={() => onConfigure?.(installedRecord)}
                style={{
                  padding: '4px',
                  borderRadius: '3px',
                  color: 'var(--text-secondary)',
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer'
                }}
                title="Configure Settings"
                aria-label={`Configure ${displayName}`}
              >
                <Settings size={14} />
              </button>
            )}

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                color: 'var(--accent-green)',
                marginRight: '2px'
              }}
              title="Extension Installed"
              aria-label="Extension Installed"
            >
              <CheckCircle size={15} />
            </div>

            <button
              type="button"
              onClick={() => onToggle?.(id, !isEnabled)}
              style={{
                padding: '1px',
                color: isEnabled ? 'var(--accent-green)' : 'var(--text-muted)',
                cursor: 'pointer',
                background: 'none',
                border: 'none',
                display: 'flex',
                alignItems: 'center'
              }}
              title={isEnabled ? 'Click to Disable' : 'Click to Enable'}
              aria-label={isEnabled ? `Disable ${displayName}` : `Enable ${displayName}`}
            >
              {isEnabled ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
            </button>
          </div>
        ) : (
          /* Uninstalled: Install Button (Collapses to icon-only in compact container) */
          <button
            type="button"
            className="extension-btn-install"
            onClick={() => onInstall?.(item as MarketplaceExtensionEntry | ExtensionMetadata)}
            aria-label={`Install ${displayName}`}
            title={`Install ${displayName}`}
          >
            <Download size={13} />
            <span>Install</span>
          </button>
        )}
      </div>
    </div>
  );
};
