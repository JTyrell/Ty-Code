/**
 * Ty-Code Desktop IDE - Marketplace Types
 * Defines data contracts for Open VSX marketplace client, disk cache, and installer pipeline.
 */

export type ExtensionInstallState = 'uninstalled' | 'installing' | 'installed' | 'error';
export type ExtensionEnabledState = 'enabled' | 'disabled';

export type InstallStep = 'download' | 'validation' | 'extraction' | 'registration';

export interface MarketplaceExtensionEntry {
  id: string;
  namespace: string;
  displayName: string;
  shortDescription: string;
  version: string;
  downloadCount: number;
  publisher: string;
  iconUrl?: string;
  installedState: ExtensionInstallState;
  enabledState: ExtensionEnabledState;
  // Aliases for compatibility
  name?: string;
  description?: string;
  // Extended fields
  downloadUrl?: string;
  sha256?: string;
  rating?: number;
  categories?: string[];
  readmeUrl?: string;
  repository?: string;
  publishedDate?: string;
  errorMessage?: string;
  failedStep?: InstallStep;
}

export interface MarketplaceSearchOptions {
  query?: string;
  size?: number;
  sortBy?: 'relevance' | 'downloadCount' | 'rating' | 'timestamp';
  sortOrder?: 'desc' | 'asc';
  forceRefresh?: boolean;
}

export interface MarketplaceSearchResult {
  extensions: MarketplaceExtensionEntry[];
  totalSize: number;
  isOfflineCache: boolean;
  offlineMessage?: string;
  rateLimited?: boolean;
  retryAfterSec?: number;
}

export interface InstallProgressEvent {
  id: string;
  step: InstallStep;
  percent?: number;
  message?: string;
}

export interface InstallResult {
  success: boolean;
  id: string;
  installedExtension?: unknown;
  error?: string;
  failedStep?: InstallStep;
  canRetry?: boolean;
}
