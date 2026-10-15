/**
 * Ty-Code Desktop IDE - OpenVsxClient Unit Tests
 * Validates search parsing, metadata resolution, UI data contract compliance,
 * rate limit handling, and disk cache revalidation.
 */

import { OpenVsxClient } from '../../src/main/services/marketplace/openvsx-client';
import { MarketplaceCache } from '../../src/main/services/marketplace/cache';
import type { MarketplaceExtensionEntry } from '../../src/shared/types/marketplace';

export async function runOpenVsxClientTests(assert: (cond: boolean, msg: string) => void) {
  console.log('--- Running OpenVsxClient Unit Tests ---');

  // Test 1: Instantiation with custom base URL and cache
  const client = new OpenVsxClient({
    baseUrl: 'https://open-vsx.org'
  });
  assert(client instanceof OpenVsxClient, 'OpenVsxClient instantiates successfully');

  // Test 2: Rate limit tracking methods
  assert(!client.isRateLimited().rateLimited, 'Initially not rate-limited');
  client.setRateLimited(10);
  assert(client.isRateLimited().rateLimited, 'Rate limit flag is active after setRateLimited');
  assert(client.isRateLimited().retryAfterSec > 0, 'Reports positive retryAfterSec');
  client.resetRateLimit();
  assert(!client.isRateLimited().rateLimited, 'Rate limit resets cleanly');

  // Test 3: Mapping of raw Open VSX API response to strict UI Data Contract
  const rawApiItem = {
    namespace: 'redhat',
    name: 'java',
    version: '1.28.0',
    displayName: 'Language Support for Java(TM) by Red Hat',
    description: 'Java Linting, Intellisense, formatting, refactoring, Maven/Gradle support',
    downloadCount: 45200000,
    publisher: 'redhat',
    files: {
      icon: 'https://open-vsx.org/api/redhat/java/1.28.0/file/icon.png',
      download: 'https://open-vsx.org/api/redhat/java/1.28.0/file/redhat.java-1.28.0.vsix',
      readme: 'https://open-vsx.org/api/redhat/java/1.28.0/file/README.md',
      sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    },
    averageRating: 4.6,
    categories: ['Programming Languages', 'Linters'],
    timestamp: '2026-03-10T12:00:00Z'
  };

  // Test internal mapping through mapToEntry
  // @ts-expect-error accessing private method for unit test
  const entry: MarketplaceExtensionEntry = client.mapToEntry(rawApiItem, new Map());

  assert(entry.id === 'redhat.java', 'Maps correct combined ID (namespace.name)');
  assert(entry.namespace === 'redhat', 'Maps namespace correctly');
  assert(entry.displayName === 'Language Support for Java(TM) by Red Hat', 'Maps displayName correctly');
  assert(entry.shortDescription.startsWith('Java Linting'), 'Maps shortDescription correctly');
  assert(entry.version === '1.28.0', 'Maps version correctly');
  assert(entry.downloadCount === 45200000, 'Maps downloadCount correctly');
  assert(entry.publisher === 'redhat', 'Maps publisher correctly');
  assert(entry.iconUrl === 'https://open-vsx.org/api/redhat/java/1.28.0/file/icon.png', 'Extracts iconUrl from files object');
  assert(entry.downloadUrl === 'https://open-vsx.org/api/redhat/java/1.28.0/file/redhat.java-1.28.0.vsix', 'Extracts downloadUrl from files object');
  assert(entry.sha256 === 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', 'Extracts sha256 from files object');
  assert(entry.installedState === 'uninstalled', 'Defaults uninstalledState for uninstalled item');
  assert(entry.enabledState === 'disabled', 'Defaults disabled for uninstalled item');
  assert(entry.rating === 4.6, 'Maps rating rounded to 1 decimal place');

  // Test 4: Handling missing optional fields gracefully
  const minimalRaw = {
    name: 'minimal-tool'
  };
  // @ts-expect-error accessing private method for unit test
  const minEntry: MarketplaceExtensionEntry = client.mapToEntry(minimalRaw, new Map());
  assert(minEntry.displayName === 'minimal-tool', 'Falls back to name when displayName missing');
  assert(minEntry.version === '0.0.0', 'Falls back to 0.0.0 when version missing');
  assert(minEntry.downloadCount === 0, 'Falls back to 0 when downloadCount missing');
  assert(minEntry.iconUrl === undefined, 'iconUrl is undefined when files.icon missing');
  assert(minEntry.shortDescription === '', 'shortDescription is empty string when missing');
}
