import { create } from 'zustand';
import type { FileNode, FlatFileNodeEntry, ProposedDiff } from '../../../preload/types';
import { transitionProfiler } from '../services/perf/transition-profiler';
import { LazyModelManager } from '../services/lazy-model-manager';

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  isDirty: boolean;
  language: string;
}

export interface DiffReviewState {
  isOpen: boolean;
  diff: ProposedDiff;
}

interface WorkspaceState {
  workspacePath: string;
  workspaceRoot: string;
  fileTree: FileNode | null;
  flatTree: FlatFileNodeEntry[] | null;
  openTabs: EditorTab[];
  activeTabPath: string | null;
  diffReview: DiffReviewState | null;
  isWorkspaceReady: boolean;
  hasWorkspace: boolean;

  // Actions
  setIsWorkspaceReady: (ready: boolean) => void;
  setWorkspacePath: (path: string) => void;
  setFileTree: (tree: FileNode | null) => void;
  setFlatTree: (flat: FlatFileNodeEntry[] | null) => void;
  appendTreeChunk: (chunk: FlatFileNodeEntry[]) => void;
  openFile: (filePath: string, name: string) => Promise<void>;
  closeTab: (filePath: string) => void;
  setActiveTab: (filePath: string) => void;
  updateTabContent: (filePath: string, newContent: string) => void;
  saveActiveFile: () => Promise<void>;
  saveFile: (filePath: string) => Promise<boolean>;
  openDiffReview: (diff: ProposedDiff) => void;
  closeDiffReview: () => void;
  applyDiff: (diff: ProposedDiff) => Promise<void>;
  refreshFileTree: () => Promise<void>;
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    case 'html':
      return 'html';
    case 'css':
      return 'css';
    case 'py':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'java':
      return 'java';
    case 'c':
      return 'c';
    case 'cpp':
    case 'cc':
    case 'cxx':
    case 'h':
    case 'hpp':
      return 'cpp';
    case 'yml':
    case 'yaml':
      return 'yaml';
    case 'sh':
    case 'bash':
      return 'shell';
    default:
      return 'plaintext';
  }
}

const TABS_STORAGE_KEY = 'ty_code_open_tabs_v1';

export function loadPersistedTabs(): { openTabs: EditorTab[]; activeTabPath: string | null } {
  try {
    if (typeof localStorage === 'undefined') return { openTabs: [], activeTabPath: null };
    const raw = localStorage.getItem(TABS_STORAGE_KEY);
    if (!raw) return { openTabs: [], activeTabPath: null };
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed?.openTabs)) {
      return {
        openTabs: parsed.openTabs,
        activeTabPath: typeof parsed.activeTabPath === 'string' ? parsed.activeTabPath : (parsed.openTabs[0]?.path || null)
      };
    }
  } catch {
    // Graceful fallback if storage corrupted
  }
  return { openTabs: [], activeTabPath: null };
}

export function savePersistedTabs(openTabs: EditorTab[], activeTabPath: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(TABS_STORAGE_KEY, JSON.stringify({ openTabs, activeTabPath }));
  } catch {
    // Graceful fallback
  }
}

const initialPersisted = loadPersistedTabs();

// Tier-2 idle prefetching for last-session tabs
if (typeof window !== 'undefined') {
  LazyModelManager.getInstance().prefetchLastSessionTabs(initialPersisted.openTabs);
}

