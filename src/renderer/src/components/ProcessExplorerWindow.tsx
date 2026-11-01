/**
 * Process Explorer panel — the renderer half of Help > Open Process Explorer.
 *
 * Prompt 5b, Step 5 group G3: "main, per-window renderers, workers, FCC
 * sidecar, PTYs with PID + RSS; local-only". The panel owns no data of its own.
 * Everything on screen came over one IPC channel from
 * `main/services/process-explorer-service.ts`, which is where the kind labels,
 * the ordering and the honesty about unmeasurable memory are decided. This file
 * renders that and adds exactly two behaviours: polling and sorting.
 *
 * Two properties are load-bearing.
 *
 *  - **The poll is a chain, not an interval.** Each read is scheduled only after
 *    the previous one settles, so a slow platform memory read stretches the
 *    cadence instead of stacking reads on top of each other — which on Windows
 *    means spawning `Get-Process` per read, i.e. the diagnostics panel becoming
 *    one of the processes it is measuring. Clearing the timeout on unmount is
 *    the whole unsubscribe story; there is no main-side timer to stop.
 *  - **Rows never disappear because measuring them failed.** A process with no
 *    readable working set still renders, with a dash. The alternative — dropping
 *    it — hides exactly the runaway shell the user opened this panel to find.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Activity, AlertTriangle, Copy, Pause, Play, RefreshCw } from 'lucide-react';
import type { ProcessExplorerSnapshot, ProcessRow } from '../../../preload/types';
import { useThemeSync } from '../hooks/useThemeSync';
import { copyTextOrNotify } from '../lib/clipboard';
import {
  MISSING_VALUE,
  PROCESS_KIND_LABELS,
  formatAge,
  formatClock,
  formatCpuPercent,
  formatKibibytes,
  nextProcessSort,
  snapshotToTsv,
  sortProcessRows,
  type ProcessSort,
  type ProcessSortKey
} from '../lib/process-explorer-format';

/**
 * Two seconds.
 *
 * Fast enough that a leak is visibly climbing, slow enough that the platform
 * read for external pids — a spawned helper process on both Windows and POSIX —
 * is not the busiest thing on the machine. There is deliberately no
 * user-facing cadence control: a slower setting would make the panel lie about
 * freshness, and a faster one would cost more than it shows.
 */
const REFRESH_INTERVAL_MS = 2_000;

const appRegion = (region: 'drag' | 'no-drag'): React.CSSProperties =>
  ({ WebkitAppRegion: region } as React.CSSProperties);

// Native caption glyphs, matching the debugger and canvas popouts. Drawn rather
// than taken from the icon set because caption buttons are 10x10 device pixels
// on Windows and a scaled 16px icon looks soft next to the real ones.
const MinimizeGlyph: React.FC = () => (
  <svg width="10" height="1" viewBox="0 0 10 1" fill="currentColor">
    <rect width="10" height="1" fill="currentColor" />
  </svg>
);

const MaximizeGlyph: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <rect x="0.5" y="0.5" width="9" height="9" />
  </svg>
);

const RestoreGlyph: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
    <path d="M2.5 0.5 h 7 v 7 h -1" />
    <rect x="0.5" y="2.5" width="7" height="7" />
  </svg>
);

const CloseGlyph: React.FC = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" stroke="currentColor" strokeWidth="1.2">
    <line x1="1" y1="1" x2="9" y2="9" />
    <line x1="9" y1="1" x2="1" y2="9" />
  </svg>
);

interface CaptionButtonProps {
  onClick: () => void;
  title: string;
  isClose?: boolean;
  children: React.ReactNode;
}

const CaptionButton: React.FC<CaptionButtonProps> = ({ onClick, title, isClose, children }) => {
  const [hovered, setHovered] = useState(false);

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      title={title}
      aria-label={title}
      style={{
        width: '46px',
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: isClose ? (hovered ? '#e81123' : 'transparent') : hovered ? 'var(--surface-2)' : 'transparent',
        color: isClose && hovered ? '#ffffff' : 'var(--text-secondary)',
        border: 'none',
        outline: 'none',
        cursor: 'default',
        padding: 0,
        transition: 'background-color 100ms ease, color 100ms ease',
        ...appRegion('no-drag')
      }}
    >
      {children}
    </button>
  );
};

interface ToolButtonProps {
  onClick: () => void;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}

