/**
 * Phase 2 — Inline Assist widget + orchestrator.
 *
 * Anchors a small overlay near the current Monaco selection, collects an
 * objective, and reuses the existing chat path (locked route + Plan/Build
 * already enforced where the agent runs). Apply routing follows the plan:
 *  - <= 5 changed lines AND `reviewPolicy = 'auto-apply-safe'`: applies
 *    directly via `workspace-store.applyDiff(ProposedDiff)`.
 *  - Otherwise (>5 lines OR the strict `always-ask` policy): opens the Safe
 *    Edit Review Gate via `workspace-store.openDiffReview(ProposedDiff)` and
 *    defers to the same approve/reject controls the agent uses.
 *  - Plan mode: propose-only, no Accept button rendered.
 *
 * The strict rule that survives either way: **no silent disk write**. Every
 * accepted proposal becomes a `ProposedDiff` and travels the same surface the
 * agent already uses, so the Gate, the audit trail, and undo all see it.
 *
 * Persistence: each accepted turn is written into the active session's
 * encrypted `subConversations[]` via the `inlineAssist:saveThread` IPC
 * channel. Listeners and DOM nodes are disposed on Esc/Cancel/close.
 */

import { getActiveEditor } from '../services/editor-service';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useSessionStore } from '../state/session-store';
import { toast } from '../state/toast-store';
import type { ProposedDiff } from '../../../preload/types';
import type { InlineThread, InlineTurn } from '../../../shared/types/inline-assist-channels';

type WidgetHandle = { dispose: () => void };

let current: WidgetHandle | null = null;
const openResolvers = new Set<(open: boolean) => void>();

export function isInlineAssistOpen(): boolean {
  return current !== null;
}

export function subscribeInlineAssistOpen(cb: (open: boolean) => void): () => void {
  openResolvers.add(cb);
  return () => openResolvers.delete(cb);
}

function announceOpen(open: boolean): void {
  for (const r of openResolvers) {
    try { r(open); } catch { /* subscriber crash is not fatal */ }
  }
}

function makeId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function changedLineCount(original: string, proposal: string): number {
  const a = original.split(/\r?\n/);
  const b = proposal.split(/\r?\n/);
  const max = Math.max(a.length, b.length);
  let changes = 0;
  for (let i = 0; i < max; i++) if (a[i] !== b[i]) changes++;
  return changes;
}

async function persistThread(thread: InlineThread): Promise<void> {
  const bridge = (window as unknown as {
    electronAPI?: { inlineAssist?: { saveThread?: (ws: string, t: InlineThread) => Promise<unknown> } };
  }).electronAPI?.inlineAssist;
  const ws = useWorkspaceStore.getState().workspacePath;
  if (bridge?.saveThread && ws && thread.sessionId) {
    try { await bridge.saveThread(ws, thread); } catch { /* best-effort */ }
  }
}

/**
 * Build the ProposedDiff for an inline accept and hand it to the store. The
 * strict routing rule: >5 changed lines OR `always-ask` policy → Gate; a
 * small change with `auto-apply-safe` may bypass the Gate (same rule the
 * agent's `replace_file_content`/`edit_file` branch follows at
 * `agent-engine.ts:1440`).
 */
export async function routeInlineApplyTo(
  filePath: string,
  fileAbsolute: string,
  originalFileContent: string,
  selectionText: string,
  selectionStartLine: number,
  proposal: string
): Promise<{ wentTo: 'gate' | 'apply'; linesChanged: number }> {
  const linesChanged = changedLineCount(selectionText, proposal);
  // Compose the whole-file replacement: swap the selected range for the
  // proposal. The original file content is authoritative; we replace only the
  // first matching occurrence of `selectionText` starting from the anchor.
  const proposedContent = spliceSelectionIntoFile(
    originalFileContent,
    selectionText,
    selectionStartLine,
    proposal
  );
  const diff: ProposedDiff = {
    id: `inline_${makeId()}`,
    filePath,
    originalContent: originalFileContent,
    proposedContent,
    description: `Inline Assist — ${linesChanged} line${linesChanged === 1 ? '' : 's'} changed`,
    status: 'pending'
  };
  const reviewPolicy = (await readReviewPolicy()) ?? 'always-ask';
  const store = useWorkspaceStore.getState();
  const allowDirectApply = linesChanged <= 5 && reviewPolicy === 'auto-apply-safe';
  if (allowDirectApply && typeof store.applyDiff === 'function') {
    await store.applyDiff(diff);
    return { wentTo: 'apply', linesChanged };
  }
  store.openDiffReview(diff);
  return { wentTo: 'gate', linesChanged };
}

/**
 * Replace `selectionText` inside `originalFileContent` starting at
 * `selectionStartLine`. If the selection spans multiple lines the whole
 * span is replaced. Falls back to a first-occurrence search when the line
 * offsets have drifted (a mid-session edit landed between opening the
 * widget and accepting).
 */
