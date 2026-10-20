import React, { useEffect, useState } from 'react';
import { AlertTriangle, ShieldAlert, Check, X, Terminal, FileCode, GitCommit, FileDiff } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import type { AgentToolApproval } from '../../../preload/types';

export interface AgentApprovalModalProps {
  isOpen?: boolean;
  approval?: AgentToolApproval | null;
  onApprove?: () => void;
  onReject?: () => void;
}

interface PtyPendingRequest {
  approvalId: string;
  ptyId: string;
  command: string;
  reason: string;
}

export const AgentApprovalModal: React.FC<AgentApprovalModalProps> = ({
  isOpen: propIsOpen,
  approval: propApproval,
  onApprove: propOnApprove,
  onReject: propOnReject
}) => {
  const { pendingApproval, respondToApproval } = useChatStore();
  const [ptyApproval, setPtyApproval] = useState<PtyPendingRequest | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Listen for terminal PTY commands requiring approval
  useEffect(() => {
    if (window.electronAPI?.onPtyApprovalRequired) {
      const unsub = window.electronAPI.onPtyApprovalRequired((data) => {
        setPtyApproval(data);
      });
      return unsub;
    }
    return undefined;
  }, []);

  const activeApproval = propApproval !== undefined ? propApproval : pendingApproval;
  const isPtyMode = !activeApproval && ptyApproval !== null;
  const isVisible = propIsOpen !== undefined ? propIsOpen : (activeApproval !== null || isPtyMode);

  const handleApprove = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (propOnApprove) {
        propOnApprove();
      } else if (activeApproval) {
        await respondToApproval(true);
      } else if (ptyApproval && window.electronAPI?.resolvePtyApproval) {
        await window.electronAPI.resolvePtyApproval(ptyApproval.approvalId, true);
        setPtyApproval(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReject = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    try {
      if (propOnReject) {
        propOnReject();
      } else if (activeApproval) {
        await respondToApproval(false);
      } else if (ptyApproval && window.electronAPI?.resolvePtyApproval) {
        await window.electronAPI.resolvePtyApproval(ptyApproval.approvalId, false);
        setPtyApproval(null);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  // Keyboard shortcut listener (Enter = Approve, Esc = Reject)
  useEffect(() => {
    if (!isVisible) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        void handleReject();
      } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || document.activeElement?.tagName !== 'BUTTON')) {
        e.preventDefault();
        void handleApprove();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isVisible, isSubmitting, activeApproval, ptyApproval]);

  if (!isVisible) return null;
  if (activeApproval?.approvalKind === 'plan_review') return null;

  // Determine Title, Command/Path, and Tool Context
  let title = 'Agent wants to perform an action. Allow?';
  let commandSnippet = '';
  let toolName = 'tool';
  let reason = 'This action requires explicit user authorization according to the Security Policy.';
  let affectedFilePath = '';

  if (activeApproval) {
    toolName = activeApproval.toolCall.name;
    reason = activeApproval.reason || reason;
    const args = activeApproval.toolCall.arguments as Record<string, unknown> | undefined;

    if (toolName === 'run_command') {
      const cmd = String(args?.command || '').trim();
      commandSnippet = cmd;
      const displayCmd = cmd.length > 40 ? `${cmd.slice(0, 37)}...` : cmd;
      title = `Agent wants to run ${displayCmd}. Allow?`;
    } else if (toolName === 'replace_file_content') {
      affectedFilePath = String(args?.filePath || activeApproval.reviewDiff?.filePath || '');
      title = `Agent wants to modify ${affectedFilePath || 'file'}. Allow?`;
    } else if (toolName === 'write_file') {
      affectedFilePath = String(args?.filePath || activeApproval.reviewDiff?.filePath || '');
      title = `Agent wants to write ${affectedFilePath || 'file'}. Allow?`;
    } else if (toolName === 'git_commit') {
      title = 'Agent wants to commit changes. Allow?';
    } else if (toolName === 'git_merge') {
      title = 'Agent wants to merge git branch. Allow?';
    } else {
      title = `Agent wants to execute ${toolName}. Allow?`;
    }
  } else if (ptyApproval) {
    toolName = 'terminal';
    commandSnippet = ptyApproval.command;
    reason = ptyApproval.reason;
    const displayCmd = ptyApproval.command.length > 40 ? `${ptyApproval.command.slice(0, 37)}...` : ptyApproval.command;
    title = `Agent wants to run ${displayCmd}. Allow?`;
  }

  const reviewDiff = activeApproval?.reviewDiff;
  const isDestructive = /rm\s+-(?:rf|fr)|del\s+\/s|remove-item.*-recurse|format\s+[a-z]:/i.test(commandSnippet);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="agent-approval-title"
      data-testid="agent-approval-modal"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        backgroundColor: 'rgba(0, 0, 0, 0.75)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          backgroundColor: 'var(--bg-secondary, #18191e)',
          border: `1px solid ${isDestructive ? 'var(--accent-red, #ef4444)' : 'var(--border-strong, #3b3e4f)'}`,
          borderRadius: '12px',
          boxShadow: '0 20px 40px -10px rgba(0, 0, 0, 0.8), 0 0 20px 0 rgba(0, 0, 0, 0.4)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          color: 'var(--text-primary, #f3f4f6)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '18px 20px 14px 20px',
            borderBottom: '1px solid var(--border-subtle, #262833)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: '14px',
            backgroundColor: isDestructive ? 'rgba(239, 68, 68, 0.08)' : 'transparent'
          }}
        >
          <div
            style={{
              padding: '10px',
              borderRadius: '10px',
              backgroundColor: isDestructive ? 'rgba(239, 68, 68, 0.15)' : 'rgba(245, 158, 11, 0.15)',
              color: isDestructive ? 'var(--accent-red, #ef4444)' : 'var(--accent-amber, #f59e0b)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0
            }}
          >
            {isDestructive ? <AlertTriangle size={22} /> : <ShieldAlert size={22} />}
          </div>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 600,
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  padding: '2px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'var(--bg-tertiary, #1f2128)',
                  color: 'var(--text-secondary, #9ca3af)',
                  border: '1px solid var(--border-subtle, #262833)'
                }}
              >
                {toolName}
              </span>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: 500,
                  color: isDestructive ? 'var(--accent-red, #ef4444)' : 'var(--accent-amber, #f59e0b)'
                }}
              >
                {isDestructive ? 'Restricted Command' : 'Security Review'}
              </span>
            </div>

            <h2
              id="agent-approval-title"
              style={{
                margin: 0,
                fontSize: '16px',
                fontWeight: 600,
                color: 'var(--text-primary, #f3f4f6)',
                lineHeight: '1.4'
              }}
            >
              {title}
            </h2>
          </div>

          <button
            onClick={handleReject}
            disabled={isSubmitting}
            title="Reject & Close (Esc)"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted, #6b7280)',
              cursor: 'pointer',
              padding: '4px',
              borderRadius: '6px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Content Body */}
        <div style={{ padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {/* Reason explanation callout */}
          <div
            style={{
              padding: '10px 14px',
              borderRadius: '8px',
              backgroundColor: 'var(--bg-tertiary, #1f2128)',
              borderLeft: `3px solid ${isDestructive ? 'var(--accent-red, #ef4444)' : 'var(--accent-amber, #f59e0b)'}`,
              fontSize: '12px',
              lineHeight: '1.5',
              color: 'var(--text-secondary, #9ca3af)'
            }}
          >
            <strong style={{ color: 'var(--text-primary, #f3f4f6)', display: 'block', marginBottom: '2px' }}>
              Policy Trigger:
            </strong>
            {reason}
          </div>

          {/* Command display box */}
          {commandSnippet && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--text-secondary, #9ca3af)' }}>
                <Terminal size={14} />
                <span>Command to execute:</span>
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '13px',
                  backgroundColor: 'var(--bg-primary, #121316)',
                  border: '1px solid var(--border-subtle, #262833)',
                  borderRadius: '6px',
                  padding: '10px 14px',
                  color: isDestructive ? 'var(--accent-red, #ef4444)' : 'var(--text-primary, #f3f4f6)',
                  overflowX: 'auto',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all'
                }}
              >
                <span style={{ color: 'var(--text-muted, #6b7280)', userSelect: 'none' }}>$ </span>
                {commandSnippet}
              </div>
            </div>
          )}

          {/* Diff / Mutation preview box */}
          {reviewDiff && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-secondary, #9ca3af)' }}>
                  <FileDiff size={14} />
                  <span>Target file: <strong style={{ color: 'var(--text-primary)' }}>{reviewDiff.filePath}</strong></span>
                </div>
                <div style={{ display: 'flex', gap: '6px', fontSize: '11px', fontWeight: 600 }}>
                  <span style={{ color: 'var(--accent-green, #10b981)' }}>+{activeApproval?.addedLines || 0}</span>
                  <span style={{ color: 'var(--accent-red, #ef4444)' }}>-{activeApproval?.removedLines || 0}</span>
                </div>
              </div>

              <div
                style={{
                  maxHeight: '160px',
                  overflowY: 'auto',
                  backgroundColor: 'var(--bg-primary, #121316)',
                  border: '1px solid var(--border-subtle, #262833)',
                  borderRadius: '6px',
                  padding: '10px',
                  fontFamily: 'var(--font-mono, monospace)',
                  fontSize: '12px',
                  lineHeight: '1.4'
                }}
              >
                <div style={{ color: 'var(--text-muted, #6b7280)', marginBottom: '4px', fontSize: '11px' }}>--- Proposed Content:</div>
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', color: 'var(--text-primary, #f3f4f6)' }}>
                  {reviewDiff.proposedContent.slice(0, 500)}
                  {reviewDiff.proposedContent.length > 500 && '\n...(preview truncated)'}
                </pre>
              </div>
            </div>
          )}

          {/* Affected paths list */}
          {activeApproval?.affectedPaths && activeApproval.affectedPaths.length > 0 && !reviewDiff && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <span style={{ fontSize: '12px', color: 'var(--text-secondary, #9ca3af)' }}>Affected paths:</span>
              <ul
                style={{
                  margin: 0,
                  padding: '6px 12px',
                  listStyle: 'none',
                  backgroundColor: 'var(--bg-primary, #121316)',
                  border: '1px solid var(--border-subtle, #262833)',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono, monospace)',
                  color: 'var(--text-secondary, #9ca3af)',
                  maxHeight: '100px',
                  overflowY: 'auto'
                }}
              >
                {activeApproval.affectedPaths.map((p) => (
                  <li key={p} style={{ padding: '2px 0' }}>{p}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '14px 20px',
            backgroundColor: 'var(--bg-primary, #121316)',
            borderTop: '1px solid var(--border-subtle, #262833)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: '10px'
          }}
        >
          <button
            type="button"
            data-testid="approval-reject-button"
            onClick={handleReject}
            disabled={isSubmitting}
            style={{
              padding: '8px 16px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 500,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              backgroundColor: 'var(--bg-tertiary, #1f2128)',
              color: 'var(--text-primary, #f3f4f6)',
              border: '1px solid var(--border-strong, #3b3e4f)',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              transition: 'background-color 0.15s ease'
            }}
          >
            <X size={15} />
            <span>Reject</span>
          </button>

          <button
            type="button"
            data-testid="approval-allow-button"
            onClick={handleApprove}
            disabled={isSubmitting}
            style={{
              padding: '8px 18px',
              borderRadius: '6px',
              fontSize: '13px',
              fontWeight: 600,
              cursor: isSubmitting ? 'not-allowed' : 'pointer',
              backgroundColor: isDestructive ? 'var(--accent-red, #ef4444)' : 'var(--accent-green, #10b981)',
              color: '#ffffff',
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              boxShadow: isDestructive ? '0 2px 8px rgba(239, 68, 68, 0.4)' : '0 2px 8px rgba(16, 185, 129, 0.4)',
              transition: 'transform 0.1s ease, opacity 0.15s ease'
            }}
          >
            <Check size={15} />
            <span>Allow</span>
          </button>
        </div>
      </div>
    </div>
  );
};
