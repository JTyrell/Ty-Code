/**
 * Ty-Code Desktop IDE - ExtensionWidthSimulator Component
 * Dev tool and preview simulator for container-responsive extension cards.
 * Enables live testing across all 3 container width buckets:
 * - Compact (<260px, e.g. 220px)
 * - Medium (260px - 360px, e.g. 300px)
 * - Wide (>360px, e.g. 420px, 600px, 800px)
 */

import React, { useState } from 'react';
import { Sliders, Maximize2, Monitor, Smartphone, Tablet, X } from 'lucide-react';
import type { InstalledExtension } from '../../../../preload/types';
import type { MarketplaceExtensionEntry } from '../../../../shared/types/marketplace';
import { ExtensionList } from './ExtensionList';
import { getWidthBucket, type WidthBucket } from '../../hooks/useContainerWidth';

// Sample mock extensions to validate all visual states and breakpoints
const MOCK_EXTENSIONS: (MarketplaceExtensionEntry | InstalledExtension)[] = [
  {
    id: 'ms-python.python',
    namespace: 'ms-python',
    name: 'python',
    displayName: 'Python',
    shortDescription: 'Python language support with extension intelligence, linting, debugging, code formatting, refactoring, and unit tests.',
    version: '2026.4.0',
    downloadCount: 60816502,
    publisher: 'ms-python',
    iconUrl: 'https://open-vsx.org/api/ms-python/python/2026.4.0/file/icon.png',
    installedState: 'uninstalled',
    enabledState: 'disabled'
  },
  {
    id: 'rust-lang.rust-analyzer',
    namespace: 'rust-lang',
    name: 'rust-analyzer',
    displayName: 'rust-analyzer',
    shortDescription: 'An alternative frontend for the Rust compiler with rich language support, inlay hints, and semantic tokens.',
    version: '0.4.1950',
    downloadCount: 4200000,
    publisher: 'rust-lang',
    installedState: 'installed',
    enabledState: 'enabled'
  },
  {
    id: 'esbenp.prettier-vscode',
    namespace: 'esbenp',
    name: 'prettier-vscode',
    displayName: 'Prettier - Code Formatter',
    shortDescription: 'Code formatter using prettier for JavaScript, TypeScript, CSS, HTML, Vue, JSON, and Markdown.',
    version: '11.0.0',
    downloadCount: 38500000,
    publisher: 'esbenp',
    installedState: 'installed',
    enabledState: 'disabled'
  },
  {
    id: 'community.sqlite-viewer',
    namespace: 'community',
    name: 'sqlite-viewer',
    displayName: 'SQLite Viewer with Extremely Long Display Name for Truncation Testing Across All Breakpoints',
    shortDescription: 'Explore SQLite databases with live tabular viewing, filtering, sorting, SQL query execution, and CSV export capabilities.',
    version: '1.2.3',
    downloadCount: 1250,
    publisher: 'community-dev',
    installedState: 'uninstalled',
    enabledState: 'disabled'
  }
];

export interface ExtensionWidthSimulatorProps {
  onClose?: () => void;
}

