/**
 * Messaging Connector Manager (Phase FCC-5)
 *
 * Coordinates Telegram and Discord connectors:
 * - Load/save configuration
 * - Enable/disable toggles
 * - Retrieve real-time status
 * - Query audit logs
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { telegramConnector } from './telegram-connector';
import { discordConnector } from './discord-connector';
import { connectorAuditLogger } from './audit-logger';
import type {
  ConnectorAuditLogEntry,
  ConnectorStatus,
  ConnectorType,
  MessagingConnectorConfig
} from './types';

export interface ConnectorsOverview {
  telegram: ConnectorStatus;
  discord: ConnectorStatus;
  recentAuditLogs: ConnectorAuditLogEntry[];
}

export class ConnectorManager {
  private static instance: ConnectorManager | null = null;
  private configFile: string;
  private isLoaded = false;

  public static getInstance(): ConnectorManager {
    if (!ConnectorManager.instance) {
      ConnectorManager.instance = new ConnectorManager();
    }
    return ConnectorManager.instance;
  }

  constructor() {
    this.configFile = path.join(os.homedir(), '.ty-claude', 'connectors-config.json');
  }

  public setConfigFile(filePath: string): void {
    this.configFile = filePath;
  }

  public async load(): Promise<void> {
    if (this.isLoaded) return;
    try {
      const raw = await fs.readFile(this.configFile, 'utf8');
      const data = JSON.parse(raw);
      if (data.telegram) {
        telegramConnector.setConfig(data.telegram);
        if (data.telegram.enabled) void telegramConnector.start();
      }
      if (data.discord) {
        discordConnector.setConfig(data.discord);
        if (data.discord.enabled) void discordConnector.start();
      }
    } catch {
      // defaults: both connectors disabled
    } finally {
      this.isLoaded = true;
    }
  }

  public async saveConfig(
    type: ConnectorType,
    config: Partial<MessagingConnectorConfig>
  ): Promise<boolean> {
    await this.load();

    const connector = type === 'telegram' ? telegramConnector : discordConnector;
    connector.setConfig(config);

    if (config.enabled !== undefined) {
      if (config.enabled) {
        await connector.start();
      } else {
        await connector.stop();
      }
    }

    try {
      await fs.mkdir(path.dirname(this.configFile), { recursive: true });
      const fullConfig = {
        telegram: telegramConnector.getConfig(),
        discord: discordConnector.getConfig(),
        updatedAt: Date.now()
      };
      await fs.writeFile(this.configFile, JSON.stringify(fullConfig, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      });
      return true;
    } catch {
      return false;
    }
  }

  public getStatus(type: ConnectorType): ConnectorStatus {
    return type === 'telegram' ? telegramConnector.getStatus() : discordConnector.getStatus();
  }

  public getOverview(): ConnectorsOverview {
    return {
      telegram: telegramConnector.getStatus(),
      discord: discordConnector.getStatus(),
      recentAuditLogs: connectorAuditLogger.getEntries(50)
    };
  }

  public getAuditLogs(limit = 100, type?: ConnectorType): ConnectorAuditLogEntry[] {
    return connectorAuditLogger.getEntries(limit, type);
  }
}

export const connectorManager = ConnectorManager.getInstance();
