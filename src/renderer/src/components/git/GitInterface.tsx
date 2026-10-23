import React from 'react';
import { SourceControlPanel } from '../SourceControlPanel';
import { WorkspaceGate } from '../common/WorkspaceGate';

/**
 * GitInterface component for Ty-Code version control.
 * Protected by WorkspaceGate to prevent git status probing before Explorer indexing completes.
 */
export const GitInterface: React.FC = () => {
  return (
    <WorkspaceGate message="Indexing Workspace for Git...">
      <SourceControlPanel />
    </WorkspaceGate>
  );
};

export default GitInterface;
