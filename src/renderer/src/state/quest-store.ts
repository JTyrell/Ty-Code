/**
 * Prompt B — Quest Mode renderer store.
 *
 * Subscribes once to the main-process quest lifecycle (via the disposable
 * `quest.subscribe` snapshot + `quest.onEvent` push stream) and keeps an
 * in-memory projection of every quest for the current workspace: status, live
 * log, todo progress and changed-file list. Spec events are forwarded to the
 * Document Review Pane so the approval gate renders exactly like any other
 * agent proposal. Nothing here fabricates quest state — the projection is
 * driven entirely by the events the service emits.
 */

import { create } from 'zustand';
import type {
  QuestMeta,
  QuestLogLine,
  QuestEvent,
  QuestStateSnapshot
} from '../../../shared/types/quest';
import { QUEST_LOG_LIMIT } from '../../../shared/types/quest';
import type { AgentDocument, IpcResponse } from '../../../preload/types';
import { useDocumentReviewStore } from './document-review-store';
import { toast } from './toast-store';

/** The preload `quest` namespace is optional in the type (mocked builds omit it). */
type QuestBridge = NonNullable<typeof window.electronAPI.quest>;

function questApi(): QuestBridge {
  const api = typeof window !== 'undefined' ? window.electronAPI?.quest : undefined;
  if (!api) throw new Error('Quest API is not available in this build.');
  return api;
}

interface QuestProjection {
  quests: QuestMeta[];
  logs: Record<string, QuestLogLine[]>;
  subscribedRoot: string | null;
  /** True once the initial subscribe resolved — panels can tell "loading" from "empty". */
  ready: boolean;

  applyEvent: (event: QuestEvent) => void;
  refresh: (workspaceRoot: string) => Promise<void>;
}

const initialState: QuestProjection = {
  quests: [],
  logs: {},
  subscribedRoot: null,
  ready: false,
  applyEvent: () => {},
  refresh: async () => {}
};

export const useQuestStore = create<QuestProjection>((set) => ({
  ...initialState,

  applyEvent: (event: QuestEvent) => {
    // Spec events open the Document Review Pane (approval gate) — the document
    // is validated upstream; we only render it if it looks like one.
    if (event.kind === 'spec' && event.document) {
      const doc = event.document as AgentDocument;
      if (doc && typeof doc === 'object' && doc.id && Array.isArray(doc.sections)) {
        useDocumentReviewStore.getState().openDocument(doc);
      }
    }

    set((state) => {
      const next: Pick<QuestProjection, 'quests' | 'logs'> = { quests: state.quests, logs: state.logs };
      if (event.quest) {
        const idx = next.quests.findIndex((q) => q.id === event.quest!.id);
        if (idx >= 0) {
          const copy = next.quests.slice();
          copy[idx] = event.quest;
          next.quests = copy;
        } else {
          next.quests = [event.quest, ...next.quests];
        }
      }
      if (event.kind === 'log' && event.line) {
        const existing = next.logs[event.questId] || [];
        const updated = [...existing, event.line];
        if (updated.length > QUEST_LOG_LIMIT) updated.splice(0, updated.length - QUEST_LOG_LIMIT);
        next.logs = { ...next.logs, [event.questId]: updated };
      }
      return next;
    });
  },

  refresh: async (workspaceRoot: string) => {
    try {
      const res = (await questApi().list(workspaceRoot)) as IpcResponse<QuestMeta[]>;
      if (res.success) set({ quests: res.data ?? [] });
    } catch {
      // Keep the last projection; refresh is opportunistic.
    }
  }
}));

/**
 * Subscribe to the quest lifecycle for a workspace. Applies the initial
 * snapshot, then folds every pushed event into the projection. Returns a
 * disposer so callers (a single useEffect) never leak listeners.
 */
export function initQuestSubscription(workspaceRoot: string): () => void {
  if (typeof window === 'undefined' || !window.electronAPI?.quest) {
    return () => {};
  }
  let disposed = false;
  const off = questApi().onEvent((event: QuestEvent) => {
    if (disposed) return;
    useQuestStore.getState().applyEvent(event);
    // In-app completion notification: fires even when the Quests tab is closed,
    // mirroring the native notification the service sends from main.
    if (event.kind === 'done' && event.quest) {
      notifyQuestDone(event.quest);
    }
  });

  void (async () => {
    try {
      const res = (await questApi().subscribe(workspaceRoot)) as IpcResponse<QuestStateSnapshot>;
      if (disposed || !res.success || !res.data) return;
      const snap = res.data;
      setQuestSnapshot(snap, workspaceRoot);
    } catch {
      /* subscribe failure leaves the (empty) projection honest */
    }
  })();

  return () => {
    disposed = true;
    if (typeof off === 'function') off();
  };
}

function setQuestSnapshot(snap: QuestStateSnapshot, workspaceRoot: string): void {
  useQuestStore.setState({
    quests: snap.quests,
    logs: snap.logs,
    subscribedRoot: workspaceRoot,
    ready: true
  });
}

function notifyQuestDone(quest: QuestMeta): void {
  switch (quest.status) {
    case 'reviewing':
      toast.success('Quest ready for review', `"${quest.title}" changed ${quest.changedFiles.length} file(s) — open Merge Review.`);
      break;
    case 'merged':
      toast.success('Quest merged', `"${quest.title}" is now in your workspace.`);
      break;
    case 'cancelled':
      toast.info('Quest cancelled', `"${quest.title}" was cancelled. Main workspace untouched.`);
      break;
    case 'failed':
      toast.error('Quest failed', quest.error || `"${quest.title}" could not complete.`);
      break;
    default:
      break;
  }
}

/** Convenience selector helpers for panels. */
export function sortQuests(quests: QuestMeta[]): QuestMeta[] {
  const activeRank = (q: QuestMeta): number => {
    switch (q.status) {
      case 'running':
        return 0;
      case 'awaiting-approval':
      case 'drafting':
        return 1;
      case 'reviewing':
        return 2;
      case 'queued':
        return 3;
      default:
        return 4;
    }
  };
  return quests.slice().sort((a, b) => {
    const rank = activeRank(a) - activeRank(b);
    if (rank !== 0) return rank;
    return b.updatedAt - a.updatedAt;
  });
}