const ToolButton: React.FC<ToolButtonProps> = ({ onClick, title, disabled, children }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    title={title}
    aria-label={title}
    style={{
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'center',
      gap: '5px',
      padding: '3px 9px',
      borderRadius: '5px',
      fontSize: '11px',
      fontWeight: 500,
      color: disabled ? 'var(--text-muted)' : 'var(--text-secondary)',
      background: 'var(--surface-2)',
      border: '1px solid var(--border-subtle)',
      cursor: disabled ? 'default' : 'pointer',
      whiteSpace: 'nowrap',
      opacity: disabled ? 0.6 : 1,
      transition: 'all 120ms ease',
      ...appRegion('no-drag')
    }}
  >
    {children}
  </button>
);

const COLUMNS: Array<{ key: ProcessSortKey | null; label: string; align: 'left' | 'right'; width?: string }> = [
  { key: 'name', label: 'Process', align: 'left' },
  { key: 'kind', label: 'Kind', align: 'left', width: '110px' },
  { key: 'pid', label: 'PID', align: 'right', width: '86px' },
  { key: 'memory', label: 'Memory', align: 'right', width: '104px' },
  { key: null, label: 'CPU', align: 'right', width: '72px' },
  { key: null, label: 'Detail', align: 'left' }
];

export const ProcessExplorerWindow: React.FC = () => {
  useThemeSync();

  const [snapshot, setSnapshot] = useState<ProcessExplorerSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bridgeMissing, setBridgeMissing] = useState(false);
  const [paused, setPaused] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [sort, setSort] = useState<ProcessSort | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);

  const isMac = typeof navigator !== 'undefined' && /macintosh|mac os x/i.test(navigator.userAgent);

  useEffect(() => {
    window.electronAPI?.isWindowMaximized?.().then(setIsMaximized).catch(() => {});
    const unsubscribe = window.electronAPI?.onWindowMaximizeChange?.((max: boolean) => {
      setIsMaximized(max);
    });
    return () => {
      unsubscribe?.();
    };
  }, []);

  useEffect(() => {
    // Read the bridge inside the effect rather than at render so the dependency
    // list stays `[paused, refreshNonce]`. `window.electronAPI` is installed
    // before the bundle runs and never changes identity, so putting the method
    // reference in the deps would only risk tearing down a live poll chain.
    const list = window.electronAPI?.processExplorerList;
    if (typeof list !== 'function') {
      // An older preload, or a build where the channel was never registered.
      // Say so plainly: a spinner that never resolves reads as a hang.
      setBridgeMissing(true);
      return;
    }
    setBridgeMissing(false);
    if (paused) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async (): Promise<void> => {
      try {
        const result = await list({ includeMemory: true });
        if (cancelled) return;
        if (result.success && result.data) {
          setSnapshot(result.data);
          setError(null);
        } else {
          // Keep the last good snapshot on screen. A failed read is worth
          // reporting but not worth blanking a table the user is reading.
          setError(result.error || 'The process snapshot came back empty.');
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'The process snapshot could not be read.');
        }
      } finally {
        if (!cancelled) {
          timer = setTimeout(() => {
            void tick();
          }, REFRESH_INTERVAL_MS);
        }
      }
    };

    void tick();

    return () => {
      cancelled = true;
      if (timer !== null) clearTimeout(timer);
    };
  }, [paused, refreshNonce]);

  const rows = useMemo<ProcessRow[]>(
    () => (snapshot ? sortProcessRows(snapshot.rows, sort) : []),
    [snapshot, sort]
  );

  const onCopy = (): void => {
    if (!snapshot) return;
    // Prompt 3's shared pipeline, not a local `navigator.clipboard` call: it
    // falls back to main when the async API is unavailable and routes failures
    // through the retryable toast every other copy surface uses.
    void copyTextOrNotify(snapshotToTsv(snapshot), 'process-explorer');
  };

  const capturedLabel = snapshot
    ? paused
      ? `Paused at ${formatClock(snapshot.capturedAt)}`
      : `${formatClock(snapshot.capturedAt)} · ${formatAge(snapshot.capturedAt, Date.now())}`
    : 'Reading…';

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        userSelect: 'none'
      }}
    >
      <header
        style={{
          height: '35px',
          minHeight: '35px',
          boxSizing: 'border-box',
          backgroundColor: 'var(--bg-secondary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingLeft: isMac ? '76px' : '12px',
          paddingRight: 0,
          flexShrink: 0,
          ...appRegion('drag')
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '8px', minWidth: 0 }}>
          <div
            style={{
              width: '20px',
              height: '20px',
              borderRadius: '5px',
              background: 'linear-gradient(135deg, rgba(99, 102, 241, 0.3) 0%, rgba(168, 85, 247, 0.22) 100%)',
              border: '1px solid rgba(129, 140, 248, 0.45)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#a5b4fc',
              flexShrink: 0
            }}
          >
            <Activity size={12} />
          </div>
          <span style={{ fontSize: '12px', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <span style={{ color: 'var(--accent-primary)', fontWeight: 700 }}>Ty-Code</span>
            <span style={{ color: 'var(--text-muted)', margin: '0 5px' }}>•</span>
            Process Explorer
          </span>
          <span
            style={{
              fontSize: '10px',
              fontFamily: 'monospace',
              color: paused ? 'var(--text-muted)' : 'var(--text-secondary)',
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            title="When this reading was taken. A process listed here may already have exited."
          >
            {bridgeMissing ? 'Unavailable' : capturedLabel}
          </span>
        </div>

        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: '100%', flexShrink: 0 }}>
          <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '6px', marginRight: '10px' }}>
            <ToolButton
              onClick={() => setPaused((p) => !p)}
              title={paused ? 'Resume automatic refresh' : 'Pause automatic refresh'}
            >
              {paused ? <Play size={12} /> : <Pause size={12} />}
              <span>{paused ? 'Resume' : 'Pause'}</span>
            </ToolButton>
            <ToolButton
              onClick={() => setRefreshNonce((n) => n + 1)}
              title="Read the process list again now"
              disabled={bridgeMissing}
            >
              <RefreshCw size={12} />
              <span>Refresh</span>
            </ToolButton>
            <ToolButton onClick={onCopy} title="Copy the table as tab-separated text" disabled={!snapshot}>
              <Copy size={12} />
              <span>Copy</span>
            </ToolButton>
          </div>

          {!isMac && (
            <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', height: '100%', ...appRegion('no-drag') }}>
              <CaptionButton onClick={() => window.electronAPI?.minimizeWindow?.()} title="Minimize">
                <MinimizeGlyph />
              </CaptionButton>
              <CaptionButton
                onClick={() => window.electronAPI?.maximizeWindow?.()}
                title={isMaximized ? 'Restore Down' : 'Maximize'}
              >
                {isMaximized ? <RestoreGlyph /> : <MaximizeGlyph />}
              </CaptionButton>
              {/* `window:close` resolves through `fromWebContents(event.sender)` in
                  main, so this closes the panel itself and not the window that
                  opened it. No dedicated channel was needed. */}
              <CaptionButton onClick={() => window.electronAPI?.closeWindow?.()} title="Close" isClose>
                <CloseGlyph />
              </CaptionButton>
            </div>
          )}
        </div>
      </header>

      {bridgeMissing && (
        <Banner tone="warn">
          Process metrics are unavailable in this build. The panel needs the process-explorer
          channel in the preload bridge.
        </Banner>
      )}

      {!bridgeMissing && error && <Banner tone="error">{error}</Banner>}

      {/* Shown verbatim, never paraphrased. The service sets it when part of the
          reading is missing, and rewriting it here would lose the specific cause
          — which source threw, how many rows failed validation. */}
      {snapshot?.notice && <Banner tone="warn">{snapshot.notice}</Banner>}

      <div style={{ flex: 1, overflow: 'auto', userSelect: 'text' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11.5px' }}>
          <thead>
            <tr>
              {COLUMNS.map((column) => {
                const isSorted = sort !== null && sort.key === column.key;
                return (
                  <th
                    key={column.label}
                    onClick={
                      column.key === null
                        ? undefined
                        : () => setSort((current) => nextProcessSort(current, column.key as ProcessSortKey))
                    }
                    title={
                      column.key === null
                        ? undefined
                        : isSorted
                        ? 'Click to reverse the sort order'
                        : 'Click to sort by this column'
                    }
                    style={{
                      position: 'sticky',
                      top: 0,
                      zIndex: 1,
                      textAlign: column.align,
                      padding: '7px 10px',
                      width: column.width,
                      backgroundColor: 'var(--bg-secondary)',
                      borderBottom: '1px solid var(--border-subtle)',
                      color: isSorted ? 'var(--accent-primary)' : 'var(--text-secondary)',
                      fontSize: '10px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      cursor: column.key === null ? 'default' : 'pointer',
                      whiteSpace: 'nowrap',
                      userSelect: 'none'
                    }}
                  >
                    {column.label}
                    {isSorted ? (sort.descending ? ' ↓' : ' ↑') : ''}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.kind}:${row.pid}`} title={row.detail || row.name}>
                <td style={cellStyle('left')}>
                  <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{row.name}</span>
                  {typeof row.windowId === 'number' && (
                    <span style={{ marginLeft: '6px', color: 'var(--text-muted)', fontFamily: 'monospace', fontSize: '10px' }}>
                      window {row.windowId}
                    </span>
                  )}
                </td>
                <td style={cellStyle('left')}>
                  <span
                    style={{
                      fontSize: '9.5px',
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      padding: '1px 6px',
                      borderRadius: '4px',
                      background: 'var(--surface-2)',
                      border: '1px solid var(--border-subtle)',
                      color: 'var(--text-secondary)',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {PROCESS_KIND_LABELS[row.kind] ?? row.kind}
                  </span>
                </td>
                <td style={{ ...cellStyle('right'), fontFamily: 'monospace' }}>{row.pid}</td>
                <td
                  style={{
                    ...cellStyle('right'),
                    fontFamily: 'monospace',
                    // Unmeasured renders as a dash, not a zero: the row is still
                    // listed because hiding it would hide the leak.
                    color: typeof row.memoryKb === 'number' ? 'var(--text-primary)' : 'var(--text-muted)'
                  }}
                >
                  {formatKibibytes(row.memoryKb)}
                </td>
                <td style={{ ...cellStyle('right'), fontFamily: 'monospace', color: 'var(--text-secondary)' }}>
                  {formatCpuPercent(row.cpuPercent)}
                </td>
                <td
                  style={{
                    ...cellStyle('left'),
                    color: 'var(--text-muted)',
                    fontFamily: 'monospace',
                    fontSize: '10.5px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: 0
                  }}
                >
                  {row.detail || MISSING_VALUE}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!bridgeMissing && rows.length === 0 && (
          <div
            style={{
              padding: '48px 24px',
              textAlign: 'center',
              color: 'var(--text-secondary)',
              fontSize: '12px'
            }}
          >
            {error ? 'Waiting for a readable snapshot…' : 'No processes reported yet.'}
          </div>
        )}
      </div>

      <footer
        style={{
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '6px 12px',
          borderTop: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-secondary)',
          fontSize: '10.5px',
          color: 'var(--text-secondary)'
        }}
      >
        <span style={{ fontFamily: 'monospace' }}>
          {rows.length} {rows.length === 1 ? 'process' : 'processes'}
          {snapshot ? ` · ${formatKibibytes(snapshot.totalMemoryKb)} measured` : ''}
        </span>
        {/* The total covers only the rows that reported a size, so labelling it
            "total" without qualification would overstate completeness on any
            machine where a shell or the sidecar could not be read. */}
        <span style={{ color: 'var(--text-muted)' }}>
          {snapshot ? `Scope: ${snapshot.scope} machine only` : 'Scope: local machine only'}
        </span>
      </footer>
    </div>
  );
};

const cellStyle = (align: 'left' | 'right'): React.CSSProperties => ({
  textAlign: align,
  padding: '5px 10px',
  borderBottom: '1px solid var(--border-subtle)',
  verticalAlign: 'middle'
});

interface BannerProps {
  tone: 'warn' | 'error';
  children: React.ReactNode;
}

const Banner: React.FC<BannerProps> = ({ tone, children }) => (
  <div
    role="status"
    style={{
      flexShrink: 0,
      display: 'flex',
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: '8px',
      padding: '7px 12px',
      fontSize: '11px',
      lineHeight: 1.45,
      userSelect: 'text',
      color: tone === 'error' ? '#fca5a5' : '#fcd34d',
      background: tone === 'error' ? 'rgba(239, 68, 68, 0.12)' : 'rgba(245, 158, 11, 0.12)',
      borderBottom: `1px solid ${tone === 'error' ? 'rgba(239, 68, 68, 0.35)' : 'rgba(245, 158, 11, 0.35)'}`
    }}
  >
    <AlertTriangle size={13} style={{ flexShrink: 0, marginTop: '1px' }} />
    <span>{children}</span>
  </div>
);
