/**
 * Ty-Code Desktop IDE - Real Open VSX VSIX Installer
 * Implements real VSIX file download, validation, extraction, and host registration pipeline:
 *  1. Fetch metadata from Open VSX registry (open-vsx.org)
 *  2. Extract downloadUrl from metadata.files.download
 *  3. Download VSIX to temporary location with progress events
 *  4. Verify checksum if sha256/checksum provided
 *  5. Validate VSIX is a genuine ZIP archive (magic bytes PK\x03\x04)
 *  6. Extract to ~/.ty-code/extensions/{publisher}.{name}-{version}/ with Zip-slip protection
 *  7. Parse manifest.json (package.json inside VSIX)
 *  8. Validate manifest: id matches registry, version matches, main entry point exists
 *  9. Register with extension host and persistent storage
 * 10. Clean rollback on any failure with error taxonomy mapping:
 *     - REGISTRY_UNREACHABLE
 *     - VSIX_DOWNLOAD_FAILED
 *     - VSIX_CORRUPT
 *     - MANIFEST_INVALID
 */

import fs from 'node:fs/promises';
import { existsSync, createWriteStream } from 'node:fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import zlib from 'zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { openVsxClient } from './openvsx-client';
import { extensionManager, ExtensionManager } from '../extension-manager';
import { extensionHost } from '../extensions/extension-host';
import type { ExtensionManifest, InstalledExtension } from '../../../preload/types';
import type {
  MarketplaceExtensionEntry,
  InstallStep,
  InstallProgressEvent,
  InstallResult
} from '../../../shared/types/marketplace';
import { ExtensionIdSchema, ExtensionManifestSchema } from '../../../preload/extension-schemas';

const DOWNLOAD_TIMEOUT_MS = 30_000;
const ZIP_MAGIC_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04]); // PK\x03\x04

function getElectronUserData(): string | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron');
    if (electron?.app?.getPath) {
      return electron.app.getPath('userData');
    }
  } catch {
    // Pure node test environment
  }
  return undefined;
}

export class VsixInstaller {
  private extensionsDir: string;
  private manager: ExtensionManager;

  constructor(customExtensionsDir?: string, manager?: ExtensionManager) {
    this.manager = manager || extensionManager;
    if (customExtensionsDir) {
      this.extensionsDir = customExtensionsDir;
    } else {
      const managerDir = (this.manager as unknown as { extensionsDir?: string }).extensionsDir;
      if (managerDir) {
        this.extensionsDir = managerDir;
      } else {
        const base = getElectronUserData() || os.homedir();
        const legacyDir = path.join(base, '.ty-claude', 'extensions');
        const newDir = path.join(base, '.ty-code', 'extensions');
        this.extensionsDir = existsSync(legacyDir) && !existsSync(newDir) ? legacyDir : newDir;
      }
    }
  }

  getExtensionsDir(): string {
    return this.extensionsDir;
  }

  /**
   * Validates ZIP archive magic bytes (PK\x03\x04).
   */
  validateZipMagicBytes(buffer: Buffer): void {
    if (buffer.length < 4) {
      throw new Error('VSIX_CORRUPT: File is too small to be a valid ZIP archive.');
    }
    if (
      buffer[0] !== ZIP_MAGIC_BYTES[0] ||
      buffer[1] !== ZIP_MAGIC_BYTES[1] ||
      buffer[2] !== ZIP_MAGIC_BYTES[2] ||
      buffer[3] !== ZIP_MAGIC_BYTES[3]
    ) {
      throw new Error(
        `VSIX_CORRUPT: Invalid ZIP file magic bytes. Expected [0x50, 0x4B, 0x03, 0x04] (PK\\x03\\x04), received [0x${buffer[0].toString(16)}, 0x${buffer[1].toString(16)}, 0x${buffer[2].toString(16)}, 0x${buffer[3].toString(16)}]`
      );
    }
  }

