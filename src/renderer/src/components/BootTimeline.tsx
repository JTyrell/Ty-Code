import React, { useEffect, useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  Activity,
  AlertTriangle,
  Clock,
  Copy,
  Download,
  Flame,
  Layers,
  RefreshCw,
  X,
  Zap
} from 'lucide-react';
import type { BootTrace, OffenderItem, PerfMark, TransitionMetric } from '../../../shared/types/perf';
import { transitionProfiler } from '../services/perf/transition-profiler';
import styles from './BootTimeline.module.css';

/* ---------------------------------------------------------------------------
 * Hover help tip: 2.5s delay before showing, 7s auto fade, instant hide when
 * the cursor leaves the target. Rendered through a portal with fixed
 * coordinates so it never clips inside scroll containers. Text wraps hard and
 * never bleeds past its boundary.
 * ------------------------------------------------------------------------- */
interface InfoTipProps {
  text: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}

const INFO_TIP_MAX_WIDTH = 280;

const InfoTip: React.FC<InfoTipProps> = ({ text, children, style }) => {
  const [visible, setVisible] = useState(false);
  const [placement, setPlacement] = useState<{ x: number; y: number; above: boolean }>({ x: 0, y: 0, above: true });
  const showTimerRef = useRef<number | null>(null);
  const autoHideTimerRef = useRef<number | null>(null);
  const anchorRef = useRef<HTMLSpanElement>(null);

  const clearTimers = () => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
    if (autoHideTimerRef.current !== null) {
      window.clearTimeout(autoHideTimerRef.current);
      autoHideTimerRef.current = null;
    }
  };

  const handleMouseEnter = () => {
    clearTimers();
    showTimerRef.current = window.setTimeout(() => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const halfWidth = INFO_TIP_MAX_WIDTH / 2;
      const x = Math.max(8, Math.min(rect.left + rect.width / 2 - halfWidth, window.innerWidth - INFO_TIP_MAX_WIDTH - 8));
      const roomAbove = rect.top > 130;
      setPlacement({
        x,
        above: roomAbove,
        y: roomAbove ? rect.top - 8 : rect.bottom + 8
      });
      setVisible(true);
      autoHideTimerRef.current = window.setTimeout(() => {
        setVisible(false);
        autoHideTimerRef.current = null;
      }, 7000);
    }, 2500);
  };

  const handleMouseLeave = () => {
    clearTimers();
    setVisible(false);
  };

  useEffect(() => clearTimers, []);

  return (
    <span
      ref={anchorRef}
      style={{ ...style, cursor: 'help' }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
      {visible &&
        createPortal(
          <div
            role="tooltip"
            style={{
              position: 'fixed',
              left: placement.x,
              top: placement.y,
              transform: 'translateX(-50%)',
              width: INFO_TIP_MAX_WIDTH,
              maxWidth: INFO_TIP_MAX_WIDTH,
              boxSizing: 'border-box',
              padding: '8px 10px',
              borderRadius: 6,
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-default)',
              boxShadow: '0 6px 18px rgba(0, 0, 0, 0.35)',
              color: 'var(--text-primary)',
              fontFamily: "var(--font-sans, 'Segoe UI', system-ui, sans-serif)",
              fontSize: 11.5,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
              overflow: 'hidden',
              zIndex: 'var(--layer-menu)',
              animation: 'perfTipIn 120ms ease-out',
              pointerEvents: 'none'
            }}
          >
            {text}
          </div>,
          document.body
        )}
    </span>
  );
};

interface BootTimelineProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'waterfall' | 'offenders' | 'transitions' | 'sync_io';

// Succinct hover help copy for every data point (plain English, no dashes)
const CATEGORY_TIPS: Record<string, string> = {
  sync_io: 'A blocking file or system call that froze the main thread during boot.',
  eager_import: 'A module parsed at startup instead of loaded only when needed.',
  network_wait: 'Boot paused while waiting for a network response.',
  process_spawn: 'Time spent launching a helper process.',
  render_storm: 'Many re-renders fired in a short burst.'
};

