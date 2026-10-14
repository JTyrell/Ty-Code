import React, { useState } from 'react';
import { Terminal as TerminalIcon, X, Trash2, Play } from 'lucide-react';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceStore } from '../state/workspace-store';

export const TerminalDrawer: React.FC = () => {
  const [command, setCommand] = useState('');
  const [output, setOutput] = useState<string[]>(['Ty-Claude Terminal initialized. Ready for commands.']);
  const [isRunning, setIsRunning] = useState(false);

  const { isTerminalOpen, toggleTerminal } = useChatStore();
  const { workspacePath } = useWorkspaceStore();

  if (!isTerminalOpen) return null;

  const handleRunCommand = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!command.trim() || isRunning) return;

    const cmdToRun = command.trim();
    setCommand('');
    setIsRunning(true);
    setOutput((prev) => [...prev, `$ ${cmdToRun}`]);

    try {
      const res = await window.electronAPI.runCommand({
        command: cmdToRun,
        cwd: workspacePath
      });

      if (res.success && res.data) {
        const out = res.data.stdout || res.data.stderr || '(no output)';
        setOutput((prev) => [...prev, out]);
      } else {
        setOutput((prev) => [...prev, `Error: ${res.error || 'Command failed'}`]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setOutput((prev) => [...prev, `Exception: ${msg}`]);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div
      style={{
        height: '220px',
        backgroundColor: 'var(--bg-secondary)',
        borderTop: '1px solid var(--border-subtle)',
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'var(--font-mono)',
        fontSize: '12px'
      }}
    >
      {/* Terminal Title Bar */}
      <div
        style={{
          height: '30px',
          padding: '0 10px',
          backgroundColor: 'var(--bg-tertiary)',
          borderBottom: '1px solid var(--border-subtle)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          color: 'var(--text-secondary)'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <TerminalIcon size={13} color="var(--accent-primary)" />
          <span>Integrated Terminal</span>
          {isRunning && <span className="animate-pulse" style={{ color: 'var(--accent-primary)' }}>● Running</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button onClick={() => setOutput([])} title="Clear Terminal" style={{ padding: '2px 4px' }}>
            <Trash2 size={12} />
          </button>
          <button onClick={toggleTerminal} title="Close Terminal" style={{ padding: '2px 4px' }}>
            <X size={12} />
          </button>
        </div>
      </div>

      {/* Terminal Output */}
      <div
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: '8px 12px',
          backgroundColor: 'var(--bg-primary)',
          color: 'var(--text-primary)',
          whiteSpace: 'pre-wrap',
          lineHeight: 1.4
        }}
      >
        {output.map((line, idx) => (
          <div key={idx} style={{ marginBottom: '4px' }}>{line}</div>
        ))}
      </div>

      {/* Terminal Input Bar */}
      <form
        onSubmit={handleRunCommand}
        style={{
          height: '32px',
          padding: '0 8px',
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          backgroundColor: 'var(--bg-tertiary)',
          borderTop: '1px solid var(--border-subtle)'
        }}
      >
        <span style={{ color: 'var(--accent-cyan)' }}>$</span>
        <input
          type="text"
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="Execute shell command in workspace (e.g. npm test, git status)..."
          disabled={isRunning}
          style={{
            flex: 1,
            height: '24px',
            padding: '2px 6px',
            fontSize: '11px',
            background: 'transparent',
            border: 'none',
            outline: 'none'
          }}
        />
        <button
          type="submit"
          disabled={!command.trim() || isRunning}
          style={{
            padding: '2px 8px',
            fontSize: '11px',
            backgroundColor: 'var(--accent-primary)',
            color: '#fff'
          }}
        >
          <Play size={11} />
        </button>
      </form>
    </div>
  );
};
