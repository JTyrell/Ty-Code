import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface RecentWorkspace {
  path: string;
  name: string;
  lastOpened: number;
}

export class RecentWorkspacesManager {
  private filePath: string;
  private maxItems = 12;

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
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const list = JSON.parse(raw);
        if (Array.isArray(list)) {
          return list.filter((item) => item && typeof item.path === 'string');
        }
      }
    } catch (err) {
      console.warn('[RecentWorkspaces] Failed to read recent workspaces:', err);
    }
    return [];
  }

  public addRecent(folderPath: string): RecentWorkspace[] {
    if (!folderPath) return this.getRecent();
    const current = this.getRecent();
    const normalized = path.normalize(folderPath);
    const name = path.basename(normalized) || normalized;

    const filtered = current.filter((item) => path.normalize(item.path) !== normalized);
    const updated: RecentWorkspace[] = [
      { path: normalized, name, lastOpened: Date.now() },
      ...filtered
    ].slice(0, this.maxItems);

    this.save(updated);
    return updated;
  }

  public removeRecent(folderPath: string): RecentWorkspace[] {
    const current = this.getRecent();
    const normalized = path.normalize(folderPath);
    const updated = current.filter((item) => path.normalize(item.path) !== normalized);
    this.save(updated);
    return updated;
  }

  public clearRecent(): void {
    this.save([]);
  }

  private save(items: RecentWorkspace[]): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(items, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[RecentWorkspaces] Failed to save recent workspaces:', err);
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
