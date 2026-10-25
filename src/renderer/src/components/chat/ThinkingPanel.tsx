import React, { useState, useEffect } from 'react';
import { Sparkles, ChevronRight, ChevronDown } from 'lucide-react';
import { useChatStore } from '../../state/chat-store';

export interface ThinkingPanelProps {
  messageId: string;
  thoughts?: string[];
  isStreaming?: boolean;
  durationSeconds?: number;
}

/**
 * ThinkingPanel Component (Step 2: Thought Rendering with Consistent Typography)
 *
 * 1. Renders thoughts inside a collapsible panel where EACH array element is its
 *    own block line (muted, slightly italic style). Never renders thoughts as one inline paragraph.
 * 2. While streaming: panel expanded, last line shimmering. Subscribes via atomic Zustand
 *    selector so high-frequency reasoning token updates only re-render this component.
 * 3. On finalization: collapses to a summary row ("Thought for Ns · M steps") that expands on click.
 */
export const ThinkingPanel: React.FC<ThinkingPanelProps> = ({
  messageId: _messageId,
  thoughts: propThoughts = [],
  isStreaming = false,
  durationSeconds = 1
}) => {
  // Selector subscription pattern: atomic selector isolates thought stream re-renders
  const liveThoughts = useChatStore((s) => s.currentThoughts);

  // When actively streaming, use the live atomic thoughts from the store
  const thoughts = (isStreaming && liveThoughts && liveThoughts.length > 0)
    ? liveThoughts
    : propThoughts;

  // Track user manual expansion toggle; null means "use default based on streaming status"
  const [userExpanded, setUserExpanded] = useState<boolean | null>(null);

  // Reset user override when streaming starts
  useEffect(() => {
    if (isStreaming) {
      setUserExpanded(null);
    }
  }, [isStreaming]);

  if (!thoughts || thoughts.length === 0) {
    return null;
  }

  const isExpanded = userExpanded !== null ? userExpanded : isStreaming;
  const stepCount = thoughts.length;
  const duration = Math.max(1, durationSeconds);
  const summaryLabel = `Thought for ${duration}s · ${stepCount} step${stepCount === 1 ? '' : 's'}`;

  return (
    <div
      className="thinking-panel-container contain-content"
      style={{
        margin: '6px 0 10px 0',
        borderRadius: '8px',
        border: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.08))',
        background: 'var(--surface-2, rgba(255, 255, 255, 0.02))',
        overflow: 'hidden',
        fontSize: '11px',
        contain: 'content'
      }}
    >
      <style>{`
        @keyframes thoughtShimmer {
          0% { opacity: 0.5; }
          50% { opacity: 1; color: var(--accent-primary, #60a5fa); }
          100% { opacity: 0.5; }
        }
        .thought-step-line {
          display: block;
          margin: 4px 0;
          font-style: italic;
          color: var(--text-muted, #94a3b8);
          line-height: 1.6;
          word-break: break-word;
          user-select: text;
        }
        .thought-step-line.shimmering-last {
          animation: thoughtShimmer 1.8s ease-in-out infinite;
          font-weight: 500;
        }
      `}</style>

      {/* Header / Summary Row */}
      <button
        type="button"
        onClick={() => setUserExpanded(!isExpanded)}
        style={{
          display: 'flex',
          width: '100%',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '8px',
          padding: '6px 12px',
          cursor: 'pointer',
          color: 'var(--text-secondary, #cbd5e1)',
          background: 'transparent',
          border: 'none',
          textAlign: 'left',
          userSelect: 'none'
        }}
        title={isExpanded ? 'Click to collapse thoughts' : 'Click to expand thought process'}
        aria-expanded={isExpanded}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Sparkles
            size={11}
            style={{
              color: 'var(--accent-primary, #60a5fa)',
              flexShrink: 0,
              ...(isStreaming ? { animation: 'pulse 1.4s ease-in-out infinite' } : {})
            }}
          />
          <span style={{ fontWeight: 600, fontSize: '11px' }}>
            {isStreaming ? `Thinking (${stepCount} step${stepCount === 1 ? '' : 's'})…` : summaryLabel}
          </span>
        </div>

        {isExpanded ? (
          <ChevronDown size={11} style={{ color: 'var(--text-muted, #94a3b8)', flexShrink: 0 }} />
        ) : (
          <ChevronRight size={11} style={{ color: 'var(--text-muted, #94a3b8)', flexShrink: 0 }} />
        )}
      </button>

      {/* Expanded Thought Elements: Each element is its own distinct block line */}
      {isExpanded && (
        <div
          className="thinking-panel-body"
          style={{
            padding: '6px 12px 10px',
            borderTop: '1px solid var(--border-subtle, rgba(255, 255, 255, 0.06))',
            maxHeight: '260px',
            overflowY: 'auto'
          }}
        >
          {thoughts.map((step, idx) => {
            const isLast = idx === thoughts.length - 1;
            const isShimmering = isStreaming && isLast;

            return (
              <div
                key={idx}
                className={`thought-step-line ${isShimmering ? 'shimmering-last' : ''}`}
              >
                {step}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default ThinkingPanel;
