/**
 * Prompt E (Step 1) — Editor Quick Actions.
 *
 * Every action here is registry-backed: the Monaco context-menu entries and
 * the selection hover toolbar dispatch the shared registry ids through
 * `executeCommandEntry`, and this module provides the handlers the registry
 * names (`ai.explain`, `ai.fix`, `ai.refactor`, `ai.generateTests`,
 * `ai.addToChat`). Inline Assist is NOT reimplemented — its own registry row
 * (`edit.inline-assist`, Ctrl+I) already owns the inline thread.
 *
 * Routing contract (the verification criterion for "carries selection
 * context correctly"):
 *  - Explain / Fix / Refactor / Generate Tests build a prompt that always
 *    embeds the file path, the exact line range, and the fenced selection,
 *    then send it to the Assistant via the same `chat-store.sendMessage` path
 *    the sidecar uses. Explain is read-only intent (Plan mode); the other
 *    three ask for changes (Build mode), where the Safe Edit Review Gate
 *    still mediates every write.
 *  - Add to Chat does not send anything: the selection lands in the composer
 *    as an `@selection` attachment, exactly what the mention pipeline
 *    produces from ChatInput.
 */

import { getActiveEditor } from '../services/editor-service';
import { useWorkspaceStore } from '../state/workspace-store';
import { useChatStore } from '../state/chat-store';
import { useChatInputStore } from '../state/chat-input-store';
import { toast } from '../state/toast-store';

export type QuickActionKind = 'explain' | 'fix' | 'refactor' | 'tests' | 'addToChat';

export interface SelectionContext {
  filePath: string;
  fileName: string;
  startLine: number;
  endLine: number;
  selectionText: string;
  /** Whole current file content, read from the model (never from disk). */
  fileContent: string;
}

/** Registry id per action kind — the only ids this module is allowed to run. */
export const QUICK_ACTION_ENTRY_IDS: Record<QuickActionKind, string> = {
  explain: 'selection.ai-explain',
  fix: 'selection.ai-fix',
  refactor: 'selection.ai-refactor',
  tests: 'selection.ai-generate-tests',
  addToChat: 'selection.ai-add-to-chat'
};

const ACTION_TITLES: Record<Exclude<QuickActionKind, 'addToChat'>, string> = {
  explain: 'Explain',
  fix: 'Fix',
  refactor: 'Refactor',
  tests: 'Generate Tests'
};

const ACTION_INSTRUCTIONS: Record<Exclude<QuickActionKind, 'addToChat'>, string> = {
  explain:
    'Explain what the selected code does: its role in this file, what it depends on, and anything surprising or risky about it. Do not modify any files.',
  fix:
    'Diagnose the bug or weakness in the selected code and fix it with the smallest correct change. Preserve unrelated behaviour, and go through the normal edit flow so the change is reviewed before it hits disk.',
  refactor:
    'Refactor the selected code for clarity while preserving its behaviour and public interface. List each transformation you made and why. Go through the normal edit flow so the change is reviewed before it hits disk.',
  tests:
    'Generate tests for the selected code covering the happy path, edge cases, and error handling. Match the project\u2019s existing test framework and conventions; put the tests in the conventional location for this repository.'
};

/** Same discipline as ChatInput's attachment cap: bound the prompt, say so. */
function capSelection(text: string, limit = 20_000): string {
  return text.length > limit
    ? `${text.slice(0, limit)}\n\u2026 [selection truncated at ${limit} chars]`
    : text;
}

/**
 * Pure prompt builder — unit-tested so "every quick action carries selection
 * context" is proven without a live Monaco instance.
 */
export function buildQuickActionPrompt(
  kind: Exclude<QuickActionKind, 'addToChat'>,
  ctx: SelectionContext
): string {
  const language = detectFenceLanguage(ctx.fileName);
  return [
    `[Quick Action: ${ACTION_TITLES[kind]}]`,
    `File: ${ctx.filePath} (selection L${ctx.startLine}\u2013L${ctx.endLine})`,
    `Selected code:\n\`\`\`${language}\n${capSelection(ctx.selectionText)}\n\`\`\``,
    ACTION_INSTRUCTIONS[kind]
  ].join('\n\n');
}

