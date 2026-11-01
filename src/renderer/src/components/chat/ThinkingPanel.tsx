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
 *
 * Presentation lives entirely in ChatSidecar.css (.thinking-panel* /
 * .thought-step-line). The component used to carry inline styles plus its own
 * <style> tag, which re-injected a duplicate @keyframes block for every streamed
 * message and kept these surfaces off the panel's token ladder.
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
    <div className="thinking-panel-container contain-content">
      {/* Header / Summary Row */}
      <button
        type="button"
        className="thinking-panel-header"
        onClick={() => setUserExpanded(!isExpanded)}
        title={isExpanded ? 'Click to collapse thoughts' : 'Click to expand thought process'}
        aria-expanded={isExpanded}
      >
        <span className="thinking-panel-label">
          <Sparkles
            size={11}
            className={`thinking-panel-icon${isStreaming ? ' is-streaming' : ''}`}
            aria-hidden="true"
          />
          <span className="thinking-panel-title">
            {isStreaming ? `Thinking (${stepCount} step${stepCount === 1 ? '' : 's'})…` : summaryLabel}
          </span>
        </span>

        {isExpanded ? (
          <ChevronDown size={11} className="thinking-panel-chevron" aria-hidden="true" />
        ) : (
          <ChevronRight size={11} className="thinking-panel-chevron" aria-hidden="true" />
        )}
      </button>

      {/* Expanded Thought Elements: Each element is its own distinct block line */}
      {isExpanded && (
        <div className="thinking-panel-body">
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
