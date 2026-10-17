/**
 * Messaging Connectors Types (Phase FCC-5)
 *
 * Types for Telegram & Discord chat-with-your-workspace connectors
 * powered by Ty-Code's managed free model fleet.
 *
 * Brand: Ty-Code
 */

export type ConnectorType = 'telegram' | 'discord';

export interface MessagingConnectorConfig {
  enabled: boolean;
  botToken: string;
  allowlistedUserIds: string[];
  rateCapPerMinute: number;
  workspaceContextEnabled: boolean;
  workspacePath?: string;
  preferredModel?: string;
}

export type ConnectorAuditAction = 'ALLOW' | 'DENY_ALLOWLIST' | 'DENY_RATE_LIMIT' | 'ERROR';

export interface ConnectorAuditLogEntry {
  id: string;
  timestamp: number;
  connectorType: ConnectorType;
  senderId: string;
  senderUsername?: string;
  action: ConnectorAuditAction;
  promptSnippet: string;
  responseSnippet?: string;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}

export interface ConnectorStatus {
  type: ConnectorType;
  enabled: boolean;
  connected: boolean;
  botUsername?: string;
  allowlistedCount: number;
  rateCapPerMinute: number;
  requestsHandled: number;
  requestsDenied: number;
  lastActive?: number;
  lastError?: string;
}

export interface MessagingResponse {
  success: boolean;
  text: string;
  action: ConnectorAuditAction;
  tokensUsed?: number;
  latencyMs?: number;
  error?: string;
}
