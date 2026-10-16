import React from 'react';
import styles from './ViewSkeleton.module.css';

export type SkeletonType = 'panel' | 'modal' | 'diff' | 'editor';

interface ViewSkeletonProps {
  type: SkeletonType;
  title?: string;
}

export const ViewSkeleton: React.FC<ViewSkeletonProps> = ({ type, title }) => {
  if (type === 'panel') {
    return (
      <div className={styles.panelContainer} aria-busy="true" aria-label="Loading panel">
        <div className={`${styles.skeletonBase} ${styles.panelHeader}`} style={{ width: title ? '50%' : '70%' }} />
        <div className={`${styles.skeletonBase} ${styles.panelSearch}`} />
        <div className={styles.panelList}>
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className={styles.panelCard}>
              <div className={`${styles.skeletonBase} ${styles.cardTitle}`} style={{ width: `${40 + (i % 3) * 15}%` }} />
              <div className={`${styles.skeletonBase} ${styles.cardSubtitle}`} style={{ width: `${60 + (i % 2) * 20}%` }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (type === 'modal') {
    return (
      <div className={styles.modalOverlay} aria-busy="true" aria-label="Loading modal">
        <div className={styles.modalBox}>
          <div className={styles.modalHeader}>
            <div className={`${styles.skeletonBase}`} style={{ width: 140, height: 18 }} />
            <div className={`${styles.skeletonBase}`} style={{ width: 24, height: 24, borderRadius: 4 }} />
          </div>
          <div className={styles.modalBody}>
            <div className={styles.modalSidebar}>
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className={`${styles.skeletonBase} ${styles.sidebarItem}`} style={{ opacity: 1 - i * 0.1 }} />
              ))}
            </div>
            <div className={styles.modalContent}>
              <div className={`${styles.skeletonBase} ${styles.contentLine}`} style={{ width: '40%' }} />
              <div className={`${styles.skeletonBase} ${styles.contentInput}`} />
              <div className={`${styles.skeletonBase} ${styles.contentLine}`} style={{ width: '60%', marginTop: 12 }} />
              <div className={`${styles.skeletonBase} ${styles.contentInput}`} />
              <div className={`${styles.skeletonBase} ${styles.contentLine}`} style={{ width: '30%', marginTop: 12 }} />
              <div className={`${styles.skeletonBase} ${styles.contentInput}`} />
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (type === 'diff') {
    return (
      <div className={styles.diffContainer} aria-busy="true" aria-label="Loading diff viewer">
        <div className={styles.diffHeader}>
          <div className={`${styles.skeletonBase}`} style={{ width: 220, height: 18 }} />
          <div style={{ display: 'flex', gap: 8 }}>
            <div className={`${styles.skeletonBase}`} style={{ width: 60, height: 24 }} />
            <div className={`${styles.skeletonBase}`} style={{ width: 60, height: 24 }} />
          </div>
        </div>
        <div className={styles.diffSplit}>
          <div className={styles.diffPane}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className={`${styles.skeletonBase} ${styles.diffLine}`}
                style={{ width: `${30 + ((i * 19) % 65)}%`, opacity: 0.85 }}
              />
            ))}
          </div>
          <div className={styles.diffPane}>
            {Array.from({ length: 14 }).map((_, i) => (
              <div
                key={i}
                className={`${styles.skeletonBase} ${styles.diffLine}`}
                style={{ width: `${25 + ((i * 23) % 70)}%`, opacity: 0.85 }}
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.panelContainer} aria-busy="true">
      <div className={`${styles.skeletonBase} ${styles.panelHeader}`} />
      <div className={`${styles.skeletonBase} ${styles.panelSearch}`} />
    </div>
  );
};
