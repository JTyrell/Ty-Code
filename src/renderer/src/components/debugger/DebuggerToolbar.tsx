/**
 * Omni-Debugger Intelligent Model Selector & Toolbar (Step 2)
 *
 * Matches the style and portal-based architecture of the main chat model picker (ModelSelector.tsx).
 * Supports:
 * 1. Auto Mode (default): "🤖 Auto (Best model per task)" with a green badge and task breakdown.
 * 2. Manual Mode: Dropdown of available models (via window.electronAPI.getAvailableModels()).
 * 3. Small badge indicating which model is currently being used for active analysis.
 * 4. Calls window.electronAPI.setDebuggerModelMode('auto' | 'manual', modelId).
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Sparkles,
  Sliders,
  ChevronDown,
  Check,
  Lock,
  Search,
  Zap,
  Cpu,
  Layers,
  Code2,
  ShieldCheck,
  Activity
} from 'lucide-react';
import type { AvailableModelConfig } from '../../../../preload/types';

interface DebuggerToolbarProps {
  className?: string;
  style?: React.CSSProperties;
}

export const DebuggerToolbar: React.FC<DebuggerToolbarProps> = ({ className, style }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<AvailableModelConfig[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeAnalysisModel, setActiveAnalysisModel] = useState<{
    modelId: string;
    name: string;
    providerId?: string;
    taskType?: string;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const dropdownRef = useRef<HTMLDivElement | null>(null);
  const [dropdownPosition, setDropdownPosition] = useState<{
    top: number;
    left: number;
    width: number;
    maxHeight: number;
  } | null>(null);

  // Sync preferences and initial models
  useEffect(() => {
    let mounted = true;

    // 1. Fetch available models
    if (window.electronAPI?.getAvailableModels) {
      window.electronAPI.getAvailableModels().then((res) => {
        if (mounted && res?.success && Array.isArray(res.data)) {
          setAvailableModels(res.data);
        }
      });
    }

    // 2. Fetch current preferences
    if (window.electronAPI?.getDebuggerModelPreferences) {
      window.electronAPI.getDebuggerModelPreferences().then((res) => {
        if (mounted && res?.success && res.data) {
          const d = res.data;
          setMode(d.mode || 'auto');
          setSelectedModelId(d.manualModelId || null);
          if (d.lastActiveModel) {
            setActiveAnalysisModel(d.lastActiveModel);
          }
        }
      });
    }

    // 3. Listen for changes broadcast from main process
    const unsubscribe = window.electronAPI?.onDebuggerModelPreferencesChanged?.((prefs) => {
      if (!mounted || !prefs) return;
      setMode(prefs.mode || 'auto');
      setSelectedModelId(prefs.manualModelId || null);
    });

    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, []);

  // Compute portal dropdown coordinates from the trigger element
  const updatePosition = useCallback(() => {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const width = Math.max(340, Math.min(420, window.innerWidth - 32));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - width - 16));
    const top = rect.bottom + 6;
    const maxHeight = Math.max(220, window.innerHeight - top - 16);

    setDropdownPosition({
      top: Math.round(top),
      left: Math.round(left),
      width: Math.round(width),
      maxHeight: Math.round(maxHeight)
    });
  }, []);

  useLayoutEffect(() => {
    if (isOpen) {
      updatePosition();
      const onResize = () => updatePosition();
      const onScroll = () => updatePosition();
      window.addEventListener('resize', onResize, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true, capture: true });
      return () => {
        window.removeEventListener('resize', onResize);
        window.removeEventListener('scroll', onScroll, { capture: true });
      };
    }
    return undefined;
  }, [isOpen, updatePosition]);

  // Click outside and Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        triggerRef.current &&
        !triggerRef.current.contains(target) &&
        dropdownRef.current &&
        !dropdownRef.current.contains(target)
      ) {
        setIsOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsOpen(false);
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Mode & Model Selection Actions
  const handleSelectAuto = async () => {
    setMode('auto');
    setSelectedModelId(null);
    setIsOpen(false);
    if (window.electronAPI?.setDebuggerModelMode) {
      await window.electronAPI.setDebuggerModelMode('auto');
    }
  };

  const handleSelectManualModel = async (model: AvailableModelConfig) => {
    setMode('manual');
    setSelectedModelId(model.modelId);
    setActiveAnalysisModel({
      modelId: model.modelId,
      name: model.name,
      providerId: model.providerId
    });
    setIsOpen(false);
    if (window.electronAPI?.setDebuggerModelMode) {
      await window.electronAPI.setDebuggerModelMode('manual', model.modelId, model.providerId);
    }
  };

  // Find currently selected manual model object
  const selectedModelObj = availableModels.find((m) => m.modelId === selectedModelId);

  // Filter models based on search
  const q = searchQuery.trim().toLowerCase();
  const matches = (r: AvailableModelConfig) =>
    !q ||
    r.name.toLowerCase().includes(q) ||
    r.modelId.toLowerCase().includes(q) ||
    (r.providerName || '').toLowerCase().includes(q);

  const availableRows = availableModels.filter(
    (r) => matches(r) && r.availabilityStatus === 'available'
  );
  const lockedRows = availableModels.filter(
    (r) => matches(r) && r.availabilityStatus !== 'available'
  );

  return (
    <div className={`omni-debugger-model-picker-container ${className || ''}`} style={style}>
      {/* Trigger Button Matching ModelSelector.tsx Style */}
      <button
        ref={triggerRef}
        type="button"
        id="btn-debugger-model-selector"
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          padding: '4px 10px',
          borderRadius: '6px',
          background: 'rgba(18, 21, 29, 0.95)',
          border: '1px solid rgba(255, 255, 255, 0.12)',
          color: 'var(--text-primary, #e2e8f0)',
          fontSize: '11px',
          fontWeight: 500,
          cursor: 'pointer',
          boxShadow: '0 2px 8px rgba(0, 0, 0, 0.3)',
          transition: 'all 0.15s ease',
          outline: 'none'
        }}
        title="Omni-Debugger Intelligent Model Selector (Auto vs Manual)"
      >
        {mode === 'auto' ? (
          <Sparkles size={12} color="#38bdf8" style={{ flexShrink: 0 }} />
        ) : (
          <Sliders size={12} color="#818cf8" style={{ flexShrink: 0 }} />
        )}

        <span
          style={{
            maxWidth: '170px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            fontWeight: 600,
            color: '#f8fafc'
          }}
        >
          {mode === 'auto'
            ? '🤖 Auto (Best per task)'
            : selectedModelObj?.name || selectedModelId || 'Select Model'}
        </span>

        {/* Mode Badge */}
        {mode === 'auto' ? (
          <span
            id="badge-debugger-auto"
            style={{
              fontSize: '8.5px',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: '3px',
              backgroundColor: 'rgba(16, 185, 129, 0.15)',
              color: '#34d399',
              border: '1px solid rgba(16, 185, 129, 0.35)',
              letterSpacing: '0.4px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            AUTO
          </span>
        ) : (
          <span
            id="badge-debugger-manual"
            style={{
              fontSize: '8.5px',
              fontWeight: 700,
              padding: '1px 5px',
              borderRadius: '3px',
              backgroundColor: 'rgba(129, 140, 248, 0.15)',
              color: '#818cf8',
              border: '1px solid rgba(129, 140, 248, 0.35)',
              letterSpacing: '0.4px',
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            MANUAL
          </span>
        )}

        {/* Small badge indicating which model is currently being used for active analysis */}
        {activeAnalysisModel && (
          <span
            id="badge-debugger-active-model"
            style={{
              fontSize: '8.5px',
              fontWeight: 600,
              padding: '1px 5px',
              borderRadius: '3px',
              backgroundColor: 'rgba(56, 189, 248, 0.12)',
              color: '#38bdf8',
              border: '1px solid rgba(56, 189, 248, 0.25)',
              whiteSpace: 'nowrap',
              flexShrink: 0,
              maxWidth: '110px',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
            title={`Active Analysis Model: ${activeAnalysisModel.name || activeAnalysisModel.modelId}`}
          >
            ⚡ {activeAnalysisModel.name?.split(' ')[0] || activeAnalysisModel.modelId.split('/').pop()}
          </span>
        )}

        <ChevronDown
          size={11}
          color="var(--text-muted, #94a3b8)"
          style={{
            flexShrink: 0,
            transform: isOpen ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease'
          }}
        />
      </button>

      {/* Portal Dropdown Menu */}
      {isOpen &&
        dropdownPosition &&
        createPortal(
          <div
            ref={dropdownRef}
            id="debugger-model-selector-dropdown-menu"
            style={{
              position: 'fixed',
              top: `${dropdownPosition.top}px`,
              left: `${dropdownPosition.left}px`,
              width: `${dropdownPosition.width}px`,
              maxWidth: 'calc(100vw - 24px)',
              maxHeight: `${dropdownPosition.maxHeight}px`,
              boxSizing: 'border-box',
              overflowX: 'hidden',
              overflowY: 'auto',
              background: '#161922',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              borderRadius: '8px',
              boxShadow: '0 16px 36px rgba(0, 0, 0, 0.65)',
              zIndex: 3000,
              padding: '10px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
            }}
          >
            {/* Mode Switcher Segmented Control */}
            <div
              style={{
                display: 'flex',
                background: 'rgba(255, 255, 255, 0.04)',
                borderRadius: '6px',
                padding: '2px',
                border: '1px solid rgba(255, 255, 255, 0.08)'
              }}
            >
              <button
                type="button"
                id="btn-debugger-mode-auto"
                onClick={() => void handleSelectAuto()}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  padding: '5px 0',
                  border: 'none',
                  borderRadius: '4px',
                  background: mode === 'auto' ? 'rgba(56, 189, 248, 0.18)' : 'transparent',
                  color: mode === 'auto' ? '#ffffff' : 'var(--text-muted, #94a3b8)',
                  fontSize: '10.5px',
                  fontWeight: mode === 'auto' ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Sparkles size={11} color={mode === 'auto' ? '#38bdf8' : 'currentColor'} />
                <span>Auto (Best per task)</span>
              </button>

              <button
                type="button"
                id="btn-debugger-mode-manual"
                onClick={() => setMode('manual')}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                  padding: '5px 0',
                  border: 'none',
                  borderRadius: '4px',
                  background: mode === 'manual' ? 'rgba(129, 140, 248, 0.18)' : 'transparent',
                  color: mode === 'manual' ? '#ffffff' : 'var(--text-muted, #94a3b8)',
                  fontSize: '10.5px',
                  fontWeight: mode === 'manual' ? 600 : 400,
                  cursor: 'pointer',
                  transition: 'all 0.15s ease'
                }}
              >
                <Sliders size={11} color={mode === 'manual' ? '#818cf8' : 'currentColor'} />
                <span>Manual Choice</span>
              </button>
            </div>

            {/* Mode-Specific Panel */}
            {mode === 'auto' ? (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '8px',
                  padding: '10px',
                  borderRadius: '6px',
                  background: 'rgba(56, 189, 248, 0.04)',
                  border: '1px solid rgba(56, 189, 248, 0.15)'
                }}
              >
                {/* Auto Selection Banner */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    <span style={{ fontSize: '12px' }}>🤖</span>
                    <span style={{ fontSize: '11px', fontWeight: 700, color: '#f8fafc' }}>
                      Auto (Best model per task)
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '8px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      backgroundColor: 'rgba(16, 185, 129, 0.2)',
                      color: '#34d399',
                      border: '1px solid rgba(16, 185, 129, 0.4)'
                    }}
                  >
                    ACTIVE
                  </span>
                </div>

                <p
                  style={{
                    fontSize: '10px',
                    color: 'var(--text-muted, #94a3b8)',
                    margin: 0,
                    lineHeight: 1.45
                  }}
                >
                  Omni-Debugger automatically selects the optimal model for each analysis phase:
                </p>

                {/* Engine Breakdown List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '10px',
                      color: '#cbd5e1'
                    }}
                  >
                    <Code2 size={11} color="#38bdf8" style={{ flexShrink: 0 }} />
                    <strong style={{ color: '#f1f5f9' }}>Static AST:</strong>
                    <span>Fast code model (Qwen 2.5 Coder Free, Llama 3.3 70B)</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '10px',
                      color: '#cbd5e1'
                    }}
                  >
                    <Activity size={11} color="#34d399" style={{ flexShrink: 0 }} />
                    <strong style={{ color: '#f1f5f9' }}>Dynamic Runtime:</strong>
                    <span>Strong code understanding (DeepSeek R1 Free)</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '10px',
                      color: '#cbd5e1'
                    }}
                  >
                    <Layers size={11} color="#a855f7" style={{ flexShrink: 0 }} />
                    <strong style={{ color: '#f1f5f9' }}>Architectural:</strong>
                    <span>High-capacity reasoning (Claude 3.5 Sonnet / DeepSeek R1)</span>
                  </div>

                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px',
                      fontSize: '10px',
                      color: '#cbd5e1'
                    }}
                  >
                    <Sparkles size={11} color="#fbbf24" style={{ flexShrink: 0 }} />
                    <strong style={{ color: '#f1f5f9' }}>AI Reasoning:</strong>
                    <span>Best available based on keys (Claude &gt; GPT-4o &gt; Free tier)</span>
                  </div>
                </div>

                {/* Free Models Invariant Guarantee Pill */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px',
                    padding: '4px 6px',
                    borderRadius: '4px',
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid rgba(16, 185, 129, 0.22)',
                    fontSize: '9.5px',
                    color: '#34d399',
                    fontWeight: 600
                  }}
                >
                  <ShieldCheck size={11} style={{ flexShrink: 0 }} />
                  <span>Free models strictly prioritized when no paid keys are present.</span>
                </div>
              </div>
            ) : (
              /* Manual Selection Mode Panel */
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {/* Search Box */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '4px 8px',
                    borderRadius: '5px',
                    background: 'rgba(255, 255, 255, 0.04)',
                    border: '1px solid rgba(255, 255, 255, 0.08)'
                  }}
                >
                  <Search size={11} color="var(--text-muted, #94a3b8)" style={{ flexShrink: 0 }} />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search available models..."
                    style={{
                      background: 'transparent',
                      border: 'none',
                      outline: 'none',
                      color: '#ffffff',
                      fontSize: '10.5px',
                      width: '100%'
                    }}
                  />
                </div>

                {/* Available Models List */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {/* Available Now Group */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '2px 4px',
                      fontSize: '10px',
                      fontWeight: 600,
                      color: '#34d399'
                    }}
                  >
                    <span>⚡ Available Now</span>
                    <span style={{ fontSize: '9px', opacity: 0.8 }}>
                      {availableRows.length} models
                    </span>
                  </div>

                  {availableRows.length === 0 ? (
                    <div
                      style={{
                        fontSize: '10px',
                        color: 'var(--text-muted, #94a3b8)',
                        padding: '6px'
                      }}
                    >
                      No models matching query.
                    </div>
                  ) : (
                    availableRows.map((r) => {
                      const isSelected = selectedModelId === r.modelId;
                      return (
                        <button
                          key={`${r.providerId}::${r.modelId}`}
                          type="button"
                          onClick={() => void handleSelectManualModel(r)}
                          style={{
                            display: 'flex',
                            width: '100%',
                            boxSizing: 'border-box',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '6px 8px',
                            borderRadius: '5px',
                            background: isSelected
                              ? 'rgba(129, 140, 248, 0.16)'
                              : 'rgba(255, 255, 255, 0.02)',
                            border: isSelected
                              ? '1px solid #818cf8'
                              : '1px solid rgba(255, 255, 255, 0.04)',
                            cursor: 'pointer',
                            textAlign: 'left',
                            transition: 'all 0.15s ease'
                          }}
                        >
                          <div
                            style={{
                              display: 'flex',
                              flexDirection: 'column',
                              minWidth: 0,
                              gap: '2px'
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                              <span
                                style={{
                                  fontSize: '10.5px',
                                  fontWeight: isSelected ? 600 : 500,
                                  color: isSelected ? '#ffffff' : 'var(--text-primary, #e2e8f0)',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {r.name}
                              </span>

                              {!r.requiresKey && (
                                <span
                                  style={{
                                    fontSize: '8px',
                                    fontWeight: 700,
                                    padding: '0 4px',
                                    borderRadius: '2px',
                                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                                    color: '#34d399',
                                    border: '1px solid rgba(16, 185, 129, 0.4)'
                                  }}
                                >
                                  FREE
                                </span>
                              )}
                              {r.providerId === 'ty-code-free' && (
                                <span
                                  style={{
                                    fontSize: '8px',
                                    fontWeight: 700,
                                    padding: '0 4px',
                                    borderRadius: '2px',
                                    backgroundColor: 'rgba(56, 189, 248, 0.2)',
                                    color: '#38bdf8',
                                    border: '1px solid rgba(56, 189, 248, 0.4)'
                                  }}
                                >
                                  COMMUNITY
                                </span>
                              )}
                            </div>

                            <span
                              style={{
                                fontSize: '9px',
                                color: 'var(--text-muted, #94a3b8)',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              via {r.providerName}
                            </span>
                          </div>

                          {isSelected && (
                            <Check size={12} color="#818cf8" style={{ flexShrink: 0 }} />
                          )}
                        </button>
                      );
                    })
                  )}

                  {/* Locked Models Section */}
                  {lockedRows.length > 0 && (
                    <>
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '6px 4px 2px',
                          fontSize: '10px',
                          fontWeight: 600,
                          color: 'var(--text-muted, #94a3b8)'
                        }}
                      >
                        <span>🔒 Locked (Needs Key)</span>
                        <span style={{ fontSize: '9px' }}>{lockedRows.length}</span>
                      </div>

                      {lockedRows.slice(0, 10).map((r) => (
                        <div
                          key={`locked-${r.providerId}::${r.modelId}`}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '4px 8px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.01)',
                            opacity: 0.6,
                            fontSize: '10px'
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                            <Lock size={10} color="var(--text-muted, #94a3b8)" />
                            <span style={{ color: 'var(--text-muted, #94a3b8)' }}>{r.name}</span>
                          </div>
                          <span style={{ fontSize: '8.5px', color: 'var(--text-muted, #94a3b8)' }}>
                            {r.providerName}
                          </span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>,
          document.body
        )}
    </div>
  );
};