export const BootTimeline: React.FC<BootTimelineProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<TabKey>('offenders');
  const [trace, setTrace] = useState<BootTrace | null>(null);
  const [liveTransitions, setLiveTransitions] = useState<TransitionMetric[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState(false);

  const loadTrace = useCallback(async () => {
    setIsLoading(true);
    try {
      if (window.electronAPI?.perfGetBootTrace) {
        const res = await window.electronAPI.perfGetBootTrace();
        if (res.success && res.data) {
          setTrace(res.data);
        }
      }
      setLiveTransitions(transitionProfiler.getCompletedTransitions());
    } catch (err) {
      console.error('[BootTimeline] Failed to load boot trace:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      void loadTrace();
      const unsub = transitionProfiler.onTransitionComplete((metric) => {
        setLiveTransitions((prev) => [metric, ...prev]);
      });
      return () => unsub();
    }
    return undefined;
  }, [isOpen, loadTrace]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isOpen && e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopyTrace = async () => {
    if (!trace) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(trace, null, 2));
      setCopyFeedback(true);
      setTimeout(() => setCopyFeedback(false), 2000);
    } catch {
      // ignore clipboard error
    }
  };

  if (!isOpen) return null;

  const totalBootMs = trace?.totalBootMs || 0;
  const topOffenders: OffenderItem[] = trace?.topOffenders || [];
  const marks: PerfMark[] = trace?.marks || [];
  const syncIoCalls = trace?.syncIoCalls || [];
  const importCosts = trace?.importCosts || [];
  const gapWarnings = trace?.gapWarnings || [];

  const getBarColor = (mark: PerfMark): string => {
    if (mark.category === 'sync_io') return 'var(--accent-red)';
    if (mark.category === 'eager_import') return 'var(--accent-amber)';
    if (mark.category === 'network_wait') return 'var(--accent-blue)';
    if (mark.category === 'process_spawn') return 'var(--accent-primary)';
    if (mark.category === 'render_storm') return 'var(--accent-primary-hover)';
    return 'var(--accent-cyan)';
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Zap size={20} color="var(--accent-cyan)" />
            <h2>Boot & Transition Profiler</h2>
            <InfoTip text="Total time from process start until all services were ready, in milliseconds.">
              <span className={styles.bootBadge}>{totalBootMs.toFixed(1)} ms total</span>
            </InfoTip>
          </div>
          <div className={styles.headerActions}>
            <button
              className={styles.btnAction}
              onClick={() => void loadTrace()}
              title="Refresh performance metrics"
              disabled={isLoading}
            >
              <RefreshCw size={13} className={isLoading ? 'spin' : ''} />
              <span>Refresh</span>
            </button>
            <button
              className={styles.btnAction}
              onClick={() => void handleCopyTrace()}
              title="Copy JSON Trace to clipboard"
            >
              <Copy size={13} />
              <span>{copyFeedback ? 'Copied!' : 'Copy JSON'}</span>
            </button>
            <button className={styles.btnClose} onClick={onClose} aria-label="Close dialog">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className={styles.tabBar}>
          <button
            className={`${styles.tabButton} ${activeTab === 'offenders' ? styles.active : ''}`}
            onClick={() => setActiveTab('offenders')}
          >
            <Flame size={14} />
            <span>Top 10 Offenders ({topOffenders.length})</span>
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'waterfall' ? styles.active : ''}`}
            onClick={() => setActiveTab('waterfall')}
          >
            <Activity size={14} />
            <span>Waterfall Timeline ({marks.length})</span>
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'transitions' ? styles.active : ''}`}
            onClick={() => setActiveTab('transitions')}
          >
            <Clock size={14} />
            <span>UI Transitions ({liveTransitions.length})</span>
          </button>
          <button
            className={`${styles.tabButton} ${activeTab === 'sync_io' ? styles.active : ''}`}
            onClick={() => setActiveTab('sync_io')}
          >
            <Layers size={14} />
            <span>Sync I/O & Imports ({syncIoCalls.length + importCosts.length})</span>
          </button>
        </div>

        {/* Modal Content */}
        <div className={styles.content}>
          {/* Quick Metrics Cards */}
          <div className={styles.statsRow}>
            <div className={styles.statCard}>
              <InfoTip text="How long the full boot took, from process start to services ready. Lower is better.">
                <span className={styles.statCardLabel}>Cold Start Duration</span>
              </InfoTip>
              <span className={styles.statCardValue}>{totalBootMs.toFixed(1)} ms</span>
              <span className={styles.statCardSub}>Process start to services ready</span>
            </div>
            <div className={styles.statCard}>
              <InfoTip text="Time spent on blocking file and system calls made before the window could open. These calls delay first paint.">
                <span className={styles.statCardLabel}>Pre-Window Sync IO</span>
              </InfoTip>
              <span className={styles.statCardValue}>
                {syncIoCalls.reduce((acc, c) => acc + c.durationMs, 0).toFixed(1)} ms
              </span>
              <span className={styles.statCardSub}>{syncIoCalls.length} synchronous calls intercepted</span>
            </div>
            <div className={styles.statCard}>
              <InfoTip text="The single slowest item found during boot, shown with its duration and category.">
                <span className={styles.statCardLabel}>Top Lag Culprit</span>
              </InfoTip>
              <span className={styles.statCardValue} style={{ fontSize: '16px' }}>
                {topOffenders[0]?.item || 'None'}
              </span>
              <span className={styles.statCardSub}>
                {topOffenders[0] ? `${topOffenders[0].ms.toFixed(1)} ms (${topOffenders[0].category})` : 'Optimal'}
              </span>
            </div>
            <div className={styles.statCard}>
              <InfoTip text="Count of boot time spans longer than 100ms that no performance mark covers. Large gaps point at missing measurements.">
                <span className={styles.statCardLabel}>Unmarked Gaps &gt;100ms</span>
              </InfoTip>
              <span className={styles.statCardValue} style={{ color: gapWarnings.length === 0 ? 'var(--accent-green)' : 'var(--accent-red)' }}>
                {gapWarnings.length}
              </span>
              <span className={styles.statCardSub}>
                {gapWarnings.length === 0 ? 'No unmarked gaps >100ms' : `${gapWarnings[0]?.gapMs}ms gap detected`}
              </span>
            </div>
          </div>

          {/* TAB 1: Top 10 Offenders */}
          {activeTab === 'offenders' && (
            <div className={styles.tableWrapper}>
              <table className={styles.perfTable}>
                <thead>
                  <tr>
                    <th style={{ width: 50 }}><InfoTip text="Position in the slow items list, ranked by measured duration.">Rank</InfoTip></th>
                    <th><InfoTip text="The module, file, or operation measured as slow.">Offending Item / Source</InfoTip></th>
                    <th style={{ width: 90 }}><InfoTip text="How long this item took, in milliseconds.">Duration</InfoTip></th>
                    <th style={{ width: 90 }}><InfoTip text="The boot stage where this cost appeared.">Phase</InfoTip></th>
                    <th style={{ width: 140 }}><InfoTip text="Category of the slowdown: sync I/O, eager imports, network waits, process spawns, or render storms.">Suspected Cause</InfoTip></th>
                    <th><InfoTip text="Extra context about why this item was slow, when available.">Details</InfoTip></th>
                  </tr>
                </thead>
                <tbody>
                  {topOffenders.map((item, idx) => (
                    <tr key={`${item.item}_${idx}`}>
                      <td>
                        <span className={`${styles.rankBadge} ${idx === 0 ? styles.rank1 : idx === 1 ? styles.rank2 : idx === 2 ? styles.rank3 : ''}`}>
                          #{idx + 1}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
                        {item.item}
                      </td>
                      <td style={{ color: item.ms > 100 ? 'var(--accent-red)' : 'var(--accent-amber)', fontWeight: 600 }}>
                        {item.ms.toFixed(1)} ms
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{item.phase}</td>
                      <td>
                        <InfoTip text={CATEGORY_TIPS[item.category] || 'Type of slowdown detected for this item.'}>
                          <span className={`${styles.categoryBadge} ${styles[`category_${item.category}`] || ''}`}>
                            {item.category}
                          </span>
                        </InfoTip>
                      </td>
                      <td style={{ color: 'var(--text-muted)', fontSize: 11 }}>
                        {item.details || '—'}
                      </td>
                    </tr>
                  ))}
                  {topOffenders.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.emptyState}>
                        No offenders recorded yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 2: Waterfall Timeline */}
          {activeTab === 'waterfall' && (
            <div className={styles.waterfallList}>
              {marks.map((mark, i) => {
                const markTime = mark.timestamp;
                const duration = mark.duration ?? 2;
                const widthPercent = totalBootMs > 0 ? Math.min(100, Math.max(1, (duration / totalBootMs) * 100)) : 1;
                const leftPercent = totalBootMs > 0 ? Math.min(99, (markTime / totalBootMs) * 100) : 0;

                return (
                  <div key={`${mark.name}_${i}`} className={styles.waterfallItem}>
                    <div className={styles.waterfallHeader}>
                      <span className={styles.waterfallName}>
                        {mark.name}
                        {mark.category && (
                          <InfoTip text={CATEGORY_TIPS[mark.category] || 'Type of slowdown detected for this step.'}>
                            <span className={`${styles.categoryBadge} ${styles[`category_${mark.category}`] || ''}`}>
                              {mark.category}
                            </span>
                          </InfoTip>
                        )}
                      </span>
                      <InfoTip text="Left number: start time after boot. Right number: how long this step lasted.">
                        <span className={styles.waterfallTime}>
                          +{markTime.toFixed(1)} ms {mark.duration !== undefined ? `(${mark.duration.toFixed(1)} ms)` : ''}
                        </span>
                      </InfoTip>
                    </div>
                    <div className={styles.barTrack}>
                      <div
                        className={styles.barFill}
                        style={{
                          marginLeft: `${leftPercent}%`,
                          width: `${widthPercent}%`,
                          backgroundColor: getBarColor(mark)
                        }}
                      />
                    </div>
                  </div>
                );
              })}
              {marks.length === 0 && (
                <div className={styles.emptyState}>No boot marks captured.</div>
              )}
            </div>
          )}

          {/* TAB 3: UI Transitions */}
          {activeTab === 'transitions' && (
            <div className={styles.tableWrapper}>
              <table className={styles.perfTable}>
                <thead>
                  <tr>
                    <th><InfoTip text="The UI action being timed, such as opening the terminal.">Transition Event</InfoTip></th>
                    <th style={{ width: 110 }}><InfoTip text="Time from the user action until the first visible update on screen.">Event-to-Visible</InfoTip></th>
                    <th style={{ width: 100 }}><InfoTip text="Main thread tasks over 50ms that ran during this transition. These cause jank.">Long Tasks</InfoTip></th>
                    <th style={{ width: 90 }}><InfoTip text="How many React render passes this transition triggered.">React Renders</InfoTip></th>
                    <th style={{ width: 90 }}><InfoTip text="How many main process round trips this transition made.">IPC Calls</InfoTip></th>
                    <th><InfoTip text="When the transition began, measured from app boot.">Started At</InfoTip></th>
                  </tr>
                </thead>
                <tbody>
                  {liveTransitions.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</td>
                      <td style={{ color: t.durationMs > 50 ? 'var(--accent-red)' : 'var(--accent-green)', fontWeight: 600 }}>
                        {t.durationMs.toFixed(1)} ms
                      </td>
                      <td>
                        {t.longTasks.length > 0 ? (
                          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>
                            {t.longTasks.length} (&gt;50ms)
                          </span>
                        ) : (
                          <span style={{ color: 'var(--text-muted)' }}>0</span>
                        )}
                      </td>
                      <td>{t.reactRenders}</td>
                      <td>{t.ipcRoundTrips}</td>
                      <td style={{ color: 'var(--text-muted)' }}>+{t.startTime.toFixed(1)} ms</td>
                    </tr>
                  ))}
                  {liveTransitions.length === 0 && (
                    <tr>
                      <td colSpan={6} className={styles.emptyState}>
                        No UI transitions recorded yet. Try switching tabs, opening settings, or toggling the terminal!
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* TAB 4: Sync I/O & Imports */}
          {activeTab === 'sync_io' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <div>
                <h3 style={{ fontSize: 14, margin: '0 0 10px 0', color: 'var(--text-primary)' }}>
                  Pre-Window Synchronous Calls (Main Process)
                </h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.perfTable}>
                    <thead>
                      <tr>
                        <th><InfoTip text="The synchronous call, such as reading a file or checking a path.">Operation</InfoTip></th>
                        <th><InfoTip text="The file or resource the call touched.">Target File / Identifier</InfoTip></th>
                        <th style={{ width: 100 }}><InfoTip text="How long the call blocked the main thread, in milliseconds.">Duration</InfoTip></th>
                        <th style={{ width: 110 }}><InfoTip text="When the call happened, relative to process start.">Timestamp</InfoTip></th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncIoCalls.map((c, i) => (
                        <tr key={`sync_${i}`}>
                          <td style={{ fontFamily: 'monospace', color: 'var(--accent-red)' }}>{c.operation}</td>
                          <td style={{ color: 'var(--text-secondary)' }}>{c.target || '—'}</td>
                          <td style={{ fontWeight: 600 }}>{c.durationMs.toFixed(1)} ms</td>
                          <td style={{ color: 'var(--text-muted)' }}>+{c.timestamp.toFixed(1)} ms</td>
                        </tr>
                      ))}
                      {syncIoCalls.length === 0 && (
                        <tr>
                          <td colSpan={4} className={styles.emptyState}>
                            No synchronous I/O calls intercepted before window creation.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <h3 style={{ fontSize: 14, margin: '0 0 10px 0', color: 'var(--text-primary)' }}>
                  Top-Level Renderer Imports Parse Cost
                </h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.perfTable}>
                    <thead>
                      <tr>
                        <th><InfoTip text="A renderer module evaluated at startup.">Module</InfoTip></th>
                        <th style={{ width: 120 }}><InfoTip text="Time spent parsing and running the module before it was usable.">Parse Cost</InfoTip></th>
                        <th style={{ width: 120 }}><InfoTip text="When the import finished, relative to process start.">Recorded At</InfoTip></th>
                      </tr>
                    </thead>
                    <tbody>
                      {importCosts.map((imp, i) => (
                        <tr key={`imp_${i}`}>
                          <td style={{ fontWeight: 600, color: 'var(--accent-amber)' }}>{imp.module}</td>
                          <td style={{ fontWeight: 600 }}>{imp.durationMs.toFixed(1)} ms</td>
                          <td style={{ color: 'var(--text-muted)' }}>+{imp.timestamp.toFixed(1)} ms</td>
                        </tr>
                      ))}
                      {importCosts.length === 0 && (
                        <tr>
                          <td colSpan={3} className={styles.emptyState}>
                            No import costs recorded.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
