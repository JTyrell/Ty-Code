/**
 * AI Data Extractor (History Export) - Phase 3.3
 *
 * Scans known local directories (~/.ty-code, ~/.ty-claude, ~/.cursor, ~/.aider, and workspace)
 * for AI chat histories and sessions, normalizes them into a unified schema,
 * and exports them to consolidated JSON and Markdown formats.
 *
 * Pure TypeScript / Node.js implementation with zero Python dependencies.
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

export type AiToolSource = 'ty-code' | 'ty-claude' | 'cursor' | 'aider' | 'claude-code' | 'generic';

export interface NormalizedMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: number;
  model?: string;
  toolCalls?: Array<{
    name: string;
    arguments?: unknown;
    result?: string;
  }>;
}

export interface NormalizedSession {
  id: string;
  sourceTool: AiToolSource;
  sourcePath: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workspacePath?: string;
  model?: string;
  messageCount: number;
  messages: NormalizedMessage[];
}

export interface HistoryExportProgress {
  stage: 'discovering' | 'reading' | 'normalizing' | 'writing' | 'completed' | 'error';
  current: number;
  total: number;
  percent: number;
  message: string;
  currentSource?: string;
}

export interface HistoryExportResult {
  success: boolean;
  exportPath: string;
  format: 'json' | 'md' | 'all';
  totalSessions: number;
  totalMessages: number;
  sourcesFound: Record<AiToolSource, number>;
  outputPath: string;
  filesGenerated: string[];
  error?: string;
}

export interface HistoryExportOptions {
  customHome?: string;
  workspacePath?: string;
  scanLocations?: string[];
  outputDir?: string;
  outputFileName?: string;
  format?: 'json' | 'md' | 'all';
  onProgress?: (progress: HistoryExportProgress) => void;
}

export class HistoryExtractor {
  /**
   * Discovers candidate chat/session files across known local directories.
   */
  public async discoverChatFiles(
    homeDir: string = os.homedir(),
    workspacePath?: string,
    customLocations: string[] = []
  ): Promise<{ path: string; sourceHint: AiToolSource }[]> {
    const candidates: { path: string; sourceHint: AiToolSource }[] = [];

    const defaultTargets: { dir: string; source: AiToolSource; recursive?: boolean }[] = [
      // 1. Ty-Code sessions & logs
      { dir: path.join(homeDir, '.ty-code', 'sessions'), source: 'ty-code' },
      { dir: path.join(homeDir, '.ty-code', 'history'), source: 'ty-code' },
      // 2. Ty-Claude legacy sessions
      { dir: path.join(homeDir, '.ty-claude', 'sessions'), source: 'ty-claude' },
      // 3. Cursor chats & sessions
      { dir: path.join(homeDir, '.cursor'), source: 'cursor', recursive: true },
      { dir: path.join(homeDir, '.config', 'Cursor'), source: 'cursor', recursive: true },
      // 4. Aider chats & logs
      { dir: path.join(homeDir, '.aider'), source: 'aider' }
    ];

    // Single file in home directory (Aider chat history)
    const homeAiderFile = path.join(homeDir, '.aider.chat.history.md');
    try {
      const s = await fs.stat(homeAiderFile);
      if (s.isFile()) {
        candidates.push({ path: homeAiderFile, sourceHint: 'aider' });
      }
    } catch {}

    if (workspacePath) {
      defaultTargets.push(
        { dir: path.join(workspacePath, '.ty-code', 'sessions'), source: 'ty-code' },
        { dir: path.join(workspacePath, '.ty-claude', 'sessions'), source: 'ty-claude' },
        { dir: path.join(workspacePath, '.cursor'), source: 'cursor', recursive: true },
        { dir: path.join(workspacePath, '.aider'), source: 'aider' }
      );

      const wsAiderFile = path.join(workspacePath, '.aider.chat.history.md');
      try {
        const s = await fs.stat(wsAiderFile);
        if (s.isFile()) {
          candidates.push({ path: wsAiderFile, sourceHint: 'aider' });
        }
      } catch {}
    }

    // Add custom scan locations
    for (const loc of customLocations) {
      defaultTargets.push({ dir: loc, source: 'generic', recursive: true });
    }

    for (const target of defaultTargets) {
      try {
        const stat = await fs.stat(target.dir);
        if (!stat.isDirectory()) continue;
        await this.scanDirectory(target.dir, target.source, Boolean(target.recursive), candidates, 0, 3);
      } catch {
        // Directory does not exist, ignore
      }
    }

    return candidates;
  }

  private async scanDirectory(
    dir: string,
    source: AiToolSource,
    recursive: boolean,
    results: { path: string; sourceHint: AiToolSource }[],
    depth: number,
    maxDepth: number
  ): Promise<void> {
    if (depth > maxDepth) return;
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile()) {
          const lower = entry.name.toLowerCase();
          if (
            lower.endsWith('.json') ||
            lower.endsWith('.jsonl') ||
            lower.endsWith('.md') ||
            lower.includes('chat') ||
            lower.includes('history') ||
            lower.includes('session')
          ) {
            results.push({ path: fullPath, sourceHint: source });
          }
        } else if (entry.isDirectory() && recursive && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
          await this.scanDirectory(fullPath, source, recursive, results, depth + 1, maxDepth);
        }
      }
    } catch {}
  }

  /**
   * Normalizes an individual chat/session file into one or more NormalizedSessions.
   */
  public async parseSessionFile(filePath: string, sourceHint: AiToolSource): Promise<NormalizedSession[]> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const ext = path.extname(filePath).toLowerCase();

      if (ext === '.json') {
        return this.parseJsonSession(content, filePath, sourceHint);
      } else if (ext === '.jsonl') {
        return this.parseJsonlSession(content, filePath, sourceHint);
      } else if (ext === '.md' || filePath.includes('history')) {
        return this.parseMarkdownSession(content, filePath, sourceHint);
      }
    } catch {}

    return [];
  }

  private parseJsonSession(rawContent: string, filePath: string, sourceHint: AiToolSource): NormalizedSession[] {
    try {
      const parsed = JSON.parse(rawContent);

      // Ty-Code / Ty-Claude SessionStore format
      if (parsed?.metadata && Array.isArray(parsed?.messages)) {
        const meta = parsed.metadata;
        const sourceTool: AiToolSource = sourceHint === 'ty-claude' ? 'ty-claude' : 'ty-code';
        const messages: NormalizedMessage[] = parsed.messages.map((m: any, idx: number) => ({
          id: m.id || `msg_${idx}`,
          role: m.role || 'user',
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          timestamp: m.timestamp || meta.createdAt,
          model: m.model,
          toolCalls: m.toolCalls
        }));

        return [{
          id: meta.id || path.basename(filePath, '.json'),
          sourceTool,
          sourcePath: filePath,
          title: meta.title || 'Untitled Ty-Code Session',
          createdAt: meta.createdAt || Date.now(),
          updatedAt: meta.updatedAt || Date.now(),
          workspacePath: meta.workspacePath,
          messageCount: messages.length,
          messages
        }];
      }

      // Cursor conversation format (e.g. { conversations: [ ... ] } or { tabs: [ ... ] })
      if (Array.isArray(parsed?.conversations) || Array.isArray(parsed?.tabs)) {
        const convList = parsed.conversations || parsed.tabs;
        const sessions: NormalizedSession[] = [];
        for (const [idx, conv] of convList.entries()) {
          const msgs: NormalizedMessage[] = (conv.messages || conv.turns || []).map((m: any, mIdx: number) => ({
            id: m.id || `cursor_msg_${idx}_${mIdx}`,
            role: m.role || (m.type === 'ai' ? 'assistant' : 'user'),
            content: typeof m.text === 'string' ? m.text : (typeof m.content === 'string' ? m.content : ''),
            timestamp: m.timestamp || Date.now()
          }));
          if (msgs.length > 0) {
            sessions.push({
              id: conv.id || `cursor_sess_${idx}`,
              sourceTool: 'cursor',
              sourcePath: filePath,
              title: conv.title || `Cursor Conversation ${idx + 1}`,
              createdAt: conv.createdAt || Date.now(),
              updatedAt: conv.updatedAt || Date.now(),
              messageCount: msgs.length,
              messages: msgs
            });
          }
        }
        return sessions;
      }

      // Generic array of messages: [ { role, content } ]
      if (Array.isArray(parsed)) {
        const msgs: NormalizedMessage[] = parsed.map((m: any, idx: number) => ({
          id: m.id || `msg_${idx}`,
          role: m.role || (idx % 2 === 0 ? 'user' : 'assistant'),
          content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
          timestamp: m.timestamp
        }));

        return [{
          id: path.basename(filePath, '.json'),
          sourceTool: sourceHint,
          sourcePath: filePath,
          title: `Imported Chat (${path.basename(filePath)})`,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          messageCount: msgs.length,
          messages: msgs
        }];
      }
    } catch {}

    return [];
  }

  private parseJsonlSession(rawContent: string, filePath: string, sourceHint: AiToolSource): NormalizedSession[] {
    const lines = rawContent.split('\n').filter((l) => l.trim().length > 0);
    const messages: NormalizedMessage[] = [];

    for (const [idx, line] of lines.entries()) {
      try {
        const parsed = JSON.parse(line);
        if (parsed.content || parsed.message) {
          const role = parsed.role || (parsed.type === 'USER_INPUT' ? 'user' : 'assistant');
          messages.push({
            id: parsed.id || `jsonl_msg_${idx}`,
            role,
            content: typeof parsed.content === 'string' ? parsed.content : (parsed.message || JSON.stringify(parsed)),
            timestamp: parsed.timestamp
          });
        }
      } catch {}
    }

    if (messages.length === 0) return [];

    return [{
      id: path.basename(filePath, '.jsonl'),
      sourceTool: sourceHint,
      sourcePath: filePath,
      title: `Transcript: ${path.basename(filePath, '.jsonl')}`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: messages.length,
      messages
    }];
  }

  private parseMarkdownSession(rawContent: string, filePath: string, sourceHint: AiToolSource): NormalizedSession[] {
    const messages: NormalizedMessage[] = [];
    const sourceTool: AiToolSource = sourceHint === 'aider' || filePath.includes('aider') ? 'aider' : 'generic';

    // Aider formats sessions with markdown headers, e.g. "#### <timestamp>" or "> User message"
    const lines = rawContent.split('\n');
    let currentRole: 'user' | 'assistant' = 'user';
    let currentBuffer: string[] = [];

    const flush = () => {
      const text = currentBuffer.join('\n').trim();
      if (text.length > 0) {
        messages.push({
          id: `md_msg_${messages.length + 1}`,
          role: currentRole,
          content: text,
          timestamp: Date.now()
        });
      }
      currentBuffer = [];
    };

    for (const line of lines) {
      if (line.startsWith('#### ')) {
        // Timestamp / session boundary in Aider history
        flush();
        continue;
      }
      if (line.startsWith('# User') || line.startsWith('USER:')) {
        flush();
        currentRole = 'user';
        const cleaned = line.replace(/^(#\s*User\s*:?|USER:\s*)/i, '').trim();
        if (cleaned) currentBuffer.push(cleaned);
      } else if (line.startsWith('# Assistant') || line.startsWith('ASSISTANT:') || line.startsWith('AI:')) {
        flush();
        currentRole = 'assistant';
        const cleaned = line.replace(/^(#\s*Assistant\s*:?|ASSISTANT:\s*|AI:\s*)/i, '').trim();
        if (cleaned) currentBuffer.push(cleaned);
      } else {
        currentBuffer.push(line);
      }
    }
    flush();

    if (messages.length === 0) return [];

    return [{
      id: path.basename(filePath, path.extname(filePath)),
      sourceTool,
      sourcePath: filePath,
      title: `${sourceTool === 'aider' ? 'Aider' : 'Markdown'} History (${path.basename(filePath)})`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messageCount: messages.length,
      messages
    }];
  }

  /**
   * Generates a single consolidated Markdown report of all extracted sessions.
   */
  public generateMarkdownReport(sessions: NormalizedSession[], totalMessages: number): string {
    const dateStr = new Date().toISOString().split('T')[0];
    const sourceCounts: Record<string, number> = {};
    for (const s of sessions) {
      sourceCounts[s.sourceTool] = (sourceCounts[s.sourceTool] || 0) + 1;
    }

    const sourceBreakdown = Object.entries(sourceCounts)
      .map(([k, v]) => `${k.toUpperCase()} (${v})`)
      .join(', ');

    const parts: string[] = [
      '# Ty-Code Consolidated AI Chat History Export',
      `**Exported Date:** ${dateStr}  `,
      `**Total Sessions:** ${sessions.length} | **Total Messages:** ${totalMessages}  `,
      `**Sources Included:** ${sourceBreakdown || 'None'}  `,
      '',
      '---',
      ''
    ];

    for (const [idx, session] of sessions.entries()) {
      const sessionDate = new Date(session.createdAt).toLocaleString();
      parts.push(`## ${idx + 1}. ${session.title}`);
      parts.push(`- **Tool Source:** \`${session.sourceTool}\``);
      parts.push(`- **Created:** ${sessionDate}`);
      parts.push(`- **Message Count:** ${session.messages.length}`);
      if (session.workspacePath) {
        parts.push(`- **Workspace:** \`${session.workspacePath}\``);
      }
      parts.push('');

      for (const msg of session.messages) {
        const icon = msg.role === 'user' ? '👤 **User**' : msg.role === 'assistant' ? '🤖 **Assistant**' : `⚙️ **${msg.role}**`;
        parts.push(`### ${icon}`);
        parts.push(msg.content);
        parts.push('');
      }

      parts.push('---', '');
    }

    return parts.join('\n');
  }

  /**
   * Main execution method: scans, extracts, normalizes, and saves the exported histories.
   */
  public async exportHistory(options: HistoryExportOptions = {}): Promise<HistoryExportResult> {
    const homeDir = options.customHome || os.homedir();
    const workspacePath = options.workspacePath || process.cwd();
    const outputDir = options.outputDir || path.join(homeDir, 'Downloads');
    const baseName = options.outputFileName || `ty-code-ai-history-${Date.now()}`;
    const format = options.format || 'all';

    options.onProgress?.({
      stage: 'discovering',
      current: 0,
      total: 0,
      percent: 5,
      message: 'Scanning local directories for Ty-Code, Cursor, and Aider chat sessions...'
    });

    const candidateFiles = await this.discoverChatFiles(homeDir, workspacePath, options.scanLocations);

    options.onProgress?.({
      stage: 'reading',
      current: 0,
      total: candidateFiles.length,
      percent: 20,
      message: `Found ${candidateFiles.length} candidate chat history files. Normalizing sessions...`
    });

    const allSessions: NormalizedSession[] = [];
    const sourcesFound: Record<AiToolSource, number> = {
      'ty-code': 0,
      'ty-claude': 0,
      'cursor': 0,
      'aider': 0,
      'claude-code': 0,
      'generic': 0
    };

    let processedCount = 0;
    for (const file of candidateFiles) {
      processedCount++;
      const sessions = await this.parseSessionFile(file.path, file.sourceHint);
      for (const s of sessions) {
        allSessions.push(s);
        sourcesFound[s.sourceTool] = (sourcesFound[s.sourceTool] || 0) + 1;
      }

      const percent = Math.min(80, Math.round(20 + (processedCount / (candidateFiles.length || 1)) * 60));
      options.onProgress?.({
        stage: 'normalizing',
        current: processedCount,
        total: candidateFiles.length,
        percent,
        message: `Processed ${processedCount}/${candidateFiles.length} files (${allSessions.length} sessions parsed)...`,
        currentSource: file.sourceHint
      });
    }

    // Sort sessions chronologically (newest first)
    allSessions.sort((a, b) => b.createdAt - a.createdAt);

    const totalMessages = allSessions.reduce((acc, s) => acc + s.messages.length, 0);

    options.onProgress?.({
      stage: 'writing',
      current: allSessions.length,
      total: allSessions.length,
      percent: 85,
      message: `Generating ${format.toUpperCase()} export files...`
    });

    await fs.mkdir(outputDir, { recursive: true }).catch(() => {});

    const filesGenerated: string[] = [];
    let primaryOutputPath = '';

    // Generate JSON
    if (format === 'json' || format === 'all') {
      const jsonPath = path.join(outputDir, `${baseName}.json`);
      const exportPayload = {
        exportedAt: new Date().toISOString(),
        exporter: 'Ty-Code AI Data Extractor',
        version: '1.0.0',
        summary: {
          totalSessions: allSessions.length,
          totalMessages,
          sources: sourcesFound
        },
        sessions: allSessions
      };
      await fs.writeFile(jsonPath, JSON.stringify(exportPayload, null, 2), 'utf-8');
      filesGenerated.push(jsonPath);
      if (!primaryOutputPath) primaryOutputPath = jsonPath;
    }

    // Generate Markdown
    if (format === 'md' || format === 'all') {
      const mdPath = path.join(outputDir, `${baseName}.md`);
      const mdContent = this.generateMarkdownReport(allSessions, totalMessages);
      await fs.writeFile(mdPath, mdContent, 'utf-8');
      filesGenerated.push(mdPath);
      if (!primaryOutputPath) primaryOutputPath = mdPath;
    }

    options.onProgress?.({
      stage: 'completed',
      current: allSessions.length,
      total: allSessions.length,
      percent: 100,
      message: `Export completed! ${allSessions.length} sessions (${totalMessages} messages) saved.`
    });

    return {
      success: true,
      exportPath: primaryOutputPath,
      outputPath: primaryOutputPath,
      format,
      totalSessions: allSessions.length,
      totalMessages,
      sourcesFound,
      filesGenerated
    };
  }
}

export const historyExtractor = new HistoryExtractor();
