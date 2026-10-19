import React, { useState, useEffect, useRef } from 'react';
import {
  Terminal,
  FileCode,
  Settings,
  GitBranch,
  Search,
  SplitSquareVertical,
  SplitSquareHorizontal,
  LayoutTemplate,
  Code2,
  RefreshCw,
  FolderOpen,
  Check,
  Zap,
  Bookmark,
  Sparkles,
  Activity
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useEditorNavigationStore } from '../state/editor-navigation-store';
import { useCodeReviewStore } from '../state/code-review-store';
import { usePairProgrammingStore } from '../state/pair-programming-store';
import { toast } from '../state/toast-store';
import { extensionHost } from '../services/extension-host';

export interface CommandItem {
  id: string;
  title: string;
  category: 'File' | 'Editor' | 'View' | 'Git' | 'Terminal' | 'LSP' | 'Extension' | 'General';
  shortcut?: string;
  icon?: React.ReactNode;
  action: () => void;
}

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onNavigateToView?: (view: string) => void;
  onToggleMinimap?: () => void;
  onToggleWordWrap?: () => void;
  onToggleZenMode?: () => void;
  onSplitEditor?: (orientation: 'horizontal' | 'vertical') => void;
  onOpenWorkspaceSymbols?: () => void;
  onOpenQuickOpen?: (initialQuery: string) => void;
  onOpenBootTimeline?: () => void;
  onOpenExtensionTrace?: () => void;
}

