import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import type { TelemetryEvent, TelemetryFeature, TelemetryPreview } from '../../preload/types';
import type { SettingsManager } from './settings-manager';

const MAX_QUEUE_BYTES = 5 * 1024 * 1024;
const MAX_EVENT_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const STORAGE_PREFIX = 'electron_safe_storage_v1:';
const ALLOWED_FEATURES = new Set<TelemetryFeature>(['agent_chat', 'project_index', 'history_export']);
type TelemetryEventInput = { event: 'app_started' } | { event: 'feature_used'; feature: TelemetryFeature };
type SafeStorageAdapter = Pick<typeof safeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'>;

function secureStorageAvailable(storage: SafeStorageAdapter, platform: NodeJS.Platform): boolean {
  let backendIsSecure = true;
  if (platform === 'linux') {
    const backend = storage.getSelectedStorageBackend();
    backendIsSecure = backend !== 'basic_text' && backend !== 'unknown';
  }
  return backendIsSecure && storage.isEncryptionAvailable();
}

function isTelemetryEvent(value: unknown): value is TelemetryEvent {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  const timestampIsValid = typeof event.timestamp === 'string'
    && Number.isFinite(Date.parse(event.timestamp));
  if (!timestampIsValid) return false;
  if (event.event === 'app_started') return Object.keys(event).length === 2;
  return event.event === 'feature_used'
    && Object.keys(event).length === 3
    && typeof event.feature === 'string'
    && ALLOWED_FEATURES.has(event.feature as TelemetryFeature);
}

function encryptedSize(events: TelemetryEvent[], storage: SafeStorageAdapter): number {
  const encrypted = storage.encryptString(JSON.stringify(events)).toString('base64');
  return Buffer.byteLength(`${STORAGE_PREFIX}${encrypted}`, 'utf8');
}

function fitQueueToLimit(events: TelemetryEvent[], storage: SafeStorageAdapter): TelemetryEvent[] {
  const oldestFirst = [...events].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  let low = 0;
  let high = oldestFirst.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (encryptedSize(oldestFirst.slice(middle), storage) <= MAX_QUEUE_BYTES) high = middle;
    else low = middle + 1;
  }
  return oldestFirst.slice(low);
}

/** Stores only fixed, content-free diagnostic events, encrypted on this device. No sender exists. */
export class TelemetryManager {
  private readonly events = new EventEmitter();
  private queue: TelemetryEvent[] = [];
  private loaded = false;
  private writeChain: Promise<void> = Promise.resolve();
  private storageError = '';
  private clearGeneration = 0;
  private expiryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly unsubscribeSettings: () => void;

  constructor(
    private readonly settingsManager: Pick<SettingsManager, 'getEffectiveSettings' | 'onDidChange'>,
    private readonly filePath: string,
    private readonly storage: SafeStorageAdapter = safeStorage,
    private readonly platform: NodeJS.Platform = process.platform
  ) {
    this.unsubscribeSettings = settingsManager.onDidChange(() => {
      void this.clearWhenDisabled().catch((error: unknown) => {
        this.storageError = error instanceof Error ? error.message : 'Could not purge telemetry after opt-out.';
        this.events.emit('change');
      });
    });
  }

  public onDidChange(listener: () => void): () => void {
    this.events.on('change', listener);
    return () => this.events.off('change', listener);
  }

  public async recordAppStarted(): Promise<void> {
    await this.record({ event: 'app_started' });
  }

  public async recordFeatureUsed(feature: TelemetryFeature): Promise<void> {
    if (!ALLOWED_FEATURES.has(feature)) return;
    await this.record({ event: 'feature_used', feature });
  }

  public async getPreview(): Promise<TelemetryPreview> {
    const settings = await this.settingsManager.getEffectiveSettings();
    const storageAvailable = secureStorageAvailable(this.storage, this.platform);
    if (!settings.telemetry.enabled) {
      await this.clearData();
      return this.toPreview(false, storageAvailable, []);
    }
    if (!storageAvailable) {
      return this.toPreview(true, false, []);
    }
    await this.load();
    return this.toPreview(true, true, this.queue);
  }

  public async deleteEvent(index: number, expected: TelemetryEvent): Promise<void> {
    const settings = await this.settingsManager.getEffectiveSettings();
    if (!settings.telemetry.enabled) throw new Error('Telemetry recording is off.');
    await this.load();
    const current = this.queue[index];
    if (!Number.isInteger(index) || !current || JSON.stringify(current) !== JSON.stringify(expected)) {
      throw new Error('Telemetry event changed. Refresh the event list before deleting it.');
    }
    const previous = this.queue;
    this.queue = this.queue.filter((_, eventIndex) => eventIndex !== index);
    try {
      await this.persist();
    } catch (error) {
      this.queue = previous;
      throw error;
    }
    this.scheduleExpiry();
    this.events.emit('change');
  }

  public async clearData(): Promise<void> {
    this.clearGeneration++;
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    const hadQueue = this.queue.length > 0;
    const hadFile = await fs.stat(this.filePath).then(() => true).catch(() => false);
    this.queue = [];
    this.loaded = true;
    this.storageError = '';
    await this.writeChain.catch(() => undefined);
    await fs.rm(this.filePath, { force: true });
    if (hadQueue || hadFile) this.events.emit('change');
  }

  public dispose(): void {
    this.unsubscribeSettings();
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    this.expiryTimer = null;
    this.events.removeAllListeners();
  }

