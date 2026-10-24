import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import {
  parseMarkdownSections,
  slugify,
  persistDocument,
  loadDocument,
  getDocumentsStorageDir
} from '../src/main/services/document-parser';
import {
  zDocumentSection,
  zDocument,
  zDocumentProposed
} from '../src/shared/types/agent-events';
import {
  SUBMIT_PLAN_TOOL,
  SUBMIT_REPORT_TOOL
} from '../src/main/agent/tool-definitions';
import type { AgentDocument } from '../src/preload/types';

describe('Document Pipeline — Backend (Prompt 1)', () => {
  describe('slugify', () => {
    it('produces clean slugified strings', () => {
      expect(slugify('Execution Plan')).toBe('execution-plan');
      expect(slugify('Phase 1: Setup & Initialization!')).toBe('phase-1-setup-initialization');
      expect(slugify('   Leading and Trailing   ')).toBe('leading-and-trailing');
      expect(slugify('')).toBe('section');
    });
  });

  describe('parseMarkdownSections', () => {
    it('returns empty array for empty or whitespace-only markdown', () => {
      expect(parseMarkdownSections('')).toEqual([]);
      expect(parseMarkdownSections('   \n  \n  ')).toEqual([]);
    });

    it('splits markdown on ATX headings (#, ##, ###) and preserves verbatim heading + body', () => {
      const markdown = `# Title\n\nIntroductory paragraph.\n\n## Background\n\nSome background info.\n\n## Execution Plan\n\n- Step 1: Initialize\n- Step 2: Migrate\n- Step 3: Verify`;

      const sections = parseMarkdownSections(markdown);
      expect(sections.length).toBe(3);

      expect(sections[0]).toEqual({
        id: 'title-0',
        heading: 'Title',
        level: 1,
        markdown: '# Title\n\nIntroductory paragraph.'
      });

      expect(sections[1]).toEqual({
        id: 'background-1',
        heading: 'Background',
        level: 2,
        markdown: '## Background\n\nSome background info.'
      });

      expect(sections[2]).toEqual({
        id: 'execution-plan-2',
        heading: 'Execution Plan',
        level: 2,
        markdown: '## Execution Plan\n\n- Step 1: Initialize\n- Step 2: Migrate\n- Step 3: Verify'
      });
    });

    it('does not split on hash marks inside fenced code blocks', () => {
      const markdown = `# Analysis Report\n\nHere is python code:\n\n\`\`\`python\n# This is a python comment, not a heading\ndef calculate():\n    return 42\n\`\`\`\n\n## Next Steps\n\nAll done.`;

      const sections = parseMarkdownSections(markdown);
      expect(sections.length).toBe(2);

      expect(sections[0].id).toBe('analysis-report-0');
      expect(sections[0].heading).toBe('Analysis Report');
      expect(sections[0].markdown).toContain('# This is a python comment, not a heading');

      expect(sections[1].id).toBe('next-steps-1');
      expect(sections[1].heading).toBe('Next Steps');
      expect(sections[1].level).toBe(2);
    });

    it('handles documents with preamble before the first heading', () => {
      const markdown = `Preamble note before first heading.\n\n# Main Heading\n\nBody content.`;

      const sections = parseMarkdownSections(markdown);
      expect(sections.length).toBe(2);
      expect(sections[0].heading).toBe('Overview');
      expect(sections[0].id).toBe('overview-0');
      expect(sections[0].markdown).toBe('Preamble note before first heading.');
      expect(sections[1].heading).toBe('Main Heading');
      expect(sections[1].id).toBe('main-heading-1');
    });

    it('strips optional closing ATX hashes while retaining heading title', () => {
      const markdown = `## Summary ##\n\nSummary body.\n\n### Details ###\n\nDetailed breakdown.`;
      const sections = parseMarkdownSections(markdown);
      expect(sections.length).toBe(2);
      expect(sections[0].heading).toBe('Summary');
      expect(sections[0].id).toBe('summary-0');
      expect(sections[1].heading).toBe('Details');
      expect(sections[1].id).toBe('details-1');
    });
  });

  describe('Zod IPC Schema Validation', () => {
    it('validates a well-formed AgentDocumentSection with zDocumentSection', () => {
      const section = {
        id: 'execution-plan-2',
        heading: 'Execution Plan',
        level: 2,
        markdown: '## Execution Plan\n\nStep 1'
      };
      const result = zDocumentSection.safeParse(section);
      expect(result.success).toBe(true);
    });

    it('validates a complete AgentDocument with zDocument', () => {
      const doc: AgentDocument = {
        id: 'doc_123',
        kind: 'plan',
        title: 'Migration Plan',
        markdown: '# Migration Plan\n\n## Phase 1\nStep 1',
        sections: [
          { id: 'migration-plan-0', heading: 'Migration Plan', level: 1, markdown: '# Migration Plan' },
          { id: 'phase-1-1', heading: 'Phase 1', level: 2, markdown: '## Phase 1\nStep 1' }
        ],
        createdAt: 1700000000000
      };
      const result = zDocument.safeParse(doc);
      expect(result.success).toBe(true);
    });

    it('validates zDocumentProposed payload with taskId and document', () => {
      const payload = {
        taskId: 'task_abc_123',
        type: 'document_proposed' as const,
        document: {
          id: 'doc_456',
          kind: 'report' as const,
          title: 'Code Audit Report',
          markdown: '# Audit\n\nPassed.',
          sections: [
            { id: 'audit-0', heading: 'Audit', level: 1, markdown: '# Audit\n\nPassed.' }
          ],
          createdAt: Date.now()
        }
      };
      const result = zDocumentProposed.safeParse(payload);
      expect(result.success).toBe(true);
    });

    it('rejects invalid document kind', () => {
      const invalid = {
        taskId: 'task_1',
        document: {
          id: 'doc_1',
          kind: 'unsupported_kind',
          title: 'Title',
          markdown: '# Title',
          sections: [],
          createdAt: Date.now()
        }
      };
      const result = zDocumentProposed.safeParse(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('Persistence (~/.tycode/documents/{id}.md and {id}.json)', () => {
    const testDocId = `test_doc_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const storageDir = getDocumentsStorageDir();
    const mdFile = path.join(storageDir, `${testDocId}.md`);
    const jsonFile = path.join(storageDir, `${testDocId}.json`);

    afterEach(async () => {
      await fs.unlink(mdFile).catch(() => undefined);
      await fs.unlink(jsonFile).catch(() => undefined);
    });

    it('persists markdown and sidecar JSON and survives reload', async () => {
      const markdown = `# Architecture Report\n\nFindings.\n\n## Section 1\n\nDetails.`;
      const sections = parseMarkdownSections(markdown);
      const doc: AgentDocument = {
        id: testDocId,
        kind: 'report',
        title: 'Architecture Report',
        markdown,
        sections,
        createdAt: Date.now()
      };

      await persistDocument(doc);

      // Verify physical files exist on disk
      const mdContent = await fs.readFile(mdFile, 'utf-8');
      expect(mdContent).toBe(markdown);

      const jsonContent = await fs.readFile(jsonFile, 'utf-8');
      const sidecar = JSON.parse(jsonContent);
      expect(sidecar.id).toBe(testDocId);
      expect(sidecar.kind).toBe('report');
      expect(sidecar.title).toBe('Architecture Report');
      expect(sidecar.sections.length).toBe(2);

      // Verify loadDocument
      const loaded = await loadDocument(testDocId);
      expect(loaded).not.toBeNull();
      expect(loaded?.id).toBe(testDocId);
      expect(loaded?.kind).toBe('report');
      expect(loaded?.title).toBe('Architecture Report');
      expect(loaded?.markdown).toBe(markdown);
      expect(loaded?.sections.length).toBe(2);
    });
  });

  describe('Tool Definitions', () => {
    it('defines submit_plan with title and markdown properties', () => {
      expect(SUBMIT_PLAN_TOOL.function.name).toBe('submit_plan');
      expect(SUBMIT_PLAN_TOOL.function.parameters.required).toContain('title');
      expect(SUBMIT_PLAN_TOOL.function.parameters.required).toContain('markdown');
    });

    it('defines submit_report with title and markdown properties', () => {
      expect(SUBMIT_REPORT_TOOL.function.name).toBe('submit_report');
      expect(SUBMIT_REPORT_TOOL.function.parameters.required).toContain('title');
      expect(SUBMIT_REPORT_TOOL.function.parameters.required).toContain('markdown');
    });
  });
});