function spliceSelectionIntoFile(
  originalFileContent: string,
  selectionText: string,
  selectionStartLine: number,
  proposal: string
): string {
  const lines = originalFileContent.split(/\r?\n/);
  const selLines = selectionText.split(/\r?\n/);
  const startIdx = Math.max(0, selectionStartLine - 1);
  if (startIdx + selLines.length <= lines.length) {
    let matches = true;
    for (let i = 0; i < selLines.length; i++) {
      if (lines[startIdx + i] !== selLines[i]) { matches = false; break; }
    }
    if (matches) {
      const proposedLines = proposal.split(/\r?\n/);
      const next = [...lines.slice(0, startIdx), ...proposedLines, ...lines.slice(startIdx + selLines.length)];
      return next.join('\n');
    }
  }
  const idx = originalFileContent.indexOf(selectionText);
  if (idx < 0) return originalFileContent;
  return (
    originalFileContent.slice(0, idx) +
    proposal +
    originalFileContent.slice(idx + selectionText.length)
  );
}

async function readReviewPolicy(): Promise<string | null> {
  try {
    const api = (window as unknown as {
      electronAPI?: { getSettings?: () => Promise<{ success?: boolean; data?: Record<string, unknown> }> };
    }).electronAPI;
    if (!api?.getSettings) return null;
    const res = await api.getSettings();
    const rp = res?.data?.['editor.reviewPolicy'] ?? res?.data?.reviewPolicy;
    if (typeof rp === 'string') return rp;
    if (rp && typeof rp === 'object') {
      const nested = (rp as Record<string, unknown>).reviewPolicy;
      if (typeof nested === 'string') return nested;
    }
    return null;
  } catch {
    return null;
  }
}

function openWidget(
  anchorFilePath: string,
  fileAbsolute: string,
  originalFileContent: string,
  range: { startLine: number; startColumn: number; endLine: number; endColumn: number },
  selectionText: string,
  agentMode: string | null,
  lockedRouteId: string | null,
  sessionId: string | null,
  workspacePath: string,
  onSubmit: (objective: string) => Promise<string | null>,
  onAccept: (proposal: string) => Promise<void>
): WidgetHandle {
  const el = document.createElement('div');
  el.className = 'inline-assist-widget';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Inline Assist');
  el.innerHTML = `
    <div class="inline-assist-header">
      <span class="inline-assist-file"></span>
      <span class="inline-assist-range"></span>
      ${agentMode === 'plan' ? '<span class="inline-assist-badge is-plan">Plan (propose-only)</span>' : ''}
    </div>
    <textarea class="inline-assist-input" placeholder="Describe the change you want…" rows="3"></textarea>
    <pre class="inline-assist-output" aria-live="polite"></pre>
    <div class="inline-assist-actions">
      <button type="button" class="inline-assist-btn is-primary" data-act="run">Run</button>
      ${agentMode !== 'plan' ? '<button type="button" class="inline-assist-btn" data-act="accept" disabled>Accept</button>' : ''}
      <button type="button" class="inline-assist-btn" data-act="cancel">Close (Esc)</button>
    </div>
  `;
  const fileEl = el.querySelector('.inline-assist-file') as HTMLElement;
  const rangeEl = el.querySelector('.inline-assist-range') as HTMLElement;
  fileEl.textContent = anchorFilePath.split(/[\\/]/).pop() ?? anchorFilePath;
  rangeEl.textContent = `L${range.startLine}:${range.startColumn}–L${range.endLine}:${range.endColumn}`;

  const editorRoot = document.querySelector('.monaco-editor-host') ?? document.querySelector('.monaco-editor');
  const rect = editorRoot?.getBoundingClientRect();
  el.style.position = 'fixed';
  el.style.top = `${(rect?.top ?? 100) + 60}px`;
  el.style.left = `${(rect?.left ?? 100) + 40}px`;
  el.style.width = '420px';
  el.style.zIndex = '10000';
  document.body.appendChild(el);

  const textarea = el.querySelector<HTMLTextAreaElement>('.inline-assist-input')!;
  const output = el.querySelector<HTMLPreElement>('.inline-assist-output')!;
  const runBtn = el.querySelector<HTMLButtonElement>('[data-act="run"]')!;
  const acceptBtn = el.querySelector<HTMLButtonElement>('[data-act="accept"]') ?? null;
  const cancelBtn = el.querySelector<HTMLButtonElement>('[data-act="cancel"]')!;

  const thread: InlineThread = {
    threadId: `thr_${makeId()}`,
    sessionId: sessionId ?? '',
    anchor: { filePath: anchorFilePath, ...range },
    lockedRouteId,
    agentMode: (agentMode as InlineThread['agentMode']) ?? null,
    turns: [],
    createdAt: Date.now(),
    updatedAt: Date.now()
  };
  void workspacePath;

  const handleEsc = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.stopPropagation(); dispose(); }
  };
  document.addEventListener('keydown', handleEsc, true);

  const dispose = () => {
    document.removeEventListener('keydown', handleEsc, true);
    if (el.parentNode) el.parentNode.removeChild(el);
    current = null;
    announceOpen(false);
  };

  runBtn.addEventListener('click', async () => {
    const objective = textarea.value.trim();
    if (!objective) { toast.error('Inline Assist needs an objective.'); return; }
    runBtn.disabled = true;
    if (acceptBtn) acceptBtn.disabled = true;
    output.textContent = '…thinking';
    try {
      const proposal = await onSubmit(objective);
      output.textContent = proposal ?? '(no proposal returned)';
      if (proposal && agentMode !== 'plan' && acceptBtn) acceptBtn.disabled = false;
      if (proposal) {
        const turn: InlineTurn = {
          id: `t_${makeId()}`,
          objective,
          proposal,
          createdAt: Date.now()
        };
        thread.turns.push(turn);
        thread.updatedAt = Date.now();
        void persistThread(thread);
      }
    } finally {
      runBtn.disabled = false;
    }
  });
  if (acceptBtn) {
    acceptBtn.addEventListener('click', () => {
      const last = thread.turns[thread.turns.length - 1];
      const proposal = last?.proposal;
      if (!proposal) return;
      void (async () => {
        if (last) last.accepted = true;
        thread.updatedAt = Date.now();
        void persistThread(thread);
        await onAccept(proposal);
        dispose();
      })();
    });
  }
  cancelBtn.addEventListener('click', () => dispose());
  textarea.focus();

  current = { dispose };
  announceOpen(true);
  return current;
}

