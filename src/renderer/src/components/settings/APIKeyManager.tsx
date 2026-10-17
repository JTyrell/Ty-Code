/**
 * API Key Manager & Auto-Detection Vault (Phase 6.2)
 *
 * Secure management of AI provider credentials:
 * 1. SafeStorage encryption status badge
 * 2. Auto-detection panel (Environment variables, Git credentials, config files, local runtimes)
 * 3. Stored keys list with Eye toggle (show/hide), Revoke, and Test Connection
 * 4. Regenerate key link to provider's management console
 * 5. Encrypted backup export and import
 *
 * Brand: Ty-Code
 */

import React, { useState, useEffect } from 'react';
import {
  Key,
  Eye,
  EyeOff,
  Trash2,
  RotateCw,
  ExternalLink,
  ShieldCheck,
  Download,
  Upload,
  Check,
  AlertCircle,
  Sparkles,
  Lock,
  Search,
  Server,
  Terminal,
  CheckCircle2,
  FolderOpen
} from 'lucide-react';
import type { DetectedApiKey, StoredKeySummary } from '../../../../shared/types/byok';
import type { CredentialStorageStatus } from '../../../../preload/types';
import { useOnboardingStore } from '../../state/onboarding-store';

export interface APIKeyManagerProps {
  onRefreshStoredKeys?: () => Promise<void>;
  onOpenWizardForProvider?: (providerId: string) => void;
}

