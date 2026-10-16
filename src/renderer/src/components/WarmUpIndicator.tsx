import React, { useEffect, useState } from 'react';
import { Check, Zap } from 'lucide-react';
import type { BootSchedulerStatePayload } from '../../../preload/types';
import styles from './WarmUpIndicator.module.css';

const TIER_NAMES: Record<number, string> = {
  0: 'Frame & Layout',
  1: 'Interactive Shell',
  2: 'Idle Services & Cache',
  3: 'Background Systems'
};

export const WarmUpIndicator: React.FC = () => {
  const [schedulerState, setSchedulerState] = useState<BootSchedulerStatePayload | null>(null);
  const [faded, setFaded] = useState(false);

  useEffect(() => {
    if (!window.electronAPI?.bootSchedulerGetState) return;

    // Fetch initial state
    void window.electronAPI.bootSchedulerGetState().then((res) => {
      if (res?.success && res.data) {
        setSchedulerState(res.data);
      }
    });

    // Subscribe to live progress
    const unsubscribe = window.electronAPI.onBootSchedulerProgress?.((state) => {
      setSchedulerState(state);
      if (state.isWarmedUp) {
        setTimeout(() => setFaded(true), 3500);
      }
    });

    return () => {
      unsubscribe?.();
    };
  }, []);

  if (!schedulerState) {
    return null;
  }

  const { currentTier, tierStatus, completedTasksCount, totalTasksCount, isWarmedUp } = schedulerState;

  const handleClick = (): void => {
    window.dispatchEvent(new CustomEvent('workbench:show-boot-timeline'));
  };

  const getDotClass = (tier: 0 | 1 | 2 | 3): string => {
    const status = tierStatus[tier];
    if (status === 'completed') return `${styles.dot} ${styles.dotCompleted}`;
    if (status === 'running') return `${styles.dot} ${styles.dotRunning}`;
    return `${styles.dot} ${styles.dotPending}`;
  };

  const tooltipText = isWarmedUp
    ? `Ty-Code Warmed Up (${completedTasksCount}/${totalTasksCount} tasks complete). Click to inspect boot timeline.`
    : `Ty-Code Boot: Tier ${currentTier} (${TIER_NAMES[currentTier] || ''}) · ${completedTasksCount}/${totalTasksCount} ready. Click to inspect boot timeline.`;

  return (
    <div
      className={`${styles.container} ${faded ? styles.fadingOut : ''}`}
      onClick={handleClick}
      title={tooltipText}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') handleClick();
      }}
    >
      <div className={styles.tierDots}>
        <span className={getDotClass(0)} title="Tier 0: Frame & Theme Tokens" />
        <span className={getDotClass(1)} title="Tier 1: Shell Interactive (<300ms)" />
        <span className={getDotClass(2)} title="Tier 2: First Idle & Warm Cache" />
        <span className={getDotClass(3)} title="Tier 3: Background Systems" />
      </div>

      {isWarmedUp ? (
        <span className={styles.readyText}>
          <Check size={11} color="#10b981" />
          {!faded && <span>Ready</span>}
        </span>
      ) : (
        <span className={styles.label}>
          <Zap size={11} color="#38bdf8" style={{ display: 'inline', marginRight: 3, verticalAlign: 'middle' }} />
          Tier {currentTier} ({completedTasksCount}/{totalTasksCount})
        </span>
      )}
    </div>
  );
};
