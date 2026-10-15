import { create } from 'zustand';
import type { CodeReviewFinding, CodeReviewResult, CodeReviewRule } from '../../../preload/types';
import { toast } from './toast-store';
import { useWorkspaceEditStore } from './workspace-edit-store';
import { handleAutoAppliedTransaction } from '../services/workspace-edit-commands';

interface CodeReviewState {
  result: CodeReviewResult | null;
  isAnalyzing: boolean;
  activeFilter: 'all' | 'bug' | 'security' | 'performance' | 'style';
  rules: CodeReviewRule[];
  activeTab: 'findings' | 'rules' | 'history';
  setFilter: (filter: 'all' | 'bug' | 'security' | 'performance' | 'style') => void;
  setActiveTab: (tab: 'findings' | 'rules' | 'history') => void;
  runReview: (filePath?: string, content?: string) => Promise<void>;
  applyFix: (finding: CodeReviewFinding) => Promise<boolean>;
  loadRules: () => Promise<void>;
  toggleRule: (ruleId: string) => Promise<void>;
}

export const useCodeReviewStore = create<CodeReviewState>((set, get) => ({
  result: null,
  isAnalyzing: false,
  activeFilter: 'all',
  rules: [],
  activeTab: 'findings',

  setFilter: (filter) => set({ activeFilter: filter }),
  setActiveTab: (tab) => set({ activeTab: tab }),

  loadRules: async () => {
    try {
      const res = await window.electronAPI.getCodeReviewRules();
      if (res.success && res.data) {
        set({ rules: res.data });
      }
    } catch {
      // Ignore
    }
  },

  toggleRule: async (ruleId: string) => {
    const currentRules = get().rules;
    const updated = currentRules.map((r) => (r.id === ruleId ? { ...r, enabled: !r.enabled } : r));
    set({ rules: updated });
    try {
      await window.electronAPI.updateCodeReviewRules(updated);
      toast.success('Rules updated', 'Code review rules preference saved.');
    } catch {
      toast.error('Could not save rules');
    }
  },

  runReview: async (filePath?: string, content?: string) => {
    set({ isAnalyzing: true });
    try {
      const res = await window.electronAPI.runCodeReview({
        filePath,
        content
      });
      if (res.success && res.data) {
        set({ result: res.data, isAnalyzing: false });
        if (res.data.findings.length === 0) {
          toast.success('Code Review Clean', 'No bugs, security issues, or performance bottlenecks found!');
        } else {
          toast.info(
            'Code Review Complete',
            `Found ${res.data.findings.length} findings (${res.data.summary.bugs} bugs, ${res.data.summary.security} security risks).`
          );
        }
      } else {
        set({ isAnalyzing: false });
        toast.error('Code review failed', res.error);
      }
    } catch (err) {
      set({ isAnalyzing: false });
      toast.error('Review error', String(err));
    }
  },

  applyFix: async (finding: CodeReviewFinding) => {
    if (!finding.suggestedFix) return false;
    try {
      const request = {
        filePath: finding.filePath,
        lineNumber: finding.line,
        originalText: finding.suggestedFix.originalText,
        replacementText: finding.suggestedFix.replacementText,
        title: `Review code-review fix · ${finding.title}`,
        forcePreview: useWorkspaceEditStore.getState().forcePreviewAll
      };
      const response = await window.electronAPI.previewSnippetEdit(request);
      if (!response.success || !response.data) throw new Error(response.error || 'Could not create the code-review fix preview.');
      if (response.data.applied) {
        handleAutoAppliedTransaction(response.data.applied);
        return true;
      }
      const preview = response.data.preview;
      if (!preview) throw new Error('The code-review fix preview was empty.');
      useWorkspaceEditStore.getState().setRequest({
        preview,
        isStale: false,
        refresh: async () => {
          const refreshed = await window.electronAPI.previewSnippetEdit({ ...request, forcePreview: true });
          if (!refreshed.success || !refreshed.data?.preview) throw new Error(refreshed.error || 'Could not refresh the code-review fix preview.');
          return refreshed.data.preview;
        }
      });
      toast.info('Review code fix', `Inspect ${finding.filePath}:${finding.line} before applying.`);
      return true;
    } catch (err) {
      toast.error('Could not prepare code-review fix', String(err));
      return false;
    }
  }
}));
