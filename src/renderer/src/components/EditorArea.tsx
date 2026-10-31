import React, { useEffect, useState, useRef } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import {
  X,
  Check,
  FileEdit,
  Code2,
  SplitSquareVertical,
  SplitSquareHorizontal,
  LayoutTemplate,
  WrapText,
  Maximize2,
  Minimize2,
  Save,
  ChevronRight,
  Sparkles,
  Copy
} from 'lucide-react';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useWorkspaceEditStore } from '../state/workspace-edit-store';
import { useEditorNavigationStore } from '../state/editor-navigation-store';
import { useLspStore } from '../state/lsp-store';
import { handleAutoAppliedTransaction, undoWorkspaceEditFromEditor } from '../services/workspace-edit-commands';
import { toast } from '../state/toast-store';
import { WelcomePage } from './WelcomePage';
import { OnboardingTour } from './OnboardingTour';
import type { GitBlameHunk } from '../../../preload/types';
import { GitBlameGutter } from './GitBlameGutter';
import {
  registerMonacoLspProviders,
  syncDocumentWithLsp,
  notifyDocumentChanged,
  notifyDocumentClosed,
  subscribeLspDiagnostics,
  applyStoredDiagnostics
} from '../services/monaco-lsp-adapter';
import { registerMonacoInlineCompletionProvider } from '../services/monaco-inline-completion';
import { ensureMonaco, useMonacoRuntime } from '../services/monaco-runtime';
import {
  forgetFile,
  recordEdit,
  registerDiffEditor,
  registerEditor,
  setActiveFile,
  type EditorDisposable
} from '../services/editor-service';
import { usePairProgrammingStore } from '../state/pair-programming-store';
import { useExtensionPromptStore } from '../state/extension-prompt-store';
import { LazyModelManager } from '../services/lazy-model-manager';
import { useDocumentReviewStore } from '../state/document-review-store';
import { DocumentReviewPane } from './documents/DocumentReviewPane';
import { useThemeSync, getMonacoTheme } from '../hooks/useThemeSync';

interface SplitPaneState {
  isSplit: boolean;
  orientation: 'horizontal' | 'vertical';
  secondaryTabPath: string | null;
}

