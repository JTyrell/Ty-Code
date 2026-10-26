import React from 'react';
import { Folder, Brain, Bug, LayoutGrid } from 'lucide-react';
import { useWorkspaceSessionStore } from '../../state/workspace-session-store';
import type { WorkspaceSurfaceId } from '../../../../preload/types';

interface SessionPresenceStripProps {
  self?: WorkspaceSurfaceId;
}

const SURFACE_META: Record<WorkspaceSurfaceId, { label: string; Icon: React.ComponentType<{ size?: number | string }> }> = {
  editor: { label: 'Editor', Icon: Folder },
  context: { label: 'Context', Icon: Brain },
  debugger: { label: 'Debugger', Icon: Bug },
  canvas: { label: 'Canvas', Icon: LayoutGrid }
};

const SURFACE_ORDER: WorkspaceSurfaceId[] = ['editor', 'context', 'debugger', 'canvas'];

export const SessionPresenceStrip: React.FC<SessionPresenceStripProps> = ({ self }) => {
  const session = useWorkspaceSessionStore((s) => s.session);

  const rootPath = session.rootPath;
  const rootDisplay = rootPath ? rootPath.split(/[\\/]/).pop() || rootPath : 'No WS';

  return (
    <div
      className="session-presence-strip"
      role="region"
      aria-label="Workspace surface presence"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '4px 8px',
        background: 'var(--bg-tertiary)',
        borderRadius: 6,
        fontSize: 11,
        color: 'var(--text-muted)',
        overflow: 'hidden'
      }}
    >
      <span
        title={rootPath ?? 'No workspace open'}
        style={{
          flexShrink: 1,
          minWidth: 0,
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          fontWeight: 600,
          color: rootPath ? 'var(--text-secondary)' : 'var(--text-muted)'
        }}
      >
        {rootDisplay}
      </span>
      <span
        aria-hidden="true"
        style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, marginLeft: 'auto' }}
      >
        {SURFACE_ORDER.map((id) => {
          const presence = session.surfaces[id];
          const attached = Boolean(presence?.attached);
          const meta = SURFACE_META[id];
          const Icon = meta.Icon;
          return (
            <span
              key={id}
              title={`${meta.label} — ${attached ? 'attached' : 'detached'}${id === self ? ' (this surface)' : ''}`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                color: attached ? 'var(--accent-primary, #818cf8)' : 'var(--text-muted)',
                opacity: attached ? 1 : 0.35,
                borderBottom: id === self ? '2px solid var(--accent-primary, #818cf8)' : '2px solid transparent'
              }}
            >
              <Icon size={12} />
            </span>
          );
        })}
      </span>
    </div>
  );
};

export default SessionPresenceStrip;