function buildNestedTreeFromFlat(flat: FlatFileNodeEntry[]): FileNode {
  if (flat.length === 0) {
    return { name: '', path: '', relativePath: '', isDirectory: true, children: [] };
  }
  const root = flat[0];
  const rootNode: FileNode = {
    name: root.name,
    path: root.path,
    relativePath: root.relativePath || '',
    isDirectory: true,
    children: []
  };

  const nodeMap = new Map<string, FileNode>();
  nodeMap.set(root.path, rootNode);

  for (let i = 1; i < flat.length; i++) {
    const item = flat[i];
    const node: FileNode = {
      name: item.name,
      path: item.path,
      relativePath: item.relativePath || '',
      isDirectory: item.isDirectory,
      size: item.size,
      extension: item.extension,
      children: item.isDirectory ? [] : undefined
    };
    nodeMap.set(item.path, node);

    const parentPath = item.path.substring(0, item.path.lastIndexOf(/[/\\]/.exec(item.path)?.[0] || '/'));
    const parentNode = nodeMap.get(parentPath);
    if (parentNode && parentNode.children) {
      parentNode.children.push(node);
    } else {
      rootNode.children?.push(node);
    }
  }

  return rootNode;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspacePath: '',
  workspaceRoot: '',
  fileTree: null,
  flatTree: null,
  openTabs: initialPersisted.openTabs,
  activeTabPath: initialPersisted.activeTabPath,
  diffReview: null,
  isWorkspaceReady: false,
  hasWorkspace: false,

  setIsWorkspaceReady: (ready: boolean) => set({ isWorkspaceReady: ready }),
  setWorkspacePath: (path: string) => set({ workspacePath: path, workspaceRoot: path, isWorkspaceReady: false, hasWorkspace: !!path }),
  setFileTree: (tree) => set({ fileTree: tree }),
  setFlatTree: (flat) => set({ flatTree: flat }),
  appendTreeChunk: (chunk) => set((state) => ({ flatTree: [...(state.flatTree || []), ...chunk] })),

  openFile: async (filePath: string, name: string) => {
    const { openTabs } = get();
    const existing = openTabs.find((t) => t.path === filePath);

    if (existing) {
      set({ activeTabPath: filePath });
      savePersistedTabs(openTabs, filePath);
      return;
    }

    // Check memory cache for instant warm open (<150ms)
    const cachedContent = LazyModelManager.getInstance().getCachedContent(filePath);
    if (cachedContent !== null) {
      const newTab: EditorTab = {
        path: filePath,
        name,
        content: cachedContent,
        isDirty: false,
        language: detectLanguage(filePath)
      };
      const lang = detectLanguage(filePath);
      const nextTabs = [...openTabs, newTab];
      set({ openTabs: nextTabs, activeTabPath: filePath });
      savePersistedTabs(nextTabs, filePath);
      void window.electronAPI.extensionTriggerEvent?.('onLanguage:' + lang, { languageId: lang, filePath })?.catch?.(() => undefined);
      return;
    }

    try {
      let created = false;
      await LazyModelManager.getInstance().loadLargeFileProgressively(
        filePath,
        (initialChunk) => {
          created = true;
          const newTab: EditorTab = {
            path: filePath,
            name,
            content: initialChunk,
            isDirty: false,
            language: detectLanguage(filePath)
          };
          const nextTabs = [...get().openTabs, newTab];
          set({ openTabs: nextTabs, activeTabPath: filePath });
          savePersistedTabs(nextTabs, filePath);
        },
        (fullContent) => {
          if (created) {
            set((state) => ({
              openTabs: state.openTabs.map((t) => (t.path === filePath ? { ...t, content: fullContent } : t))
            }));
          } else {
            const newTab: EditorTab = {
              path: filePath,
              name,
              content: fullContent,
              isDirty: false,
              language: detectLanguage(filePath)
            };
            const nextTabs = [...get().openTabs, newTab];
            set({ openTabs: nextTabs, activeTabPath: filePath });
            savePersistedTabs(nextTabs, filePath);
            void window.electronAPI.extensionTriggerEvent?.('onLanguage:' + detectLanguage(filePath), { languageId: detectLanguage(filePath), filePath })?.catch?.(() => undefined);
          }
        }
      );
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  },

  closeTab: (filePath: string) => {
    const { openTabs, activeTabPath } = get();
    // Recycle model to disposed pool
    LazyModelManager.getInstance().releaseModel(filePath);

    const nextTabs = openTabs.filter((t) => t.path !== filePath);
    let nextActive = activeTabPath;

    if (activeTabPath === filePath) {
      nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].path : null;
    }

    set({ openTabs: nextTabs, activeTabPath: nextActive });
    savePersistedTabs(nextTabs, nextActive);
  },

  setActiveTab: (filePath: string) => {
    const filename = filePath.split(/[/\\]/).pop() || filePath;
    const transId = transitionProfiler.startTransition(`tab_switch:${filename}`);
    set({ activeTabPath: filePath });
    savePersistedTabs(get().openTabs, filePath);
    void transitionProfiler.endTransition(transId, `tab_switch:${filename}`);
    void window.electronAPI.extensionTriggerEvent?.('onLanguage:' + detectLanguage(filePath), { languageId: detectLanguage(filePath), filePath })?.catch?.(() => undefined);
  },

  updateTabContent: (filePath: string, newContent: string) => {
    set((state) => {
      const nextTabs = state.openTabs.map((t) =>
        t.path === filePath
          ? { ...t, content: newContent, isDirty: true }
          : t
      );
      savePersistedTabs(nextTabs, state.activeTabPath);
      return { openTabs: nextTabs };
    });
  },

  saveActiveFile: async () => {
    const activeTabPath = get().activeTabPath;
    if (activeTabPath) await get().saveFile(activeTabPath);
  },

  saveFile: async (filePath: string) => {
    const tab = get().openTabs.find((item) => item.path === filePath);
    if (!tab || !tab.isDirty) return true;
    const contentAtStart = tab.content;
    try {
      const response = await window.electronAPI.writeFile(tab.path, contentAtStart);
      if (!response.success) throw new Error(response.error || 'File write failed.');
      set((state) => {
        const nextTabs = state.openTabs.map((item) => item.path === tab.path
          ? { ...item, isDirty: item.content !== contentAtStart }
          : item);
        savePersistedTabs(nextTabs, state.activeTabPath);
        return { openTabs: nextTabs };
      });
      void window.electronAPI.lspDidSave({ filePath: tab.path, text: contentAtStart });
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  },

  openDiffReview: (diff: ProposedDiff) => {
    const transId = transitionProfiler.startTransition('diff_open');
    set({ diffReview: { isOpen: true, diff } });
    void transitionProfiler.endTransition(transId, 'diff_open');
  },

  closeDiffReview: () => {
    set({ diffReview: null });
  },

  applyDiff: async (diff: ProposedDiff) => {
    try {
      const res = await window.electronAPI.applyDiff(diff);
      if (res.success) {
        // If file is open in tab, update tab content
        const { openTabs, refreshFileTree } = get();
        const tab = openTabs.find((t) => t.path.endsWith(diff.filePath) || diff.filePath.endsWith(t.name));
        if (tab) {
          set((state) => ({
            openTabs: state.openTabs.map((t) =>
              t.path === tab.path ? { ...t, content: diff.proposedContent, isDirty: false } : t
            )
          }));
        }
        set({ diffReview: null });
        await refreshFileTree();
      }
    } catch (err) {
      console.error('Failed to apply diff:', err);
    }
  },

  refreshFileTree: async () => {
    const { workspacePath } = get();
    if (!workspacePath) {
      set({ isWorkspaceReady: false, hasWorkspace: false });
      return;
    }
    set({ isWorkspaceReady: false });
    try {
      if (window.electronAPI?.getWorkspaceTreeChunked) {
        const chunkRes = await window.electronAPI.getWorkspaceTreeChunked(workspacePath);
        if (chunkRes.success && chunkRes.data?.flatTree) {
          set({ flatTree: chunkRes.data.flatTree });
          const nested = buildNestedTreeFromFlat(chunkRes.data.flatTree);
          set({ fileTree: nested, isWorkspaceReady: true, hasWorkspace: true });
          return;
        }
      }

      const res = await window.electronAPI?.getWorkspaceTree(workspacePath);
      if (res?.success && res.data) {
        set({ fileTree: res.data, isWorkspaceReady: true, hasWorkspace: true });
      }
    } catch (err) {
      console.error('Failed to refresh tree:', err);
    }
  }
}));

// Global IPC event listeners for workspace readiness and folder open
if (typeof window !== 'undefined' && window.electronAPI) {
  window.electronAPI.onWorkspaceReady?.((data) => {
    useWorkspaceStore.getState().setIsWorkspaceReady(true);
    if (data?.path && useWorkspaceStore.getState().workspacePath !== data.path) {
      useWorkspaceStore.setState({ workspacePath: data.path, workspaceRoot: data.path, hasWorkspace: true });
    }
  });

  window.electronAPI.onOpenFolder?.((data) => {
    if (data?.folderPath) {
      useWorkspaceStore.getState().setWorkspacePath(data.folderPath);
      void useWorkspaceStore.getState().refreshFileTree();
    }
  });
}
