/**
 * Telegram Messaging Connector (Phase FCC-5)
 *
 * Exposes chat-with-your-workspace via a dedicated Telegram bot:
 * - Toggleable module (default OFF)
 * - Token setup (BotFather bot token)
 * - Allowlisted user IDs / usernames
 * - Per-minute sliding window rate caps
 * - Full audit logging
 *
 * Brand: Ty-Code
 */

import { BaseConnector } from './base-connector';
import type { ConnectorType } from './types';

export class TelegramConnector extends BaseConnector {
  private static instance: TelegramConnector | null = null;
  public readonly connectorType: ConnectorType = 'telegram';
  public readonly displayName = 'Telegram Bot';
  private pollingTimer: NodeJS.Timeout | null = null;
  private lastUpdateId = 0;

  public static getInstance(): TelegramConnector {
    if (!TelegramConnector.instance) {
      TelegramConnector.instance = new TelegramConnector();
    }
    return TelegramConnector.instance;
  }

  public async start(): Promise<boolean> {
    if (!this.config.enabled || !this.config.botToken) {
      this.isConnected = false;
      return false;
    }

    try {
      // Test bot token and fetch bot info via Telegram getMe API
      const botInfo = await this.callTelegramApi('getMe');
      if (botInfo && botInfo.ok && botInfo.result) {
        this.isConnected = true;
        this.botUsername = botInfo.result.username;
        this.lastError = undefined;

        // Start polling for updates if token is active
        this.startPolling();
        return true;
      } else {
        this.isConnected = false;
        this.lastError = botInfo?.description || 'Failed to authenticate Telegram bot token';
        return false;
      }
    } catch (err: unknown) {
      this.isConnected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  public async stop(): Promise<void> {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.isConnected = false;
  }

  /**
   * Dispatches updates received via polling or webhooks
   */
  public async processUpdate(update: any): Promise<void> {
    if (!update || !update.message) return;
    const msg = update.message;
    const senderId = String(msg.from?.id || '');
    const senderUsername = msg.from?.username;
    const text = msg.text || '';
    const chatId = msg.chat?.id;

    if (!text || !senderId || !chatId) return;

    const response = await this.handleIncomingMessage(senderId, senderUsername, text, String(chatId));

    // Send reply back to Telegram chat
    try {
      await this.callTelegramApi('sendMessage', {
        chat_id: chatId,
        text: response.text,
        reply_to_message_id: msg.message_id
      });
    } catch {
      // non-blocking
    }
  }

  private startPolling(): void {
    if (this.pollingTimer) clearInterval(this.pollingTimer);

    // Poll every 3 seconds
    this.pollingTimer = setInterval(async () => {
      if (!this.isConnected || !this.config.enabled) return;
      try {
        const res = await this.callTelegramApi('getUpdates', {
          offset: this.lastUpdateId + 1,
          timeout: 2,
          limit: 10
        });

        if (res && res.ok && Array.isArray(res.result)) {
          for (const update of res.result) {
            this.lastUpdateId = Math.max(this.lastUpdateId, update.update_id);
            await this.processUpdate(update);
          }
        }
      } catch {
        // Polling retry
      }
    }, 3000);
  }

  /**
   * Helper to invoke Telegram Bot API methods
   */
  public async callTelegramApi(method: string, body?: Record<string, unknown>): Promise<any> {
    if (!this.config.botToken) return null;

    const url = `https://api.telegram.org/bot${this.config.botToken}/${method}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method: body ? 'POST' : 'GET',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      return await response.json();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Telegram API request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const telegramConnector = TelegramConnector.getInstance();