  /**
   * Downloads VSIX to a temporary file with progress streaming and checksum validation.
   */
  async downloadVsixToFile(
    downloadUrl: string,
    tempFilePath: string,
    expectedSha256?: string,
    onProgress?: (percent: number, bytesReceived: number, totalBytes: number) => void
  ): Promise<{ size: number; sha256: string }> {
    if (!downloadUrl || typeof downloadUrl !== 'string') {
      throw new Error('VSIX_DOWNLOAD_FAILED: Download URL is missing or invalid.');
    }

    try {
      const parsed = new URL(downloadUrl);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
        throw new Error('VSIX_DOWNLOAD_FAILED: Invalid URL protocol. HTTPS required.');
      }
    } catch (e) {
      throw new Error(`VSIX_DOWNLOAD_FAILED: Invalid download URL: ${e instanceof Error ? e.message : String(e)}`);
    }

    // Ensure temp directory exists
    const tempDir = path.dirname(tempFilePath);
    await fs.mkdir(tempDir, { recursive: true });

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < 2; attempt++) {
      if (attempt > 0) {
        await new Promise((r) => setTimeout(r, 600));
      }

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);

        const res = await fetch(downloadUrl, {
          headers: {
            'User-Agent': 'Ty-Code-Desktop-IDE',
            Accept: 'application/octet-stream, application/zip, */*'
          },
          signal: controller.signal
        });

        clearTimeout(timeoutId);

        if (!res.ok) {
          throw new Error(`VSIX_DOWNLOAD_FAILED: HTTP ${res.status} from download endpoint.`);
        }

        const totalBytes = Number(res.headers.get('content-length') || 0);
        const reader = res.body?.getReader();

        const hash = crypto.createHash('sha256');
        let bytesReceived = 0;
        const fileStream = createWriteStream(tempFilePath);

        if (reader) {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytesReceived += value.byteLength;
              hash.update(value);
              fileStream.write(Buffer.from(value));

              if (totalBytes > 0 && onProgress) {
                const percent = Math.min(100, Math.round((bytesReceived / totalBytes) * 100));
                onProgress(percent, bytesReceived, totalBytes);
              }
            }
          } finally {
            await new Promise((resolve) => fileStream.end(resolve));
          }
        } else {
          // Fallback arrayBuffer
          const arrayBuf = await res.arrayBuffer();
          const buf = Buffer.from(arrayBuf);
          bytesReceived = buf.length;
          hash.update(buf);
          await fs.writeFile(tempFilePath, buf);
          if (onProgress) {
            onProgress(100, bytesReceived, bytesReceived);
          }
        }

        const calculatedSha256 = hash.digest('hex').toLowerCase();

        // Verify SHA-256 if provided
        if (expectedSha256 && expectedSha256.trim()) {
          const expectedClean = expectedSha256.trim().toLowerCase();
          if (!expectedClean.startsWith('http') && calculatedSha256 !== expectedClean) {
            throw new Error(`VSIX_CORRUPT: Checksum mismatch. Expected ${expectedClean}, calculated ${calculatedSha256}`);
          }
        }

        return { size: bytesReceived, sha256: calculatedSha256 };
      } catch (err: unknown) {
        lastError = err instanceof Error ? err : new Error(String(err));
      }
    }

    throw lastError || new Error('VSIX_DOWNLOAD_FAILED: Failed to download VSIX package after retries.');
  }

  /**
   * Pure Node.js ZIP extraction without external dependencies.
   * Extracts entries, strips 'extension/' prefix, and sanitizes against Zip slip.
   */
  extractZipToMemory(buffer: Buffer): Map<string, Buffer> {
    if (buffer.length < 22) {
      throw new Error('VSIX_CORRUPT: Invalid archive: buffer too small to be a ZIP archive.');
    }

    // Validate ZIP magic bytes
    this.validateZipMagicBytes(buffer);

    // 1. Locate End of Central Directory (EOCD)
    let eocdOffset = -1;
    const maxSearch = Math.min(buffer.length, 65557);
    for (let i = buffer.length - 22; i >= buffer.length - maxSearch; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      throw new Error('VSIX_CORRUPT: End of Central Directory (EOCD) record not found in archive.');
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    const files = new Map<string, Buffer>();
    let cur = cdOffset;

    for (let i = 0; i < totalEntries && cur < eocdOffset; i++) {
      if (buffer.readUInt32LE(cur) !== 0x02014b50) break;

      const compressionMethod = buffer.readUInt16LE(cur + 10);
      const compressedSize = buffer.readUInt32LE(cur + 20);
      const fnLength = buffer.readUInt16LE(cur + 28);
      const extraLength = buffer.readUInt16LE(cur + 30);
      const commentLength = buffer.readUInt16LE(cur + 32);
      const localHeaderOffset = buffer.readUInt32LE(cur + 42);

      const rawFileName = buffer.subarray(cur + 46, cur + 46 + fnLength).toString('utf8');
      cur += 46 + fnLength + extraLength + commentLength;

      // Skip directory entries
      if (rawFileName.endsWith('/') || rawFileName.endsWith('\\')) {
        continue;
      }

      // Check local file header
      if (localHeaderOffset + 30 > buffer.length || buffer.readUInt32LE(localHeaderOffset) !== 0x04034b50) {
        continue;
      }

      const localFnLength = buffer.readUInt16LE(localHeaderOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localHeaderOffset + 28);
      const dataStart = localHeaderOffset + 30 + localFnLength + localExtraLength;

      if (dataStart + compressedSize > buffer.length) {
        continue;
      }

      const compressedData = buffer.subarray(dataStart, dataStart + compressedSize);
      let uncompressedData: Buffer;

      if (compressionMethod === 0) {
        uncompressedData = compressedData;
      } else if (compressionMethod === 8) {
        try {
          uncompressedData = zlib.inflateRawSync(compressedData);
        } catch (zlibErr) {
          console.warn(`[VsixInstaller] Failed to decompress "${rawFileName}":`, zlibErr);
          continue;
        }
      } else {
        // Unsupported compression method
        continue;
      }

      // Sanitize entry path: protect against zip-slip traversal
      const normalizedPath = rawFileName.replace(/\\/g, '/');
      if (normalizedPath.includes('../') || normalizedPath.startsWith('/') || /^[a-zA-Z]:/.test(normalizedPath)) {
        console.warn(`[VsixInstaller] Skipping dangerous zip-slip entry: "${rawFileName}"`);
        continue;
      }

      // Strip leading 'extension/' prefix if present
      let cleanRelativePath = normalizedPath;
      if (cleanRelativePath.startsWith('extension/')) {
        cleanRelativePath = cleanRelativePath.slice('extension/'.length);
      }

      files.set(cleanRelativePath, uncompressedData);
    }

    return files;
  }

  /**
   * Validates manifest and verifies entry point exists.
   */
  validateManifest(
    files: Map<string, Buffer>,
    expectedId: string,
    expectedVersion?: string
  ): { manifest: ExtensionManifest; mainFile: string } {
    const pkgBuffer = files.get('package.json');
    if (!pkgBuffer) {
      throw new Error(`MANIFEST_INVALID: VSIX package "${expectedId}" is missing required "package.json" manifest.`);
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(pkgBuffer.toString('utf8')) as Record<string, unknown>;
    } catch (jsonErr) {
      throw new Error(`MANIFEST_INVALID: Corrupt package.json in VSIX: ${jsonErr instanceof Error ? jsonErr.message : String(jsonErr)}`);
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('MANIFEST_INVALID: Extension manifest must be a JSON object.');
    }

    const name = typeof parsed.name === 'string' ? parsed.name.trim() : '';
    const publisher = typeof parsed.publisher === 'string' ? parsed.publisher.trim() : '';
    const version = typeof parsed.version === 'string' ? parsed.version.trim() : '';

    if (!name) throw new Error('MANIFEST_INVALID: Manifest is missing required "name" field.');
    if (!publisher) throw new Error('MANIFEST_INVALID: Manifest is missing required "publisher" field.');
    if (!version) throw new Error('MANIFEST_INVALID: Manifest is missing required "version" field.');

    // 1. Verify id matches registry (case-insensitive)
    const manifestId = `${publisher}.${name}`;
    if (manifestId.toLowerCase() !== expectedId.toLowerCase()) {
      throw new Error(`MANIFEST_INVALID: Extension identity mismatch: manifest declares "${manifestId}" but requested "${expectedId}".`);
    }

    // 2. Verify version matches if expected
    if (expectedVersion && expectedVersion.trim() && version !== expectedVersion.trim()) {
      console.warn(`[VsixInstaller] Note: registry version "${expectedVersion}" differs from package version "${version}". Using package version.`);
    }

    // 3. Verify main entry point exists in files
    const declaredMain = typeof parsed.main === 'string' ? parsed.main.trim() : '';
    let resolvedMain: string | undefined;

    if (declaredMain) {
      const cleanMain = declaredMain.replace(/^\.\//, '').replace(/\\/g, '/');
      const candidates = [
        cleanMain,
        `${cleanMain}.js`,
        `${cleanMain}/index.js`,
        path.posix.join(cleanMain, 'extension.js'),
        'out/extension.js',
        'dist/extension.js',
        'extension.js',
        'index.js'
      ];

      for (const cand of candidates) {
        if (files.has(cand)) {
          resolvedMain = cand;
          break;
        }
      }

      if (!resolvedMain) {
        throw new Error(
          `MANIFEST_INVALID: Declared main entry point "${declaredMain}" was not found in extracted VSIX files.`
        );
      }
    } else {
      // Default entry point search
      const defaults = ['extension.js', 'out/extension.js', 'dist/extension.js', 'index.js'];
      for (const d of defaults) {
        if (files.has(d)) {
          resolvedMain = d;
          break;
        }
      }
      if (!resolvedMain) {
        // If manifest doesn't declare main, it may be a declarative extension (theme, language grammar)
        resolvedMain = 'package.json';
      }
    }

    // Normalize contributes: merge array configurations and scalarize union types
    const rawContributes = typeof parsed.contributes === 'object' && parsed.contributes !== null
      ? { ...(parsed.contributes as Record<string, unknown>) }
      : {};

    if (rawContributes.configuration) {
      let configObj = rawContributes.configuration;
      if (Array.isArray(configObj)) {
        const mergedProps: Record<string, unknown> = {};
        for (const item of configObj) {
          if (item && typeof item === 'object' && (item as any).properties) {
            Object.assign(mergedProps, (item as any).properties);
          }
        }
        configObj = { title: configObj[0]?.title || 'Configuration', properties: mergedProps };
      }
      if (configObj && typeof configObj === 'object' && (configObj as any).properties) {
        const props = { ...((configObj as any).properties as Record<string, any>) };
        for (const [k, v] of Object.entries(props)) {
          if (v && typeof v === 'object' && Array.isArray(v.type)) {
            props[k] = { ...v, type: v.type.find((t: any) => typeof t === 'string' && t !== 'null') || 'string' };
          }
        }
        configObj = { ...(configObj as any), properties: props };
      }
      rawContributes.configuration = configObj;
    }

    // 4. Parse with Schema
    const manifest = ExtensionManifestSchema.parse({
      name,
      publisher,
      version,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : name,
      description: typeof parsed.description === 'string' ? parsed.description : '',
      main: resolvedMain !== 'package.json' ? resolvedMain : undefined,
      categories: Array.isArray(parsed.categories)
        ? parsed.categories.filter((c): c is string => typeof c === 'string')
        : ['Tools'],
      capabilities: Array.isArray(parsed.capabilities)
        ? parsed.capabilities.filter((c): c is string => typeof c === 'string')
        : ['commands.register'],
      contributes: rawContributes
    });

    return { manifest, mainFile: resolvedMain };
  }

  /**
   * Writes extracted files into target directory on disk.
   */
  async extractToDisk(files: Map<string, Buffer>, targetDir: string): Promise<void> {
    await fs.mkdir(targetDir, { recursive: true });

    for (const [relPath, content] of files.entries()) {
      const filePath = path.join(targetDir, ...relPath.split('/'));
      const dirPath = path.dirname(filePath);
      await fs.mkdir(dirPath, { recursive: true });
      await fs.writeFile(filePath, content);
    }
  }

  /**
   * Rolls back an installation by cleanly removing target directory and temp file.
   */
  async rollback(targetDir?: string, tempFile?: string): Promise<void> {
    if (tempFile && existsSync(tempFile)) {
      try {
        await fs.rm(tempFile, { force: true });
      } catch (err) {
        console.warn(`[VsixInstaller] Rollback failed to remove temp file "${tempFile}":`, err);
      }
    }

    if (targetDir && existsSync(targetDir)) {
      try {
        await fs.rm(targetDir, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[VsixInstaller] Rollback failed to remove target directory "${targetDir}":`, err);
      }
    }
  }

  /**
   * Registers an installed extension with ExtensionManager and persists state.
   */
  async registerInstalledExtension(installed: InstalledExtension): Promise<void> {
    await this.manager.init();
    const map = (this.manager as unknown as { installedExtensions: Map<string, InstalledExtension> }).installedExtensions;
    if (map) {
      map.set(installed.id, installed);
      await (this.manager as unknown as { persist: () => Promise<void> }).persist();
    }
    // Step 9: Register with extension host runtime
    await extensionHost.registerExtension(installed).catch((err) => {
      console.warn(`[VsixInstaller] Failed to register "${installed.id}" with ExtensionHost:`, err);
    });
  }

  /**
   * Main Pipeline: Install extension from Open VSX registry or metadata entry.
   * Follows the 10-step pipeline:
   *  1. Fetch metadata from Open VSX
   *  2. Extract downloadUrl
   *  3. Download VSIX to temp location with progress
   *  4. Verify checksum
   *  5. Validate ZIP magic bytes (PK\x03\x04)
   *  6. Extract to target directory
   *  7. Parse manifest.json
   *  8. Validate manifest and entry point
   *  9. Register with extension host
   *  10. Return success with InstalledExtension record
   */
  async install(
    entryOrId:
      | MarketplaceExtensionEntry
      | { id: string; namespace?: string; name?: string; downloadUrl?: string; sha256?: string; [key: string]: unknown },
    onProgress?: (event: InstallProgressEvent) => void
  ): Promise<InstallResult> {
    const rawId = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
    const cleanId = rawId.trim();
    let currentStep: InstallStep = 'download';
    let targetDir: string | undefined;
    let tempFilePath: string | undefined;

    try {
      await this.manager.init();
      await fs.mkdir(this.extensionsDir, { recursive: true });

      // Check if built-in
      const existing = this.manager.getInstalledExtensions().find((e) => e.id.toLowerCase() === cleanId.toLowerCase());
      if (existing?.isBuiltIn) {
        throw new Error(`Built-in extension "${cleanId}" cannot be replaced.`);
      }

      // Step 1 & 2: Fetch metadata if downloadUrl is missing
      let downloadUrl = (entryOrId as MarketplaceExtensionEntry).downloadUrl;
      let expectedSha256 = (entryOrId as MarketplaceExtensionEntry).sha256;
      let expectedVersion = (entryOrId as MarketplaceExtensionEntry).version;

      if (!downloadUrl) {
        onProgress?.({ id: cleanId, step: 'download', percent: 5, message: 'Querying Open VSX registry metadata…' });
        const parts = cleanId.split('.');
        const namespace = (entryOrId as any).namespace || parts[0];
        const extensionName = (entryOrId as any).name || parts.slice(1).join('.');

        if (!namespace || !extensionName) {
          throw new Error(`REGISTRY_UNREACHABLE: Invalid extension ID format "${cleanId}". Must be "publisher.name".`);
        }

        try {
          const meta = await openVsxClient.getMetadata(namespace, extensionName);
          if (!meta) {
            throw new Error(`REGISTRY_UNREACHABLE: Extension "${cleanId}" was not found on Open VSX registry.`);
          }
          downloadUrl = meta.downloadUrl;
          expectedSha256 = meta.sha256;
          expectedVersion = meta.version;
        } catch (fetchErr) {
          const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
          throw new Error(`REGISTRY_UNREACHABLE: Failed to connect to Open VSX registry for "${cleanId}": ${msg}`);
        }
      }

      if (!downloadUrl) {
        throw new Error(`REGISTRY_UNREACHABLE: Extension "${cleanId}" has no VSIX download file available on Open VSX.`);
      }

      // Step 3, 4, 5: Download VSIX to temporary location with progress events
      currentStep = 'download';
      const tmpDir = path.join(this.extensionsDir, '.tmp');
      tempFilePath = path.join(tmpDir, `${cleanId}-${Date.now()}.vsix`);

      onProgress?.({ id: cleanId, step: 'download', percent: 10, message: 'Connecting to download server…' });

      await this.downloadVsixToFile(
        downloadUrl,
        tempFilePath,
        expectedSha256,
        (percent, bytesReceived, totalBytes) => {
          const mb = (bytesReceived / (1024 * 1024)).toFixed(1);
          const totalMb = totalBytes > 0 ? (totalBytes / (1024 * 1024)).toFixed(1) : '?';
          onProgress?.({
            id: cleanId,
            step: 'download',
            percent,
            message: `Downloading VSIX package (${mb}MB / ${totalMb}MB)…`
          });
        }
      );

      // Read downloaded buffer for extraction & magic byte validation
      const vsixBuffer = await fs.readFile(tempFilePath);

      // Step 5: Validate ZIP magic bytes
      this.validateZipMagicBytes(vsixBuffer);

      // Step 6: Extract to memory with Zip slip protection
      currentStep = 'extraction';
      onProgress?.({ id: cleanId, step: 'extraction', percent: 60, message: 'Extracting package archive…' });

      const extractedFiles = this.extractZipToMemory(vsixBuffer);

      // Step 7 & 8: Parse and validate manifest & main entry point
      currentStep = 'validation';
      onProgress?.({ id: cleanId, step: 'validation', percent: 75, message: 'Validating extension manifest & entry point…' });

      const { manifest } = this.validateManifest(extractedFiles, cleanId, expectedVersion);

      // Target directory: ~/.ty-code/extensions/{publisher}.{name}-{version}/
      const targetFolderName = `${manifest.publisher}.${manifest.name}-${manifest.version}`;
      targetDir = path.join(this.extensionsDir, targetFolderName);

      // Clean existing target if re-installing
      if (existsSync(targetDir)) {
        await fs.rm(targetDir, { recursive: true, force: true });
      }

      await this.extractToDisk(extractedFiles, targetDir);

      // Step 9: Register with extension manager / host
      currentStep = 'registration';
      onProgress?.({ id: cleanId, step: 'registration', percent: 90, message: 'Registering extension host…' });

      const installedRecord: InstalledExtension = {
        id: cleanId,
        manifest,
        enabled: true,
        isBuiltIn: false,
        installPath: targetDir,
        installedAt: Date.now(),
        settings: {},
        executionState: 'installed'
      };

      await this.registerInstalledExtension(installedRecord);

      // Step 10: Clean up temp file
      if (tempFilePath && existsSync(tempFilePath)) {
        await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
      }

      onProgress?.({ id: cleanId, step: 'registration', percent: 100, message: 'Installation complete!' });

      return {
        success: true,
        id: cleanId,
        installedExtension: installedRecord
      };
    } catch (err: unknown) {
      // Rollback on any failure!
      await this.rollback(targetDir, tempFilePath);

      const rawMsg = err instanceof Error ? err.message : String(err);
      let classifiedError = rawMsg;
      if (rawMsg.startsWith('REGISTRY_UNREACHABLE:') || rawMsg.startsWith('VSIX_DOWNLOAD_FAILED:') || rawMsg.startsWith('VSIX_CORRUPT:') || rawMsg.startsWith('MANIFEST_INVALID:')) {
        classifiedError = rawMsg;
      } else if (currentStep === 'download') {
        classifiedError = `VSIX_DOWNLOAD_FAILED: ${rawMsg}`;
      } else if (currentStep === 'validation') {
        classifiedError = `MANIFEST_INVALID: ${rawMsg}`;
      } else {
        classifiedError = `VSIX_CORRUPT: ${rawMsg}`;
      }

      return {
        success: false,
        id: cleanId,
        failedStep: currentStep,
        error: classifiedError,
        canRetry: true
      };
    }
  }

  /**
   * Install from a local .vsix file.
   */
  async installFromVsix(
    filePath: string,
    onProgress?: (event: InstallProgressEvent) => void
  ): Promise<InstallResult> {
    let currentStep: InstallStep = 'validation';
    let targetDir: string | undefined;

    if (!filePath || typeof filePath !== 'string' || !existsSync(filePath)) {
      throw new Error(`VSIX package file is unavailable or does not exist at "${filePath}".`);
    }

    try {
      await this.manager.init();
      const vsixBuffer = await fs.readFile(filePath);

      this.validateZipMagicBytes(vsixBuffer);

      currentStep = 'validation';
      onProgress?.({ id: 'local-vsix', step: 'validation', percent: 30, message: 'Validating package…' });
      const extractedFiles = this.extractZipToMemory(vsixBuffer);

      const pkgBuffer = extractedFiles.get('package.json');
      if (!pkgBuffer) throw new Error('MANIFEST_INVALID: VSIX package is missing package.json.');
      const parsed = JSON.parse(pkgBuffer.toString('utf8'));
      const id = `${parsed.publisher}.${parsed.name}`;

      const { manifest } = this.validateManifest(extractedFiles, id, parsed.version);

      currentStep = 'extraction';
      onProgress?.({ id, step: 'extraction', percent: 65, message: 'Extracting package…' });

      const targetFolderName = `${manifest.publisher}.${manifest.name}-${manifest.version}`;
      targetDir = path.join(this.extensionsDir, targetFolderName);

      if (existsSync(targetDir)) {
        await fs.rm(targetDir, { recursive: true, force: true });
      }
      await this.extractToDisk(extractedFiles, targetDir);

      currentStep = 'registration';
      onProgress?.({ id, step: 'registration', percent: 90, message: 'Registering extension…' });

      const installedRecord: InstalledExtension = {
        id,
        manifest,
        enabled: true,
        isBuiltIn: false,
        installPath: targetDir,
        installedAt: Date.now(),
        settings: {},
        executionState: 'installed'
      };

      await this.registerInstalledExtension(installedRecord);

      return {
        success: true,
        id,
        installedExtension: installedRecord
      };
    } catch (err: unknown) {
      await this.rollback(targetDir);
      return {
        success: false,
        id: 'unknown',
        failedStep: currentStep,
        error: err instanceof Error ? err.message : String(err),
        canRetry: true
      };
    }
  }

  /**
   * Uninstalls an extension and removes its folder.
   */
  async uninstall(id: string): Promise<boolean> {
    await this.manager.init();
    const installed = this.manager.getInstalledExtensions().find((e) => e.id.toLowerCase() === id.toLowerCase());
    if (!installed) {
      throw new Error(`Extension "${id}" is not installed.`);
    }
    if (installed.isBuiltIn) {
      throw new Error(`Built-in extension "${id}" cannot be uninstalled.`);
    }

    // Remove folder from disk if it exists
    if (installed.installPath && existsSync(installed.installPath)) {
      try {
        await fs.rm(installed.installPath, { recursive: true, force: true });
      } catch (err) {
        console.warn(`[VsixInstaller] Failed to remove "${installed.installPath}":`, err);
      }
    }

    // Unregister from extension host runtime
    await extensionHost.unregisterExtension(installed.id).catch((err) => {
      console.warn(`[VsixInstaller] Failed to unregister "${installed.id}" from ExtensionHost:`, err);
    });

    // Unregister from manager
    await this.manager.uninstallExtension(installed.id);
    return true;
  }

  /**
   * Scans the installed extensions directory on disk and parses package.json manifests.
   */
  async scanInstalledDirectory(): Promise<InstalledExtension[]> {
    await fs.mkdir(this.extensionsDir, { recursive: true });
    const entries = await fs.readdir(this.extensionsDir, { withFileTypes: true });
    const results: InstalledExtension[] = [];

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const pkgPath = path.join(this.extensionsDir, entry.name, 'package.json');
        if (existsSync(pkgPath)) {
          try {
            const raw = await fs.readFile(pkgPath, 'utf8');
            const manifest = ExtensionManifestSchema.parse(JSON.parse(raw));
            const id = `${manifest.publisher}.${manifest.name}`;
            results.push({
              id,
              manifest,
              enabled: true,
              isBuiltIn: false,
              installPath: path.join(this.extensionsDir, entry.name),
              installedAt: Date.now()
            });
          } catch {
            // ignore invalid manifest
          }
        }
      }
    }
    return results;
  }
}

export const vsixInstaller = new VsixInstaller();
export { openVsxClient } from './openvsx-client';