/** Command handler: `edit.inline-assist`. */
export async function handleInlineAssist(): Promise<{ ran: boolean; reason?: string }> {
  const editor = getActiveEditor();
  if (!editor) return { ran: false, reason: 'no-editor' };
  const selection = editor.getSelection();
  if (!selection) return { ran: false, reason: 'no-selection' };
  const isEmpty =
    typeof selection.isEmpty === 'function'
      ? selection.isEmpty()
      : selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn;
  if (isEmpty) return { ran: false, reason: 'empty-selection' };

  const model = editor.getModel?.();
  if (!model) return { ran: false, reason: 'no-model' };
  const selectionText = model.getValueInRange(selection);
  if (!selectionText) return { ran: false, reason: 'no-selection-text' };
  // Whole-file content comes from the model's full range (EditorModelLike has
  // no getValue); we read line 1..last so the spliced diff is against real disk
  // text rather than just the selection.
  const lastLine = model.getLineCount();
  const fileContent = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: lastLine,
    endColumn: model.getLineMaxColumn(lastLine)
  });

  const wsState = useWorkspaceStore.getState();
  const workspacePath = wsState.workspacePath;
  const filePath = wsState.activeTabPath ?? '';
  if (!workspacePath || !filePath) return { ran: false, reason: 'no-workspace' };

  const chatState = useChatStore.getState();
  const agentMode = chatState.agentMode ?? null;
  const sessionId = useSessionStore.getState().activeSessionId;
  const lockedRouteId: string | null = null;

  openWidget(
    filePath,
    filePath,
    fileContent,
    {
      startLine: selection.startLineNumber,
      startColumn: selection.startColumn,
      endLine: selection.endLineNumber,
      endColumn: selection.endColumn
    },
    selectionText,
    agentMode,
    lockedRouteId,
    sessionId,
    workspacePath,
    async (objective) => {
      const prompt =
        `[Inline Assist]\nFile: ${filePath}\nRange: L${selection.startLineNumber}:L${selection.endLineNumber}\n\n` +
        `Original selection:\n\`\`\`\n${selectionText}\n\`\`\`\n\n` +
        `Objective: ${objective}\n\nReply with ONLY the replacement text (no explanation, no fences).`;
      const before = useChatStore.getState().messages.length;
      // Route through the real chat/agent path so Plan/Build, route locking,
      // and provider health handoff behave identically to the assistant feed.
      await useChatStore.getState().sendMessage(prompt, workspacePath, filePath, fileContent);
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const st = useChatStore.getState();
        if (!st.isRunning && st.messages.length > before) break;
      }
      const st = useChatStore.getState();
      const lastAssistant = [...st.messages].reverse().find((m) => m.role === 'assistant');
      return lastAssistant?.content ?? null;
    },
    async (proposal) => {
      const outcome = await routeInlineApplyTo(
        filePath,
        filePath,
        fileContent,
        selectionText,
        selection.startLineNumber,
        proposal
      );
      if (outcome.wentTo === 'gate') {
        toast.info(
          `Inline Assist: ${outcome.linesChanged}-line change opened in the Safe Edit Review Gate. Approve there to write to disk.`
        );
      } else {
        toast.success(`Inline Assist: auto-applied ${outcome.linesChanged}-line change.`);
      }
    }
  );

  return { ran: true };
}

/** Test seam: forcibly close the widget. */
export function disposeInlineAssistWidget(): void {
  current?.dispose();
  current = null;
  announceOpen(false);
}