export const APIKeyManager: React.FC<APIKeyManagerProps> = ({
  onRefreshStoredKeys,
  onOpenWizardForProvider
}) => {
  const [detectedKeys, setDetectedKeys] = useState<DetectedApiKey[]>([]);
  const [storedKeys, setStoredKeys] = useState<StoredKeySummary[]>([]);
  const [revealedKeys, setRevealedKeys] = useState<Record<string, string>>({});
  const [loadingRevealed, setLoadingRevealed] = useState<Record<string, boolean>>({});
  const [storageStatus, setStorageStatus] = useState<CredentialStorageStatus | null>(null);
  const [isDetecting, setIsDetecting] = useState(false);
  const [importingKeyId, setImportingKeyId] = useState<string | null>(null);
  const [importAllLoading, setImportAllLoading] = useState(false);
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isExporting, setIsExporting] = useState(false);

  // Load initial state
  useEffect(() => {
    void refreshAll();
  }, []);

  const refreshAll = async () => {
    setErrorNotice(null);
    try {
      // 1. Get Storage status
      const statusRes = await window.electronAPI.getCredentialStorageStatus();
      if (statusRes.success && statusRes.data) {
        setStorageStatus(statusRes.data);
      }

      // 2. Get Stored Keys
      if (window.electronAPI.byokGetStoredKeys) {
        const storedRes = await window.electronAPI.byokGetStoredKeys();
        if (storedRes.success && storedRes.data) {
          setStoredKeys(storedRes.data);
        }
      }

      // 3. Scan Auto-Detection
      if (window.electronAPI.byokDetectKeys) {
        setIsDetecting(true);
        const detectRes = await window.electronAPI.byokDetectKeys();
        if (detectRes.success && detectRes.data) {
          setDetectedKeys(detectRes.data);
        }
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIsDetecting(false);
    }
  };

  // Toggle Reveal Key
  const handleToggleReveal = async (providerId: string) => {
    if (revealedKeys[providerId]) {
      // Hide
      setRevealedKeys((prev) => {
        const next = { ...prev };
        delete next[providerId];
        return next;
      });
      return;
    }

    if (!window.electronAPI.byokRevealKey) return;
    setLoadingRevealed((prev) => ({ ...prev, [providerId]: true }));
    setErrorNotice(null);

    try {
      const res = await window.electronAPI.byokRevealKey(providerId);
      if (res.success && res.data) {
        setRevealedKeys((prev) => ({ ...prev, [providerId]: res.data || '' }));
      } else {
        setErrorNotice(res.error || 'Failed to reveal key.');
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingRevealed((prev) => ({ ...prev, [providerId]: false }));
    }
  };

  // Revoke Key
  const handleRevokeKey = async (providerId: string) => {
    if (!window.confirm(`Revoke and remove the API key for ${providerId}? This will remove it from safeStorage.`)) {
      return;
    }

    if (!window.electronAPI.byokRevokeKey) return;
    setErrorNotice(null);

    try {
      const res = await window.electronAPI.byokRevokeKey(providerId);
      if (res.success) {
        setActionNotice(`Key for ${providerId} was successfully revoked.`);
        setTimeout(() => setActionNotice(null), 3500);
        await refreshAll();
        if (onRefreshStoredKeys) await onRefreshStoredKeys();
      } else {
        setErrorNotice(res.error || 'Failed to revoke key.');
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    }
  };

  // Import single detected key
  const handleImportDetectedKey = async (item: DetectedApiKey) => {
    if (!window.electronAPI.byokImportDetectedKey) return;
    setImportingKeyId(item.id);
    setErrorNotice(null);

    try {
      const res = await window.electronAPI.byokImportDetectedKey(item.id, item.providerId);
      if (res.success) {
        setActionNotice(`Imported key for ${item.providerName} from ${item.source}!`);
        setTimeout(() => setActionNotice(null), 3500);
        await refreshAll();
        if (onRefreshStoredKeys) await onRefreshStoredKeys();
      } else {
        setErrorNotice(res.error || 'Failed to import detected key.');
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setImportingKeyId(null);
    }
  };

  // Import all detected keys
  const handleImportAllDetected = async () => {
    if (!window.electronAPI.byokImportDetectedKey) return;
    setImportAllLoading(true);
    setErrorNotice(null);

    try {
      let imported = 0;
      for (const item of detectedKeys) {
        if (!item.isLocalInstance) {
          const res = await window.electronAPI.byokImportDetectedKey(item.id, item.providerId);
          if (res.success) imported++;
        }
      }
      setActionNotice(`Successfully imported and encrypted ${imported} detected keys!`);
      setTimeout(() => setActionNotice(null), 4000);
      await refreshAll();
      if (onRefreshStoredKeys) await onRefreshStoredKeys();
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setImportAllLoading(false);
    }
  };

  // Export encrypted keys backup
  const handleExportBackup = async () => {
    if (!window.electronAPI.byokExportKeys) return;
    setIsExporting(true);
    try {
      const res = await window.electronAPI.byokExportKeys();
      if (res.success && res.data) {
        const blob = new Blob([res.data], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ty-code-keys-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
        setActionNotice('Encrypted keys backup exported successfully!');
        setTimeout(() => setActionNotice(null), 3500);
      }
    } catch (err: unknown) {
      setErrorNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setIsExporting(false);
    }
  };

  // Import backup file
  const handleImportBackupFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      const content = event.target?.result as string;
      if (content && window.electronAPI.byokImportKeys) {
        try {
          const res = await window.electronAPI.byokImportKeys(content);
          if (res.success && res.data) {
            setActionNotice(`Imported ${res.data.importedCount} keys from backup.`);
            setTimeout(() => setActionNotice(null), 4000);
            await refreshAll();
            if (onRefreshStoredKeys) await onRefreshStoredKeys();
          } else {
            setErrorNotice(res.error || 'Failed to import backup.');
          }
        } catch (err: unknown) {
          setErrorNotice(err instanceof Error ? err.message : String(err));
        }
      }
    };
    reader.readAsText(file);
  };

  const filteredStoredKeys = storedKeys.filter((k) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return k.providerName.toLowerCase().includes(q) || k.providerId.toLowerCase().includes(q);
  });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }} id="api-key-manager-root">
      {/* Encryption SafeStorage Banner */}
      <div
        id="storage-encryption-banner"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px',
          padding: '12px 16px',
          borderRadius: '8px',
          background: 'linear-gradient(135deg, rgba(16, 185, 129, 0.1) 0%, rgba(56, 189, 248, 0.05) 100%)',
          border: '1px solid rgba(16, 185, 129, 0.25)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <ShieldCheck size={20} color="#34d399" />
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                Encrypted with Electron safeStorage
              </span>
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: '12px',
                  background: 'rgba(16, 185, 129, 0.2)',
                  color: '#34d399',
                  fontSize: '11px',
                  fontWeight: 600
                }}
              >
                {storageStatus?.backend || 'Hardware/OS Keystore'}
              </span>
            </div>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
              {storageStatus?.message || 'Keys are protected by your operating system keystore (DPAPI / Keychain / Secret Service).'}
            </p>
          </div>
        </div>

        {/* Backup export/import & Setup Wizard */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            id="btn-vault-rerun-wizard"
            onClick={() => useOnboardingStore.getState().openWizard('welcome')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(99, 102, 241, 0.2)',
              border: '1px solid rgba(99, 102, 241, 0.4)',
              color: '#c7d2fe',
              fontSize: '11px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            <Sparkles size={12} color="#818cf8" />
            Setup Wizard
          </button>

          <button
            type="button"
            id="btn-export-keys-backup"
            disabled={isExporting}
            onClick={handleExportBackup}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            <Download size={12} />
            Export Backup
          </button>

          <label
            htmlFor="upload-keys-backup"
            id="label-import-keys-backup"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '5px',
              padding: '6px 10px',
              borderRadius: '6px',
              background: 'rgba(255, 255, 255, 0.06)',
              border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#cbd5e1',
              fontSize: '11px',
              cursor: 'pointer'
            }}
          >
            <Upload size={12} />
            Import Backup
            <input
              id="upload-keys-backup"
              type="file"
              accept=".json"
              style={{ display: 'none' }}
              onChange={handleImportBackupFile}
            />
          </label>
        </div>
      </div>

      {/* Notices */}
      {actionNotice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            background: 'rgba(16, 185, 129, 0.15)',
            border: '1px solid rgba(16, 185, 129, 0.3)',
            color: '#34d399',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          id="manager-action-notice"
        >
          <CheckCircle2 size={14} />
          <span>{actionNotice}</span>
        </div>
      )}

      {errorNotice && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: '6px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            color: '#f87171',
            fontSize: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          id="manager-error-notice"
        >
          <AlertCircle size={14} />
          <span>{errorNotice}</span>
        </div>
      )}

      {/* ============================================================ */}
      {/* AUTO-DETECTION SECTION                                       */}
      {/* ============================================================ */}
      <div
        id="auto-detection-section"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '12px',
          padding: '16px',
          borderRadius: '8px',
          background: 'rgba(30, 41, 59, 0.4)',
          border: '1px solid rgba(255, 255, 255, 0.08)'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Sparkles size={16} color="var(--accent-primary)" />
              Auto-Detected Keys &amp; Local Instances
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
              Discovered from environment variables ($OPENAI_API_KEY), git credentials, and config files.
            </p>
          </div>

          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              type="button"
              id="btn-rescan-keys"
              disabled={isDetecting}
              onClick={() => void refreshAll()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '5px',
                padding: '5px 10px',
                borderRadius: '5px',
                background: 'rgba(255, 255, 255, 0.05)',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                color: '#cbd5e1',
                fontSize: '11px',
                cursor: isDetecting ? 'wait' : 'pointer'
              }}
            >
              <RotateCw size={11} className={isDetecting ? 'spinning' : ''} />
              {isDetecting ? 'Scanning...' : 'Rescan'}
            </button>

            {detectedKeys.some((k) => !k.isLocalInstance) && (
              <button
                type="button"
                id="btn-import-all-detected"
                disabled={importAllLoading}
                onClick={handleImportAllDetected}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '5px',
                  padding: '5px 12px',
                  borderRadius: '5px',
                  background: 'var(--accent-primary)',
                  border: 'none',
                  color: '#ffffff',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: importAllLoading ? 'wait' : 'pointer'
                }}
              >
                <Check size={12} />
                {importAllLoading ? 'Importing All...' : 'Import All Detected'}
              </button>
            )}
          </div>
        </div>

        {detectedKeys.length === 0 ? (
          <div style={{ padding: '12px', textAlign: 'center', color: '#64748b', fontSize: '12px' }}>
            {isDetecting ? 'Scanning environment and configs for credentials...' : 'No external credentials or local instances detected.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {detectedKeys.map((item) => (
              <div
                key={item.id}
                id={`detected-key-row-${item.id}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 12px',
                  borderRadius: '6px',
                  background: 'rgba(15, 23, 42, 0.5)',
                  border: '1px solid rgba(255, 255, 255, 0.06)'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  {item.source === 'env' ? (
                    <Terminal size={15} color="#38bdf8" />
                  ) : item.source === 'local_instance' ? (
                    <Server size={15} color="#10b981" />
                  ) : item.source === 'git_credential' ? (
                    <Key size={15} color="#f59e0b" />
                  ) : (
                    <FolderOpen size={15} color="#a855f7" />
                  )}

                  <div>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: '#f8fafc' }}>
                      {item.providerName}
                    </span>
                    <span style={{ marginLeft: '8px', fontSize: '11px', color: '#94a3b8' }}>
                      {item.sourceDescription}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '11px', fontFamily: 'monospace', color: '#cbd5e1' }}>
                    {item.maskedKey}
                  </span>

                  {!item.isLocalInstance && (
                    <button
                      type="button"
                      id={`btn-import-detected-${item.id}`}
                      disabled={importingKeyId === item.id}
                      onClick={() => void handleImportDetectedKey(item)}
                      style={{
                        padding: '4px 10px',
                        borderRadius: '4px',
                        background: 'rgba(99, 102, 241, 0.2)',
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        color: '#a5b4fc',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      {importingKeyId === item.id ? 'Importing...' : 'Import'}
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ============================================================ */}
      {/* STORED KEYS LIST                                             */}
      {/* ============================================================ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <h4 style={{ margin: 0, fontSize: '14px', fontWeight: 600, color: '#f8fafc' }}>
              Stored Provider Keys ({storedKeys.filter((k) => k.isConfigured).length} Configured)
            </h4>
            <p style={{ margin: '2px 0 0 0', fontSize: '11px', color: '#94a3b8' }}>
              View, reveal, regenerate, or revoke your securely stored credentials.
            </p>
          </div>

          <div style={{ position: 'relative', width: '200px' }}>
            <Search size={13} color="#64748b" style={{ position: 'absolute', left: '8px', top: '50%', transform: 'translateY(-50%)' }} />
            <input
              type="text"
              id="input-filter-stored-keys"
              placeholder="Search keys..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                width: '100%',
                padding: '5px 8px 5px 26px',
                borderRadius: '5px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                background: 'rgba(15, 23, 42, 0.6)',
                color: '#f8fafc',
                fontSize: '11px'
              }}
            />
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }} id="stored-keys-list">
          {filteredStoredKeys.map((item) => {
            const isRevealed = Boolean(revealedKeys[item.providerId]);
            const revealedValue = revealedKeys[item.providerId];
            const isLoadingReveal = Boolean(loadingRevealed[item.providerId]);

            return (
              <div
                key={item.providerId}
                id={`stored-key-row-${item.providerId}`}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: '6px',
                  background: 'rgba(30, 41, 59, 0.35)',
                  border: item.isConfigured ? '1px solid rgba(99, 102, 241, 0.25)' : '1px solid rgba(255, 255, 255, 0.06)'
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '13px', fontWeight: 600, color: '#f8fafc' }}>
                      {item.providerName}
                    </span>
                    {item.isConfigured ? (
                      <span
                        style={{
                          padding: '1px 6px',
                          borderRadius: '4px',
                          background: 'rgba(16, 185, 129, 0.15)',
                          color: '#34d399',
                          fontSize: '10px',
                          fontWeight: 600
                        }}
                      >
                        Configured
                      </span>
                    ) : (
                      <span style={{ fontSize: '11px', color: '#64748b' }}>Not Configured</span>
                    )}
                  </div>

                  {item.isConfigured && (
                    <div style={{ marginTop: '3px', fontSize: '11px', fontFamily: 'monospace', color: '#94a3b8' }}>
                      {isRevealed ? revealedValue : (item.maskedKey || '••••••••••••')}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  {item.isConfigured ? (
                    <>
                      <button
                        type="button"
                        id={`btn-reveal-key-${item.providerId}`}
                        disabled={isLoadingReveal}
                        onClick={() => void handleToggleReveal(item.providerId)}
                        title={isRevealed ? 'Conceal Key' : 'Reveal Key'}
                        style={{
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: 'rgba(255, 255, 255, 0.05)',
                          border: '1px solid rgba(255, 255, 255, 0.1)',
                          color: '#cbd5e1',
                          fontSize: '11px',
                          cursor: 'pointer'
                        }}
                      >
                        {isRevealed ? <EyeOff size={13} /> : <Eye size={13} />}
                      </button>

                      {item.setupUrl && (
                        <button
                          type="button"
                          id={`btn-regenerate-${item.providerId}`}
                          onClick={() => window.electronAPI.openExternal(item.setupUrl!)}
                          title="Open provider console to regenerate API key"
                          style={{
                            padding: '5px 8px',
                            borderRadius: '4px',
                            background: 'rgba(255, 255, 255, 0.05)',
                            border: '1px solid rgba(255, 255, 255, 0.1)',
                            color: '#cbd5e1',
                            fontSize: '11px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px'
                          }}
                        >
                          <ExternalLink size={12} />
                          Regenerate
                        </button>
                      )}

                      <button
                        type="button"
                        id={`btn-revoke-${item.providerId}`}
                        onClick={() => void handleRevokeKey(item.providerId)}
                        title="Revoke and delete key"
                        style={{
                          padding: '5px 8px',
                          borderRadius: '4px',
                          background: 'rgba(239, 68, 68, 0.1)',
                          border: '1px solid rgba(239, 68, 68, 0.25)',
                          color: '#f87171',
                          fontSize: '11px',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: '4px'
                        }}
                      >
                        <Trash2 size={12} />
                        Revoke
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      id={`btn-add-stored-key-${item.providerId}`}
                      onClick={() => onOpenWizardForProvider?.(item.providerId)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '4px',
                        background: 'rgba(99, 102, 241, 0.2)',
                        border: '1px solid rgba(99, 102, 241, 0.4)',
                        color: '#a5b4fc',
                        fontSize: '11px',
                        fontWeight: 600,
                        cursor: 'pointer'
                      }}
                    >
                      Add Key
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