export const CommandPalette: React.FC<CommandPaletteProps> = ({
  isOpen,
  onClose,
  onNavigateToView,
  onToggleMinimap,
  onToggleWordWrap,
  onToggleZenMode,
  onSplitEditor,
  onOpenWorkspaceSymbols,
  onOpenQuickOpen,
  onOpenBootTimeline,
  onOpenExtensionTrace
}) => {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [hostCommands, setHostCommands] = useState<Array<{ id: string; title: string; category?: string }>>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const { saveActiveFile, activeTabPath, openTabs } = useWorkspaceStore();
  const { toggleTerminal, toggleSettings } = useChatStore();

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      setTimeout(() => inputRef.current?.focus(), 50);

      window.electronAPI.extensionListCommands?.().then((res) => {
        if (res && res.success && Array.isArray(res.data)) {
          setHostCommands(res.data);
        }
      }).catch(() => undefined);
    }
  }, [isOpen]);

  // Generate complete command list
  const getCommands = (): CommandItem[] => {
    const commands: CommandItem[] = [
      {
        id: 'tycode.extension.traceInstall',
        title: 'Ty-Code: Trace Extension Install',
        category: 'Extension',
        icon: <Activity size={14} color="var(--accent-primary)" />,
        action: () => {
          onClose();
          onOpenExtensionTrace?.();
        }
      },
      {
        id: 'editor.save',
        title: 'Save Active File',
        category: 'File',
        shortcut: 'Ctrl+S',
        icon: <Check size={14} color="var(--accent-green)" />,
        action: () => {
          void saveActiveFile();
          onClose();
        }
      },
      {
        id: 'workbench.action.gotoLine',
        title: 'Go to Line',
        category: 'Editor',
        shortcut: 'Ctrl+G',
        icon: <Search size={14} color="var(--accent-amber)" />,
        action: () => { onOpenQuickOpen?.(':'); onClose(); }
      },
      {
        id: 'workbench.action.gotoSymbol',
        title: 'Go to Symbol in File',
        category: 'Editor',
        shortcut: 'Ctrl+Shift+O',
        icon: <Code2 size={14} color="var(--accent-cyan)" />,
        action: () => { onOpenQuickOpen?.('@'); onClose(); }
      },
      {
        id: 'editor.toggleMinimap',
        title: 'Toggle Minimap',
        category: 'View',
        shortcut: 'Ctrl+Shift+M',
        icon: <LayoutTemplate size={14} color="var(--accent-primary)" />,
        action: () => {
          onToggleMinimap?.();
          onClose();
        }
      },
      {
        id: 'editor.toggleWordWrap',
        title: 'Toggle Word Wrap',
        category: 'View',
        shortcut: 'Alt+Z',
        icon: <FileCode size={14} color="var(--accent-cyan)" />,
        action: () => {
          onToggleWordWrap?.();
          onClose();
        }
      },
      {
        id: 'editor.toggleZenMode',
        title: 'Toggle Zen Mode (Distraction-Free)',
        category: 'View',
        shortcut: 'Ctrl+K Z',
        icon: <Zap size={14} color="var(--accent-amber)" />,
        action: () => {
          onToggleZenMode?.();
          onClose();
        }
      },
      {
        id: 'workbench.action.showBootTimeline',
        title: 'Ty-Code: Show Boot Timeline',
        category: 'View',
        icon: <Zap size={14} color="#38bdf8" />,
        action: () => {
          onOpenBootTimeline?.();
          onClose();
        }
      },
      {
        id: 'tycode.perf.profile-open-paths',
        title: 'Ty-Code: Profile Open Paths',
        category: 'View',
        icon: <Activity size={14} color="#38bdf8" />,
        action: async () => {
          onClose();
          toast.info('Profiling Open Paths...', 'Measuring folder and file open stages');
          try {
            const res = await window.electronAPI.perfProfileOpenPaths?.();
            if (res?.success && res.data) {
              const lag = res.data.analysis.primaryLagLocation;
              const top = res.data.topOffenders[0];
              toast.success(
                'Open Path Trace Complete',
                `Primary lag: ${lag}. Top Offender: ${top?.item || 'N/A'} (${top?.ms ?? 0}ms)`
              );
            } else {
              toast.error('Profiling Failed', res?.error || 'Unknown error');
            }
          } catch (err) {
            toast.error('Profiling Error', String(err));
          }
        }
      },
      {
        id: 'workbench.splitVertical',
        title: 'Split Editor Right (Vertical)',
        category: 'Editor',
        shortcut: 'Ctrl+\\',
        icon: <SplitSquareVertical size={14} color="var(--accent-primary)" />,
        action: () => {
          onSplitEditor?.('vertical');
          onClose();
        }
      },
      {
        id: 'workbench.splitHorizontal',
        title: 'Split Editor Down (Horizontal)',
        category: 'Editor',
        shortcut: 'Ctrl+K Ctrl+\\',
        icon: <SplitSquareHorizontal size={14} color="var(--accent-primary)" />,
        action: () => {
          onSplitEditor?.('horizontal');
          onClose();
        }
      },
      {
        id: 'workbench.searchInFiles',
        title: 'Find in Files (Global Search)',
        category: 'View',
        shortcut: 'Ctrl+Shift+F',
        icon: <Search size={14} color="var(--accent-primary)" />,
        action: () => {
          onNavigateToView?.('search');
          onClose();
        }
      },
      {
        id: 'workbench.sourceControl',
        title: 'Open Source Control (Git)',
        category: 'Git',
        shortcut: 'Ctrl+Shift+G',
        icon: <GitBranch size={14} color="var(--accent-amber)" />,
        action: () => {
          onNavigateToView?.('source-control');
          onClose();
        }
      },
      {
        id: 'workbench.extensions',
        title: 'Open Extensions Marketplace',
        category: 'General',
        shortcut: 'Ctrl+Shift+X',
        icon: <FolderOpen size={14} color="var(--accent-cyan)" />,
        action: () => {
          onNavigateToView?.('extensions');
          onClose();
        }
      },
      {
        id: 'workbench.terminal',
        title: 'Toggle Terminal Emulator',
        category: 'Terminal',
        shortcut: 'Ctrl+`',
        icon: <Terminal size={14} color="var(--accent-green)" />,
        action: () => {
          toggleTerminal();
          onClose();
        }
      },
      {
        id: 'workbench.terminal.fccAgent',
        title: 'Ty-Code: Open FCC Terminal Agent',
        category: 'Terminal',
        icon: <Terminal size={14} color="var(--accent-cyan)" />,
        action: () => {
          onClose();
          toast.info('Opening FCC agent terminal…');
          window.dispatchEvent(new CustomEvent('tycode:fcc-agent-terminal'));
        }
      },
      {
        id: 'workbench.settings',
        title: 'Open User Settings & API Keys',
        category: 'General',
        shortcut: 'Ctrl+,',
        icon: <Settings size={14} color="var(--text-secondary)" />,
        action: () => {
          toggleSettings();
          onClose();
        }
      },
      {
        id: 'tycode.diagnostics.run',
        title: 'Ty-Code: Run Connection Diagnostics',
        category: 'General',
        icon: <Activity size={14} color="#38bdf8" />,
        action: () => {
          useChatStore.getState().openSettings('diagnostics');
          onClose();
        }
      },
      {
        id: 'tycode.diagnostics.trace',
        title: 'Ty-Code: Run Live Connectivity Trace',
        category: 'General',
        icon: <Activity size={14} color="#a855f7" />,
        action: () => {
          useChatStore.getState().openSettings('diagnostics');
          toast.info('Starting End-to-End Connectivity Trace…');
          void window.electronAPI.runConnectivityTrace?.();
          onClose();
        }
      },
      {
        id: 'workbench.action.workspaceSymbol',
        title: 'Go to Workspace Symbol',
        category: 'LSP',
        shortcut: 'Ctrl+T',
        icon: <Search size={14} color="var(--accent-cyan)" />,
        action: () => { onOpenWorkspaceSymbols?.(); onClose(); }
      },
      {
        id: 'editor.action.rename',
        title: 'Rename Symbol',
        category: 'LSP',
        shortcut: 'F2',
        icon: <Code2 size={14} color="var(--accent-cyan)" />,
        action: () => { useEditorNavigationStore.getState().runAction('renameSymbol'); onClose(); }
      },
      {
        id: 'editor.action.goToDefinition',
        title: 'Go to Definition',
        category: 'LSP',
        shortcut: 'F12',
        icon: <FileCode size={14} color="var(--accent-primary)" />,
        action: () => { useEditorNavigationStore.getState().runAction('goToDefinition'); onClose(); }
      },
      {
        id: 'editor.action.findReferences',
        title: 'Find References',
        category: 'LSP',
        shortcut: 'Shift+F12',
        icon: <Search size={14} color="var(--accent-cyan)" />,
        action: () => { useEditorNavigationStore.getState().runAction('findReferences'); onClose(); }
      },
      {
        id: 'editor.action.goToImplementation',
        title: 'Go to Implementation',
        category: 'LSP',
        shortcut: 'Ctrl+F12',
        icon: <Code2 size={14} color="var(--accent-primary)" />,
        action: () => { useEditorNavigationStore.getState().runAction('goToImplementation'); onClose(); }
      },
      {
        id: 'editor.action.quickFix',
        title: 'Show Code Actions',
        category: 'LSP',
        shortcut: 'Ctrl+.',
        icon: <Check size={14} color="var(--accent-amber)" />,
        action: () => { useEditorNavigationStore.getState().runAction('quickFix'); onClose(); }
      },
      {
        id: 'lsp.restartServers',
        title: 'Restart All Language Servers (LSP)',
        category: 'LSP',
        icon: <RefreshCw size={14} color="var(--accent-cyan)" />,
        action: async () => {
          if (window.electronAPI) {
            const servers = await window.electronAPI.lspGetServers();
            if (servers.success && servers.data) {
              for (const s of servers.data) {
                if (s.status === 'running') {
                  void window.electronAPI.lspRestartServer(s.languageId);
                }
              }
            }
          }
          onClose();
        }
      },
      {
        id: 'tycode.ai.runCodeReview',
        title: 'AI: Run Automated Code Review',
        category: 'General',
        shortcut: 'Ctrl+Shift+R',
        icon: <Sparkles size={14} color="var(--accent-primary)" />,
        action: () => {
          onNavigateToView?.('code-review');
          onClose();
          const tab = openTabs.find((t) => t.path === activeTabPath);
          void useCodeReviewStore.getState().runReview(tab?.path, tab?.content);
        }
      },
      {
        id: 'tycode.ai.togglePairMode',
        title: 'AI: Toggle Pair Programming Mode',
        category: 'General',
        icon: <Sparkles size={14} color="#22c55e" />,
        action: () => {
          usePairProgrammingStore.getState().togglePairMode();
          onClose();
        }
      },
      {
        id: 'tycode.ai.indexWorkspace',
        title: 'AI: Index Project & Build Context Graph',
        category: 'General',
        icon: <Sparkles size={14} color="var(--accent-cyan)" />,
        action: async () => {
          onClose();
          toast.info('Indexing Project', 'Scanning workspace symbols and dependencies…');
          const res = await window.electronAPI.indexProject();
          if (res.success && res.data) {
            toast.success('Project Indexed', `Indexed ${res.data.fileCount} files and ${res.data.symbolCount} symbols in ${res.data.indexedInMs}ms.`);
          } else {
            toast.error('Indexing failed', res.error);
          }
        }
      },
      {
        id: 'tycode.ai.generateTests',
        title: 'AI: Generate Unit Tests for Active File',
        category: 'General',
        icon: <Sparkles size={14} color="var(--accent-amber)" />,
        action: async () => {
          onClose();
          const tab = openTabs.find((t) => t.path === activeTabPath);
          if (!tab) {
            toast.warning('No file open', 'Open a file to generate unit tests.');
            return;
          }
          toast.info('Generating Tests', `Creating test suite for ${tab.path}…`);
          const res = await window.electronAPI.generateCodeFromPrompt({
            type: 'test-generation',
            prompt: `Generate unit tests for ${tab.path}`,
            language: tab.language,
            filePath: tab.path,
            contextCode: tab.content
          });
          if (res.success && res.data) {
            await navigator.clipboard.writeText(res.data.code);
            toast.success('Tests Generated & Copied to Clipboard', res.data.explanation);
          } else {
            toast.error('Test generation failed', res.error);
          }
        }
      },
      {
        id: 'tycode.ai.generateDocs',
        title: 'AI: Generate Documentation & Docstrings',
        category: 'General',
        icon: <Sparkles size={14} color="var(--accent-primary)" />,
        action: async () => {
          onClose();
          const tab = openTabs.find((t) => t.path === activeTabPath);
          if (!tab) {
            toast.warning('No file open', 'Open a file to generate documentation.');
            return;
          }
          const res = await window.electronAPI.generateCodeFromPrompt({
            type: 'documentation',
            prompt: `Generate documentation for ${tab.path}`,
            language: tab.language,
            filePath: tab.path,
            contextCode: tab.content
          });
          if (res.success && res.data) {
            await navigator.clipboard.writeText(res.data.code);
            toast.success('Documentation Generated', 'Copied documentation comments to clipboard.');
          } else {
            toast.error('Doc generation failed', res.error);
          }
        }
      }
    ];

    // Only expose commands that have actually been registered by an active Worker.
    for (const command of extensionHost.getRegisteredCommands()) {
      commands.push({
        id: command.id,
        title: command.title,
        category: 'Extension',
        icon: <Bookmark size={14} color="var(--accent-primary)" />,
        action: () => {
          void extensionHost.executeCommand(command.id).catch((error: unknown) => {
            console.error('Extension command failed:', error);
          });
          onClose();
        }
      });
    }

    for (const cmd of hostCommands) {
      if (!commands.some((c) => c.id === cmd.id)) {
        commands.push({
          id: cmd.id,
          title: cmd.title,
          category: 'Extension',
          icon: <Bookmark size={14} color="var(--accent-primary)" />,
          action: () => {
            void window.electronAPI.extensionExecuteCommand(cmd.id).catch((error: unknown) => {
              console.error('Extension command failed:', error);
            });
            onClose();
          }
        });
      }
    }

    return commands;
  };

  const allCommands = getCommands();
  const filteredCommands = allCommands.filter((cmd) => {
    if (!query.trim()) return true;
    const q = query.toLowerCase();
    return (
      cmd.title.toLowerCase().includes(q) ||
      cmd.category.toLowerCase().includes(q) ||
      cmd.id.toLowerCase().includes(q)
    );
  });

  // Dynamic Natural Language Command Execution
  if (query.trim().length > 1 && (query.startsWith('?') || query.startsWith('ai:') || filteredCommands.length === 0)) {
    const rawInput = query.replace(/^(\?|ai:)\s*/, '');
    filteredCommands.unshift({
      id: 'tycode.ai.nlCommand',
      title: `Ty-Code AI: "${rawInput}"`,
      category: 'General',
      icon: <Sparkles size={14} color="var(--accent-primary)" />,
      action: async () => {
        onClose();
        const tab = openTabs.find((t) => t.path === activeTabPath);
        const res = await window.electronAPI.parseNaturalLanguageCommand({
          input: rawInput,
          context: {
            activeFilePath: tab?.path,
            language: tab?.language
          }
        });
        if (res.success && res.data) {
          const item = res.data;
          if (item.action === 'execute-command' && item.commandId) {
            const match = allCommands.find((c) => c.id === item.commandId);
            if (match) match.action();
            else toast.info('Command executed', item.commandTitle || item.commandId);
          } else if (item.action === 'navigate' && item.commandId) {
            const view = item.commandId.replace('workbench.view.', '');
            onNavigateToView?.(view);
          } else if (item.action === 'review-code') {
            onNavigateToView?.('code-review');
            void useCodeReviewStore.getState().runReview(tab?.path, tab?.content);
          } else if (item.action === 'generate-code' && item.generatedCode) {
            await navigator.clipboard.writeText(item.generatedCode);
            toast.success('Code Generated', 'Snippet generated and copied to clipboard.');
          } else {
            toast.info('Ty-Code Command', item.message);
          }
        } else {
          toast.error('Command parse error', res.error);
        }
      }
    });
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev < filteredCommands.length - 1 ? prev + 1 : prev));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => (prev > 0 ? prev - 1 : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const target = filteredCommands[selectedIndex];
      if (target) {
        target.action();
      }
    }
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.65)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '70px',
        zIndex: 11000
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '620px',
          backgroundColor: 'var(--bg-secondary)',
          border: '1px solid var(--border-subtle)',
          borderRadius: '8px',
          boxShadow: '0 20px 48px rgba(0,0,0,0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {/* Command Search Bar */}
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: 'var(--bg-tertiary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px'
          }}
        >
          <Code2 size={16} color="var(--accent-primary)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Type a command or action (e.g. format, minimap, terminal)..."
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              padding: 0,
              fontSize: '13px',
              outline: 'none',
              color: 'var(--text-primary)'
            }}
          />
        </div>

        {/* Command List */}
        <div style={{ maxHeight: '360px', overflowY: 'auto', padding: '6px' }}>
          {filteredCommands.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
              No commands found matching "{query}".
            </div>
          ) : (
            filteredCommands.map((cmd, idx) => {
              const isSelected = idx === selectedIndex;
              return (
                <div
                  key={cmd.id}
                  onClick={() => cmd.action()}
                  style={{
                    padding: '8px 12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    cursor: 'pointer',
                    borderRadius: '5px',
                    backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    fontSize: '12px',
                    gap: '12px'
                  }}
                  onMouseEnter={() => setSelectedIndex(idx)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', overflow: 'hidden' }}>
                    <div style={{ flexShrink: 0 }}>{cmd.icon}</div>
                    <span style={{ fontWeight: isSelected ? 600 : 400, whiteSpace: 'nowrap' }}>
                      {cmd.title}
                    </span>
                    <span
                      style={{
                        fontSize: '10px',
                        padding: '1px 5px',
                        borderRadius: '3px',
                        backgroundColor: 'var(--bg-tertiary)',
                        color: 'var(--text-muted)',
                        fontWeight: 600
                      }}
                    >
                      {cmd.category}
                    </span>
                  </div>

                  {cmd.shortcut && (
                    <span
                      style={{
                        fontSize: '11px',
                        fontFamily: "'JetBrains Mono', monospace",
                        color: 'var(--text-muted)',
                        backgroundColor: 'var(--bg-tertiary)',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        border: '1px solid var(--border-subtle)',
                        flexShrink: 0
                      }}
                    >
                      {cmd.shortcut}
                    </span>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
