/**
 * Tray Manager (Phase FCC-5)
 *
 * Manages the system tray / menu-bar presence:
 * 1. Displays fleet health overview & remaining free tokens.
 * 2. Quick Chat shortcut to immediately bring up chat without navigating.
 * 3. Pause / Resume controls for background agent tasks.
 * 4. Toggle for 'Run in Background' setting.
 * 5. Window restore and quit controls.
 *
 * Brand: Ty-Code
 */

import path from 'node:path';
import { app, BrowserWindow, Menu, MenuItem, nativeImage, Tray } from 'electron';
import { backgroundTaskSupervisor } from './background-task-supervisor';
import { optimizationPipeline } from '../../providers/optimization-pipeline';

export class TrayManager {
  private static instance: TrayManager | null = null;
  private tray: Tray | null = null;
  private mainWindow: BrowserWindow | null = null;
  private isInitialized = false;

  public static getInstance(): TrayManager {
    if (!TrayManager.instance) {
      TrayManager.instance = new TrayManager();
    }
    return TrayManager.instance;
  }

  public initialize(window: BrowserWindow): void {
    this.mainWindow = window;

    if (this.isInitialized) {
      this.updateMenu();
      return;
    }

    try {
      if (!Tray || typeof Tray !== 'function') {
        // Headless or non-electron environment
        return;
      }

      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(__dirname, '../../../../build/icon.png');

      let icon: any;
      try {
        icon = nativeImage.createFromPath(iconPath);
        if (icon.isEmpty()) {
          icon = nativeImage.createEmpty();
        }
      } catch {
        icon = nativeImage.createEmpty();
      }

      this.tray = new Tray(icon);
      this.tray.setToolTip('Ty-Code - Antigravity IDE');

      this.tray.on('click', () => {
        this.toggleWindowVisibility();
      });

      // Update menu on task changes
      backgroundTaskSupervisor.on('task-started', () => this.updateMenu());
      backgroundTaskSupervisor.on('task-completed', () => this.updateMenu());
      backgroundTaskSupervisor.on('task-progress', () => this.updateMenu());
      backgroundTaskSupervisor.on('task-paused', () => this.updateMenu());
      backgroundTaskSupervisor.on('task-resumed', () => this.updateMenu());
      backgroundTaskSupervisor.on('settings-changed', () => this.updateMenu());

      this.isInitialized = true;
      this.updateMenu();
    } catch {
      // Non-blocking in headless / unsupported platforms
    }
  }

  public getTray(): Tray | null {
    return this.tray;
  }

  public toggleWindowVisibility(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    if (this.mainWindow.isVisible()) {
      this.mainWindow.hide();
    } else {
      this.mainWindow.show();
      this.mainWindow.focus();
    }
  }

  public showQuickChat(): void {
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return;

    if (!this.mainWindow.isVisible()) {
      this.mainWindow.show();
    }
    this.mainWindow.focus();

    // Signal renderer to focus chat input
    try {
      this.mainWindow.webContents.send('chat:focus-quick-chat');
    } catch {
      // non-blocking
    }
  }

  public buildMenuTemplate(): Array<Record<string, unknown>> {
    // 1. Fleet health information
    let fleetSummaryText = 'Fleet: Managed Free Supply Active';
    try {
      const meters = optimizationPipeline.getQuotaMetersSummary();
      const healthyCount = meters.providers.filter((p) => !p.isExhausted).length;
      const totalCount = meters.providers.length;
      const remainingMillions = (meters.aggregateFreeTokensRemainingToday / 1_000_000).toFixed(1);
      fleetSummaryText = `Fleet: ${healthyCount}/${totalCount} Healthy (${remainingMillions}M Free Tokens)`;
    } catch {
      // fallback
    }

    // 2. Active tasks
    const activeTasks = backgroundTaskSupervisor.getActiveTasks();
    const taskMenuItems: Array<Record<string, unknown>> = [];

    if (activeTasks.length > 0) {
      for (const task of activeTasks) {
        taskMenuItems.push({
          label: `${task.name} (${task.status} - ${task.progress}%)`,
          sublabel: task.description,
          enabled: false
        });
      }

      taskMenuItems.push({
        label: 'Pause All Tasks',
        click: () => backgroundTaskSupervisor.pauseAllTasks()
      });
      taskMenuItems.push({
        label: 'Resume All Tasks',
        click: () => backgroundTaskSupervisor.resumeAllTasks()
      });
    } else {
      taskMenuItems.push({
        label: 'No background tasks running',
        enabled: false
      });
    }

    const template: Array<Record<string, unknown>> = [
      {
        label: 'Ty-Code - Antigravity IDE',
        enabled: false
      },
      {
        label: fleetSummaryText,
        enabled: false
      },
      { type: 'separator' },
      {
        label: 'Open Quick Chat',
        accelerator: 'CommandOrControl+Shift+Space',
        click: () => this.showQuickChat()
      },
      { type: 'separator' },
      {
        label: 'Background Tasks',
        submenu: taskMenuItems
      },
      {
        label: 'Run in Background (Keep active on window close)',
        type: 'checkbox',
        checked: backgroundTaskSupervisor.isRunInBackgroundEnabled(),
        click: (menuItem: MenuItem) => {
          backgroundTaskSupervisor.setRunInBackground(menuItem.checked);
        }
      },
      { type: 'separator' },
      {
        label: 'Open Ty-Code Window',
        click: () => {
          if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.show();
            this.mainWindow.focus();
          }
        }
      },
      {
        label: 'Quit Ty-Code',
        click: () => {
          app.quit();
        }
      }
    ];

    return template;
  }

  public updateMenu(): void {
    if (!this.tray) return;

    try {
      if (Menu && typeof Menu.buildFromTemplate === 'function') {
        const template = this.buildMenuTemplate() as any;
        const contextMenu = Menu.buildFromTemplate(template);
        this.tray.setContextMenu(contextMenu);
      }
    } catch {
      // non-blocking
    }
  }

  public destroy(): void {
    if (this.tray) {
      try {
        this.tray.destroy();
      } catch {
        // non-blocking
      }
      this.tray = null;
    }
    this.isInitialized = false;
  }
}

export const trayManager = TrayManager.getInstance();
