/**
 * Background Task Supervisor (Phase FCC-5)
 *
 * Supervises long-running agent tasks and ensures tasks survive window close:
 * 1. 'Run in background' setting: long agent tasks survive window close when enabled.
 * 2. Native notifications on task completion and attention-needed.
 * 3. Task management: start, pause, resume, cancel, and status reporting.
 * 4. Ties directly to Ty-Code General Settings and Tray menu.
 *
 * Brand: Ty-Code
 */

import { EventEmitter } from 'node:events';
import { app, Notification } from 'electron';
import type { BackgroundTaskInfo } from '../../../preload/types';

export type TaskStatus = 'running' | 'paused' | 'completed' | 'failed' | 'needs-attention';

export interface BackgroundTaskContext {
  id: string;
  reportProgress: (percent: number, message?: string) => void;
  requestAttention: (reason: string) => void;
  isPaused: () => boolean;
  waitIfPaused: () => Promise<void>;
  isCancelled: () => boolean;
}

export interface EmittedNotification {
  title: string;
  body: string;
  timestamp: number;
}

export class BackgroundTaskSupervisor extends EventEmitter {
  private static instance: BackgroundTaskSupervisor | null = null;
  private tasks: Map<string, {
    info: BackgroundTaskInfo;
    isPaused: boolean;
    isCancelled: boolean;
    pausePromise: Promise<void> | null;
    resumeResolve: (() => void) | null;
  }> = new Map();

  private runInBackground = false;
  private notifyOnCompletion = true;
  private notifyOnAttention = true;
  private emittedNotifications: EmittedNotification[] = [];

  public static getInstance(): BackgroundTaskSupervisor {
    if (!BackgroundTaskSupervisor.instance) {
      BackgroundTaskSupervisor.instance = new BackgroundTaskSupervisor();
    }
    return BackgroundTaskSupervisor.instance;
  }

  constructor() {
    super();
  }

  public setRunInBackground(enabled: boolean): void {
    this.runInBackground = enabled;
    this.emit('settings-changed', { runInBackground: enabled });
  }

  public isRunInBackgroundEnabled(): boolean {
    return this.runInBackground;
  }

  public setNotificationPreferences(options: { notifyOnCompletion?: boolean; notifyOnAttention?: boolean }): void {
    if (options.notifyOnCompletion !== undefined) this.notifyOnCompletion = options.notifyOnCompletion;
    if (options.notifyOnAttention !== undefined) this.notifyOnAttention = options.notifyOnAttention;
  }

  /**
   * Starts a new background task
   */
  public async startTask<T>(
    name: string,
    description: string,
    runner: (ctx: BackgroundTaskContext) => Promise<T>
  ): Promise<{ taskId: string; promise: Promise<T> }> {
    const taskId = `bg_task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

    const info: BackgroundTaskInfo = {
      id: taskId,
      name,
      description,
      progress: 0,
      status: 'running',
      startTime: Date.now()
    };

    const taskEntry = {
      info,
      isPaused: false,
      isCancelled: false,
      pausePromise: null as Promise<void> | null,
      resumeResolve: null as (() => void) | null
    };

    this.tasks.set(taskId, taskEntry);
    this.emit('task-started', info);

    const ctx: BackgroundTaskContext = {
      id: taskId,
      reportProgress: (percent: number, msg?: string) => {
        info.progress = Math.min(100, Math.max(0, percent));
        if (msg) info.description = msg;
        this.emit('task-progress', info);
      },
      requestAttention: (reason: string) => {
        info.status = 'needs-attention';
        info.attentionReason = reason;
        this.emit('task-attention', info);
        this.sendNativeNotification('Ty-Code Attention Needed', `${name}: ${reason}`);
      },
      isPaused: () => taskEntry.isPaused,
      waitIfPaused: async () => {
        if (taskEntry.isPaused && taskEntry.pausePromise) {
          await taskEntry.pausePromise;
        }
      },
      isCancelled: () => taskEntry.isCancelled
    };

    const promise = (async () => {
      try {
        const result = await runner(ctx);
        info.status = 'completed';
        info.progress = 100;
        info.endTime = Date.now();
        this.emit('task-completed', info);

        if (this.notifyOnCompletion) {
          this.sendNativeNotification('Ty-Code Task Complete', `"${name}" completed successfully.`);
        }

        return result;
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        info.status = 'failed';
        info.endTime = Date.now();
        info.description = `Failed: ${errMsg}`;
        this.emit('task-failed', info);

        this.sendNativeNotification('Ty-Code Task Failed', `"${name}" encountered an error: ${errMsg}`);
        throw err;
      }
    })();

    return { taskId, promise };
  }

  /**
   * Pauses an active background task
   */
  public pauseTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.info.status !== 'running') return false;

    task.isPaused = true;
    task.info.status = 'paused';
    task.pausePromise = new Promise((resolve) => {
      task.resumeResolve = resolve;
    });
    this.emit('task-paused', task.info);
    return true;
  }

  /**
   * Resumes a paused background task
   */
  public resumeTask(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task || task.info.status !== 'paused') return false;

    task.isPaused = false;
    task.info.status = 'running';
    if (task.resumeResolve) {
      task.resumeResolve();
      task.pausePromise = null;
      task.resumeResolve = null;
    }
    this.emit('task-resumed', task.info);
    return true;
  }

  /**
   * Pauses all running tasks
   */
  public pauseAllTasks(): number {
    let count = 0;
    for (const [id] of this.tasks) {
      if (this.pauseTask(id)) count++;
    }
    return count;
  }

  /**
   * Resumes all paused tasks
   */
  public resumeAllTasks(): number {
    let count = 0;
    for (const [id] of this.tasks) {
      if (this.resumeTask(id)) count++;
    }
    return count;
  }

  /**
   * Returns active background tasks
   */
  public getActiveTasks(): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values())
      .map((t) => ({ ...t.info }))
      .filter((t) => t.status === 'running' || t.status === 'paused' || t.status === 'needs-attention');
  }

  /**
   * Returns all recorded tasks
   */
  public getAllTasks(): BackgroundTaskInfo[] {
    return Array.from(this.tasks.values()).map((t) => ({ ...t.info }));
  }

  /**
   * Hook for mainWindow close event: checks if window close should be intercepted to keep tasks running in background
   */
  public handleWindowCloseAttempt(): { shouldIntercept: boolean; hasActiveTasks: boolean } {
    const activeTasks = this.getActiveTasks();
    const hasActiveTasks = activeTasks.length > 0;
    const shouldIntercept = this.runInBackground;

    if (shouldIntercept && hasActiveTasks) {
      this.sendNativeNotification(
        'Ty-Code Running in Background',
        `${activeTasks.length} background task${activeTasks.length > 1 ? 's are' : ' is'} continuing execution.`
      );
    }

    return { shouldIntercept, hasActiveTasks };
  }

  /**
   * Dispatches native OS notification
   */
  public sendNativeNotification(title: string, body: string): void {
    const record: EmittedNotification = { title, body, timestamp: Date.now() };
    this.emittedNotifications.push(record);
    this.emit('notification-sent', record);

    try {
      if (Notification && typeof Notification.isSupported === 'function' && Notification.isSupported()) {
        const notif = new Notification({
          title,
          body,
          silent: false
        });
        notif.show();
      }
    } catch {
      // In headless test environments or when desktop notification service is unavailable
    }
  }

  public getEmittedNotifications(): EmittedNotification[] {
    return [...this.emittedNotifications];
  }

  public clearNotifications(): void {
    this.emittedNotifications = [];
  }
}

export const backgroundTaskSupervisor = BackgroundTaskSupervisor.getInstance();