function detectFenceLanguage(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  const known: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
    py: 'python', go: 'go', rs: 'rust', java: 'java', cs: 'csharp',
    cpp: 'cpp', c: 'c', md: 'markdown', json: 'json', yml: 'yaml', yaml: 'yaml'
  };
  return known[ext] ?? ext;
}

/**
 * Snapshot the active editor selection. Returns null (rather than throwing)
 * whenever a quick action cannot be honest about its context — no editor,
 * empty selection, no model — because a partial context silently degrades
 * into a wrong answer.
 */
export function readSelectionContext(): SelectionContext | null {
  const editor = getActiveEditor();
  if (!editor) return null;
  const selection = editor.getSelection();
  if (!selection) return null;
  const isEmpty =
    typeof (selection as { isEmpty?: () => boolean }).isEmpty === 'function'
      ? (selection as { isEmpty: () => boolean }).isEmpty()
      : selection.startLineNumber === selection.endLineNumber && selection.startColumn === selection.endColumn;
  if (isEmpty) return null;
  const model = editor.getModel?.();
  if (!model) return null;
  const selectionText = model.getValueInRange(selection);
  if (!selectionText) return null;
  const lastLine = model.getLineCount();
  const fileContent = model.getValueInRange({
    startLineNumber: 1,
    startColumn: 1,
    endLineNumber: lastLine,
    endColumn: model.getLineMaxColumn(lastLine)
  });
  const workspacePath = useWorkspaceStore.getState().workspacePath;
  const activeTabPath = useWorkspaceStore.getState().activeTabPath;
  const rawPath =
    activeTabPath ||
    (typeof (model as { uri?: { fsPath?: string } }).uri?.fsPath === 'string'
      ? (model as { uri?: { fsPath?: string } }).uri?.fsPath ?? ''
      : '');
  if (!rawPath) return null;
  return {
    filePath: workspacePath ? (rawPath.startsWith(workspacePath) ? rawPath.slice(workspacePath.length + 1) : rawPath) : rawPath,
    fileName: rawPath.split(/[\\/]/).pop() ?? rawPath,
    startLine: selection.startLineNumber,
    endLine: selection.endLineNumber,
    selectionText,
    fileContent
  };
}

/**
 * Ask App.tsx to reveal the Assistant panel. App owns the split width, so the
 * only honest way to open it is the same window event the menu bar uses to
 * toggle it — with an "ensure" variant that opens but never closes.
 */
export function ensureAssistantVisible(): void {
  window.dispatchEvent(new Event('workbench:ensure-assistant'));
}

/**
 * Run a quick action. Returns a registry-style result; `summary` becomes the
 * success toast the runtime reports, so a click is never silent.
 */
export async function runQuickAction(
  kind: QuickActionKind
): Promise<{ ran: boolean; reason?: string; summary?: string }> {
  const ctx = readSelectionContext();
  if (!ctx) {
    toast.warning('No selection', 'Select code in the editor first, then retry the quick action.');
    return { ran: false, reason: 'no-selection' };
  }

  if (kind === 'addToChat') {
    useChatInputStore.getState().addAttachment({
      id: '',
      type: 'mention',
      name: 'selection',
      content: `${ctx.filePath} (L${ctx.startLine}\u2013L${ctx.endLine})\n${capSelection(ctx.selectionText)}`
    });
    ensureAssistantVisible();
    return {
      ran: true,
      summary: `Selection (L${ctx.startLine}\u2013L${ctx.endLine}) attached to chat as @selection`
    };
  }

  const state = useChatStore.getState();
  const mode = kind === 'explain' ? 'plan' : 'build';
  state.setAgentMode(mode);
  ensureAssistantVisible();
  const prompt = buildQuickActionPrompt(kind, ctx);
  if (state.isRunning) {
    state.queueMessage(prompt);
    return { ran: true, summary: `${ACTION_TITLES[kind]} queued behind the running task (${mode.toUpperCase()} mode)` };
  }
  const workspacePath = useWorkspaceStore.getState().workspacePath ?? '';
  const absolutePath = useWorkspaceStore.getState().activeTabPath ?? ctx.filePath;
  void state.sendMessage(prompt, workspacePath, absolutePath, ctx.fileContent);
  return { ran: true, summary: `${ACTION_TITLES[kind]} sent to the Assistant (${mode.toUpperCase()} mode)` };
}
