import React from 'react';
import { GitBranch, AlertCircle, Cpu, Check } from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';

export const StatusBar: React.FC = () => {
  const { openTabs, activeTabPath } = useWorkspaceStore();
  const { settings } = useChatStore();

  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const language = activeTab?.language || 'plaintext';

  return (
    <div
      style={{
        height: '22px',
        backgroundColor: '#1f2128',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 8px',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        userSelect: 'none',
        zIndex: 5
      }}
    >
      {/* Left Items: Git Branch & Diagnostic Counts */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }} title="Git Branch">
          <GitBranch size={12} color="var(--accent-primary)" />
          <span>master</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }} title="Diagnostics: 0 Errors, 0 Warnings">
          <AlertCircle size={11} color="var(--accent-green)" />
          <span>0 errors</span>
        </div>
      </div>

      {/* Right Items: Editor Stats, Encoding, Language, Model */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <span>Ln 1, Col 1</span>
        <span>Spaces: 2</span>
        <span>UTF-8</span>
        <span style={{ textTransform: 'capitalize', color: 'var(--accent-cyan)' }}>{language}</span>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px', color: 'var(--text-primary)' }} title="Active AI Engine">
          <Cpu size={12} color="var(--accent-primary)" />
          <span>{settings?.activeModel?.split('/').pop() || 'DeepSeek V3'}</span>
        </div>
      </div>
    </div>
  );
};
