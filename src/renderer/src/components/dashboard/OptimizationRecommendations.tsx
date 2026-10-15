/**
 * Optimization Recommendations Component (Phase 6.5)
 *
 * Suggests smart, usage-driven optimizations based on real user activity patterns,
 * quota headroom, model specialization, and provider health.
 *
 * Brand: Ty-Code
 */

import React, { useState } from 'react';
import {
  Sparkles,
  Zap,
  ShieldAlert,
  Pin,
  Clock,
  ArrowRight,
  CheckCircle2,
  X,
  Sliders,
  AlertTriangle,
  Flame
} from 'lucide-react';
import type { OptimizationRecommendation } from '../../../../shared/types/quota-dashboard';

interface OptimizationRecommendationsProps {
  recommendations: OptimizationRecommendation[];
  onDismiss: (id: string) => Promise<void> | void;
  onApplyAction?: (actionKey: string, rec: OptimizationRecommendation) => void;
}

export const OptimizationRecommendations: React.FC<OptimizationRecommendationsProps> = ({
  recommendations,
  onDismiss,
  onApplyAction
}) => {
  const [dismissingIds, setDismissingIds] = useState<Set<string>>(new Set());
  const [appliedIds, setAppliedIds] = useState<Set<string>>(new Set());

  const handleDismiss = async (id: string) => {
    setDismissingIds((prev) => new Set(prev).add(id));
    try {
      await onDismiss(id);
    } finally {
      setDismissingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  const handleAction = (rec: OptimizationRecommendation) => {
    setAppliedIds((prev) => new Set(prev).add(rec.id));
    if (onApplyAction) {
      onApplyAction(rec.actionKey, rec);
    }
  };

  const getPriorityBadge = (priority: 'high' | 'medium' | 'low') => {
    switch (priority) {
      case 'high':
        return (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(239, 68, 68, 0.15)',
              color: '#f87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            <Flame size={10} /> High Impact
          </span>
        );
      case 'medium':
        return (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(245, 158, 11, 0.15)',
              color: '#fbbf24',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            <Zap size={10} /> Recommended
          </span>
        );
      case 'low':
      default:
        return (
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: '9999px',
              backgroundColor: 'rgba(56, 189, 248, 0.15)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.3)',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              textTransform: 'uppercase',
              letterSpacing: '0.5px'
            }}
          >
            <Sparkles size={10} /> Optimization
          </span>
        );
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'add_provider':
        return <Sparkles size={18} color="#818cf8" />;
      case 'backup_provider':
        return <ShieldAlert size={18} color="#f59e0b" />;
      case 'pin_model':
        return <Pin size={18} color="#10b981" />;
      case 'disable_slow':
        return <Clock size={18} color="#f87171" />;
      default:
        return <Sliders size={18} color="#38bdf8" />;
    }
  };

  return (
    <div id="optimization-recommendations-container" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600, color: '#f1f5f9', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Sparkles size={16} color="var(--accent-primary, #38bdf8)" />
            AI-Driven Optimization Recommendations
          </h3>
          <p style={{ margin: '4px 0 0 0', fontSize: '12px', color: '#94a3b8' }}>
            Personalized insights derived from recent query distribution, quota consumption, and latency metrics.
          </p>
        </div>
        <span
          id="badge-active-recommendations-count"
          style={{
            fontSize: '11px',
            fontWeight: 600,
            padding: '4px 10px',
            borderRadius: '6px',
            backgroundColor: 'rgba(56, 189, 248, 0.12)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.25)'
          }}
        >
          {recommendations.length} Active {recommendations.length === 1 ? 'Tip' : 'Tips'}
        </span>
      </div>

      {recommendations.length === 0 ? (
        <div
          id="recommendations-empty-state"
          style={{
            padding: '36px',
            textAlign: 'center',
            backgroundColor: 'rgba(255, 255, 255, 0.02)',
            border: '1px dashed rgba(255, 255, 255, 0.1)',
            borderRadius: '10px'
          }}
        >
          <CheckCircle2 size={32} color="#10b981" style={{ margin: '0 auto 10px auto' }} />
          <h4 style={{ margin: '0 0 4px 0', fontSize: '14px', color: '#f1f5f9' }}>Ecosystem Fully Optimized</h4>
          <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8' }}>
            Your active models, fallback routes, and provider balances are operating at peak efficiency.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {recommendations.map((rec) => {
            const isApplied = appliedIds.has(rec.id);
            const isDismissing = dismissingIds.has(rec.id);

            return (
              <div
                key={rec.id}
                id={`card-recommendation-${rec.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: '14px',
                  padding: '14px 16px',
                  backgroundColor: 'rgba(255, 255, 255, 0.03)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: '10px',
                  transition: 'all 0.2s ease',
                  opacity: isDismissing ? 0.4 : 1
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', flex: 1 }}>
                  <div
                    style={{
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                      backgroundColor: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      marginTop: '2px'
                    }}
                  >
                    {getTypeIcon(rec.type)}
                  </div>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                        {rec.title}
                      </span>
                      {getPriorityBadge(rec.priority)}
                    </div>

                    <p style={{ margin: 0, fontSize: '12px', color: '#94a3b8', lineHeight: 1.5 }}>
                      {rec.description}
                    </p>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                  <button
                    type="button"
                    id={`btn-apply-rec-${rec.id}`}
                    onClick={() => handleAction(rec)}
                    disabled={isApplied}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '6px',
                      padding: '6px 12px',
                      borderRadius: '6px',
                      backgroundColor: isApplied ? 'rgba(16, 185, 129, 0.15)' : 'rgba(56, 189, 248, 0.15)',
                      color: isApplied ? '#34d399' : '#38bdf8',
                      border: isApplied ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(56, 189, 248, 0.3)',
                      fontSize: '11px',
                      fontWeight: 600,
                      cursor: isApplied ? 'default' : 'pointer',
                      transition: 'all 0.15s ease'
                    }}
                  >
                    {isApplied ? (
                      <>
                        <CheckCircle2 size={12} /> Applied
                      </>
                    ) : (
                      <>
                        {rec.actionLabel}
                        <ArrowRight size={11} />
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    id={`btn-dismiss-rec-${rec.id}`}
                    onClick={() => void handleDismiss(rec.id)}
                    title="Dismiss recommendation"
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#64748b',
                      cursor: 'pointer',
                      padding: '6px',
                      borderRadius: '6px',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'color 0.15s ease'
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                    onMouseLeave={(e) => (e.currentTarget.style.color = '#64748b')}
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
