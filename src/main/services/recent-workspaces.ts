import { app } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

import { isAppOrSystemDir } from './workspace-security';

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: number;
}

export class RecentWorkspacesManager {
  private filePath: string;
  private maxItems = 12;
  private memoryCache: RecentWorkspace[] | null = null;
  private isLoaded = false;

  constructor(customPath?: string) {
    if (customPath) {
      this.filePath = customPath;
    } else {
      try {
        const userData = app?.getPath ? app.getPath('userData') : process.cwd();
        this.filePath = path.join(userData, 'recent-workspaces.json');
      } catch {
        this.filePath = path.join(process.cwd(), 'recent-workspaces.json');
      }
    }
  }

  public getRecent(): RecentWorkspace[] {
    if (this.memoryCache !== null) {
      return [...this.memoryCache];
    }
    // Asynchronous background load
    void this.loadAsync();
    return [];
  }

  public async getRecentAsync(): Promise<RecentWorkspace[]> {
    if (this.memoryCache !== null) {
      return [...this.memoryCache];
    }
    await this.loadAsync();
    return this.memoryCache ? [...this.memoryCache] : [];
  }

  private async loadAsync(): Promise<void> {
    try {
      const exists = await fs.access(this.filePath).then(() => true).catch(() => false);
      if (exists) {
        const raw = await fs.readFile(this.filePath, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          this.memoryCache = list.filter((item) => item && typeof item.path === 'string' && !isAppOrSystemDir(item.path));
          this.isLoaded = true;
          return;
        }
      }
    } catch (err) {
      console.warn('[RecentWorkspaces] Failed to read recent workspaces:', err);
    }
    this.memoryCache = [];
    this.isLoaded = true;
  }

  public addRecent(folderPath: string): RecentWorkspace[] {
    if (!folderPath || isAppOrSystemDir(folderPath)) return this.getRecent();
    const current = this.memoryCache !== null ? this.memoryCache : this.getRecent();
    const normalized = path.normalize(folderPath);
    const name = path.basename(normalized) || normalized;

    const filtered = current.filter((item) => path.normalize(item.path) !== normalized && !isAppOrSystemDir(item.path));
    const updated: RecentWorkspace[] = [
      { path: normalized, name, lastOpened: Date.now() },
      ...filtered
    ].slice(0, this.maxItems);

    this.memoryCache = updated;
    void this.saveAsync(updated);
    return updated;
  }

  public removeRecent(folderPath: string): RecentWorkspace[] {
    const current = this.memoryCache !== null ? this.memoryCache : this.getRecent();
    const normalized = path.normalize(folderPath);
    const updated = current.filter((item) => path.normalize(item.path) !== normalized);
    this.memoryCache = updated;
    void this.saveAsync(updated);
    return updated;
  }

  public clearRecent(): void {
    this.memoryCache = [];
    void this.saveAsync([]);
  }

  private async saveAsync(items: RecentWorkspace[]): Promise<void> {
    try {
      const dir = path.dirname(this.filePath);
      await fs.mkdir(dir, { recursive: true });
      await fs.writeFile(this.filePath, JSON.stringify(items, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[RecentWorkspaces] Failed to save recent workspaces asynchronously:', err);
    }
  }
}

let instance: RecentWorkspacesManager | null = null;
export function getRecentWorkspacesManager(): RecentWorkspacesManager {
  if (!instance) {
    instance = new RecentWorkspacesManager();
  }
  return instance;
}
