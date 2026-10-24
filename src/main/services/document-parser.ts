import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import type { AgentDocument, AgentDocumentSection } from '../../preload/types';

export { AgentDocument, AgentDocumentSection };

/**
 * Converts a heading title into a clean, URL-safe slug.
 */
export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

/**
 * Parses markdown into structured document sections based on ATX headings (#, ##, ###).
 * Each section retains its heading line plus its body content verbatim (including nested code blocks and lists).
 * Stable IDs are assigned as: slugified heading + '-' + index (e.g., 'execution-plan-2').
 */
export function parseMarkdownSections(markdown: string): AgentDocumentSection[] {
  if (!markdown || !markdown.trim()) {
    return [];
  }

  const lines = markdown.split(/\r?\n/);
  const sections: AgentDocumentSection[] = [];

  let currentHeading = '';
  let currentLevel = 1;
  let currentLines: string[] = [];
  let inCodeBlock = false;
  let codeFenceChar = '';
  let hasHeading = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    // Track fenced code blocks (``` or ~~~) so nested code comments/hashes are not treated as ATX headings
    if (trimmed.startsWith('```') || trimmed.startsWith('~~~')) {
      const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        const fence = fenceMatch[1];
        if (!inCodeBlock) {
          inCodeBlock = true;
          codeFenceChar = fence[0];
        } else if (fence[0] === codeFenceChar) {
          inCodeBlock = false;
          codeFenceChar = '';
        }
      }
    }

    // ATX headings: 1 to 6 hash marks followed by whitespace, outside code blocks
    const headingMatch = !inCodeBlock ? line.match(/^(#{1,6})\s+(.*)$/) : null;

    if (headingMatch) {
      // Flush previous section if it has content or had a heading
      if (hasHeading || currentLines.some((l) => l.trim().length > 0)) {
        const sectionMarkdown = currentLines.join('\n').trim();
        if (sectionMarkdown.length > 0) {
          const index = sections.length;
          const headingTitle = currentHeading || 'Overview';
          sections.push({
            id: `${slugify(headingTitle)}-${index}`,
            heading: headingTitle,
            level: currentLevel,
            markdown: sectionMarkdown
          });
        }
      }

      currentLevel = headingMatch[1].length;
      // Strip trailing hashes if present per CommonMark ATX specification
      currentHeading = headingMatch[2].replace(/\s+#+\s*$/, '').trim();
      currentLines = [line];
      hasHeading = true;
    } else {
      currentLines.push(line);
    }
  }

  // Flush remaining lines as the final section
  if (currentLines.length > 0) {
    const sectionMarkdown = currentLines.join('\n').trim();
    if (sectionMarkdown.length > 0) {
      const index = sections.length;
      const headingTitle = currentHeading || 'Overview';
      sections.push({
        id: `${slugify(headingTitle)}-${index}`,
        heading: headingTitle,
        level: currentLevel,
        markdown: sectionMarkdown
      });
    }
  }

  return sections;
}

/**
 * Returns the base storage directory for documents: ~/.tycode/documents
 */
export function getDocumentsStorageDir(): string {
  return path.join(os.homedir(), '.tycode', 'documents');
}

/**
 * Persists an AgentDocument to disk:
 * - ~/.tycode/documents/{id}.md: full verbatim markdown
 * - ~/.tycode/documents/{id}.json: metadata sidecar (kind, title, sections, createdAt)
 */
export async function persistDocument(document: AgentDocument): Promise<void> {
  const dir = getDocumentsStorageDir();
  await fs.mkdir(dir, { recursive: true });

  const mdPath = path.join(dir, `${document.id}.md`);
  const jsonPath = path.join(dir, `${document.id}.json`);

  const sidecar = {
    id: document.id,
    kind: document.kind,
    title: document.title,
    sections: document.sections,
    createdAt: document.createdAt
  };

  await Promise.all([
    fs.writeFile(mdPath, document.markdown, 'utf-8'),
    fs.writeFile(jsonPath, JSON.stringify(sidecar, null, 2), 'utf-8')
  ]);
}

/**
 * Loads a persisted document by ID from ~/.tycode/documents/
 */
export async function loadDocument(id: string): Promise<AgentDocument | null> {
  const dir = getDocumentsStorageDir();
  const mdPath = path.join(dir, `${id}.md`);
  const jsonPath = path.join(dir, `${id}.json`);

  try {
    const [markdown, jsonContent] = await Promise.all([
      fs.readFile(mdPath, 'utf-8'),
      fs.readFile(jsonPath, 'utf-8')
    ]);
    const metadata = JSON.parse(jsonContent);
    return {
      id: metadata.id || id,
      kind: metadata.kind || 'plan',
      title: metadata.title || 'Document',
      markdown,
      sections: metadata.sections || parseMarkdownSections(markdown),
      createdAt: metadata.createdAt || Date.now()
    };
  } catch {
    return null;
  }
}

/**
 * Lists all documents persisted in ~/.tycode/documents/
 */
export async function listDocuments(): Promise<Array<Omit<AgentDocument, 'markdown'>>> {
  const dir = getDocumentsStorageDir();
  try {
    const files = await fs.readdir(dir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));
    const docs: Array<Omit<AgentDocument, 'markdown'>> = [];

    for (const file of jsonFiles) {
      try {
        const content = await fs.readFile(path.join(dir, file), 'utf-8');
        const parsed = JSON.parse(content);
        docs.push(parsed);
      } catch {
        // Ignore unparseable sidecars
      }
    }

    return docs.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  } catch {
    return [];
  }
}
