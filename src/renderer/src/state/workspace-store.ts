import { create } from 'zustand';
import type { FileNode, ProposedDiff } from '../../../preload/types';

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
  fileTree: FileNode | null;
  openTabs: EditorTab[];
  activeTabPath: string | null;
  diffReview: DiffReviewState | null;

  // Actions
  setWorkspacePath: (path: string) => void;
  setFileTree: (tree: FileNode | null) => void;
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

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspacePath: '',
  fileTree: null,
  openTabs: [],
  activeTabPath: null,
  diffReview: null,

  setWorkspacePath: (path: string) => set({ workspacePath: path }),
  setFileTree: (tree) => set({ fileTree: tree }),

  openFile: async (filePath: string, name: string) => {
    const { openTabs } = get();
    const existing = openTabs.find((t) => t.path === filePath);

    if (existing) {
      set({ activeTabPath: filePath });
      return;
    }

    try {
      const res = await window.electronAPI.readFile(filePath);
      if (res.success && res.data !== undefined) {
        const newTab: EditorTab = {
          path: filePath,
          name,
          content: res.data,
          isDirty: false,
          language: detectLanguage(filePath)
        };

        set({
          openTabs: [...openTabs, newTab],
          activeTabPath: filePath
        });
      }
    } catch (err) {
      console.error('Failed to open file:', err);
    }
  },

  closeTab: (filePath: string) => {
    const { openTabs, activeTabPath } = get();
    const nextTabs = openTabs.filter((t) => t.path !== filePath);
    let nextActive = activeTabPath;

    if (activeTabPath === filePath) {
      nextActive = nextTabs.length > 0 ? nextTabs[nextTabs.length - 1].path : null;
    }

    set({ openTabs: nextTabs, activeTabPath: nextActive });
  },

  setActiveTab: (filePath: string) => set({ activeTabPath: filePath }),

  updateTabContent: (filePath: string, newContent: string) => {
    set((state) => ({
      openTabs: state.openTabs.map((t) =>
        t.path === filePath
          ? { ...t, content: newContent, isDirty: true }
          : t
      )
    }));
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
      set((state) => ({
        openTabs: state.openTabs.map((item) => item.path === tab.path
          ? { ...item, isDirty: item.content !== contentAtStart }
          : item)
      }));
      void window.electronAPI.lspDidSave({ filePath: tab.path, text: contentAtStart });
      return true;
    } catch (error) {
      console.error('Failed to save file:', error);
      return false;
    }
  },

  openDiffReview: (diff: ProposedDiff) => {
    set({ diffReview: { isOpen: true, diff } });
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
    if (!workspacePath) return;
    try {
      const res = await window.electronAPI.getWorkspaceTree(workspacePath);
      if (res.success && res.data) {
        set({ fileTree: res.data });
      }
    } catch (err) {
      console.error('Failed to refresh tree:', err);
    }
  }
}));
