import { create } from 'zustand';
import type { CodeReviewFinding, CodeReviewResult, CodeReviewRule } from '../../../preload/types';
import { toast } from './toast-store';

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
      const readRes = await window.electronAPI.readFile(finding.filePath);
      if (!readRes.success || readRes.data === undefined) {
        toast.error('Could not read file to apply fix');
        return false;
      }
      const original = readRes.data;
      if (!original.includes(finding.suggestedFix.originalText)) {
        toast.error('Cannot apply fix: Target code changed on disk.');
        return false;
      }

      const updated = original.replace(finding.suggestedFix.originalText, finding.suggestedFix.replacementText);
      const writeRes = await window.electronAPI.writeFile(finding.filePath, updated);
      if (writeRes.success) {
        toast.success('Fix applied', `Updated ${finding.filePath}:${finding.line}`);
        // Remove fixed finding from list
        const currentResult = get().result;
        if (currentResult) {
          const remaining = currentResult.findings.filter((f) => f.id !== finding.id);
          set({
            result: {
              ...currentResult,
              findings: remaining,
              summary: {
                ...currentResult.summary,
                total: remaining.length,
                bugs: remaining.filter((f) => f.category === 'bug').length,
                security: remaining.filter((f) => f.category === 'security').length,
                performance: remaining.filter((f) => f.category === 'performance').length,
                style: remaining.filter((f) => f.category === 'style').length
              }
            }
          });
        }
        return true;
      } else {
        toast.error('Could not write file', writeRes.error);
        return false;
      }
    } catch (err) {
      toast.error('Apply fix error', String(err));
      return false;
    }
  }
}));
