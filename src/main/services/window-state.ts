import { app, screen, BrowserWindow, Rectangle } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export interface WindowState {
  x?: number;
  y?: number;
  width: number;
  height: number;
  isMaximized: boolean;
  isFullScreen: boolean;
}

const DEFAULT_STATE: WindowState = {
  width: 1450,
  height: 920,
  isMaximized: false,
  isFullScreen: false
};

export class WindowStateManager {
  private configPath: string;
  private state: WindowState;
  private saveTimeout: NodeJS.Timeout | null = null;
  private window: BrowserWindow | null = null;

  constructor(customConfigPath?: string) {
    if (customConfigPath) {
      this.configPath = customConfigPath;
    } else {
      try {
        const userData = app?.getPath ? app.getPath('userData') : process.cwd();
        this.configPath = path.join(userData, 'window-state.json');
      } catch {
        this.configPath = path.join(process.cwd(), 'window-state.json');
      }
    }
    this.state = this.loadState();
  }

  public getState(): WindowState {
    return { ...this.state };
  }

  public manage(window: BrowserWindow): void {
    this.window = window;

    // Apply saved state
    if (this.state.isMaximized) {
      window.maximize();
    }
    if (this.state.isFullScreen) {
      window.setFullScreen(true);
    }

    const updateState = () => {
      if (!this.window || (typeof this.window.isDestroyed === 'function' && this.window.isDestroyed())) return;

      const isMaximized = this.window.isMaximized();
      const isFullScreen = this.window.isFullScreen();

      if (!isMaximized && !isFullScreen) {
        const bounds = this.window.getBounds();
        this.state = {
          x: bounds.x,
          y: bounds.y,
          width: bounds.width,
          height: bounds.height,
          isMaximized: false,
          isFullScreen: false
        };
      } else {
        this.state.isMaximized = isMaximized;
        this.state.isFullScreen = isFullScreen;
      }

      this.scheduleSave();
    };

    window.on('resize', updateState);
    window.on('move', updateState);
    window.on('maximize', updateState);
    window.on('unmaximize', updateState);
    window.on('enter-full-screen', updateState);
    window.on('leave-full-screen', updateState);
    window.on('close', () => {
      updateState();
      this.saveStateSync();
    });
  }

  public scheduleSave(): void {
    if (this.saveTimeout) clearTimeout(this.saveTimeout);
    this.saveTimeout = setTimeout(() => {
      this.saveStateSync();
    }, 500);
  }

  public saveStateSync(): void {
    try {
      const dir = path.dirname(this.configPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.configPath, JSON.stringify(this.state, null, 2), 'utf-8');
    } catch (err) {
      console.warn('[WindowState] Failed to save window state:', err);
    }
  }

  private loadState(): WindowState {
    try {
      if (fs.existsSync(this.configPath)) {
        const data = fs.readFileSync(this.configPath, 'utf-8');
        const parsed = JSON.parse(data) as Partial<WindowState>;
        if (typeof parsed === 'object' && parsed !== null) {
          const validated = {
            width: typeof parsed.width === 'number' && parsed.width >= 800 ? parsed.width : DEFAULT_STATE.width,
            height: typeof parsed.height === 'number' && parsed.height >= 600 ? parsed.height : DEFAULT_STATE.height,
            x: typeof parsed.x === 'number' ? parsed.x : undefined,
            y: typeof parsed.y === 'number' ? parsed.y : undefined,
            isMaximized: Boolean(parsed.isMaximized),
            isFullScreen: Boolean(parsed.isFullScreen)
          };

          if (this.hasBounds(validated) && !this.isWithinDisplayBounds(validated)) {
            // Reposition window if outside visible screen space
            return {
              width: validated.width,
              height: validated.height,
              isMaximized: validated.isMaximized,
              isFullScreen: validated.isFullScreen
            };
          }

          return validated as WindowState;
        }
      }
    } catch (err) {
      console.warn('[WindowState] Failed to load window state, using defaults:', err);
    }
    return { ...DEFAULT_STATE };
  }

  private hasBounds(state: Partial<WindowState>): state is WindowState & { x: number; y: number } {
    return typeof state.x === 'number' && typeof state.y === 'number';
  }

  private isWithinDisplayBounds(state: { x: number; y: number; width: number; height: number }): boolean {
    if (!screen || !screen.getAllDisplays) return true;
    try {
      const displays = screen.getAllDisplays();
      const rect: Rectangle = { x: state.x, y: state.y, width: state.width, height: state.height };
      return displays.some((display) => {
        const bounds = display.bounds;
        return (
          rect.x + rect.width > bounds.x + 50 &&
          rect.x < bounds.x + bounds.width - 50 &&
          rect.y + rect.height > bounds.y + 50 &&
          rect.y < bounds.y + bounds.height - 50
        );
      });
    } catch {
      return true;
    }
  }
}