  private toPreview(recordingEnabled: boolean, storageAvailable: boolean, events: TelemetryEvent[]): TelemetryPreview {
    const storageMessage = storageAvailable
      ? 'Encrypted local event storage is available.'
      : 'Encrypted local event storage is unavailable. Configure the operating-system credential store to record telemetry.';
    return {
      recordingEnabled,
      storageAvailable,
      storageMessage,
      ...(this.storageError ? { storageError: this.storageError } : {}),
      destinationConfigured: false,
      queuedCount: events.length,
      sentCount: 0,
      failedCount: 0,
      transmittedEvents: 0,
      events: events.map((event) => ({ ...event }))
    };
  }

  private async record(event: TelemetryEventInput): Promise<void> {
    try {
      const generation = this.clearGeneration;
      const settings = await this.settingsManager.getEffectiveSettings();
      if (generation !== this.clearGeneration) return;
      if (!settings.telemetry.enabled) {
        await this.clearData();
        return;
      }
      if (!secureStorageAvailable(this.storage, this.platform)) return;
      await this.load();
      if (generation !== this.clearGeneration) return;
      const previous = this.queue;
      const cutoff = Date.now() - MAX_EVENT_AGE_MS;
      const next = [...this.queue, { ...event, timestamp: new Date().toISOString() } as TelemetryEvent]
        .filter((item) => Date.parse(item.timestamp) >= cutoff);
      this.queue = fitQueueToLimit(next, this.storage);
      try {
        await this.persist(generation);
      } catch (error) {
        this.queue = previous;
        throw error;
      }
      this.storageError = '';
      this.scheduleExpiry();
      this.events.emit('change');
    } catch (error) {
      this.storageError = error instanceof Error ? error.message : 'Could not persist encrypted telemetry data.';
      this.events.emit('change');
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    if (!secureStorageAvailable(this.storage, this.platform)) return;
    try {
      const stored = await fs.readFile(this.filePath, 'utf8');
      if (!stored.startsWith(STORAGE_PREFIX)) throw new Error('Telemetry file is not in the encrypted format.');
      const plaintext = this.storage.decryptString(Buffer.from(stored.slice(STORAGE_PREFIX.length), 'base64'));
      const raw: unknown = JSON.parse(plaintext);
      if (!Array.isArray(raw)) throw new Error('Telemetry queue has an invalid format.');
      const originalSnapshot = JSON.stringify(raw);
      const cutoff = Date.now() - MAX_EVENT_AGE_MS;
      this.queue = raw.filter(isTelemetryEvent)
        .filter((event) => Date.parse(event.timestamp) >= cutoff);
      this.queue = fitQueueToLimit(this.queue, this.storage);
      if (JSON.stringify(this.queue) !== originalSnapshot) await this.persist();
      this.scheduleExpiry();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.queue = [];
        await fs.rm(this.filePath, { force: true }).catch(() => undefined);
        this.storageError = error instanceof Error ? error.message : 'Could not read encrypted telemetry data.';
      }
    }
  }

  private async persist(expectedGeneration = this.clearGeneration): Promise<void> {
    this.writeChain = this.writeChain.catch(() => undefined).then(async () => {
      const settings = await this.settingsManager.getEffectiveSettings();
      if (expectedGeneration !== this.clearGeneration) {
        await fs.rm(this.filePath, { force: true });
        return;
      }
      if (!settings.telemetry.enabled || !secureStorageAvailable(this.storage, this.platform)) {
        this.queue = [];
        await fs.rm(this.filePath, { force: true });
        return;
      }
      const encrypted = this.storage.encryptString(JSON.stringify(this.queue)).toString('base64');
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      try {
        await fs.writeFile(temporaryPath, `${STORAGE_PREFIX}${encrypted}`, { encoding: 'utf8', mode: 0o600 });
        await fs.rename(temporaryPath, this.filePath);
      } catch (error) {
        await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
        throw error;
      }
    });
    await this.writeChain;
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.queue.length === 0) {
      this.expiryTimer = null;
      return;
    }
    const nextExpiry = Math.min(...this.queue.map((event) => Date.parse(event.timestamp) + MAX_EVENT_AGE_MS));
    this.expiryTimer = setTimeout(() => {
      this.expiryTimer = null;
      void this.removeExpiredEvents().catch((error: unknown) => {
        this.storageError = error instanceof Error ? error.message : 'Could not remove expired telemetry events.';
        this.events.emit('change');
      });
    }, Math.min(MAX_TIMER_DELAY_MS, Math.max(1, nextExpiry - Date.now() + 1)));
    this.expiryTimer.unref?.();
  }

  private async removeExpiredEvents(): Promise<void> {
    const settings = await this.settingsManager.getEffectiveSettings();
    if (!settings.telemetry.enabled) return;
    await this.load();
    const cutoff = Date.now() - MAX_EVENT_AGE_MS;
    const retained = this.queue.filter((event) => Date.parse(event.timestamp) >= cutoff);
    if (retained.length === this.queue.length) {
      this.scheduleExpiry();
      return;
    }
    this.queue = retained;
    await this.persist();
    this.scheduleExpiry();
    this.events.emit('change');
  }

  private async clearWhenDisabled(): Promise<void> {
    const settings = await this.settingsManager.getEffectiveSettings();
    if (settings.telemetry.enabled) return;
    await this.clearData();
  }
}
