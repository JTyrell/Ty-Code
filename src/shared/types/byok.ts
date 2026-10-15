/**
 * Bring Your Own Key (BYOK) & Key Management Types (Phase 6.2)
 *
 * Provides type contracts for:
 * 1. Step-by-Step BYOK Setup Wizard
 * 2. Visual Provider Cards & Quick Actions
 * 3. Advanced Manual JSON Configuration
 * 4. Secure Key Management (safeStorage encryption, eye toggle, revoke, export/import)
 * 5. Automatic Key Detection (Env vars, Git credentials, config files, local instances)
 *
 * Brand: Ty-Code
 */

export type KeyDetectionSource =
  | 'env'
  | 'git_credential'
  | 'config_file'
  | 'browser_token'
  | 'local_instance';

export interface DetectedApiKey {
  id: string;
  providerId: string;
  providerName: string;
  source: KeyDetectionSource;
  sourceDescription: string;
  maskedKey: string;
  rawKey?: string;
  endpoint?: string;
  isLocalInstance?: boolean;
  modelCount?: number;
}

export interface CustomProviderConfig {
  id: string;
  name: string;
  baseUrl: string;
  apiKey?: string;
  authHeader?: string;
  customHeaders?: Record<string, string>;
  models?: string[];
  defaultModel?: string;
  notes?: string;
}

export interface StoredKeySummary {
  providerId: string;
  providerName: string;
  isConfigured: boolean;
  maskedKey?: string;
  endpoint?: string;
  setupUrl?: string;
  lastUpdated?: number;
  supportsRegenerate?: boolean;
  isFreeTierAvailable?: boolean;
  freeModelCount?: number;
}

export interface ByokExportBundle {
  version: 1;
  exportedAt: number;
  brand: 'Ty-Code';
  encryptedPayload: string; // safeStorage or passphrase protected base64
  providerCount: number;
}

export interface ByokImportResult {
  importedCount: number;
  updatedProviders: string[];
  failedProviders?: string[];
}
