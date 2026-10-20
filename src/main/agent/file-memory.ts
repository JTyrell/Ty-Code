import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export interface FileMemory {
  path: string;
  lastAccessed: number;
  accessCount: number;
  summary: string;
  keySymbols: string[];
  dependencies: string[];
}

const MEMORY_DIR = path.join(os.homedir(), '.tycode');
const MEMORY_FILE = path.join(MEMORY_DIR, 'file-memory.json');
const SAVE_DEBOUNCE_MS = 1_000;
const RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export function normalizeMemoryPath(filePath: string): string {
  return path.normalize(filePath).replace(/\\/g, '/');
}

const SYMBOL_PATTERNS: Array<{ regex: RegExp; kind: string }> = [
  { regex: /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g, kind: 'fn' },
  { regex: /(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/g, kind: 'class' },
  { regex: /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/g, kind: 'fn' },
  { regex: /(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/g, kind: 'type' },
  { regex: /(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/g, kind: 'type' },
  { regex: /(?:export\s+)?enum\s+([A-Za-z_$][\w$]*)/g, kind: 'enum' }
];

export function extractKeySymbols(content: string): string[] {
  if (!content) return [];
  const symbols = new Set<string>();
  for (const { regex, kind } of SYMBOL_PATTERNS) {
    regex.lastIndex = 0;
    let match = regex.exec(content);
    while (match) {
      symbols.add(`${kind}:${match[1]}`);
      match = regex.exec(content);
    }
  }
  return Array.from(symbols);
}

export function extractDependencies(content: string): string[] {
  if (!content) return [];
  const deps = new Set<string>();
  const patterns = [
    /(?:import|export)\s[^'\"]*from\s+['\"]([^'\"]+)['\"]/g,
    /import\s+['\"]([^'\"]+)['\"]/g,
    /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g
  ];
  for (const pattern of patterns) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match) {
      deps.add(match[1]);
      match = pattern.exec(content);
    }
  }
  return Array.from(deps);
}

function tokenize(query: string): string[] {
  return (query || '')
    .toLowerCase()
    .split(/[^a-z0-9_./-]+/)
    .filter((term) => term.length > 1);
}

export class FileMemoryManager {
  private memories = new Map<string, FileMemory>();
  private loadPromise: Promise<void> | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveQueued = false;

  ensureLoaded(): Promise<void> {
    if (!this.loadPromise) {
      this.loadPromise = this.loadFromDisk().catch(() => undefined);
    }
    return this.loadPromise;
  }

  accessFile(filePath: string): FileMemory {
    const key = normalizeMemoryPath(filePath);
    const now = Date.now();
    const existing = this.memories.get(key);
    if (existing) {
      existing.accessCount++;
      existing.lastAccessed = now;
      this.scheduleSave();
      return existing;
    }
    const fresh: FileMemory = {
      path: key,
      lastAccessed: now,
      accessCount: 1,
      summary: '',
      keySymbols: [],
      dependencies: []
    };
    this.memories.set(key, fresh);
    this.scheduleSave();
    return fresh;
  }

  getMemory(filePath: string): FileMemory | null {
    return this.memories.get(normalizeMemoryPath(filePath)) || null;
  }

  hasMemory(filePath: string): boolean {
    return this.memories.has(normalizeMemoryPath(filePath));
  }

  updateMemory(filePath: string, updates: Partial<FileMemory>): void {
    const key = normalizeMemoryPath(filePath);
    const existing = this.memories.get(key);
    const memory: FileMemory = existing || {
      path: key,
      lastAccessed: 0,
      accessCount: 0,
      summary: '',
      keySymbols: [],
      dependencies: []
    };
    if (!existing) this.memories.set(key, memory);
    if (typeof updates.summary === 'string') memory.summary = updates.summary;
    if (updates.keySymbols) memory.keySymbols = updates.keySymbols.slice(0, 32);
    if (updates.dependencies) memory.dependencies = updates.dependencies.slice(0, 64);
    if (typeof updates.lastAccessed === 'number') memory.lastAccessed = updates.lastAccessed;
    if (typeof updates.accessCount === 'number') memory.accessCount = updates.accessCount;
    this.scheduleSave();
  }

  getRelevantFiles(query: string, limit: number): FileMemory[] {
    const terms = tokenize(query);
    const scored = Array.from(this.memories.values()).map((memory) => {
      const age = Math.max(0, Date.now() - memory.lastAccessed);
      const recencyScore = Math.max(0, 1 - age / RECENCY_WINDOW_MS) * 10;
      const accessScore = Math.min(20, memory.accessCount * 2);
      let queryScore = 0;
      const pathLower = memory.path.toLowerCase();
      const summaryLower = memory.summary.toLowerCase();
      for (const term of terms) {
        if (pathLower.includes(term)) queryScore += 5;
        if (summaryLower.includes(term)) queryScore += 4;
      }
      const queryLower = query.toLowerCase();
      for (const symbol of memory.keySymbols) {
        if (queryLower.includes(symbol.toLowerCase()) || symbol.toLowerCase().includes(terms[0] || '')) queryScore += 6;
      }
      return { memory, score: recencyScore + accessScore + queryScore };
    });
    return scored
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(1, limit))
      .map((entry) => entry.memory);
  }

  private scheduleSave(): void {
    this.saveQueued = true;
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      if (!this.saveQueued) return;
      this.saveQueued = false;
      void this.persistToDisk().catch(() => undefined);
    }, SAVE_DEBOUNCE_MS);
  }

  async persistToDisk(): Promise<void> {
    this.saveQueued = false;
    await fs.mkdir(MEMORY_DIR, { recursive: true });
    const tmpPath = `${MEMORY_FILE}.${process.pid}.tmp`;
    const payload = JSON.stringify(Array.from(this.memories.values()), null, 2);
    await fs.writeFile(tmpPath, payload, 'utf-8');
    await fs.rename(tmpPath, MEMORY_FILE);
  }

  async loadFromDisk(): Promise<void> {
    try {
      const raw = await fs.readFile(MEMORY_FILE, 'utf-8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      for (const entry of parsed) {
        if (!entry || typeof (entry as FileMemory).path !== 'string') continue;
        const memory = entry as FileMemory;
        this.memories.set(normalizeMemoryPath(memory.path), {
          path: normalizeMemoryPath(memory.path),
          lastAccessed: typeof memory.lastAccessed === 'number' ? memory.lastAccessed : 0,
          accessCount: typeof memory.accessCount === 'number' ? memory.accessCount : 0,
          summary: typeof memory.summary === 'string' ? memory.summary : '',
          keySymbols: Array.isArray(memory.keySymbols) ? memory.keySymbols.filter((s) => typeof s === 'string') : [],
          dependencies: Array.isArray(memory.dependencies) ? memory.dependencies.filter((d) => typeof d === 'string') : []
        });
      }
    } catch {
      this.memories.clear();
    }
  }
}

export const fileMemoryManager = new FileMemoryManager();
