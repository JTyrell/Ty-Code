import React, { useState } from 'react';
import { X, Settings, Check, RotateCcw } from 'lucide-react';
import type { InstalledExtension } from '../../../preload/types';
import { useExtensionStore } from '../state/extension-store';
import { toast } from '../state/toast-store';

interface ExtensionSettingsProps {
  extension: InstalledExtension;
  onClose: () => void;
}

export const ExtensionSettings: React.FC<ExtensionSettingsProps> = ({ extension, onClose }) => {
  const { updateSettings } = useExtensionStore();
  const config = extension.manifest.contributes?.configuration;
  const properties = config?.properties || {};

  const [formState, setFormState] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      initial[key] = extension.settings?.[key] !== undefined ? extension.settings[key] : prop.default;
    }
    return initial;
  });

  const [isSaved, setIsSaved] = useState(false);

  const handleSave = async () => {
    const saved = await updateSettings(extension.id, formState);
    if (!saved) {
      toast.error('Failed to save extension settings', extension.manifest.displayName || extension.manifest.name);
      return;
    }
    toast.success('Extension settings saved', extension.manifest.displayName || extension.manifest.name);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2000);
  };

  const handleReset = () => {
    const defaults: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      defaults[key] = prop.default;
    }
    setFormState(defaults);
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.6)',
        backdropFilter: 'blur(3px)',
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '540px',
          maxHeight: '85vh',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 12px 32px rgba(0,0,0,0.6)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 16px',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-tertiary)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Settings size={16} color="var(--accent-primary)" />
            <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)' }}>
              Settings: {extension.manifest.displayName || extension.manifest.name}
            </span>
          </div>

          <button onClick={onClose} style={{ padding: '4px', color: 'var(--text-muted)' }}>
            <X size={15} />
          </button>
        </div>

        {/* Settings Body */}
        <div style={{ padding: '16px', flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {Object.keys(properties).length === 0 ? (
            <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No configurable settings defined for this extension.
            </div>
          ) : (
            Object.entries(properties).map(([key, prop]) => {
              const currentValue = formState[key];

              return (
                <div
                  key={key}
                  style={{
                    padding: '10px',
                    borderRadius: '6px',
                    backgroundColor: 'var(--bg-tertiary)',
                    border: '1px solid var(--border-subtle)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '6px'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: '12px', fontWeight: 600, color: 'var(--text-primary)' }}>
                      {key}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--accent-cyan)', textTransform: 'uppercase' }}>
                      {prop.type}
                    </span>
                  </div>

                  {prop.description && (
                    <span style={{ fontSize: '11px', color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                      {prop.description}
                    </span>
                  )}

                  {/* Input Rendering based on Type */}
                  <div style={{ marginTop: '4px' }}>
                    {prop.type === 'boolean' ? (
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12px' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(currentValue)}
                          onChange={(e) => setFormState({ ...formState, [key]: e.target.checked })}
                          style={{ accentColor: 'var(--accent-primary)', width: '15px', height: '15px' }}
                        />
                        <span style={{ color: currentValue ? 'var(--accent-green)' : 'var(--text-muted)' }}>
                          {currentValue ? 'Enabled' : 'Disabled'}
                        </span>
                      </label>
                    ) : prop.enum && Array.isArray(prop.enum) ? (
                      <select
                        value={String(currentValue || '')}
                        onChange={(e) => setFormState({ ...formState, [key]: e.target.value })}
                        style={{
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          fontSize: '12px',
                          outline: 'none',
                          width: '100%',
                          maxWidth: '250px'
                        }}
                      >
                        {prop.enum.map((opt) => (
                          <option key={String(opt)} value={String(opt)}>
                            {String(opt)}
                          </option>
                        ))}
                      </select>
                    ) : prop.type === 'number' ? (
                      <input
                        type="number"
                        value={Number(currentValue) || 0}
                        onChange={(e) => setFormState({ ...formState, [key]: parseFloat(e.target.value) || 0 })}
                        style={{
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          fontSize: '12px',
                          width: '100px'
                        }}
                      />
                    ) : (
                      <input
                        type="text"
                        value={String(currentValue || '')}
                        onChange={(e) => setFormState({ ...formState, [key]: e.target.value })}
                        style={{
                          backgroundColor: 'var(--bg-primary)',
                          color: 'var(--text-primary)',
                          border: '1px solid var(--border-subtle)',
                          borderRadius: '4px',
                          padding: '4px 8px',
                          fontSize: '12px',
                          width: '100%'
                        }}
                      />
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Actions */}
        <div
          style={{
            padding: '12px 16px',
            borderTop: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            backgroundColor: 'var(--bg-tertiary)'
          }}
        >
          <button
            onClick={handleReset}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 12px',
              backgroundColor: 'transparent',
              color: 'var(--text-muted)',
              fontSize: '12px',
              borderRadius: '4px'
            }}
            title="Reset settings to manifest defaults"
          >
            <RotateCcw size={13} />
            <span>Reset Defaults</span>
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={onClose}
              style={{
                padding: '6px 14px',
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border-subtle)',
                borderRadius: '4px',
                fontSize: '12px'
              }}
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              style={{
                padding: '6px 16px',
                backgroundColor: isSaved ? 'var(--accent-green)' : 'var(--accent-primary)',
                color: '#fff',
                borderRadius: '4px',
                fontSize: '12px',
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              {isSaved ? <Check size={14} /> : null}
              <span>{isSaved ? 'Saved!' : 'Save Configuration'}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