export const ExtensionWidthSimulator: React.FC<ExtensionWidthSimulatorProps> = ({ onClose }) => {
  const [simulatedWidth, setSimulatedWidth] = useState<number>(300);
  const bucket: WidthBucket = getWidthBucket(simulatedWidth);

  const presets = [
    { label: 'Compact', testId: 'simulator-preset-compact', width: 220, icon: Smartphone, desc: '< 260px' },
    { label: 'Medium', testId: 'simulator-preset-medium', width: 310, icon: Tablet, desc: '260 - 360px' },
    { label: 'Wide', testId: 'simulator-preset-wide', width: 440, icon: Monitor, desc: '> 360px' },
    { label: 'Max Sidecar', testId: 'simulator-preset-max-sidecar', width: 800, icon: Maximize2, desc: '800px' }
  ];

  const bucketBadgeColors: Record<WidthBucket, { bg: string; text: string; border: string }> = {
    compact: { bg: 'rgba(234, 179, 8, 0.15)', text: '#eab308', border: 'rgba(234, 179, 8, 0.3)' },
    medium: { bg: 'rgba(139, 92, 246, 0.15)', text: '#a78bfa', border: 'rgba(139, 92, 246, 0.3)' },
    wide: { bg: 'rgba(16, 185, 129, 0.15)', text: '#34d399', border: 'rgba(16, 185, 129, 0.3)' }
  };

  return (
    <div
      data-testid="extension-width-simulator"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        width: '100%',
        backgroundColor: 'var(--bg-secondary)',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      {/* Simulator Control Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-primary)',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sliders size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Container Width Simulator
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span
              data-testid="simulator-bucket-badge"
              style={{
                fontSize: '11px',
                fontWeight: 600,
                padding: '2px 8px',
                borderRadius: '12px',
                backgroundColor: bucketBadgeColors[bucket].bg,
                color: bucketBadgeColors[bucket].text,
                border: `1px solid ${bucketBadgeColors[bucket].border}`,
                textTransform: 'uppercase',
                letterSpacing: '0.5px'
              }}
            >
              {bucket} ({simulatedWidth}px)
            </span>

            {onClose && (
              <button
                type="button"
                onClick={onClose}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '2px'
                }}
                title="Close Simulator"
                aria-label="Close Simulator"
              >
                <X size={16} />
              </button>
            )}
          </div>
        </div>

        {/* Preset Buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {presets.map((preset) => {
            const isSelected = simulatedWidth === preset.width;
            const Icon = preset.icon;
            return (
              <button
                key={preset.label}
                type="button"
                data-testid={preset.testId}
                onClick={() => setSimulatedWidth(preset.width)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  padding: '5px 8px',
                  fontSize: '11px',
                  fontWeight: isSelected ? 600 : 500,
                  borderRadius: '4px',
                  backgroundColor: isSelected ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: isSelected ? '#ffffff' : 'var(--text-secondary)',
                  border: isSelected ? '1px solid var(--accent-primary)' : '1px solid var(--border-subtle)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Icon size={12} />
                <span>{preset.label}</span>
                <span style={{ fontSize: '10px', opacity: 0.75 }}>({preset.width}px)</span>
              </button>
            );
          })}
        </div>

        {/* Continuous Width Slider (200px - 800px) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '40px' }}>200px</span>
          <input
            type="range"
            min={200}
            max={800}
            value={simulatedWidth}
            onChange={(e) => setSimulatedWidth(Number(e.target.value))}
            style={{
              flex: 1,
              accentColor: 'var(--accent-primary)',
              cursor: 'ew-resize',
              height: '4px'
            }}
            aria-label="Container simulated width"
          />
          <span style={{ fontSize: '11px', color: 'var(--text-muted)', minWidth: '40px', textAlign: 'right' }}>800px</span>
        </div>
      </div>

      {/* Simulated Preview Box */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: '16px',
          display: 'flex',
          justifyContent: 'center',
          backgroundColor: 'var(--bg-tertiary)'
        }}
      >
        <div
          data-testid="simulator-container-frame"
          style={{
            width: `${simulatedWidth}px`,
            maxWidth: '100%',
            height: '100%',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '6px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.35)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            transition: 'width 0.1s ease-out'
          }}
        >
          {/* Header inside frame */}
          <div
            style={{
              padding: '6px 10px',
              backgroundColor: 'var(--bg-primary)',
              borderBottom: '1px solid var(--border-subtle)',
              fontSize: '11px',
              color: 'var(--text-muted)',
              display: 'flex',
              justifyContent: 'space-between'
            }}
          >
            <span>Container: {simulatedWidth}px</span>
            <span>Bucket: {bucket.toUpperCase()}</span>
          </div>

          {/* Embedded ExtensionList running live in simulated container */}
          <div style={{ flex: 1, overflow: 'hidden' }}>
            <ExtensionList
              items={MOCK_EXTENSIONS}
              installed={MOCK_EXTENSIONS.filter(e => 'manifest' in e) as InstalledExtension[]}
              onSelect={() => {}}
              onInstall={() => {}}
              onToggle={() => {}}
            />
          </div>
        </div>
      </div>
    </div>
  );
};
