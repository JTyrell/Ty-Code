/**
 * Connector Audit Logger (Phase FCC-5)
 *
 * Records audit logs for Telegram and Discord connector interactions:
 * - Logs all incoming requests
 * - Tracks allowlist acceptances & rejections (DENY_ALLOWLIST)
 * - Tracks rate cap rejections (DENY_RATE_LIMIT)
 * - Persists entries locally for workspace security auditing
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import type { ConnectorAuditLogEntry, ConnectorType } from './types';

export class ConnectorAuditLogger {
  private static instance: ConnectorAuditLogger | null = null;
  private entries: ConnectorAuditLogEntry[] = [];
  private readonly maxEntries = 1000;
  private isLoaded = false;
  private logFilePath: string;

  public static getInstance(): ConnectorAuditLogger {
    if (!ConnectorAuditLogger.instance) {
      ConnectorAuditLogger.instance = new ConnectorAuditLogger();
    }
    return ConnectorAuditLogger.instance;
  }

  constructor() {
    this.logFilePath = path.join(os.homedir(), '.ty-claude', 'connector-audit.json');
  }

  public setLogFilePath(filePath: string): void {
    this.logFilePath = filePath;
  }

  public async load(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const raw = await fs.readFile(this.logFilePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        this.entries = data.slice(-this.maxEntries);
      }
    } catch {
      this.entries = [];
    } finally {
      this.isLoaded = true;
    }
  }

  public async record(entry: Omit<ConnectorAuditLogEntry, 'id' | 'timestamp'>): Promise<ConnectorAuditLogEntry> {
    await this.load();

    const fullEntry: ConnectorAuditLogEntry = {
      ...entry,
      id: `audit_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`,
      timestamp: Date.now()
    };

    this.entries.push(fullEntry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    void this.persist();
    return fullEntry;
  }

  private async persist(): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.logFilePath), { recursive: true });
      await fs.writeFile(this.logFilePath, JSON.stringify(this.entries, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
    } catch {
      // non-blocking
    }
  }

  public getEntries(limit = 100, connectorType?: ConnectorType): ConnectorAuditLogEntry[] {
    let list = this.entries;
    if (connectorType) {
      list = list.filter((e) => e.connectorType === connectorType);
    }
    return [...list].reverse().slice(0, limit);
  }

  public clear(): void {
    this.entries = [];
    void this.persist();
  }
}

export const connectorAuditLogger = ConnectorAuditLogger.getInstance();
