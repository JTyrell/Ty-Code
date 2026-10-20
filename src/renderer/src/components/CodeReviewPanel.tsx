import React, { useEffect } from 'react';
import {
  ShieldAlert,
  Bug,
  Zap,
  Code2,
  CheckCircle2,
  RefreshCw,
  Sliders,
  History,
  FileCheck,
  ArrowRight,
  Sparkles,
  ExternalLink
} from 'lucide-react';
import { useCodeReviewStore } from '../state/code-review-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { NoProjectEmptyState } from './NoProjectEmptyState';

export const CodeReviewPanel: React.FC = () => {
  const {
    result,
    isAnalyzing,
    activeFilter,
    rules,
    activeTab,
    setFilter,
    setActiveTab,
    runReview,
    applyFix,
    loadRules,
    toggleRule
  } = useCodeReviewStore();

  const { activeTabPath, openTabs, workspacePath } = useWorkspaceStore();
  const currentTab = openTabs.find((t) => t.path === activeTabPath);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const handleReviewCurrent = () => {
    if (currentTab) {
      void runReview(currentTab.path, currentTab.content);
    } else {
      void runReview();
    }
  };

  const findings = result?.findings || [];
  const filteredFindings =
    activeFilter === 'all' ? findings : findings.filter((f) => f.category === activeFilter);

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'bug':
        return <Bug size={14} style={{ color: '#ef4444' }} />;
      case 'security':
        return <ShieldAlert size={14} style={{ color: '#f97316' }} />;
      case 'performance':
        return <Zap size={14} style={{ color: '#eab308' }} />;
      default:
        return <Code2 size={14} style={{ color: '#38bdf8' }} />;
    }
  };

  const getSeverityBadge = (severity: string) => {
    const bg =
      severity === 'error'
        ? 'rgba(239, 68, 68, 0.2)'
        : severity === 'warning'
        ? 'rgba(245, 158, 11, 0.2)'
        : 'rgba(56, 189, 248, 0.2)';
    const color =
      severity === 'error' ? '#ef4444' : severity === 'warning' ? '#f59e0b' : '#38bdf8';
    return (
      <span
        style={{
          padding: '2px 6px',
          borderRadius: '4px',
          fontSize: '10px',
          fontWeight: 700,
          textTransform: 'uppercase',
          backgroundColor: bg,
          color
        }}
      >
        {severity}
      </span>
    );
  };

  if (!workspacePath) {
    return (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          overflow: 'hidden'
        }}
      >
        <div
          style={{
            padding: '10px 12px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
        >
          <FileCheck size={16} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>
            AI Code Review
          </span>
        </div>
        <NoProjectEmptyState hint="AI Code Review analyzes files from the loaded project. Open a folder to review your code." />
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-secondary)',
        color: 'var(--text-primary)',
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 12px',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <FileCheck size={16} style={{ color: 'var(--accent-primary)' }} />
          <span style={{ fontWeight: 600, fontSize: '12px', textTransform: 'uppercase' }}>
            AI Code Review
          </span>
        </div>

        <button
          onClick={handleReviewCurrent}
          disabled={isAnalyzing}
          style={{
            padding: '4px 10px',
            fontSize: '11px',
            fontWeight: 600,
            borderRadius: '4px',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            cursor: isAnalyzing ? 'wait' : 'pointer'
          }}
        >
          <RefreshCw size={12} className={isAnalyzing ? 'animate-spin' : ''} />
          {isAnalyzing ? 'Analyzing…' : 'Review Active File'}
        </button>
      </div>

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          borderBottom: '1px solid var(--border-subtle)',
          backgroundColor: 'var(--bg-tertiary)',
          fontSize: '11px'
        }}
      >
        <button
          onClick={() => setActiveTab('findings')}
          style={{
            flex: 1,
            padding: '8px 0',
            borderBottom: activeTab === 'findings' ? '2px solid var(--accent-primary)' : 'none',
            color: activeTab === 'findings' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'findings' ? 600 : 400
          }}
        >
          Findings {findings.length > 0 && `(${findings.length})`}
        </button>
        <button
          onClick={() => setActiveTab('rules')}
          style={{
            flex: 1,
            padding: '8px 0',
            borderBottom: activeTab === 'rules' ? '2px solid var(--accent-primary)' : 'none',
            color: activeTab === 'rules' ? 'var(--text-primary)' : 'var(--text-secondary)',
            fontWeight: activeTab === 'rules' ? 600 : 400,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '4px'
          }}
        >
          <Sliders size={12} /> Rules
        </button>
      </div>

      {/* Findings Tab Content */}
      {activeTab === 'findings' && (
        <>
          {/* Summary Filter Chips */}
          {result && (
            <div
              style={{
                padding: '8px 10px',
                borderBottom: '1px solid var(--border-subtle)',
                display: 'flex',
                gap: '6px',
                overflowX: 'auto',
                fontSize: '11px'
              }}
            >
              <button
                onClick={() => setFilter('all')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor:
                    activeFilter === 'all' ? 'var(--accent-primary)' : 'var(--bg-tertiary)',
                  color: activeFilter === 'all' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                All ({result.summary.total})
              </button>
              <button
                onClick={() => setFilter('bug')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor:
                    activeFilter === 'bug' ? '#ef4444' : 'var(--bg-tertiary)',
                  color: activeFilter === 'bug' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                Bugs ({result.summary.bugs})
              </button>
              <button
                onClick={() => setFilter('security')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor:
                    activeFilter === 'security' ? '#f97316' : 'var(--bg-tertiary)',
                  color: activeFilter === 'security' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                Security ({result.summary.security})
              </button>
              <button
                onClick={() => setFilter('performance')}
                style={{
                  padding: '3px 8px',
                  borderRadius: '12px',
                  backgroundColor:
                    activeFilter === 'performance' ? '#eab308' : 'var(--bg-tertiary)',
                  color: activeFilter === 'performance' ? '#fff' : 'var(--text-secondary)'
                }}
              >
                Perf ({result.summary.performance})
              </button>
            </div>
          )}

          {/* Finding List */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '10px' }}>
            {filteredFindings.length === 0 ? (
              <div
                style={{
                  padding: '40px 20px',
                  textAlign: 'center',
                  color: 'var(--text-secondary)',
                  fontSize: '12px'
                }}
              >
                <CheckCircle2
                  size={32}
                  style={{ color: '#22c55e', margin: '0 auto 12px auto' }}
                />
                <p style={{ fontWeight: 600, color: 'var(--text-primary)', marginBottom: '4px' }}>
                  No issues found
                </p>
                <p>Click "Review Active File" to scan code for potential bugs and security issues.</p>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {filteredFindings.map((finding) => (
                  <div
                    key={finding.id}
                    style={{
                      padding: '10px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--bg-primary)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '8px'
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between'
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {getCategoryIcon(finding.category)}
                        <span style={{ fontWeight: 600, fontSize: '12px' }}>{finding.title}</span>
                      </div>
                      {getSeverityBadge(finding.severity)}
                    </div>

                    <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                      {finding.description}
                    </div>

                    {finding.codeSnippet && (
                      <div
                        style={{
                          backgroundColor: 'var(--bg-tertiary)',
                          padding: '6px 8px',
                          borderRadius: '4px',
                          fontFamily: 'monospace',
                          fontSize: '11px',
                          overflowX: 'auto',
                          color: '#e2e8f0'
                        }}
                      >
                        Line {finding.line}: {finding.codeSnippet}
                      </div>
                    )}

                    {finding.suggestedFix && (
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginTop: '4px'
                        }}
                      >
                        <span style={{ fontSize: '10px', color: '#22c55e', fontWeight: 600 }}>
                          Fix available
                        </span>
                        <button
                          onClick={() => void applyFix(finding)}
                          style={{
                            padding: '3px 8px',
                            fontSize: '10px',
                            fontWeight: 600,
                            borderRadius: '4px',
                            backgroundColor: 'rgba(34, 197, 94, 0.15)',
                            color: '#22c55e',
                            border: '1px solid rgba(34, 197, 94, 0.3)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <Sparkles size={11} /> Review Fix
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Rules Tab Content */}
      {activeTab === 'rules' && (
        <div style={{ flex: 1, overflowY: 'auto', padding: '12px' }}>
          <p style={{ fontSize: '11px', color: 'var(--text-secondary)', marginBottom: '12px' }}>
            Toggle custom rules to enforce team standards and custom lints.
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {rules.map((rule) => (
              <div
                key={rule.id}
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  backgroundColor: 'var(--bg-primary)',
                  border: '1px solid var(--border-subtle)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between'
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600 }}>{rule.name}</span>
                  <span style={{ fontSize: '10px', color: 'var(--text-secondary)' }}>
                    {rule.description}
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => void toggleRule(rule.id)}
                  style={{ cursor: 'pointer' }}
                />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
