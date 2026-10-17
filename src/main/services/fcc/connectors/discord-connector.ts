/**
 * Discord Messaging Connector (Phase FCC-5)
 *
 * Exposes chat-with-your-workspace via a dedicated Discord bot:
 * - Toggleable module (default OFF)
 * - Token setup (Discord Developer Bot token)
 * - Allowlisted Discord user IDs / usernames
 * - Per-minute sliding window rate caps
 * - Full audit logging
 *
 * Brand: Ty-Code
 */

import { BaseConnector } from './base-connector';
import type { ConnectorType } from './types';

export class DiscordConnector extends BaseConnector {
  private static instance: DiscordConnector | null = null;
  public readonly connectorType: ConnectorType = 'discord';
  public readonly displayName = 'Discord Bot';

  public static getInstance(): DiscordConnector {
    if (!DiscordConnector.instance) {
      DiscordConnector.instance = new DiscordConnector();
    }
    return DiscordConnector.instance;
  }

  public async start(): Promise<boolean> {
    if (!this.config.enabled || !this.config.botToken) {
      this.isConnected = false;
      return false;
    }

    try {
      // Authenticate Discord bot via /users/@me
      const botInfo = await this.callDiscordApi('users/@me');
      if (botInfo && botInfo.id) {
        this.isConnected = true;
        this.botUsername = botInfo.username;
        this.lastError = undefined;
        return true;
      } else {
        this.isConnected = false;
        this.lastError = botInfo?.message || 'Failed to authenticate Discord bot token';
        return false;
      }
    } catch (err: unknown) {
      this.isConnected = false;
      this.lastError = err instanceof Error ? err.message : String(err);
      return false;
    }
  }

  public async stop(): Promise<void> {
    this.isConnected = false;
  }

  /**
   * Dispatches messages received via Discord gateway or webhook
   */
  public async processMessage(event: {
    author: { id: string; username?: string; bot?: boolean };
    content: string;
    channel_id: string;
    id: string;
  }): Promise<void> {
    if (!event || !event.author || event.author.bot) return;

    const senderId = event.author.id;
    const senderUsername = event.author.username;
    const text = event.content || '';
    const channelId = event.channel_id;

    if (!text || !senderId || !channelId) return;

    const response = await this.handleIncomingMessage(senderId, senderUsername, text, channelId);

    // Send reply to Discord channel
    try {
      await this.callDiscordApi(`channels/${channelId}/messages`, 'POST', {
        content: response.text,
        message_reference: { message_id: event.id }
      });
    } catch {
      // non-blocking
    }
  }

  /**
   * Helper to invoke Discord REST API
   */
  public async callDiscordApi(endpoint: string, method: 'GET' | 'POST' = 'GET', body?: Record<string, unknown>): Promise<any> {
    if (!this.config.botToken) return null;

    const url = `https://discord.com/api/v10/${endpoint}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bot ${this.config.botToken}`,
          'Content-Type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      return await response.json();
    } catch (err: unknown) {
      if (err instanceof Error && err.name === 'AbortError') {
        throw new Error('Discord API request timed out');
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

export const discordConnector = DiscordConnector.getInstance();
