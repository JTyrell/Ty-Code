import React, { useEffect } from 'react';
import { Info, CheckCircle2, AlertTriangle, XCircle, X } from 'lucide-react';
import { useToastStore, type Toast } from '../state/toast-store';

const ToastItem: React.FC<{ toast: Toast; onDismiss: (id: string) => void }> = ({ toast, onDismiss }) => {
  useEffect(() => {
    if (toast.duration && toast.duration > 0) {
      const timer = setTimeout(() => {
        onDismiss(toast.id);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
    return undefined;
  }, [toast.id, toast.duration, onDismiss]);

  const getIcon = () => {
    switch (toast.type) {
      case 'success':
        return <CheckCircle2 size={16} color="var(--accent-green)" />;
      case 'warning':
        return <AlertTriangle size={16} color="var(--accent-amber)" />;
      case 'error':
        return <XCircle size={16} color="var(--accent-red)" />;
      case 'info':
      default:
        return <Info size={16} color="var(--accent-cyan)" />;
    }
  };

  const getBorderColor = () => {
    switch (toast.type) {
      case 'success':
        return 'rgba(16, 185, 129, 0.4)';
      case 'warning':
        return 'rgba(245, 158, 11, 0.4)';
      case 'error':
        return 'rgba(239, 68, 68, 0.4)';
      case 'info':
      default:
        return 'rgba(6, 182, 212, 0.4)';
    }
  };

  return (
    <div
      role="alert"
      className="toast-card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '320px',
        maxWidth: '90vw',
        padding: '10px 12px',
        backgroundColor: 'var(--bg-tertiary)',
        border: `1px solid ${getBorderColor()}`,
        borderRadius: '8px',
        boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        animation: 'toastSlideIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        position: 'relative',
        overflow: 'hidden'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ flexShrink: 0, marginTop: '2px' }}>{getIcon()}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '12px', color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {toast.title}
          </div>
          {toast.message && (
            <div
              style={{
                fontSize: '11px',
                color: 'var(--text-secondary)',
                marginTop: '3px',
                lineHeight: 1.4,
                wordBreak: 'break-word'
              }}
            >
              {toast.message}
            </div>
          )}
          {toast.action && (
            <button
              onClick={() => {
                toast.action?.onClick();
                onDismiss(toast.id);
              }}
              style={{
                marginTop: '8px',
                padding: '3px 8px',
                fontSize: '11px',
                fontWeight: 500,
                backgroundColor: 'var(--bg-hover)',
                color: 'var(--accent-primary)',
                border: '1px solid var(--border-strong)',
                borderRadius: '4px',
                cursor: 'pointer'
              }}
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          onClick={() => onDismiss(toast.id)}
          aria-label="Dismiss toast notification"
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-muted)',
            cursor: 'pointer',
            padding: '2px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '4px'
          }}
        >
          <X size={13} />
        </button>
      </div>
    </div>
  );
};

export const ToastContainer: React.FC = () => {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <aside
      aria-label="Notifications"
      style={{
        position: 'fixed',
        bottom: '32px',
        right: '16px',
        zIndex: 'var(--layer-toast)',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'auto'
      }}
    >
      {toasts.map((item) => (
        <ToastItem key={item.id} toast={item} onDismiss={removeToast} />
      ))}
    </aside>
  );
};
