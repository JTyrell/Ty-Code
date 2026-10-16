import React, { useEffect, useState, useCallback } from 'react';
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

interface BootTimelineProps {
  isOpen: boolean;
  onClose: () => void;
}

type TabKey = 'waterfall' | 'offenders' | 'transitions' | 'sync_io';

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
    if (mark.category === 'sync_io') return '#ef4444';
    if (mark.category === 'eager_import') return '#f59e0b';
    if (mark.category === 'network_wait') return '#3b82f6';
    if (mark.category === 'process_spawn') return '#a855f7';
    if (mark.category === 'render_storm') return '#ec4899';
    return '#38bdf8';
  };

  return (
    <div className={styles.overlay} onClick={onClose} role="dialog" aria-modal="true">
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        {/* Modal Header */}
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <Zap size={20} color="#38bdf8" />
            <h2>Boot & Transition Profiler</h2>
            <span className={styles.bootBadge}>{totalBootMs.toFixed(1)} ms total</span>
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
              <span className={styles.statCardLabel}>Cold Start Duration</span>
              <span className={styles.statCardValue}>{totalBootMs.toFixed(1)} ms</span>
              <span className={styles.statCardSub}>Process start to services ready</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statCardLabel}>Pre-Window Sync IO</span>
              <span className={styles.statCardValue}>
                {syncIoCalls.reduce((acc, c) => acc + c.durationMs, 0).toFixed(1)} ms
              </span>
              <span className={styles.statCardSub}>{syncIoCalls.length} synchronous calls intercepted</span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statCardLabel}>Top Lag Culprit</span>
              <span className={styles.statCardValue} style={{ fontSize: '16px' }}>
                {topOffenders[0]?.item || 'None'}
              </span>
              <span className={styles.statCardSub}>
                {topOffenders[0] ? `${topOffenders[0].ms.toFixed(1)} ms (${topOffenders[0].category})` : 'Optimal'}
              </span>
            </div>
            <div className={styles.statCard}>
              <span className={styles.statCardLabel}>Unmarked Gaps &gt;100ms</span>
              <span className={styles.statCardValue} style={{ color: gapWarnings.length === 0 ? '#7ee787' : '#f87171' }}>
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
                    <th style={{ width: 50 }}>Rank</th>
                    <th>Offending Item / Source</th>
                    <th style={{ width: 90 }}>Duration</th>
                    <th style={{ width: 90 }}>Phase</th>
                    <th style={{ width: 140 }}>Suspected Cause</th>
                    <th>Details</th>
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
                      <td style={{ fontWeight: 600, color: '#ffffff' }}>
                        {item.item}
                      </td>
                      <td style={{ color: item.ms > 100 ? '#f87171' : '#fbbf24', fontWeight: 600 }}>
                        {item.ms.toFixed(1)} ms
                      </td>
                      <td style={{ textTransform: 'capitalize' }}>{item.phase}</td>
                      <td>
                        <span className={`${styles.categoryBadge} ${styles[`category_${item.category}`] || ''}`}>
                          {item.category}
                        </span>
                      </td>
                      <td style={{ color: '#8b949e', fontSize: 11 }}>
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
                          <span className={`${styles.categoryBadge} ${styles[`category_${mark.category}`] || ''}`}>
                            {mark.category}
                          </span>
                        )}
                      </span>
                      <span className={styles.waterfallTime}>
                        +{markTime.toFixed(1)} ms {mark.duration !== undefined ? `(${mark.duration.toFixed(1)} ms)` : ''}
                      </span>
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
                    <th>Transition Event</th>
                    <th style={{ width: 110 }}>Event-to-Visible</th>
                    <th style={{ width: 100 }}>Long Tasks</th>
                    <th style={{ width: 90 }}>React Renders</th>
                    <th style={{ width: 90 }}>IPC Calls</th>
                    <th>Started At</th>
                  </tr>
                </thead>
                <tbody>
                  {liveTransitions.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: 600, color: '#e6edf3' }}>{t.name}</td>
                      <td style={{ color: t.durationMs > 50 ? '#f87171' : '#7ee787', fontWeight: 600 }}>
                        {t.durationMs.toFixed(1)} ms
                      </td>
                      <td>
                        {t.longTasks.length > 0 ? (
                          <span style={{ color: '#f87171', fontWeight: 600 }}>
                            {t.longTasks.length} (&gt;50ms)
                          </span>
                        ) : (
                          <span style={{ color: '#8b949e' }}>0</span>
                        )}
                      </td>
                      <td>{t.reactRenders}</td>
                      <td>{t.ipcRoundTrips}</td>
                      <td style={{ color: '#8b949e' }}>+{t.startTime.toFixed(1)} ms</td>
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
                <h3 style={{ fontSize: 14, margin: '0 0 10px 0', color: '#ffffff' }}>
                  Pre-Window Synchronous Calls (Main Process)
                </h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.perfTable}>
                    <thead>
                      <tr>
                        <th>Operation</th>
                        <th>Target File / Identifier</th>
                        <th style={{ width: 100 }}>Duration</th>
                        <th style={{ width: 110 }}>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {syncIoCalls.map((c, i) => (
                        <tr key={`sync_${i}`}>
                          <td style={{ fontFamily: 'monospace', color: '#f87171' }}>{c.operation}</td>
                          <td style={{ color: '#c9d1d9' }}>{c.target || '—'}</td>
                          <td style={{ fontWeight: 600 }}>{c.durationMs.toFixed(1)} ms</td>
                          <td style={{ color: '#8b949e' }}>+{c.timestamp.toFixed(1)} ms</td>
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
                <h3 style={{ fontSize: 14, margin: '0 0 10px 0', color: '#ffffff' }}>
                  Top-Level Renderer Imports Parse Cost
                </h3>
                <div className={styles.tableWrapper}>
                  <table className={styles.perfTable}>
                    <thead>
                      <tr>
                        <th>Module</th>
                        <th style={{ width: 120 }}>Parse Cost</th>
                        <th style={{ width: 120 }}>Recorded At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importCosts.map((imp, i) => (
                        <tr key={`imp_${i}`}>
                          <td style={{ fontWeight: 600, color: '#fbbf24' }}>{imp.module}</td>
                          <td style={{ fontWeight: 600 }}>{imp.durationMs.toFixed(1)} ms</td>
                          <td style={{ color: '#8b949e' }}>+{imp.timestamp.toFixed(1)} ms</td>
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
