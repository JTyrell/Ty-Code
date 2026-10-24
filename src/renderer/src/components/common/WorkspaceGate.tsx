import React, { useState } from 'react';
import { Loader2, FolderSearch, FolderOpen } from 'lucide-react';
import { useWorkspaceStore } from '../../state/workspace-store';

export interface WorkspaceGateProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  featureName?: string;
  message?: string;
  subtext?: string;
}

/**
 * WorkspaceGate: Explorer-First Gatekeeper Component
 * - When no workspace is loaded (`!workspaceRoot`), displays a rich "Empty State" card
 *   prompting the user to "Open Folder" via window.electronAPI.openFolderDialog().
 * - When a workspace is indexing (`!isWorkspaceReady`), shows the non-blocking indexing state.
 * - Once workspace is ready (`isWorkspaceReady && workspaceRoot`), automatically renders `children`.
 */
export const WorkspaceGate: React.FC<WorkspaceGateProps> = ({
  children,
  fallback,
  featureName,
  message = 'Indexing Workspace...',
  subtext = 'Waiting for Explorer file tree scan to finish before initializing features.'
}) => {
  const isWorkspaceReady = useWorkspaceStore((state) => state.isWorkspaceReady);
  const workspaceRoot = useWorkspaceStore((state) => state.workspaceRoot || state.workspacePath || null);
  const [isOpening, setIsOpening] = useState(false);

  // Derive feature name from prop or message (e.g. "Omni-Debugger", "M3E Canvas", "Git")
  const resolvedFeatureName = featureName || (
    message?.includes('Indexing Workspace for ')
      ? message.replace('Indexing Workspace for ', '').replace(/\.\.\.$/, '').trim()
      : 'workspace'
  );

  // Once the folder is selected and workspace is ready, render the feature children
  if (isWorkspaceReady && workspaceRoot) {
    return <>{children}</>;
  }

  // Render custom fallback if explicitly provided
  if (fallback) {
    return <>{fallback}</>;
  }

  const handleOpenFolder = async () => {
    if (isOpening) return;
    setIsOpening(true);
    try {
      if (window.electronAPI?.openFolderDialog) {
        const res = await window.electronAPI.openFolderDialog();
        if (res?.success && res.data) {
          useWorkspaceStore.getState().setWorkspacePath(res.data);
          await useWorkspaceStore.getState().refreshFileTree();
        }
      } else if (window.electronAPI?.selectWorkspaceFolder) {
        const res = await window.electronAPI.selectWorkspaceFolder();
        if (res?.success && res.data) {
          useWorkspaceStore.getState().setWorkspacePath(res.data);
          await useWorkspaceStore.getState().refreshFileTree();
        }
      }
    } catch (err) {
      console.error('[WorkspaceGate] Error opening folder dialog:', err);
    } finally {
      setIsOpening(false);
    }
  };

  // State 1: No Workspace Open -> Render Graceful Empty State Card
  if (!workspaceRoot) {
    return (
      <div
        className="workspace-gate-container workspace-gate-empty-state"
        role="region"
        aria-label="No Workspace Open"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          minHeight: '320px',
          padding: '32px 24px',
          background: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          boxSizing: 'border-box',
          position: 'relative',
          overflow: 'hidden'
        }}
      >
        {/* Subtle decorative glow */}
        <div
          style={{
            position: 'absolute',
            width: '280px',
            height: '280px',
            background: 'radial-gradient(circle, var(--accent-primary, #6366f1) 0%, transparent 70%)',
            opacity: 0.12,
            top: '35%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            pointerEvents: 'none',
            filter: 'blur(32px)'
          }}
        />

        <div
          className="workspace-gate-card workspace-gate-card-empty"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            maxWidth: '440px',
            width: '100%',
            padding: '36px 32px',
            borderRadius: '16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
            boxShadow: '0 20px 48px -12px rgba(0, 0, 0, 0.25), 0 0 0 1px var(--border-subtle)',
            backdropFilter: 'blur(16px)',
            WebkitBackdropFilter: 'blur(16px)',
            textAlign: 'center',
            position: 'relative',
            zIndex: 1
          }}
        >
          {/* Icon Badge */}
          <div
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '64px',
              height: '64px',
              marginBottom: '20px',
              borderRadius: '16px',
              background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.15) 0%, rgba(99, 102, 241, 0.15) 100%)',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              boxShadow: '0 8px 24px -4px rgba(56, 189, 248, 0.2)'
            }}
          >
            <FolderOpen size={30} color="var(--accent-primary, #38bdf8)" />
          </div>

          <h3
            style={{
              margin: '0 0 10px 0',
              fontSize: '18px',
              fontWeight: 700,
              letterSpacing: '-0.015em',
              color: 'var(--text-primary)'
            }}
          >
            No Workspace Open
          </h3>

          <p
            style={{
              margin: '0 0 24px 0',
              fontSize: '13px',
              lineHeight: '1.55',
              color: 'var(--text-secondary)',
              maxWidth: '340px'
            }}
          >
            Open a folder to enable {resolvedFeatureName} features.
          </p>

          <button
            type="button"
            onClick={handleOpenFolder}
            disabled={isOpening}
            className="workspace-gate-open-btn"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '10px 22px',
              fontSize: '13px',
              fontWeight: 600,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #0284c7 0%, #2563eb 100%)',
              border: 'none',
              borderRadius: '8px',
              cursor: isOpening ? 'wait' : 'pointer',
              boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
              transition: 'all 0.18s ease-in-out',
              outline: 'none'
            }}
          >
            {isOpening ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                <span>Opening...</span>
              </>
            ) : (
              <>
                <FolderOpen size={16} />
                <span>Open Folder</span>
              </>
            )}
          </button>
        </div>

        <style>{`
          .workspace-gate-open-btn:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 6px 20px rgba(37, 99, 235, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.3) !important;
            filter: brightness(1.08);
          }
          .workspace-gate-open-btn:active:not(:disabled) {
            transform: translateY(0);
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    );
  }

  // State 2: Indexing State -> Folder selected, waiting for file scan to finish
  return (
    <div
      className="workspace-gate-container workspace-gate-indexing-state"
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
        background: 'var(--bg-primary)',
        color: 'var(--text-primary)',
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
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          boxShadow: '0 12px 32px rgba(0, 0, 0, 0.15), 0 0 0 1px var(--border-subtle)',
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
            fontWeight: 700,
            letterSpacing: '-0.01em',
            color: 'var(--text-primary)'
          }}
        >
          {message}
        </h3>

        <p
          style={{
            margin: 0,
            fontSize: '12px',
            lineHeight: '1.5',
            color: 'var(--text-secondary)'
          }}
        >
          {subtext}
        </p>

        <div
          style={{
            width: '100%',
            height: '3px',
            background: 'var(--bg-tertiary)',
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
