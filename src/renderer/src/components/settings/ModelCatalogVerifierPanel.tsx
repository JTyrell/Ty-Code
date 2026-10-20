import React, { useEffect, useState, useCallback } from 'react';
import { BadgeCheck, RefreshCw, ShieldAlert, Sparkles, XCircle, Check, Plus, Minus, Pencil } from 'lucide-react';
import type { CatalogVerificationResult, ModelCatalogVerificationSnapshot } from '../../../../preload/types';
import { toast } from '../../state/toast-store';

interface ModelCatalogVerifierPanelProps {
  onCorrectionsApplied?: () => void;
}

export const ModelCatalogVerifierPanel: React.FC<ModelCatalogVerifierPanelProps> = ({ onCorrectionsApplied }) => {
  const [snapshot, setSnapshot] = useState<ModelCatalogVerificationSnapshot | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const loadSnapshot = useCallback(async () => {
    if (!window.electronAPI?.getModelCatalogVerifications) return;
    try {
      const res = await window.electronAPI.getModelCatalogVerifications();
      if (res.success && res.data) setSnapshot(res.data);
    } catch {
      // Silent: snapshot stays null and the panel shows the "not yet verified" hint
    }
  }, []);

  useEffect(() => {
    void loadSnapshot();
    if (window.electronAPI?.onModelCatalogVerified) {
      const unsub = window.electronAPI.onModelCatalogVerified((snap) => {
        setSnapshot(snap);
      });
      return () => {
        unsub?.();
      };
    }
    return undefined;
  }, [loadSnapshot]);

  const handleVerify = useCallback(async () => {
    if (!window.electronAPI?.verifyModelCatalog) {
      toast.error('Catalog verification API not available');
      return;
    }
    setIsVerifying(true);
    try {
      const res = await window.electronAPI.verifyModelCatalog();
      if (res.success && res.data) {
        setSnapshot(res.data);
        const correctedCount = res.data.results.filter((r) => r.corrected).length;
        if (correctedCount > 0) {
          toast.success(`Catalog verified: ${correctedCount} provider database(s) auto-corrected`);
          onCorrectionsApplied?.();
        } else {
          toast.success('Catalog verified: our stored model list already matches live data');
        }
      } else {
        toast.error(res.error || 'Verification failed');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setIsVerifying(false);
    }
  }, [onCorrectionsApplied]);

  const results = snapshot?.results || [];
  const passCount = results.filter((r) => r.status === 'PASS').length;
  const failCount = results.filter((r) => r.status === 'FAIL').length;
  const noKeyCount = results.filter((r) => r.status === 'NO_KEY').length;
  const correctedCount = results.filter((r) => r.corrected).length;
  const shown = expanded ? results : results.slice(0, 4);

  return (
    <div
      style={{
        padding: '12px 16px',
        background: 'rgba(16, 185, 129, 0.08)',
        border: '1px solid rgba(16, 185, 129, 0.3)',
        borderRadius: '10px'
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <BadgeCheck size={16} color="#10b981" />
          <span style={{ fontSize: 13, fontWeight: 600, color: '#f8fafc' }}>Live Model Catalog Verification</span>
          {snapshot && (
            <span style={{ fontSize: 10.5, color: '#6ee7b7' }}>
              checked{' '}
              {new Date(snapshot.updatedAt || Date.now()).toLocaleTimeString()}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void handleVerify()}
          disabled={isVerifying}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            padding: '6px 12px',
            borderRadius: 6,
            background: isVerifying ? 'rgba(16, 185, 129, 0.25)' : '#10b981',
            border: 'none',
            color: '#ffffff',
            fontSize: 11.5,
            fontWeight: 600,
            cursor: isVerifying ? 'wait' : 'pointer',
            whiteSpace: 'nowrap'
          }}
        >
          <RefreshCw size={12} className={isVerifying ? 'animate-spin' : ''} />
          <span>{isVerifying ? 'Verifying Live Models...' : 'Verify Model Database'}</span>
        </button>
      </div>

      <p style={{ margin: '4px 0 0 0', fontSize: 11, color: '#94a3b8' }}>
        Autonomously checks the real names, titles, and availability of every AI offered by your connected
        providers, then corrects our stored models database near instantaneously when reality differs.
      </p>

      {correctedCount > 0 && (
        <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: '#fbbf24' }}>
          <Sparkles size={12} />
          <span>{correctedCount} provider database(s) were corrected after differences were found.</span>
        </div>
      )}

      {results.length > 0 && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 8, fontSize: 11, fontWeight: 500 }}>
            <span style={{ color: '#34d399' }}>{passCount} verified</span>
            <span style={{ color: '#f87171' }}>{failCount} failed</span>
            <span style={{ color: '#9ca3af' }}>{noKeyCount} need a key</span>
          </div>

          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {shown.map((r: CatalogVerificationResult) => {
              const pass = r.status === 'PASS';
              const fail = r.status === 'FAIL';
              return (
                <div
                  key={r.providerId}
                  style={{
                    padding: '8px 10px',
                    borderRadius: 6,
                    background: 'rgba(0, 0, 0, 0.25)',
                    border: pass ? '1px solid rgba(16, 185, 129, 0.25)' : fail ? '1px solid rgba(244, 63, 94, 0.3)' : '1px solid rgba(107, 114, 128, 0.3)'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: '#e5e7eb' }}>{r.providerName}</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 600, color: pass ? '#34d399' : fail ? '#f87171' : '#9ca3af' }}>
                      {pass ? <Check size={11} /> : fail ? <XCircle size={11} /> : null}
                      {pass ? 'MATCHED' : fail ? 'UNREACHABLE' : 'KEY NEEDED'}
                    </span>
                  </div>
                  {(r.corrected || fail) && (
                    <div style={{ marginTop: 4, display: 'flex', flexWrap: 'wrap', gap: 8, fontSize: 10.5 }}>
                      {r.addedModels.map((m) => (
                        <span key={m.modelId} style={{ color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <Plus size={10} /> {m.name || m.modelId}
                        </span>
                      ))}
                      {r.removedModelIds.map((id) => (
                        <span key={id} style={{ color: '#f87171', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <Minus size={10} /> {id}
                        </span>
                      ))}
                      {r.renamedModels.map((rn) => (
                        <span key={rn.modelId} style={{ color: '#fbbf24', display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                          <Pencil size={10} /> {rn.expectedName} is now {rn.liveName}
                        </span>
                      ))}
                    </div>
                  )}
                  {fail && (
                    <div style={{ marginTop: 3, fontSize: 10.5, color: '#fca5a5' }}>
                      <ShieldAlert size={10} style={{ verticalAlign: 'middle', marginRight: 3 }} />
                      {r.error || 'Endpoint did not respond'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {results.length > 4 && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              style={{
                marginTop: 6,
                background: 'transparent',
                border: 'none',
                color: '#818cf8',
                fontSize: 11,
                cursor: 'pointer',
                padding: 0
              }}
            >
              {expanded ? 'Show fewer providers' : `Show all ${results.length} providers`}
            </button>
          )}
        </>
      )}

      {results.length === 0 && (
        <div style={{ marginTop: 8, fontSize: 11, color: '#9ca3af' }}>
          Not verified yet. Verification runs automatically at startup and whenever you save an API key.
        </div>
      )}
    </div>
  );
};
