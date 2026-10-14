import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ConversationMemoryEntry, MemoryQuery } from '../../preload/types';

export class ConversationMemoryService {
  private workspacePath: string;
  private memories: ConversationMemoryEntry[] = [];
  private isLoaded = false;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  setWorkspace(workspacePath: string): void {
    if (this.workspacePath !== workspacePath) {
      this.workspacePath = workspacePath;
      this.isLoaded = false;
      this.memories = [];
    }
  }

  private getMemoryFilePath(): string {
    return path.join(this.workspacePath, '.ty-code', 'conversation-memory.json');
  }

  async load(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const filePath = this.getMemoryFilePath();
      const raw = await fs.readFile(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.memories = data;
      }
    } catch {
      this.memories = [];
    } finally {
      this.isLoaded = true;
    }
  }

  async save(): Promise<void> {
    try {
      const filePath = this.getMemoryFilePath();
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, JSON.stringify(this.memories, null, 2), 'utf8');
    } catch {
      // Gracefully ignore write errors
    }
  }

  async addMemory(entry: Partial<ConversationMemoryEntry>): Promise<ConversationMemoryEntry> {
    await this.load();
    const newEntry: ConversationMemoryEntry = {
      id: entry.id || randomUUID(),
      timestamp: entry.timestamp || Date.now(),
      topic: entry.topic || 'General Task',
      summary: entry.summary || '',
      keyDecisions: entry.keyDecisions || [],
      relevantFiles: entry.relevantFiles || [],
      tags: entry.tags || []
    };

    // Prepend so latest are first
    this.memories.unshift(newEntry);
    if (this.memories.length > 200) {
      this.memories = this.memories.slice(0, 200);
    }
    await this.save();
    return newEntry;
  }

  async queryMemories(queryReq?: MemoryQuery): Promise<ConversationMemoryEntry[]> {
    await this.load();
    if (!queryReq || !queryReq.query || !queryReq.query.trim()) {
      const limit = queryReq?.limit || 20;
      return this.memories.slice(0, limit);
    }

    const terms = queryReq.query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = this.memories.map((mem) => {
      let score = 0;
      const haystack = [
        mem.topic,
        mem.summary,
        ...mem.keyDecisions,
        ...mem.relevantFiles,
        ...mem.tags
      ]
        .join(' ')
        .toLowerCase();

      for (const term of terms) {
        if (haystack.includes(term)) {
          score += 1;
          if (mem.topic.toLowerCase().includes(term)) score += 2;
          if (mem.tags.some((t) => t.toLowerCase() === term)) score += 2;
        }
      }

      return { mem, score };
    });

    const limit = queryReq.limit || 10;
    return scored
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score || b.mem.timestamp - a.mem.timestamp)
      .map((s) => s.mem)
      .slice(0, limit);
  }

  async getAll(): Promise<ConversationMemoryEntry[]> {
    await this.load();
    return [...this.memories];
  }

  async getAllEntries(): Promise<ConversationMemoryEntry[]> {
    return this.getAll();
  }

  async initialize(): Promise<void> {
    return this.load();
  }

  async saveEntry(entry: {
    role?: string;
    content?: string;
    topic?: string;
    summary?: string;
    keyDecisions?: string[];
    relevantFiles?: string[];
    tags?: string[];
  }): Promise<ConversationMemoryEntry & { content?: string }> {
    const summary = entry.summary || entry.content || '';
    const keyDecisions = entry.keyDecisions || (entry.content ? [entry.content] : []);
    const saved = await this.addMemory({
      topic: entry.topic || (entry.role === 'user' ? 'User Decision' : 'Architectural Note'),
      summary,
      keyDecisions,
      relevantFiles: entry.relevantFiles || [],
      tags: entry.tags || []
    });
    return { ...saved, content: summary };
  }

  async searchMemory(query: string, limit: number = 10): Promise<Array<ConversationMemoryEntry & { content: string }>> {
    const results = await this.queryMemories({ query, limit });
    return results.map((r) => ({
      ...r,
      content: r.summary || (r.keyDecisions && r.keyDecisions.length > 0 ? r.keyDecisions[0] : '')
    }));
  }

  async clear(): Promise<void> {
    this.memories = [];
    this.isLoaded = true;
    await this.save();
  }
}