export const EditorArea: React.FC = () => {
  const theme = useThemeSync();
  const monacoTheme = getMonacoTheme(theme);
  // Zustand selector audit: narrow slices to eliminate render storms
  const openTabs = useWorkspaceStore((s) => s.openTabs);
  const activeTabPath = useWorkspaceStore((s) => s.activeTabPath);
  const workspacePath = useWorkspaceStore((s) => s.workspacePath);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const updateTabContent = useWorkspaceStore((s) => s.updateTabContent);
  const saveActiveFile = useWorkspaceStore((s) => s.saveActiveFile);
  const saveFile = useWorkspaceStore((s) => s.saveFile);
  const diffReview = useWorkspaceStore((s) => s.diffReview);
  const closeDiffReview = useWorkspaceStore((s) => s.closeDiffReview);
  const applyDiff = useWorkspaceStore((s) => s.applyDiff);

  const activeDocument = useDocumentReviewStore((s) => s.activeDocument);
  const isDocumentTabOpen = useDocumentReviewStore((s) => s.isDocumentTabOpen);
  const isDocTabActive = useDocumentReviewStore((s) => s.isDocTabActive);
  const setDocTabActive = useDocumentReviewStore((s) => s.setDocTabActive);
  const clearDocument = useDocumentReviewStore((s) => s.clearDocument);

  const monacoRuntime = useMonacoRuntime();
  const monaco = monacoRuntime.monaco;
  const settings = useChatStore((s) => s.settings);
  const languageServers = useLspStore((s) => s.servers);
  const [minimapEnabled, setMinimapEnabled] = useState(true);
  const [wordWrap, setWordWrap] = useState<'off' | 'on' | 'wordWrapColumn' | 'bounded'>('off');
  const [isZenMode, setIsZenMode] = useState(false);
  const [currentLine, setCurrentLine] = useState(1);
  const [blameHunks, setBlameHunks] = useState<GitBlameHunk[]>([]);
  const [blameRefreshKey, setBlameRefreshKey] = useState(0);
  const cursorListenerRef = useRef<{ dispose: () => void } | null>(null);
  // The command registry's view of the live editors (Prompt 5). Each pane owns one
  // registration, so an unmounted pane stops asserting cursor state it cannot see.
  const primaryEditorRegistration = useRef<EditorDisposable | null>(null);
  const secondaryEditorRegistration = useRef<EditorDisposable | null>(null);
  const diffEditorRegistration = useRef<EditorDisposable | null>(null);
  const [splitState, setSplitState] = useState<SplitPaneState>({
    isSplit: false,
    orientation: 'vertical',
    secondaryTabPath: null
  });
  const [isTourOpen, setIsTourOpen] = useState(false);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; path: string } | null>(null);
  const navigationRequest = useEditorNavigationStore((state) => state.request);
  const openingNavigationId = useRef<number | null>(null);

  const editorRef = useRef<any>(null);
  const activeTab = openTabs.find((t) => t.path === activeTabPath);
  const secondaryTab = openTabs.find((t) => t.path === splitState.secondaryTabPath) || openTabs[1] || null;
  const shouldLoadMonaco = Boolean(activeTab || diffReview?.isOpen);

  useEffect(() => {
    if (shouldLoadMonaco && monacoRuntime.status === 'idle') {
      void ensureMonaco().catch((error) => toast.error('Editor failed to load', String(error)));
    }
  }, [shouldLoadMonaco, monacoRuntime.status]);

  useEffect(() => () => cursorListenerRef.current?.dispose(), []);

  useEffect(
    () => () => {
      primaryEditorRegistration.current?.dispose();
      primaryEditorRegistration.current = null;
      secondaryEditorRegistration.current?.dispose();
      secondaryEditorRegistration.current = null;
      diffEditorRegistration.current?.dispose();
      diffEditorRegistration.current = null;
    },
    []
  );

  // Tell the editor service which file the active pane is showing. This is what
  // makes `hasSymbolProvider` honest per language, and what keys both the
  // navigation history and the per-file last-edit map.
  useEffect(() => {
    setActiveFile(activeTab?.path ?? null, activeTab?.language ?? null);
  }, [activeTab?.path, activeTab?.language]);

  // Release a split pane's registration the moment the split closes rather than
  // waiting for unmount, so Switch Group never lists a group that is already gone.
  useEffect(() => {
    if (splitState.isSplit) return;
    secondaryEditorRegistration.current?.dispose();
    secondaryEditorRegistration.current = null;
  }, [splitState.isSplit]);

  useEffect(() => {
    if (diffReview?.isOpen) return;
    diffEditorRegistration.current?.dispose();
    diffEditorRegistration.current = null;
  }, [diffReview?.isOpen]);

  useEffect(() => {
    setMinimapEnabled(settings?.editor?.minimap ?? true);
    setWordWrap(settings?.editor?.wordWrap ?? 'off');
  }, [settings?.editor?.minimap, settings?.editor?.wordWrap]);

  // Monaco Model Lifecycle: Defer creation until tab visible; maintain and reuse disposed-model pool
  const recentTabsRef = useRef<string[]>([]);
  useEffect(() => {
    if (!monaco || !activeTab) return;
    const path = activeTab.path;
    recentTabsRef.current = [path, ...recentTabsRef.current.filter((p) => p !== path)];

    const allModels = monaco.editor.getModels();
    const openTabPaths = new Set(openTabs.map((t) => t.path));
    const openTabModels = allModels.filter((m) => {
      if (m.uri.scheme !== 'file') return false;
      const fsPath = m.uri.fsPath.replace(/\\/g, '/');
      return openTabPaths.has(fsPath) || openTabs.some((t) => t.path.replace(/\\/g, '/') === fsPath);
    });

    if (openTabModels.length > 10) {
      const keepPaths = new Set(recentTabsRef.current.slice(0, 10));
      for (const m of openTabModels) {
        const fsPath = m.uri.fsPath.replace(/\\/g, '/');
        const isKeep = keepPaths.has(fsPath) || openTabs.slice(0, 10).some((t) => t.path.replace(/\\/g, '/') === fsPath);
        if (!isKeep && fsPath !== activeTab.path.replace(/\\/g, '/')) {
          LazyModelManager.getInstance().releaseModel(fsPath);
        }
      }
    }
  }, [activeTab?.path, monaco, openTabs]);

  // Defer Monaco layout to rAF after visibility change or split change
  useEffect(() => {
    if (!editorRef.current) return;
    const rafId = window.requestAnimationFrame(() => {
      try {
        editorRef.current.layout();
      } catch {
        // Layout transition
      }
    });
    return () => window.cancelAnimationFrame(rafId);
  }, [activeTab?.path, splitState.isSplit, splitState.orientation]);

  const previousActivePath = useRef<string | null>(activeTabPath);
  useEffect(() => {
    const autoSave = settings?.editor?.autoSave ?? 'afterDelay';
    if (autoSave === 'onFocusChange' && previousActivePath.current && previousActivePath.current !== activeTabPath) void saveFile(previousActivePath.current);
    previousActivePath.current = activeTabPath;
    if (autoSave === 'off') return;
    const timers: number[] = [];
    if (autoSave === 'afterDelay') {
      for (const tab of openTabs) {
        if (tab.isDirty) timers.push(window.setTimeout(() => { void saveFile(tab.path); }, settings?.editor?.autoSaveDelay ?? 1000));
      }
    } else {
      const onBlur = () => { for (const tab of useWorkspaceStore.getState().openTabs) if (tab.isDirty) void saveFile(tab.path); };
      window.addEventListener('blur', onBlur);
      return () => { window.removeEventListener('blur', onBlur); timers.forEach(window.clearTimeout); };
    }
    return () => timers.forEach(window.clearTimeout);
  }, [openTabs, saveFile, settings?.editor?.autoSave, settings?.editor?.autoSaveDelay]);

  const handleBlameLoaded = React.useCallback((hunks: GitBlameHunk[]) => {
    setBlameHunks(hunks);
  }, []);

  useEffect(() => {
    if (!monaco || !editorRef.current || !activeTab || activeTab.isDirty || blameHunks.length === 0) return;
    const decorations = editorRef.current.createDecorationsCollection(blameHunks.map((hunk) => ({
      range: new monaco.Range(hunk.lineStart, 1, hunk.lineStart, 1),
      options: {
        isWholeLine: false,
        glyphMarginClassName: 'git-blame-glyph',
        glyphMarginHoverMessage: { value: [`**${hunk.author}** · ${hunk.dateString}`, hunk.summary, `Commit ${hunk.commitHash.slice(0, 7)}`].join('\n\n') }
      }
    })));
    return () => decorations.clear();
  }, [activeTab, blameHunks, monaco]);

  // Register LSP & Inline AI completion providers once Monaco is loaded
  useEffect(() => {
    if (!monaco) return;
    registerMonacoLspProviders(monaco);
    registerMonacoInlineCompletionProvider(monaco);
    return subscribeLspDiagnostics(monaco);
  }, [monaco]);

  // Sync active file with LSP when opened or tab switches
  useEffect(() => {
    if (activeTab) syncDocumentWithLsp(activeTab.path, activeTab.language, activeTab.content);
  }, [activeTab?.path]);

  useEffect(() => {
    if (splitState.isSplit && secondaryTab) syncDocumentWithLsp(secondaryTab.path, secondaryTab.language, secondaryTab.content);
  }, [splitState.isSplit, secondaryTab?.path]);

  // Global Keyboard shortcuts in editor area
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        const editorNode = editorRef.current?.getDomNode?.() as HTMLElement | null;
        const activeElement = document.activeElement;
        const isEditorFocused = Boolean(editorNode?.contains(activeElement));
        const isOtherTextField = !isEditorFocused && (activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || (activeElement instanceof HTMLElement && activeElement.isContentEditable));
        const editState = useWorkspaceEditStore.getState();
        if (!isOtherTextField && editState.lastAppliedTransactionId && editState.lastAppliedEditorRevision === editState.editorRevision) {
          e.preventDefault();
          e.stopImmediatePropagation();
          void undoWorkspaceEditFromEditor();
          return;
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        void saveActiveFile().then(() => setBlameRefreshKey((value) => value + 1));
      } else if ((e.ctrlKey || e.metaKey) && e.key === '\\') {
        e.preventDefault();
        toggleSplit('vertical');
      } else if (e.altKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        setWordWrap((prev) => (prev === 'on' ? 'off' : 'on'));
      }
    };
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [saveActiveFile, activeTab]);

  useEffect(() => {
    return useEditorNavigationStore.getState().registerActions({
      toggleMinimap: () => setMinimapEnabled((value) => !value),
      toggleWordWrap: () => setWordWrap((value) => value === 'on' ? 'off' : 'on'),
      toggleZenMode: () => setIsZenMode((value) => !value),
      splitVertical: () => toggleSplit('vertical'),
      splitHorizontal: () => toggleSplit('horizontal'),
      renameSymbol: () => { void editorRef.current?.getAction('editor.action.rename')?.run(); },
      findReferences: () => { void editorRef.current?.getAction('editor.action.findReferences')?.run(); },
      goToDefinition: () => { void editorRef.current?.getAction('editor.action.goToDefinition')?.run(); },
      goToImplementation: () => { void editorRef.current?.getAction('editor.action.goToImplementation')?.run(); },
      quickFix: () => { void editorRef.current?.getAction('editor.action.quickFix')?.run(); }
    });
  }, [openTabs, activeTabPath]);

  useEffect(() => {
    if (!navigationRequest || openingNavigationId.current === navigationRequest.id) return;
    openingNavigationId.current = navigationRequest.id;
    const requestedPath = navigationRequest.target.filePath;
    const isAbsoluteTarget = Boolean(requestedPath && (/^[A-Za-z]:[\\/]/.test(requestedPath) || requestedPath.startsWith('/') || requestedPath.startsWith('\\\\')));
    const targetPath = requestedPath
      ? (isAbsoluteTarget ? requestedPath : `${workspacePath.replace(/[\\/]+$/, '')}${workspacePath.includes('\\') ? '\\' : '/'}${requestedPath.replace(/[\\/]/g, workspacePath.includes('\\') ? '\\' : '/')}`)
      : activeTabPath;
    const navigate = async () => {
      if (targetPath && targetPath !== activeTabPath) {
        const name = targetPath.split(/[\\/]/).pop() || targetPath;
        await useWorkspaceStore.getState().openFile(targetPath, name);
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (editor) {
          const model = editor.getModel();
          const maxLine = model?.getLineCount() || 1;
          const lineNumber = Math.max(1, Math.min(maxLine, navigationRequest.target.line));
          const maxColumn = model?.getLineMaxColumn(lineNumber) || 1;
          const column = Math.max(1, Math.min(maxColumn, navigationRequest.target.column || 1));
          editor.setPosition({ lineNumber, column });
          editor.revealPositionInCenter({ lineNumber, column });
          editor.focus();
        }
        useEditorNavigationStore.getState().clearRequest(navigationRequest.id);
        openingNavigationId.current = null;
      }));
    };
    void navigate();
  }, [navigationRequest?.id, activeTabPath, workspacePath]);

  const toggleSplit = (orientation: 'horizontal' | 'vertical') => {
    setSplitState((prev) => {
      if (prev.isSplit && prev.orientation === orientation) {
        return { ...prev, isSplit: false };
      }
      const otherTab = openTabs.find((t) => t.path !== activeTabPath) || null;
      return {
        isSplit: true,
        orientation,
        secondaryTabPath: otherTab ? otherTab.path : activeTabPath
      };
    });
  };

  const triggerRefactor = async (
    type: any,
    selectedText: string,
    selection: any,
    targetName?: string
  ) => {
    if (!activeTab) return;
    try {
      const req = {
        type,
        filePath: activeTab.path,
        selectedText,
        selectionRange: {
          startLine: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLine: selection.endLineNumber,
          endColumn: selection.endColumn
        },
        targetName,
        forcePreview: useWorkspaceEditStore.getState().forcePreviewAll
      };
      const response = await window.electronAPI.requestRefactorPreview(req);
      if (!response.success || !response.data) {
        toast.error('Refactor failed', response.error);
        return;
      }
      if (response.data.applied) {
        handleAutoAppliedTransaction(response.data.applied);
        return;
      }
      useWorkspaceEditStore.getState().setRequest({
        preview: response.data.preview,
        isStale: false,
        refresh: async () => {
          const refreshed = await window.electronAPI.requestRefactorPreview({ ...req, forcePreview: true });
          if (!refreshed.success || !refreshed.data) throw new Error(refreshed.error || 'Could not refresh refactor preview.');
          return refreshed.data.preview;
        }
      });
      toast.info('Refactor Preview Ready', 'Review unified Myers diff and apply changes.');
    } catch (err) {
      toast.error('Refactor error', String(err));
    }
  };

  const handleEditorMount = (editor: any) => {
    cursorListenerRef.current?.dispose();
    editorRef.current = editor;
    primaryEditorRegistration.current?.dispose();
    primaryEditorRegistration.current = registerEditor(editor, { groupId: 'primary' });
    if (monaco && activeTab) applyStoredDiagnostics(monaco, activeTab.path);
    setCurrentLine(editor.getPosition()?.lineNumber || 1);
    cursorListenerRef.current = editor.onDidChangeCursorPosition((event: { position: { lineNumber: number } }) => {
      setCurrentLine(event.position.lineNumber);
    });

    // Enable multi-cursor modifier
    editor.updateOptions({
      multiCursorModifier: 'alt',
      bracketPairColorization: { enabled: true },
      guides: {
        indentation: true,
        bracketPairs: true,
        highlightActiveIndentation: true
      },
      folding: true,
      foldingStrategy: 'auto',
      showFoldingControls: 'always',
      renderWhitespace: 'selection'
    });

    // AI Refactoring Context Menu Actions
    editor.addAction({
      id: 'tycode.refactor.extractFunction',
      label: 'AI Refactor: Extract Function',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 1,
      run: async (ed: any) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection);
        if (!selectedText) {
          toast.warning('No selection', 'Select code to extract function.');
          return;
        }
        const fnName = await useExtensionPromptStore.getState().requestInput('Enter function name:', 'extractedFunction');
        if (!fnName || !fnName.trim()) return;
        await triggerRefactor('extract-function', selectedText, selection, fnName.trim());
      }
    });

    editor.addAction({
      id: 'tycode.refactor.extractVariable',
      label: 'AI Refactor: Extract Variable',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 2,
      run: async (ed: any) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection);
        if (!selectedText) {
          toast.warning('No selection', 'Select expression to extract variable.');
          return;
        }
        const varName = await useExtensionPromptStore.getState().requestInput('Enter variable name:', 'extractedVal');
        if (!varName || !varName.trim()) return;
        await triggerRefactor('extract-variable', selectedText, selection, varName.trim());
      }
    });

    editor.addAction({
      id: 'tycode.refactor.addErrorHandling',
      label: 'AI Refactor: Add Error Handling (try/catch)',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 3,
      run: async (ed: any) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection);
        if (!selectedText) {
          toast.warning('No selection', 'Select code to wrap in error handling.');
          return;
        }
        await triggerRefactor('add-error-handling', selectedText, selection);
      }
    });

    editor.addAction({
      id: 'tycode.refactor.addTypes',
      label: 'AI Refactor: Add TypeScript Types',
      contextMenuGroupId: '1_modification',
      contextMenuOrder: 4,
      run: async (ed: any) => {
        const selection = ed.getSelection();
        const selectedText = ed.getModel()?.getValueInRange(selection);
        if (!selectedText) {
          toast.warning('No selection', 'Select code to add types.');
          return;
        }
        await triggerRefactor('add-typescript-types', selectedText, selection);
      }
    });
  };

  const handleSecondaryEditorMount = (editor: any) => {
    secondaryEditorRegistration.current?.dispose();
    secondaryEditorRegistration.current = registerEditor(editor, { groupId: 'secondary' });
  };

  const handleDiffEditorMount = (editor: any) => {
    diffEditorRegistration.current?.dispose();
    diffEditorRegistration.current = registerDiffEditor(editor);
  };

  const handleContentChange = (path: string, newContent: string) => {
    const transactionContent = useWorkspaceEditStore.getState().consumePendingEditorContent(path);
    if (transactionContent !== undefined && transactionContent === newContent) return;
    updateTabContent(path, newContent);
    notifyDocumentChanged(path, newContent);
    // Go G1's per-file last-edit map: the cursor at change time is the edit site.
    recordEdit(path);
    useWorkspaceEditStore.getState().markEditorChanged(path, newContent);
    if (activeTab) {
      void usePairProgrammingStore.getState().processEditorEvent({
        type: 'content-changed',
        filePath: path,
        language: activeTab.language,
        line: currentLine,
        content: newContent
      });
    }
  };

  const handleCloseTab = (path: string) => {
    notifyDocumentClosed(path);
    // Otherwise Back keeps offering a tab the user deliberately closed.
    forgetFile(path);
    if (monaco) {
      try {
        const uri = monaco.Uri.file(path);
        const model = monaco.editor.getModel(uri);
        model?.dispose();
      } catch {
        // Safe disposal fallback
      }
    }
    closeTab(path);
    if (splitState.secondaryTabPath === path) {
      setSplitState((prev) => ({ ...prev, secondaryTabPath: null, isSplit: false }));
    }
  };

  const handleCloseOtherTabs = (currentPath: string) => {
    for (const tab of openTabs) {
      if (tab.path !== currentPath) {
        handleCloseTab(tab.path);
      }
    }
    setTabContextMenu(null);
  };

  const handleCloseRightTabs = (currentPath: string) => {
    const idx = openTabs.findIndex((t) => t.path === currentPath);
    if (idx !== -1) {
      const toClose = openTabs.slice(idx + 1);
      for (const tab of toClose) {
        handleCloseTab(tab.path);
      }
    }
    setTabContextMenu(null);
  };

  useEffect(() => {
    if (!tabContextMenu) return;
    const handleClose = () => setTabContextMenu(null);
    window.addEventListener('click', handleClose);
    return () => window.removeEventListener('click', handleClose);
  }, [tabContextMenu]);

  // Breadcrumbs path split
  const pathParts = activeTab ? activeTab.path.replace(/\\/g, '/').split('/').filter(Boolean) : [];
  const displayParts = pathParts.slice(-4);

  return (
    <div
      style={{
        flex: 1,
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: 'var(--bg-primary)',
        overflow: 'hidden',
        position: isZenMode ? 'fixed' : 'relative',
        inset: isZenMode ? 0 : undefined,
        zIndex: isZenMode ? 'var(--layer-editor-zen)' : 1
      }}
    >
      {/* Diff Review Bar if Diff Active */}
      {diffReview?.isOpen && (
        <div
          style={{
            height: '38px',
            backgroundColor: 'rgba(139, 92, 246, 0.15)',
            borderBottom: '1px solid var(--accent-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '0 12px',
            fontSize: '12px'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-primary)' }}>
            <FileEdit size={14} color="var(--accent-primary)" />
            <span>
              Reviewing AI proposed modifications to <strong>{diffReview.diff.filePath}</strong>
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button
              onClick={() => applyDiff(diffReview.diff)}
              style={{
                backgroundColor: 'var(--accent-green)',
                color: '#fff',
                padding: '4px 10px',
                fontWeight: 500,
                fontSize: '11px',
                borderRadius: '4px'
              }}
            >
              <Check size={12} />
              <span>Apply Changes</span>
            </button>
            <button
              onClick={closeDiffReview}
              style={{
                backgroundColor: 'var(--bg-hover)',
                color: 'var(--text-secondary)',
                padding: '4px 10px',
                fontSize: '11px',
                borderRadius: '4px'
              }}
            >
              <X size={12} />
              <span>Dismiss</span>
            </button>
          </div>
        </div>
      )}

      {/* Tabs Header */}
      {!diffReview?.isOpen && (
        <div
          style={{
            height: '35px',
            backgroundColor: 'var(--bg-secondary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            userSelect: 'none',
            overflow: 'hidden'
          }}
        >
          {/* Tabs List */}
          <div style={{ display: 'flex', alignItems: 'center', height: '100%', overflowX: 'auto', flex: 1 }}>
            {/* Pinned Document Review Tab */}
            {activeDocument && isDocumentTabOpen && (
              <div
                onClick={() => setDocTabActive(true)}
                style={{
                  height: '100%',
                  padding: '0 12px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  cursor: 'pointer',
                  fontSize: '12px',
                  backgroundColor: isDocTabActive ? 'var(--bg-primary)' : 'transparent',
                  color: isDocTabActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                  borderRight: '1px solid var(--border-subtle)',
                  borderTop: isDocTabActive ? '2px solid var(--accent-primary, #6366f1)' : '2px solid transparent',
                  flexShrink: 0
                }}
                title={`Agent ${activeDocument.kind.toUpperCase()}: ${activeDocument.title}`}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}>
                  <span
                    style={{
                      fontSize: '9px',
                      fontWeight: 700,
                      padding: '1px 5px',
                      borderRadius: '3px',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      backgroundColor: activeDocument.kind === 'plan' ? 'rgba(99, 102, 241, 0.2)' : 'rgba(16, 185, 129, 0.2)',
                      color: activeDocument.kind === 'plan' ? '#a5b4fc' : '#6ee7b7',
                      border: `1px solid ${activeDocument.kind === 'plan' ? 'rgba(99, 102, 241, 0.4)' : 'rgba(16, 185, 129, 0.4)'}`
                    }}
                  >
                    {activeDocument.kind}
                  </span>
                  <span>📄 {activeDocument.title}</span>
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    clearDocument();
                  }}
                  style={{
                    padding: '2px',
                    borderRadius: '3px',
                    color: 'var(--text-muted)',
                    background: 'transparent',
                    border: 'none',
                    cursor: 'pointer'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  title="Close document review"
                >
                  <X size={12} />
                </button>
              </div>
            )}

            {openTabs.map((tab) => {
              const isActive = !isDocTabActive && tab.path === activeTabPath;
              return (
                <div
                  key={tab.path}
                  onClick={() => {
                    setActiveTab(tab.path);
                    setDocTabActive(false);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setTabContextMenu({ x: e.clientX, y: e.clientY, path: tab.path });
                  }}
                  style={{
                    height: '100%',
                    padding: '0 12px',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    backgroundColor: isActive ? 'var(--bg-primary)' : 'transparent',
                    color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderRight: '1px solid var(--border-subtle)',
                    borderTop: isActive ? '2px solid var(--accent-primary)' : '2px solid transparent',
                    flexShrink: 0
                  }}
                >
                  <span>{tab.name}</span>
                  {tab.isDirty && (
                    <span
                      style={{
                        width: '6px',
                        height: '6px',
                        borderRadius: '50%',
                        backgroundColor: 'var(--accent-cyan)'
                      }}
                      title="Unsaved changes"
                    />
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleCloseTab(tab.path);
                    }}
                    style={{
                      padding: '2px',
                      borderRadius: '3px',
                      color: 'var(--text-muted)'
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right Toolbar: Split Editor, Minimap, Word Wrap, Zen Mode, Git Blame */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', paddingRight: '8px', flexShrink: 0 }}>
            {/* Split Vertical */}
            <button
              onClick={() => toggleSplit('vertical')}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: splitState.isSplit && splitState.orientation === 'vertical' ? 'var(--accent-primary)' : 'var(--text-muted)',
                backgroundColor: splitState.isSplit && splitState.orientation === 'vertical' ? 'var(--bg-tertiary)' : 'transparent'
              }}
              title="Split Editor Right (Ctrl+\)"
            >
              <SplitSquareVertical size={14} />
            </button>

            {/* Split Horizontal */}
            <button
              onClick={() => toggleSplit('horizontal')}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: splitState.isSplit && splitState.orientation === 'horizontal' ? 'var(--accent-primary)' : 'var(--text-muted)',
                backgroundColor: splitState.isSplit && splitState.orientation === 'horizontal' ? 'var(--bg-tertiary)' : 'transparent'
              }}
              title="Split Editor Down"
            >
              <SplitSquareHorizontal size={14} />
            </button>

            {/* Toggle Minimap */}
            <button
              onClick={() => setMinimapEnabled((prev) => !prev)}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: minimapEnabled ? 'var(--accent-primary)' : 'var(--text-muted)'
              }}
              title="Toggle Minimap"
            >
              <LayoutTemplate size={14} />
            </button>

            {/* Toggle Word Wrap */}
            <button
              onClick={() => setWordWrap((prev) => (prev === 'on' ? 'off' : 'on'))}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: wordWrap === 'on' ? 'var(--accent-primary)' : 'var(--text-muted)'
              }}
              title="Toggle Word Wrap (Alt+Z)"
            >
              <WrapText size={14} />
            </button>

            {/* Zen Mode */}
            <button
              onClick={() => setIsZenMode((prev) => !prev)}
              style={{
                padding: '4px 6px',
                borderRadius: '4px',
                color: isZenMode ? 'var(--accent-amber)' : 'var(--text-muted)'
              }}
              title="Toggle Zen Mode"
            >
              {isZenMode ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>

            {/* Git Blame Gutter Info */}
            {activeTab && (
              <div style={{ marginLeft: '6px' }}>
                <GitBlameGutter
                  filePath={activeTab.path.slice(workspacePath.length).replace(/^[\\/]+/, '')}
                  currentLine={currentLine}
                  isDirty={activeTab.isDirty}
                  refreshKey={blameRefreshKey}
                  onBlameLoaded={handleBlameLoaded}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* Breadcrumb Navigation Bar */}
      {activeTab && !diffReview?.isOpen && !isDocTabActive && (
        <div
          style={{
            height: '24px',
            backgroundColor: 'var(--bg-primary)',
            borderBottom: '1px solid var(--border-subtle)',
            display: 'flex',
            alignItems: 'center',
            padding: '0 12px',
            fontSize: '11px',
            color: 'var(--text-muted)',
            gap: '4px',
            userSelect: 'none'
          }}
        >
          {displayParts.map((part, index) => (
            <React.Fragment key={index}>
              {index > 0 && <ChevronRight size={10} color="var(--border-strong)" />}
              <span
                style={{
                  color: index === displayParts.length - 1 ? 'var(--text-primary)' : 'var(--text-muted)',
                  fontWeight: index === displayParts.length - 1 ? 600 : 400
                }}
              >
                {part}
              </span>
            </React.Fragment>
          ))}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '10px' }}>
            {(() => {
              const languageId = activeTab.language === 'javascript' ? 'typescript' : activeTab.language === 'c' ? 'cpp' : activeTab.language;
              const server = languageServers.find((item) => item.languageId === languageId);
              return <span title={server?.error || server?.resolvedPath || activeTab.language} style={{ color: server?.status === 'running' ? 'var(--accent-green)' : server?.status === 'error' ? 'var(--accent-red)' : 'var(--text-muted)' }}>{server?.status === 'running' ? 'LSP Running' : server?.isAvailable ? 'LSP Ready' : 'LSP Unavailable'}</span>;
            })()}
            <span>{activeTab.language}</span>
          </div>
        </div>
      )}

      {/* Main Monaco Surface (Single or Split Pane) */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: splitState.orientation === 'horizontal' ? 'column' : 'row' }}>
        {isDocTabActive && activeDocument && isDocumentTabOpen ? (
          <DocumentReviewPane />
        ) : (activeTab || diffReview?.isOpen) && !monaco ? (
          <div role={monacoRuntime.error ? 'alert' : 'status'} style={{ margin: 'auto', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>{monacoRuntime.error ? `Editor failed to load: ${monacoRuntime.error}` : 'Loading editor…'}</span>
            {monacoRuntime.error && <button type="button" onClick={() => { void ensureMonaco().catch((error) => toast.error('Editor failed to load', String(error))); }}>Retry</button>}
          </div>
        ) : diffReview?.isOpen ? (
          <DiffEditor
            original={diffReview.diff.originalContent}
            modified={diffReview.diff.proposedContent}
            language="typescript"
            theme={monacoTheme}
            onMount={handleDiffEditorMount}
            options={{
              renderSideBySide: true,
              fontSize: 13,
              fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
              automaticLayout: true,
              scrollBeyondLastLine: false,
              readOnly: true
            }}
          />
        ) : activeTab ? (
          <>
            {/* Primary Editor Pane */}
            <div style={{ flex: 1, height: '100%', position: 'relative', overflow: 'hidden' }}>
              <Editor
                key="primary_editor"
                path={monaco?.Uri.file(activeTab.path).toString() ?? activeTab.path}
                language={activeTab.language}
                value={activeTab.content}
                theme={monacoTheme}
                onMount={handleEditorMount}
                onChange={(val) => {
                  if (val !== undefined) handleContentChange(activeTab.path, val);
                }}
                options={{
                  fontSize: settings?.editor?.fontSize ?? 13,
                  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
                  automaticLayout: false,
                  scrollBeyondLastLine: false,
                  minimap: { enabled: minimapEnabled, side: 'right' },
                  wordWrap,
                  lineNumbers: 'on',
                  glyphMargin: true,
                  renderWhitespace: 'selection',
                  tabSize: settings?.editor?.tabSize ?? 2,
                  bracketPairColorization: { enabled: settings?.editor?.bracketPairs ?? true },
                  guides: {
                    indentation: true,
                    bracketPairs: true,
                    highlightActiveIndentation: true
                  },
                  multiCursorModifier: 'alt'
                }}
              />
            </div>

            {/* Secondary Split Pane if Active */}
            {splitState.isSplit && secondaryTab && (
              <div
                style={{
                  flex: 1,
                  height: '100%',
                  position: 'relative',
                  overflow: 'hidden',
                  borderLeft: splitState.orientation === 'vertical' ? '1px solid var(--border-subtle)' : 'none',
                  borderTop: splitState.orientation === 'horizontal' ? '1px solid var(--border-subtle)' : 'none'
                }}
              >
                <div
                  style={{
                    height: '24px',
                    backgroundColor: 'var(--bg-secondary)',
                    borderBottom: '1px solid var(--border-subtle)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 10px',
                    fontSize: '11px',
                    color: 'var(--text-secondary)'
                  }}
                >
                  <span>{secondaryTab.name} (Split View)</span>
                  <button
                    onClick={() => setSplitState((prev) => ({ ...prev, isSplit: false }))}
                    style={{ padding: '2px', color: 'var(--text-muted)' }}
                    title="Close Split"
                  >
                    <X size={12} />
                  </button>
                </div>
                <div style={{ height: 'calc(100% - 24px)' }}>
                  <Editor
                    key="secondary_editor"
                    path={monaco?.Uri.file(secondaryTab.path).toString() ?? secondaryTab.path}
                    language={secondaryTab.language}
                    value={secondaryTab.content}
                    theme={monacoTheme}
                    onMount={handleSecondaryEditorMount}
                    onChange={(val) => {
                      if (val !== undefined) handleContentChange(secondaryTab.path, val);
                    }}
                    options={{
                      fontSize: 13,
                      fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
                      automaticLayout: true,
                      scrollBeyondLastLine: false,
                      minimap: { enabled: false },
                      wordWrap,
                      lineNumbers: 'on',
                      bracketPairColorization: { enabled: true },
                      multiCursorModifier: 'alt'
                    }}
                  />
                </div>
              </div>
            )}
          </>
        ) : (
          <WelcomePage onStartTour={() => setIsTourOpen(true)} />
        )}
      </div>

      {/* Tab Context Menu */}
      {tabContextMenu && (
        <div
          role="menu"
          style={{
            position: 'fixed',
            top: tabContextMenu.y,
            left: tabContextMenu.x,
            zIndex: 'var(--layer-menu)',
            backgroundColor: 'var(--bg-tertiary)',
            border: '1px solid var(--border-strong)',
            borderRadius: '6px',
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.5)',
            padding: '4px',
            minWidth: '160px',
            display: 'flex',
            flexDirection: 'column',
            gap: '1px'
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              handleCloseTab(tabContextMenu.path);
              setTabContextMenu(null);
            }}
            style={{
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            Close
          </button>
          <button
            onClick={() => handleCloseOtherTabs(tabContextMenu.path)}
            style={{
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            Close Others
          </button>
          <button
            onClick={() => handleCloseRightTabs(tabContextMenu.path)}
            style={{
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            Close to the Right
          </button>
          <div style={{ height: '1px', backgroundColor: 'var(--border-subtle)', margin: '3px 0' }} />
          <button
            onClick={async () => {
              await navigator.clipboard.writeText(tabContextMenu.path);
              toast.success('Path copied', tabContextMenu.path);
              setTabContextMenu(null);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              padding: '6px 8px',
              fontSize: '11px',
              color: 'var(--text-primary)',
              borderRadius: '4px',
              textAlign: 'left',
              cursor: 'pointer'
            }}
          >
            <Copy size={12} />
            Copy Path
          </button>
        </div>
      )}

      {/* Onboarding Tour Modal */}
      <OnboardingTour isOpen={isTourOpen} onClose={() => setIsTourOpen(false)} />
    </div>
  );
};
