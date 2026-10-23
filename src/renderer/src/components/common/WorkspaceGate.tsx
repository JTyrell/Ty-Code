import React from 'react';
import { Loader2, FolderSearch } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';

export interface WorkspaceGateProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  message?: string;
  subtext?: string;
}

/**
 * WorkspaceGate: Explorer-First Gatekeeper Component
 * Reads `isWorkspaceReady` from the Zustand workspace store using an atomic selector.
 * Blocks child rendering (e.g., M3E Canvas, Git Interface, Omni-Debugger) until
 * the Explorer has fully scanned and indexed the active workspace.
 */
export const WorkspaceGate: React.FC<WorkspaceGateProps> = ({
  children,
  fallback,
  message = 'Indexing Workspace...',
  subtext = 'Waiting for Explorer file tree scan to finish before initializing features.'
}) => {
  const isWorkspaceReady = useWorkspaceStore((state) => state.isWorkspaceReady);

  if (isWorkspaceReady) {
    return <>{children}</>;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return (
    <div
      className="workspace-gate-container"
      role="status"
      aria-live="polite"
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        width: '100%',
        minHeight: '260px',
        padding: '32px 24px',
        background: 'var(--bg-primary, #0d1117)',
        color: 'var(--text-primary, #c9d1d9)',
        boxSizing: 'border-box',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div
        className="workspace-gate-card"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          maxWidth: '420px',
          padding: '28px 32px',
          borderRadius: '12px',
          background: 'var(--bg-secondary, rgba(22, 27, 34, 0.75))',
          border: '1px solid var(--border-subtle, rgba(48, 54, 61, 0.6))',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35)',
          backdropFilter: 'blur(8px)',
          textAlign: 'center'
        }}
      >
        <div
          style={{
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '56px',
            height: '56px',
            marginBottom: '18px',
            borderRadius: '50%',
            background: 'rgba(56, 189, 248, 0.1)',
            border: '1px solid rgba(56, 189, 248, 0.25)'
          }}
        >
          <FolderSearch size={26} color="var(--accent-primary, #38bdf8)" />
          <Loader2
            size={48}
            className="animate-spin"
            style={{
              position: 'absolute',
              color: 'var(--accent-primary, #38bdf8)',
              opacity: 0.75,
              animation: 'spin 1.2s linear infinite'
            }}
          />
        </div>

        <h3
          style={{
            margin: '0 0 8px 0',
            fontSize: '15px',
            fontWeight: 600,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary, #f0f6fc)'
          }}
        >
          {message}
        </h3>

        <p
          style={{
            margin: 0,
            fontSize: '12px',
            lineHeight: '1.5',
            color: 'var(--text-muted, #8b949e)'
          }}
        >
          {subtext}
        </p>

        <div
          style={{
            width: '100%',
            height: '3px',
            background: 'var(--bg-tertiary, #21262d)',
            borderRadius: '2px',
            marginTop: '20px',
            overflow: 'hidden',
            position: 'relative'
          }}
        >
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              width: '45%',
              background: 'linear-gradient(90deg, transparent, var(--accent-primary, #38bdf8), transparent)',
              animation: 'gateShimmer 1.5s ease-in-out infinite'
            }}
          />
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        @keyframes gateShimmer {
          0% { left: -50%; }
          100% { left: 150%; }
        }
      `}</style>
    </div>
  );
};

export default WorkspaceGate;
