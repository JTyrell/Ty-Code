/**
 * BYOK Setup Wizard (Phase 6.2)
 *
 * 5-Step guided wizard for adding API keys:
 * Step 1: Choose Provider (cards with free tier info)
 * Step 2: Get API Key (link/signup instructions with copy button)
 * Step 3: Enter API Key (secure field + eye toggle + Test Connection)
 * Step 4: Select Models (checklist with capability badges)
 * Step 5: Done (success summary + Start Coding button)
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Check,
  ChevronRight,
  ChevronLeft,
  Key,
  Eye,
  EyeOff,
  RotateCw,
  ExternalLink,
  Copy,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Server,
  Layers,
  ArrowRight,
  Code2,
  Search,
  X,
  Filter
} from 'lucide-react';
import type { FreeProvider } from '../../../../shared/types/free-providers';
import type { DiscoveredModel, TestConnectionResult } from '../../../../preload/types';

export interface BYOKWizardProps {
  freeProviders: FreeProvider[];
  initialProviderId?: string;
  onComplete: (config: { providerId: string; apiKey: string; selectedModel?: string; selectedModels?: string[] }) => Promise<void>;
  onClose: () => void;
  onStartCoding: () => void;
}

export const BYOKWizard: React.FC<BYOKWizardProps> = ({
  freeProviders,
  initialProviderId,
  onComplete,
  onClose,
  onStartCoding
}) => {
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);
  const [selectedProviderId, setSelectedProviderId] = useState<string>(initialProviderId || 'openrouter-free');
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);
  const [discoveredModels, setDiscoveredModels] = useState<DiscoveredModel[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>('');
  const [selectedModelsList, setSelectedModelsList] = useState<string[]>([]);
  const [modelFilterQuery, setModelFilterQuery] = useState('');
  const [modelFilterCategory, setModelFilterCategory] = useState<'all' | 'free' | 'coding' | 'reasoning' | 'selected'>('all');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const selectedProvider = freeProviders.find((p) => p.id === selectedProviderId) || freeProviders[0];

  useEffect(() => {
    if (initialProviderId) {
      setSelectedProviderId(initialProviderId);
    }
  }, [initialProviderId]);

  // Handle Testing Connection in Step 3
  const handleTestConnection = async () => {
    if (!apiKey.trim() && selectedProvider.auth_type !== 'anonymous') {
      setErrorMsg('Please enter an API key to test.');
      return;
    }
    setErrorMsg('');
    setIsTesting(true);
    setTestResult(null);

    try {
      const cleanId = selectedProvider.id.replace('-free', '');
      const endpoint = selectedProvider.base_url !== 'auto' ? selectedProvider.base_url : undefined;
      const testResponse = await window.electronAPI.providerTestConnection({
        providerId: cleanId,
        apiKey: apiKey.trim(),
        customEndpoint: endpoint
      });
      if (!testResponse.success || !testResponse.data) throw new Error(testResponse.error || 'Connection verification failed.');
      const result = testResponse.data;

      if (result.success) {
        setTestResult(result);
        // Fetch models only after the user initiates this explicit provider check.
        try {
          const modelsResponse = await window.electronAPI.providerGetModels({
            providerId: cleanId,
            apiKey: apiKey.trim(),
            customEndpoint: endpoint
          });

          const modelsRes = modelsResponse.success ? modelsResponse.data : undefined;
          if (modelsRes && modelsRes.length > 0) {
            setDiscoveredModels(modelsRes);
            setSelectedModel(modelsRes[0].id);
            setSelectedModelsList([modelsRes[0].id]);
          } else if (selectedProvider.best_free_models?.length) {
            const fallbackList: DiscoveredModel[] = selectedProvider.best_free_models.map((m) => ({
              id: m,
              name: m,
              provider: selectedProvider.id,
              isFree: true,
              category: 'Free' as const
            }));
            setDiscoveredModels(fallbackList);
            setSelectedModel(fallbackList[0].id);
            setSelectedModelsList([fallbackList[0].id]);
          }
        } catch {
          // Fallback to provider's curated free models
          if (selectedProvider.best_free_models?.length) {
            const fallbackList: DiscoveredModel[] = selectedProvider.best_free_models.map((m) => ({
              id: m,
              name: m,
              provider: selectedProvider.id,
              isFree: true,
              category: 'Free' as const
            }));
            setDiscoveredModels(fallbackList);
            setSelectedModel(fallbackList[0].id);
            setSelectedModelsList([fallbackList[0].id]);
          }
        }
      } else {
        setTestResult(result);
        setErrorMsg(result.error || 'Connection verification failed. Please check your key.');
      }
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsTesting(false);
    }
  };

  const handleCopySignupUrl = async () => {
    if (selectedProvider?.signup_url) {
      await navigator.clipboard.writeText(selectedProvider.signup_url);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 2000);
    }
  };

  const handleOpenSignupUrl = () => {
    if (selectedProvider?.signup_url) {
      void window.electronAPI.openExternal(selectedProvider.signup_url);
    }
  };

  const handleFinishWizard = async () => {
    setIsSaving(true);
    try {
      await onComplete({
        providerId: selectedProvider.id,
        apiKey: apiKey.trim(),
        selectedModel: selectedModel || discoveredModels[0]?.id || selectedProvider.best_free_models?.[0],
        selectedModels: selectedModelsList
      });
      setStep(5);
    } catch (err: unknown) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleModelSelection = (modelId: string) => {
    if (selectedModelsList.includes(modelId)) {
      setSelectedModelsList(selectedModelsList.filter((m) => m !== modelId));
    } else {
      setSelectedModelsList([...selectedModelsList, modelId]);
    }
  };

  const allModels: DiscoveredModel[] = useMemo(() => {
    if (discoveredModels.length > 0) return discoveredModels;
    return (selectedProvider.best_free_models || []).map((m) => ({
      id: m,
      name: m,
      provider: selectedProvider.id,
      isFree: true,
      category: 'Free' as const
    }));
  }, [discoveredModels, selectedProvider]);

  const filteredModels = useMemo(() => {
    return allModels.filter((model) => {
      const q = modelFilterQuery.trim().toLowerCase();
      const matchesSearch = !q || model.name.toLowerCase().includes(q) || model.id.toLowerCase().includes(q);
      if (!matchesSearch) return false;

      if (modelFilterCategory === 'free') {
        return Boolean(model.isFree || model.category === 'Free' || model.id.toLowerCase().includes(':free'));
      }
      if (modelFilterCategory === 'coding') {
        const idLower = (model.id + ' ' + model.name).toLowerCase();
        return (
          idLower.includes('code') ||
          idLower.includes('coder') ||
          idLower.includes('qwen') ||
          idLower.includes('deepseek') ||
          idLower.includes('claude') ||
          idLower.includes('gpt') ||
          idLower.includes('dev')
        );
      }
      if (modelFilterCategory === 'reasoning') {
        const idLower = (model.id + ' ' + model.name).toLowerCase();
        return (
          idLower.includes('reason') ||
          idLower.includes('r1') ||
          idLower.includes('think') ||
          idLower.includes('o1') ||
          idLower.includes('o3') ||
          idLower.includes('qwq')
        );
      }
      if (modelFilterCategory === 'selected') {
        return selectedModelsList.includes(model.id) || selectedModel === model.id;
      }
      return true;
    });
  }, [allModels, modelFilterQuery, modelFilterCategory, selectedModelsList, selectedModel]);

  const handleSelectAllFiltered = () => {
    const toAdd = filteredModels.map((m) => m.id);
    const updated = Array.from(new Set([...selectedModelsList, ...toAdd]));
    setSelectedModelsList(updated);
    if (!selectedModel && toAdd.length > 0) {
      setSelectedModel(toAdd[0]);
    }
  };

  const handleDeselectAll = () => {
    setSelectedModelsList([]);
  };

  return (
    <div
      id="byok-wizard-root"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        background: 'rgba(15, 23, 42, 0.8)',
        borderRadius: '12px',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        padding: '24px',
        color: '#f8fafc'
      }}
    >
      {/* Wizard Step Progress Tracker */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          paddingBottom: '16px'
        }}
        id="wizard-step-tracker"
      >
        {[
          { num: 1, label: '1. Provider' },
          { num: 2, label: '2. Get Key' },
          { num: 3, label: '3. Enter Key' },
          { num: 4, label: '4. Select Models' },
          { num: 5, label: '5. Done' }
        ].map((s) => (
          <div
            key={s.num}
            id={`wizard-step-indicator-${s.num}`}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '12px',
              fontWeight: 600,
              color: step === s.num ? 'var(--accent-primary)' : step > s.num ? '#34d399' : '#64748b'
            }}
          >
            <div
              style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background:
                  step === s.num
                    ? 'var(--accent-primary)'
                    : step > s.num
                      ? 'rgba(16, 185, 129, 0.2)'
                      : 'rgba(255, 255, 255, 0.05)',
                color: step === s.num ? '#ffffff' : step > s.num ? '#34d399' : '#64748b',
                border: step > s.num ? '1px solid #10b981' : 'none'
              }}
            >
              {step > s.num ? <Check size={14} /> : s.num}
            </div>
            <span>{s.label}</span>
          </div>
        ))}
      </div>

      {errorMsg && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#fca5a5',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          id="wizard-error-banner"
        >
          <AlertCircle size={15} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 1: CHOOSE PROVIDER                                      */}
      {/* ============================================================ */}
      {step === 1 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="step-1-choose-provider">
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Choose AI Provider</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Select a provider to connect your personal API key or use their generous free tiers.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
              gap: '12px',
              maxHeight: '340px',
              overflowY: 'auto',
              paddingRight: '4px'
            }}
          >
            {freeProviders.map((p) => {
              const isSelected = selectedProviderId === p.id;
              return (
                <div
                  key={p.id}
                  id={`wizard-provider-card-${p.id}`}
                  onClick={() => setSelectedProviderId(p.id)}
                  style={{
                    padding: '12px',
                    borderRadius: '8px',
                    border: isSelected ? '2px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                    background: isSelected ? 'rgba(99, 102, 241, 0.15)' : 'rgba(30, 41, 59, 0.4)',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    transition: 'all 0.15s ease'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontWeight: 600, fontSize: '13px', color: '#f8fafc' }}>{p.name}</span>
                    {isSelected && <CheckCircle2 size={16} color="var(--accent-primary)" />}
                  </div>

                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                    {p.setup_instructions}
                  </span>

                  {p.best_free_models?.length > 0 && (
                    <span
                      style={{
                        alignSelf: 'flex-start',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: 'rgba(16, 185, 129, 0.15)',
                        color: '#34d399',
                        fontSize: '10px',
                        fontWeight: 600
                      }}
                    >
                      {p.best_free_models.length} Free Models Available
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '10px' }}>
            <button
              type="button"
              id="wizard-btn-cancel-1"
              onClick={onClose}
              style={{
                padding: '8px 14px',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              id="wizard-btn-next-1"
              onClick={() => {
                setErrorMsg('');
                setStep(2);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '6px',
                background: 'var(--accent-primary)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Continue to Step 2
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 2: GET API KEY                                          */}
      {/* ============================================================ */}
      {step === 2 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="step-2-get-api-key">
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>
              Get Your {selectedProvider.name} API Key
            </h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Follow these simple instructions to generate or copy your free or custom API key.
            </p>
          </div>

          <div
            style={{
              padding: '16px',
              borderRadius: '8px',
              background: 'rgba(30, 41, 59, 0.5)',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '12px'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--accent-primary)" />
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>Instructions</span>
            </div>

            <p style={{ margin: 0, fontSize: '12px', color: '#cbd5e1', lineHeight: '1.6' }}>
              {selectedProvider.setup_instructions}
            </p>

            {selectedProvider.signup_url && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '6px' }}>
                <button
                  type="button"
                  id="wizard-btn-open-browser"
                  onClick={handleOpenSignupUrl}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 14px',
                    borderRadius: '6px',
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: '1px solid rgba(99, 102, 241, 0.4)',
                    color: '#a5b4fc',
                    fontSize: '12px',
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  <ExternalLink size={13} />
                  Open {selectedProvider.name} Key Portal
                </button>

                <button
                  type="button"
                  id="wizard-btn-copy-url"
                  onClick={handleCopySignupUrl}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 12px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.1)',
                    color: '#94a3b8',
                    fontSize: '12px',
                    cursor: 'pointer'
                  }}
                >
                  {copiedUrl ? <Check size={13} color="#34d399" /> : <Copy size={13} />}
                  {copiedUrl ? 'Copied URL!' : 'Copy Portal URL'}
                </button>
              </div>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
            <button
              type="button"
              id="wizard-btn-back-2"
              onClick={() => setStep(1)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 14px',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <ChevronLeft size={14} />
              Back
            </button>

            <button
              type="button"
              id="wizard-btn-next-2"
              onClick={() => {
                setErrorMsg('');
                setStep(3);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '6px',
                background: 'var(--accent-primary)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              I Have My Key
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 3: ENTER API KEY                                        */}
      {/* ============================================================ */}
      {step === 3 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="step-3-enter-api-key">
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Enter Your API Key</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Your key is encrypted locally using operating-system safeStorage and never leaves your machine.
            </p>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <label htmlFor="wizard-input-api-key" style={{ fontSize: '12px', fontWeight: 500, color: '#cbd5e1' }}>
              API Key for {selectedProvider.name}
            </label>

            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <input
                id="wizard-input-api-key"
                type={showKey ? 'text' : 'password'}
                placeholder={`Paste your ${selectedProvider.name} key (sk-...)`}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 40px 9px 12px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.7)',
                  color: '#f8fafc',
                  fontSize: '13px',
                  fontFamily: 'monospace'
                }}
              />

              <button
                type="button"
                id="wizard-btn-toggle-show-key"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? 'Hide key' : 'Show key'}
                style={{
                  position: 'absolute',
                  right: '10px',
                  background: 'none',
                  border: 'none',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: '4px'
                }}
              >
                {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Test Connection Button & Indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <button
              type="button"
              id="wizard-btn-test-connection"
              disabled={isTesting || (!apiKey.trim() && selectedProvider.auth_type !== 'anonymous')}
              onClick={handleTestConnection}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 14px',
                borderRadius: '6px',
                background: 'rgba(255, 255, 255, 0.08)',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#f8fafc',
                fontSize: '12px',
                fontWeight: 600,
                cursor: isTesting ? 'wait' : 'pointer'
              }}
            >
              <RotateCw size={13} className={isTesting ? 'spinning' : ''} />
              {isTesting ? 'Testing Connection...' : 'Test Connection'}
            </button>

            {testResult?.success && (
              <span style={{ color: '#34d399', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                <CheckCircle2 size={14} />
                Connection verified ({testResult.latencyMs || 0}ms)
              </span>
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
            <button
              type="button"
              id="wizard-btn-back-3"
              onClick={() => setStep(2)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 14px',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <ChevronLeft size={14} />
              Back
            </button>

            <button
              type="button"
              id="wizard-btn-next-3"
              disabled={!apiKey.trim() && selectedProvider.auth_type !== 'anonymous'}
              onClick={() => {
                setErrorMsg('');
                // If not tested yet, automatically trigger test or advance to model picker
                if (!discoveredModels.length && selectedProvider.best_free_models?.length) {
                  const fallbackList: DiscoveredModel[] = selectedProvider.best_free_models.map((m) => ({
                    id: m,
                    name: m,
                    provider: selectedProvider.id,
                    isFree: true,
                    category: 'Free' as const
                  }));
                  setDiscoveredModels(fallbackList);
                  setSelectedModel(fallbackList[0].id);
                  setSelectedModelsList([fallbackList[0].id]);
                }
                setStep(4);
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 16px',
                borderRadius: '6px',
                background: 'var(--accent-primary)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              Continue to Models
              <ChevronRight size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 4: SELECT MODELS                                        */}
      {/* ============================================================ */}
      {step === 4 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }} id="step-4-select-models">
          <div>
            <h3 style={{ margin: 0, fontSize: '16px', fontWeight: 600 }}>Select Preferred Models</h3>
            <p style={{ margin: '4px 0 0 0', fontSize: '13px', color: '#94a3b8' }}>
              Choose which models from {selectedProvider.name} to activate for coding, reasoning, and quick edits.
            </p>
          </div>

          {/* Search & Filter Toolbar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {/* Search Input with Clear Button */}
            <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '12px',
                  color: '#94a3b8',
                  pointerEvents: 'none'
                }}
              />
              <input
                id="wizard-model-search-input"
                type="text"
                placeholder="Search models by name or ID (e.g., qwen, deepseek, coder, sonnet)..."
                value={modelFilterQuery}
                onChange={(e) => setModelFilterQuery(e.target.value)}
                style={{
                  width: '100%',
                  padding: '8px 34px 8px 34px',
                  borderRadius: '6px',
                  border: '1px solid rgba(255, 255, 255, 0.15)',
                  background: 'rgba(15, 23, 42, 0.7)',
                  color: '#f8fafc',
                  fontSize: '12px'
                }}
              />
              {modelFilterQuery && (
                <button
                  type="button"
                  id="wizard-btn-clear-search"
                  onClick={() => setModelFilterQuery('')}
                  title="Clear search"
                  style={{
                    position: 'absolute',
                    right: '10px',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    padding: '2px',
                    display: 'flex',
                    alignItems: 'center'
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>

            {/* Category Filter Pills & Selection Controls */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                flexWrap: 'wrap',
                gap: '8px'
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', alignItems: 'center', gap: '3px' }}>
                  <Filter size={11} /> Filter:
                </span>
                {[
                  { id: 'all', label: 'All' },
                  { id: 'free', label: 'Free Tier' },
                  { id: 'coding', label: 'Coding' },
                  { id: 'reasoning', label: 'Reasoning' },
                  { id: 'selected', label: `Selected (${selectedModelsList.length})` }
                ].map((chip) => {
                  const isActive = modelFilterCategory === chip.id;
                  return (
                    <button
                      key={chip.id}
                      type="button"
                      id={`wizard-filter-chip-${chip.id}`}
                      onClick={() => setModelFilterCategory(chip.id as any)}
                      style={{
                        padding: '3px 10px',
                        borderRadius: '12px',
                        fontSize: '11px',
                        fontWeight: 500,
                        border: isActive ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.12)',
                        background: isActive ? 'rgba(99, 102, 241, 0.25)' : 'rgba(255, 255, 255, 0.04)',
                        color: isActive ? '#ffffff' : '#cbd5e1',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease'
                      }}
                    >
                      {chip.label}
                    </button>
                  );
                })}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {filteredModels.length} of {allModels.length} models
                </span>
                <button
                  type="button"
                  id="wizard-btn-select-all-filtered"
                  onClick={handleSelectAllFiltered}
                  disabled={filteredModels.length === 0}
                  style={{
                    padding: '2px 8px',
                    borderRadius: '4px',
                    fontSize: '11px',
                    fontWeight: 500,
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    color: '#e2e8f0',
                    cursor: 'pointer'
                  }}
                >
                  Select All
                </button>
                {selectedModelsList.length > 0 && (
                  <button
                    type="button"
                    id="wizard-btn-deselect-all"
                    onClick={handleDeselectAll}
                    style={{
                      padding: '2px 8px',
                      borderRadius: '4px',
                      fontSize: '11px',
                      fontWeight: 500,
                      background: 'transparent',
                      border: '1px solid rgba(239, 68, 68, 0.3)',
                      color: '#f87171',
                      cursor: 'pointer'
                    }}
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>
          </div>

          <div
            style={{
              maxHeight: '260px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              paddingRight: '4px'
            }}
          >
            {filteredModels.length === 0 ? (
              <div
                style={{
                  padding: '24px 16px',
                  textAlign: 'center',
                  background: 'rgba(30, 41, 59, 0.3)',
                  borderRadius: '6px',
                  border: '1px dashed rgba(255, 255, 255, 0.1)'
                }}
              >
                <p style={{ margin: 0, fontSize: '13px', color: '#94a3b8' }}>
                  No models match your current search or category filter.
                </p>
                <button
                  type="button"
                  onClick={() => {
                    setModelFilterQuery('');
                    setModelFilterCategory('all');
                  }}
                  style={{
                    marginTop: '8px',
                    padding: '4px 12px',
                    borderRadius: '4px',
                    background: 'rgba(99, 102, 241, 0.2)',
                    border: '1px solid rgba(99, 102, 241, 0.4)',
                    color: '#c7d2fe',
                    fontSize: '11px',
                    cursor: 'pointer',
                    fontWeight: 500
                  }}
                >
                  Reset Filter
                </button>
              </div>
            ) : (
              filteredModels.map((model) => {
                const isChecked = selectedModelsList.includes(model.id) || selectedModel === model.id;
                const isDefault = selectedModel === model.id;

                return (
                  <div
                    key={model.id}
                    id={`wizard-model-row-${model.id}`}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 14px',
                      borderRadius: '6px',
                      border: isDefault ? '1px solid var(--accent-primary)' : '1px solid rgba(255, 255, 255, 0.08)',
                      background: isDefault ? 'rgba(99, 102, 241, 0.12)' : 'rgba(30, 41, 59, 0.4)'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input
                        type="checkbox"
                        id={`chk-model-${model.id}`}
                        checked={isChecked}
                        onChange={() => toggleModelSelection(model.id)}
                        style={{ cursor: 'pointer' }}
                      />
                      <div>
                        <span style={{ fontSize: '13px', fontWeight: 500, color: '#f8fafc' }}>
                          {model.name}
                        </span>
                        {model.name !== model.id && (
                          <span style={{ fontSize: '11px', color: '#64748b', marginLeft: '6px', fontFamily: 'monospace' }}>
                            {model.id}
                          </span>
                        )}
                        <div style={{ display: 'flex', gap: '6px', marginTop: '2px' }}>
                          {model.isFree && (
                            <span style={{ fontSize: '10px', color: '#34d399', fontWeight: 600 }}>Free</span>
                          )}
                          {model.category && (
                            <span style={{ fontSize: '10px', color: '#94a3b8' }}>({model.category})</span>
                          )}
                        </div>
                      </div>
                    </div>

                    <button
                      type="button"
                      id={`btn-set-default-${model.id}`}
                      onClick={() => {
                        setSelectedModel(model.id);
                        if (!selectedModelsList.includes(model.id)) {
                          setSelectedModelsList([...selectedModelsList, model.id]);
                        }
                      }}
                      style={{
                        padding: '4px 8px',
                        borderRadius: '4px',
                        background: isDefault ? 'var(--accent-primary)' : 'rgba(255, 255, 255, 0.05)',
                        border: 'none',
                        color: isDefault ? '#ffffff' : '#94a3b8',
                        fontSize: '11px',
                        cursor: 'pointer',
                        fontWeight: 600
                      }}
                    >
                      {isDefault ? 'Active Default' : 'Set as Default'}
                    </button>
                  </div>
                );
              })
            )}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px' }}>
            <button
              type="button"
              id="wizard-btn-back-4"
              onClick={() => setStep(3)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                padding: '8px 14px',
                borderRadius: '6px',
                background: 'transparent',
                border: '1px solid rgba(255, 255, 255, 0.15)',
                color: '#cbd5e1',
                fontSize: '12px',
                cursor: 'pointer'
              }}
            >
              <ChevronLeft size={14} />
              Back
            </button>

            <button
              type="button"
              id="wizard-btn-save-finish"
              disabled={isSaving}
              onClick={handleFinishWizard}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '8px 18px',
                borderRadius: '6px',
                background: 'linear-gradient(135deg, #10b981 0%, #059669 100%)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '12px',
                cursor: isSaving ? 'wait' : 'pointer',
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
              }}
            >
              {isSaving ? 'Encrypting & Saving...' : 'Save & Finish'}
              <Check size={14} />
            </button>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* STEP 5: DONE                                                 */}
      {/* ============================================================ */}
      {step === 5 && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            padding: '24px 12px',
            gap: '16px'
          }}
          id="step-5-done"
        >
          <div
            style={{
              width: '56px',
              height: '56px',
              borderRadius: '50%',
              background: 'rgba(16, 185, 129, 0.2)',
              border: '2px solid #10b981',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#34d399'
            }}
          >
            <CheckCircle2 size={32} />
          </div>

          <div>
            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: '#f8fafc' }}>
              {selectedProvider.name} Successfully Connected!
            </h3>
            <p style={{ margin: '6px 0 0 0', fontSize: '13px', color: '#94a3b8', maxWidth: '420px' }}>
              Your API key has been encrypted into operating-system safeStorage. Active model set to{' '}
              <strong style={{ color: '#38bdf8' }}>{selectedModel || 'Default Model'}</strong>.
            </p>
          </div>

          <div
            style={{
              display: 'flex',
              gap: '12px',
              marginTop: '12px'
            }}
          >
            <button
              type="button"
              id="wizard-btn-start-coding"
              onClick={onStartCoding}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '10px 22px',
                borderRadius: '8px',
                background: 'linear-gradient(135deg, #0ea5e9 0%, #6366f1 100%)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                fontSize: '13px',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(14, 165, 233, 0.4)'
              }}
            >
              <Code2 size={16} />
              Start Coding
            </button>

            <button
              type="button"
              id="wizard-btn-close-done"
              onClick={onClose}
              style={{
                padding: '10px 18px',
                borderRadius: '8px',
                background: 'rgba(255, 255, 255, 0.06)',
                border: '1px solid rgba(255, 255, 255, 0.12)',
                color: '#cbd5e1',
                fontSize: '13px',
                cursor: 'pointer'
              }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
