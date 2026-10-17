import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, Copy, Check } from 'lucide-react';

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallbackTitle?: string;
  fallback?: ReactNode | ((error: Error, reset: () => void) => ReactNode);
  onReset?: () => void;
  className?: string;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  copied: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      copied: false
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('[ErrorBoundary caught error]:', error, errorInfo);
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({ hasError: false, error: null, errorInfo: null, copied: false });
  };

  handleCopy = (): void => {
    const { error, errorInfo } = this.state;
    const text = `Error: ${error?.message || 'Unknown error'}\n\nStack:\n${error?.stack || ''}\n\nComponent Stack:\n${errorInfo?.componentStack || ''}`;
    void navigator.clipboard.writeText(text);
    this.setState({ copied: true });
    setTimeout(() => this.setState({ copied: false }), 2000);
  };

  render(): ReactNode {
    const { hasError, error, errorInfo, copied } = this.state;
    const { children, fallback, fallbackTitle = 'Something went wrong in this view' } = this.props;

    if (hasError && error) {
      if (typeof fallback === 'function') {
        return fallback(error, this.resetErrorBoundary);
      }
      if (fallback) {
        return fallback;
      }

      return (
        <div
          role="alert"
          style={{
            margin: '16px auto',
            maxWidth: '680px',
            padding: '20px 24px',
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            border: '1px solid rgba(239, 68, 68, 0.35)',
            borderRadius: '10px',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5), 0 0 20px rgba(239, 68, 68, 0.1)',
            color: '#f1f5f9',
            fontFamily: 'system-ui, -apple-system, sans-serif'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0
              }}
            >
              <AlertTriangle size={18} color="#ef4444" />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f8fafc' }}>
                {fallbackTitle}
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: '12px', color: '#94a3b8' }}>
                An unhandled rendering exception occurred. You can reload this view without restarting the application.
              </p>
            </div>
          </div>

          <div
            style={{
              padding: '10px 12px',
              backgroundColor: 'rgba(0, 0, 0, 0.4)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              borderRadius: '6px',
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: '11px',
              color: '#fca5a5',
              lineHeight: 1.5,
              maxHeight: '120px',
              overflowY: 'auto',
              marginBottom: '14px',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word'
            }}
          >
            {error.message || 'Unknown render exception'}
            {errorInfo?.componentStack && (
              <span style={{ display: 'block', color: '#64748b', marginTop: '6px', fontSize: '10px' }}>
                {errorInfo.componentStack.slice(0, 250)}...
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                padding: '7px 14px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                backgroundColor: 'var(--accent-primary, #6366f1)',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                boxShadow: '0 2px 8px rgba(99, 102, 241, 0.3)'
              }}
            >
              <RotateCcw size={13} />
              <span>Try Again</span>
            </button>

            <button
              type="button"
              onClick={this.handleCopy}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 12px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: '6px',
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                color: '#cbd5e1',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                cursor: 'pointer'
              }}
            >
              {copied ? <Check size={13} color="#34d399" /> : <Copy size={13} />}
              <span>{copied ? 'Copied' : 'Copy Error Details'}</span>
            </button>

            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                padding: '7px 12px',
                fontSize: '12px',
                fontWeight: 500,
                borderRadius: '6px',
                backgroundColor: 'transparent',
                color: '#94a3b8',
                border: 'none',
                cursor: 'pointer',
                marginLeft: 'auto'
              }}
            >
              <RefreshCw size={12} />
              <span>Reload Workbench</span>
            </button>
          </div>
        </div>
      );
    }

    return children;
  }
}
