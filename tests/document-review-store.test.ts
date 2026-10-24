import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useDocumentReviewStore } from '../src/renderer/src/state/document-review-store';
import type { AgentDocument } from '../src/preload/types';

describe('DocumentReviewStore', () => {
  const sampleDoc: AgentDocument = {
    id: 'doc-test-123',
    kind: 'plan',
    title: 'Architectural Overhaul Plan',
    markdown: '# Overview\n\nInitial draft of plan.\n\n## Tasks\n\n1. Do task A.',
    sections: [
      { id: 'overview-0', heading: 'Overview', level: 1, markdown: '# Overview\n\nInitial draft of plan.' },
      { id: 'tasks-1', heading: 'Tasks', level: 2, markdown: '## Tasks\n\n1. Do task A.' }
    ],
    createdAt: 1700000000000
  };

  beforeEach(() => {
    useDocumentReviewStore.getState().clearDocument();
  });

  it('initializes with default empty state', () => {
    const state = useDocumentReviewStore.getState();
    expect(state.activeDocument).toBeNull();
    expect(state.mode).toBe('preview');
    expect(state.status).toBe('pending');
    expect(state.comments).toEqual({});
    expect(state.isDocumentTabOpen).toBe(false);
    expect(state.isDocTabActive).toBe(false);
    expect(state.updatedSectionIds).toEqual([]);
  });

  it('opens a proposed document and sets tab to open and active', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);
    const state = useDocumentReviewStore.getState();

    expect(state.activeDocument).toEqual(sampleDoc);
    expect(state.mode).toBe('preview');
    expect(state.status).toBe('pending');
    expect(state.isDocumentTabOpen).toBe(true);
    expect(state.isDocTabActive).toBe(true);
  });

  it('switches between preview and edit modes', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);
    expect(useDocumentReviewStore.getState().mode).toBe('preview');

    useDocumentReviewStore.getState().setMode('edit');
    expect(useDocumentReviewStore.getState().mode).toBe('edit');

    useDocumentReviewStore.getState().setMode('preview');
    expect(useDocumentReviewStore.getState().mode).toBe('preview');
  });

  it('adds section feedback comments and stores them by section ID', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);

    useDocumentReviewStore.getState().addComment('overview-0', 'Looks great, but add a migration note.');
    useDocumentReviewStore.getState().addComment('overview-0', 'Also verify backward compatibility.');
    useDocumentReviewStore.getState().addComment('tasks-1', 'Clarify order of task A.');

    const comments = useDocumentReviewStore.getState().comments;
    expect(comments['overview-0']).toHaveLength(2);
    expect(comments['overview-0'][0]).toBe('Looks great, but add a migration note.');
    expect(comments['overview-0'][1]).toBe('Also verify backward compatibility.');
    expect(comments['tasks-1']).toHaveLength(1);
    expect(comments['tasks-1'][0]).toBe('Clarify order of task A.');
  });

  it('diffs old vs new markdown and badges changed sections with updatedSectionIds', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);
    useDocumentReviewStore.getState().addComment('overview-0', 'Needs more details.');

    // Agent revises the document: overview is updated, tasks is unchanged, notes is added
    const revisedDoc: AgentDocument = {
      id: 'doc-test-123',
      kind: 'plan',
      title: 'Architectural Overhaul Plan (v2)',
      markdown: '# Overview\n\nRevised draft with extra migration steps.\n\n## Tasks\n\n1. Do task A.\n\n## Notes\n\nImportant security considerations.',
      sections: [
        { id: 'overview-0', heading: 'Overview', level: 1, markdown: '# Overview\n\nRevised draft with extra migration steps.' },
        { id: 'tasks-1', heading: 'Tasks', level: 2, markdown: '## Tasks\n\n1. Do task A.' },
        { id: 'notes-2', heading: 'Notes', level: 2, markdown: '## Notes\n\nImportant security considerations.' }
      ],
      createdAt: 1700000005000
    };

    useDocumentReviewStore.getState().openDocument(revisedDoc);
    const state = useDocumentReviewStore.getState();

    // Changed sections: overview-0 (content changed) and notes-2 (new section)
    expect(state.updatedSectionIds).toContain('overview-0');
    expect(state.updatedSectionIds).toContain('notes-2');
    expect(state.updatedSectionIds).not.toContain('tasks-1');

    // Section comment for overview-0 is preserved
    expect(state.comments['overview-0']).toEqual(['Needs more details.']);
  });

  it('updates document review status', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);
    expect(useDocumentReviewStore.getState().status).toBe('pending');

    useDocumentReviewStore.getState().setStatus('approved');
    expect(useDocumentReviewStore.getState().status).toBe('approved');

    useDocumentReviewStore.getState().setStatus('revision-requested');
    expect(useDocumentReviewStore.getState().status).toBe('revision-requested');
  });

  it('updates document markdown content while preserving other attributes', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);

    const updatedMarkdown = '# Overview\n\nUpdated draft.\n\n## Tasks\n\n1. Updated task.';
    useDocumentReviewStore.getState().updateDocumentMarkdown(updatedMarkdown);

    const activeDoc = useDocumentReviewStore.getState().activeDocument;
    expect(activeDoc).not.toBeNull();
    expect(activeDoc?.markdown).toBe(updatedMarkdown);
    expect(activeDoc?.title).toBe(sampleDoc.title);
    expect(activeDoc?.kind).toBe(sampleDoc.kind);
  });

  it('clears active document and closes review tab on clearDocument', () => {
    useDocumentReviewStore.getState().openDocument(sampleDoc);
    expect(useDocumentReviewStore.getState().activeDocument).not.toBeNull();

    useDocumentReviewStore.getState().clearDocument();
    const state = useDocumentReviewStore.getState();

    expect(state.activeDocument).toBeNull();
    expect(state.isDocumentTabOpen).toBe(false);
    expect(state.isDocTabActive).toBe(false);
    expect(state.status).toBe('pending');
    expect(state.updatedSectionIds).toEqual([]);
  });

  it('restores last document from storage if available', async () => {
    const mockGetLast = vi.fn().mockResolvedValue({
      success: true,
      data: sampleDoc
    });
    (globalThis as any).electronAPI = { getLastDocument: mockGetLast };

    const restored = await useDocumentReviewStore.getState().restoreLastDocument();
    expect(restored).toEqual(sampleDoc);
    expect(useDocumentReviewStore.getState().activeDocument).toEqual(sampleDoc);
    expect(useDocumentReviewStore.getState().isDocumentTabOpen).toBe(true);
  });
});
