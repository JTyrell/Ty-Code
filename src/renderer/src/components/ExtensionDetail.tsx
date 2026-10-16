import React, { useState } from 'react';
import {
  X,
  Boxes,
  Download,
  Star,
  ExternalLink,
  CheckCircle,
  Play,
  Terminal,
  Settings,
  ShieldCheck,
  Tag
} from 'lucide-react';
import type { InstalledExtension, ExtensionMetadata } from '../../../preload/types';
import type { MarketplaceExtensionEntry } from '../../../shared/types/marketplace';
import { useExtensionStore } from '../state/extension-store';
import { ExtensionSettings } from './ExtensionSettings';

interface ExtensionDetailProps {
  item: InstalledExtension | ExtensionMetadata | MarketplaceExtensionEntry;
  onClose: () => void;
}

export const ExtensionDetail: React.FC<ExtensionDetailProps> = ({ item, onClose }) => {
  const {
    installed,
    installExtension,
    uninstallExtension,
    toggleExtension,
    executeCommand
  } = useExtensionStore();

  const [activeTab, setActiveTab] = useState<'details' | 'commands' | 'settings'>('details');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [commandFeedback, setCommandFeedback] = useState<string | null>(null);

  // Check if item is an InstalledExtension
  const isInstalledObj = 'manifest' in item;
  const installedRecord = isInstalledObj
    ? (item as InstalledExtension)
    : installed.find((ext) => ext.id === item.id);

  const isInstalled = Boolean(installedRecord);
  const isEnabled = installedRecord?.enabled ?? false;
  const isBuiltIn = installedRecord?.isBuiltIn ?? false;

  const manifest = isInstalledObj
    ? (item as InstalledExtension).manifest
    : {
        name: (item as ExtensionMetadata).name || item.id.split('.')[1] || item.id,
        publisher: (item as ExtensionMetadata).namespace || item.id.split('.')[0] || '',
        version: item.version,
        displayName: item.displayName,
        description: (item as ExtensionMetadata).description || (item as MarketplaceExtensionEntry).shortDescription || '',
        categories: (item as ExtensionMetadata).categories || ['Tools'],
        contributes: {}
      };

  const commands = installedRecord?.isBuiltIn ? installedRecord.manifest.contributes?.commands || [] : [];
  const hasSettings = Boolean(installedRecord?.manifest.contributes?.configuration?.properties);

  const handleRunCommand = async (cmdId: string) => {
    try {
      setCommandFeedback(`Running ${cmdId}...`);
      await executeCommand(cmdId);
      setCommandFeedback(`Successfully executed ${cmdId}`);
      setTimeout(() => setCommandFeedback(null), 3000);
    } catch (err: unknown) {
      setCommandFeedback(`Error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(3px)',
        zIndex: 90,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '640px',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 16px 40px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '16px 20px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: '16px'
          }}
        >
          <div style={{ display: 'flex', gap: '14px', alignItems: 'center' }}>
            <div
              style={{
                width: '54px',
                height: '54px',
                borderRadius: '8px',
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-subtle)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: 'hidden',
                flexShrink: 0
              }}
            >
              {'iconUrl' in item && item.iconUrl ? (
                <img src={item.iconUrl} alt={`${manifest.displayName || manifest.name} extension icon`} referrerPolicy="no-referrer" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              ) : (
                <Boxes size={30} color="var(--accent-primary)" />
              )}
            </div>

            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  {manifest.displayName || manifest.name}
                </span>
                {isBuiltIn && (
                  <span style={{ fontSize: '10px', backgroundColor: 'rgba(139, 92, 246, 0.2)', color: 'var(--accent-primary)', padding: '2px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    BUILT-IN
                  </span>
                )}
              </div>

              <div style={{ fontSize: '12px', color: 'var(--accent-cyan)', marginTop: '2px' }}>
                {manifest.publisher} • v{manifest.version}
              </div>

              {/* Badges / Categories */}
              <div style={{ display: 'flex', gap: '6px', marginTop: '6px', flexWrap: 'wrap' }}>
                {(manifest.categories || ['Tools']).map((cat) => (
                  <span
                    key={cat}
                    style={{
                      fontSize: '10px',
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-muted)',
                      border: '1px solid var(--border-subtle)',
                      padding: '1px 6px',
                      borderRadius: '3px'
                    }}
                  >
                    {cat}
                  </span>
                ))}
              </div>
            </div>
          </div>

          <button onClick={onClose} style={{ padding: '4px', color: 'var(--text-muted)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Action Bar (Install / Enable / Disable / Uninstall / Settings) */}
        <div
          style={{
            padding: '10px 20px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'rgba(255, 255, 255, 0.02)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {isInstalled ? (
              <>
                <button
                  onClick={() => void toggleExtension(installedRecord!.id, !isEnabled)}
                  style={{
                    padding: '6px 14px',
                    borderRadius: '4px',
                    fontSize: '12px',
                    fontWeight: 500,
                    backgroundColor: isEnabled ? 'rgba(239, 68, 68, 0.15)' : 'var(--accent-green)',
                    color: isEnabled ? 'var(--accent-red)' : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    cursor: 'pointer'
                  }}
                  title={isEnabled ? 'Disable extension' : 'Enable extension'}
                >
                  <CheckCircle size={13} />
                  <span>{isEnabled ? 'Disable' : 'Enable'}</span>
                </button>

                {!isBuiltIn && (
                  <button
                    onClick={() => {
                      void uninstallExtension(installedRecord!.id);
                      onClose();
                    }}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border-subtle)'
                    }}
                  >
                    Uninstall
                  </button>
                )}

                {hasSettings && (
                  <button
                    onClick={() => setIsSettingsOpen(true)}
                    style={{
                      padding: '6px 12px',
                      borderRadius: '4px',
                      fontSize: '12px',
                      backgroundColor: 'var(--bg-tertiary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '6px'
                    }}
                  >
                    <Settings size={13} />
                    <span>Configure</span>
                  </button>
                )}
              </>
            ) : (
              <button
                onClick={() => void installExtension(item as ExtensionMetadata)}
                style={{
                  padding: '6px 16px',
                  borderRadius: '4px',
                  fontSize: '12px',
                  fontWeight: 500,
                  backgroundColor: 'var(--accent-primary)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px'
                }}
              >
                <Download size={13} />
                <span>Install</span>
              </button>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', fontSize: '11px', color: 'var(--text-muted)' }}>
            {'downloadCount' in item && item.downloadCount !== undefined && (
              <span>⬇ {item.downloadCount.toLocaleString()} downloads</span>
            )}
            {'rating' in item && item.rating !== undefined && (
              <span style={{ display: 'flex', alignItems: 'center', gap: '3px', color: 'var(--accent-amber)' }}>
                <Star size={11} fill="var(--accent-amber)" /> {item.rating}
              </span>
            )}
            {('publishedDate' in item && item.publishedDate) && (
              <span>Updated: {new Date(item.publishedDate).toLocaleDateString()}</span>
            )}
            <a
              href={`https://github.com/JTyrell/Ty-Code/issues/new?title=%5BSecurity+Report%5D+Extension+${encodeURIComponent(item.id)}&labels=security,extensions&body=${encodeURIComponent(`Extension ID: ${item.id}\nVersion: ${manifest.version}\nPublisher: ${manifest.publisher}\n\nSecurity issue description:\n`)}`}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '4px',
                color: 'var(--accent-red)',
                textDecoration: 'none',
                padding: '2px 6px',
                borderRadius: '3px',
                border: '1px solid rgba(239, 68, 68, 0.3)'
              }}
              title="Report suspicious or malicious extension behavior"
            >
              <ExternalLink size={10} />
              <span>Report</span>
            </a>
          </div>
        </div>

        {/* Tab Selection */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', padding: '0 20px' }}>
          {(['details', 'commands', 'settings'] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: '8px 12px',
                fontSize: '12px',
                fontWeight: 500,
                color: activeTab === tab ? 'var(--accent-primary)' : 'var(--text-secondary)',
                borderBottom: activeTab === tab ? '2px solid var(--accent-primary)' : '2px solid transparent',
                textTransform: 'capitalize'
              }}
            >
              {tab === 'commands' ? `Commands (${commands.length})` : tab}
            </button>
          ))}
        </div>

        {/* Content Body */}
        <div style={{ padding: '20px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {commandFeedback && (
            <div
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                backgroundColor: 'rgba(139, 92, 246, 0.15)',
                border: '1px solid var(--accent-primary)',
                fontSize: '12px',
                color: 'var(--text-primary)'
              }}
            >
              {commandFeedback}
            </div>
          )}

          {activeTab === 'details' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ fontSize: '13px', color: 'var(--text-primary)', lineHeight: 1.6 }}>
                {manifest.description}
              </div>

              <div style={{ marginTop: '12px', padding: '12px', borderRadius: '6px', backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px', color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontWeight: 600, color: 'var(--text-primary)' }}>
                  <ShieldCheck size={14} color="var(--accent-green)" />
                  <span>Extension Security & Isolation</span>
                </div>
                <span>Sandboxed in an isolated Worker thread. Capabilities (filesystem, commands, languages) are mediated by Ty-Code permissions. Dangerous actions (out-of-workspace writes, terminal execution) require explicit user approval.</span>
              </div>
            </div>
          )}

          {activeTab === 'commands' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {commands.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No commands contributed by this extension.
                </div>
              ) : (
                commands.map((cmd) => (
                  <div
                    key={cmd.command}
                    style={{
                      padding: '8px 12px',
                      borderRadius: '6px',
                      backgroundColor: 'var(--bg-tertiary)',
                      border: '1px solid var(--border-subtle)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between'
                    }}
                  >
                    <div>
                      <div style={{ fontSize: '12px', fontWeight: 500, color: 'var(--text-primary)' }}>
                        {cmd.title}
                      </div>
                      <div style={{ fontSize: '11px', fontFamily: 'monospace', color: 'var(--text-muted)' }}>
                        {cmd.command}
                      </div>
                    </div>

                    <button
                      onClick={() => void handleRunCommand(cmd.command)}
                      disabled={!isEnabled}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        padding: '4px 10px',
                        borderRadius: '4px',
                        backgroundColor: isEnabled ? 'var(--accent-primary)' : 'var(--bg-secondary)',
                        color: isEnabled ? '#fff' : 'var(--text-muted)',
                        fontSize: '11px',
                        cursor: isEnabled ? 'pointer' : 'not-allowed'
                      }}
                      title={isEnabled ? 'Execute command' : 'Enable extension to run command'}
                    >
                      <Play size={10} />
                      <span>Run</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'settings' && (
            <div>
              {installedRecord && hasSettings ? (
                <button
                  onClick={() => setIsSettingsOpen(true)}
                  style={{
                    padding: '8px 16px',
                    backgroundColor: 'var(--accent-primary)',
                    color: '#fff',
                    borderRadius: '4px',
                    fontSize: '12px'
                  }}
                >
                  Open Extension Settings Panel
                </button>
              ) : (
                <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                  No configurable settings available.
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Extension Settings Modal Sub-component */}
      {isSettingsOpen && installedRecord && (
        <ExtensionSettings
          extension={installedRecord}
          onClose={() => setIsSettingsOpen(false)}
        />
      )}
    </div>
  );
};
