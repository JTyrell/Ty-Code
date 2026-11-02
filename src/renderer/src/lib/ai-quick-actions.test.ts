/**
 * Prompt E (Step 1) — quick actions carry selection context correctly.
 *
 * The verification criterion is explicit: EVERY quick action must route with
 * the right file, range, and selected text. These tests pin the pure prompt
 * builder, the selection snapshot against a duck-typed Monaco model, and the
 * two routing shapes (send-to-Assistant vs @selection attachment).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  getActiveEditor: vi.fn(),
  toast: {
    warning: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    error: vi.fn()
  },
  chat: {
    isRunning: false,
    setAgentMode: vi.fn(),
    queueMessage: vi.fn(),
    sendMessage: vi.fn(async () => undefined)
  } as Record<string, any>,
  chatInput: { addAttachment: vi.fn() } as Record<string, any>,
  workspace: {
    workspacePath: 'C:/repo/proj',
    activeTabPath: 'C:/repo/proj/src/math.ts'
  } as Record<string, any>
}));

vi.mock('../services/editor-service', () => ({
  getActiveEditor: () => mocks.getActiveEditor()
}));
vi.mock('../state/toast-store', () => ({ toast: mocks.toast }));
vi.mock('../state/chat-store', () => ({
  useChatStore: { getState: () => mocks.chat }
}));
vi.mock('../state/chat-input-store', () => ({
  useChatInputStore: { getState: () => mocks.chatInput }
}));
vi.mock('../state/workspace-store', () => ({
  useWorkspaceStore: { getState: () => mocks.workspace }
}));

import {
  buildQuickActionPrompt,
  readSelectionContext,
  runQuickAction,
  QUICK_ACTION_ENTRY_IDS,
  type SelectionContext
} from './ai-quick-actions';

const ctx: SelectionContext = {
  filePath: 'src/math.ts',
  fileName: 'math.ts',
  startLine: 10,
  endLine: 14,
  selectionText: 'function add(a: number, b: number) { return a + b; }',
  fileContent: 'export function add(a: number, b: number) { return a + b; }\n'
};

function makeEditor(options: {
  startLineNumber: number;
  endLineNumber: number;
  startColumn?: number;
  endColumn?: number;
  selectionText: string;
  lines: string[];
}) {
  const selection = {
    startLineNumber: options.startLineNumber,
    endLineNumber: options.endLineNumber,
    startColumn: options.startColumn ?? 1,
    endColumn: options.endColumn ?? 100
  };
  const model = {
    uri: { fsPath: 'C:/repo/proj/src/math.ts' },
    getValueInRange: (range: typeof selection) =>
      range.startLineNumber === 1
        ? options.lines.join('\n')
        : options.selectionText,
    getLineCount: () => options.lines.length,
    getLineMaxColumn: (line: number) => (options.lines[line - 1]?.length ?? 0) + 1
  };
  return {
    getSelection: () => selection,
    getModel: () => model
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.chat.isRunning = false;
  mocks.workspace.workspacePath = 'C:/repo/proj';
  mocks.workspace.activeTabPath = 'C:/repo/proj/src/math.ts';
  vi.stubGlobal('window', {
    dispatchEvent: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  });
});

describe('buildQuickActionPrompt — selection context', () => {
  const kinds = ['explain', 'fix', 'refactor', 'tests'] as const;
  for (const kind of kinds) {
    it(`${kind}: embeds file path, exact range, and fenced selection`, () => {
      const prompt = buildQuickActionPrompt(kind, ctx);
      expect(prompt).toContain(`File: ${ctx.filePath}`);
      expect(prompt).toContain(`L${ctx.startLine}\u2013L${ctx.endLine}`);
      expect(prompt).toContain('```typescript');
      expect(prompt).toContain(ctx.selectionText);
      expect(prompt).toContain('[Quick Action:');
    });
  }

  it('explain is explicitly read-only intent', () => {
    expect(buildQuickActionPrompt('explain', ctx)).toContain('Do not modify any files');
  });

  it('change-seeking actions route through the review gate wording', () => {
    for (const kind of ['fix', 'refactor'] as const) {
      expect(buildQuickActionPrompt(kind, ctx)).toContain('reviewed before it hits disk');
    }
  });

  it('bounds oversized selections instead of flooding the prompt', () => {
    const huge: SelectionContext = { ...ctx, selectionText: 'x'.repeat(25_000) };
    const prompt = buildQuickActionPrompt('explain', huge);
    expect(prompt).toContain('[selection truncated at 20000 chars]');
  });
});

describe('readSelectionContext — honest snapshots', () => {
  it('maps a live Monaco selection to a relative file path and full content', () => {
    mocks.getActiveEditor.mockReturnValue(
      makeEditor({
        startLineNumber: 10,
        endLineNumber: 14,
        selectionText: ctx.selectionText,
        lines: ['one', 'two', 'three']
      })
    );
    const snap = readSelectionContext();
    expect(snap).not.toBeNull();
    expect(snap!.filePath).toBe('src/math.ts');
    expect(snap!.fileName).toBe('math.ts');
    expect(snap!.startLine).toBe(10);
    expect(snap!.endLine).toBe(14);
    expect(snap!.selectionText).toBe(ctx.selectionText);
    expect(snap!.fileContent).toBe('one\ntwo\nthree');
  });

  it('returns null for an empty (caret-only) selection', () => {
    mocks.getActiveEditor.mockReturnValue(
      makeEditor({ startLineNumber: 3, endLineNumber: 3, startColumn: 5, endColumn: 5, selectionText: '', lines: ['a'] })
    );
    expect(readSelectionContext()).toBeNull();
  });

  it('returns null with no editor at all', () => {
    mocks.getActiveEditor.mockReturnValue(null);
    expect(readSelectionContext()).toBeNull();
  });
});

describe('runQuickAction — routing', () => {
  beforeEach(() => {
    mocks.getActiveEditor.mockReturnValue(
      makeEditor({
        startLineNumber: 10,
        endLineNumber: 14,
        selectionText: ctx.selectionText,
        lines: ['export function add(a: number, b: number) { return a + b; }']
      })
    );
  });

  it('addToChat attaches @selection without sending anything', async () => {
    const result = await runQuickAction('addToChat');
    expect(result.ran).toBe(true);
    expect(mocks.chatInput.addAttachment).toHaveBeenCalledTimes(1);
    const attachment = mocks.chatInput.addAttachment.mock.calls[0][0];
    expect(attachment.type).toBe('mention');
    expect(attachment.name).toBe('selection');
    expect(attachment.content).toContain('src/math.ts (L10\u2013L14)');
    expect(attachment.content).toContain(ctx.selectionText);
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
  });

  it('explain routes to the Assistant in Plan mode with the selection embedded', async () => {
    const result = await runQuickAction('explain');
    expect(result.ran).toBe(true);
    expect(mocks.chat.setAgentMode).toHaveBeenCalledWith('plan');
    expect(mocks.chat.sendMessage).toHaveBeenCalledTimes(1);
    const [prompt, workspacePath, absolutePath] = mocks.chat.sendMessage.mock.calls[0];
    expect(prompt).toContain(ctx.selectionText);
    expect(prompt).toContain('File: src/math.ts');
    expect(workspacePath).toBe('C:/repo/proj');
    expect(absolutePath).toBe('C:/repo/proj/src/math.ts');
  });

  it('fix routes in Build mode, and queues behind a running task', async () => {
    mocks.chat.isRunning = true;
    const result = await runQuickAction('fix');
    expect(result.ran).toBe(true);
    expect(mocks.chat.setAgentMode).toHaveBeenCalledWith('build');
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    expect(mocks.chat.queueMessage).toHaveBeenCalledTimes(1);
    expect(mocks.chat.queueMessage.mock.calls[0][0]).toContain(ctx.selectionText);

    mocks.chat.isRunning = false;
    await runQuickAction('fix');
    expect(mocks.chat.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('without a selection, warns and runs nothing', async () => {
    mocks.getActiveEditor.mockReturnValue(null);
    const result = await runQuickAction('refactor');
    expect(result.ran).toBe(false);
    expect(mocks.toast.warning).toHaveBeenCalled();
    expect(mocks.chat.sendMessage).not.toHaveBeenCalled();
    expect(mocks.chatInput.addAttachment).not.toHaveBeenCalled();
  });

  it('every kind maps to a selection.* registry entry id (registry-backed only)', () => {
    for (const entryId of Object.values(QUICK_ACTION_ENTRY_IDS)) {
      expect(entryId).toMatch(/^selection\.ai-/);
    }
  });
});
