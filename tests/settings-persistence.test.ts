import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  SettingsSchema,
  SettingsPatchSchema,
  SETTINGS_SCHEMA_VERSION,
  classifySettingsError,
  safeSerializeSettings,
  migrateSettingsDocument
} from '../src/shared/types/settings';
import { SettingsManager, DEFAULT_SETTINGS } from '../src/main/services/settings-manager';

describe('Settings Persistence & Systemic Save-Failure Fix', () => {
  let tempDir: string;
  let testSettingsPath: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tycode-settings-test-'));
    testSettingsPath = path.join(tempDir, 'settings.json');
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Step 1 & 2: Error Classification, Zod Schema Reconciliation & Forward-Compatibility', () => {
    it('classifies errors into structured reason codes', () => {
      const valErr = classifySettingsError(new Error('Global settings failed schema validation: Invalid input'));
      expect(valErr.code).toBe('VALIDATION');
      expect(valErr.message).toContain('schema validation');

      const parseErr = classifySettingsError(new SyntaxError('Unexpected token } in JSON at position 42'));
      expect(parseErr.code).toBe('PARSE');

      const lockErr = classifySettingsError(Object.assign(new Error('resource busy or locked'), { code: 'EBUSY' }));
      expect(lockErr.code).toBe('LOCK');

      const ioErr = classifySettingsError(Object.assign(new Error('no such file or directory'), { code: 'ENOENT' }));
      expect(ioErr.code).toBe('IO');
    });

    it('safely serializes data and converts or strips non-JSON types', () => {
      const sample = {
        name: 'test',
        big: BigInt(12345),
        map: new Map([['key1', 'val1']]),
        set: new Set(['item1', 'item2']),
        fn: () => 'skip me'
      };

      const serialized = safeSerializeSettings(sample);
      const parsed = JSON.parse(serialized);

      expect(parsed.name).toBe('test');
      expect(parsed.big).toBe('12345');
      expect(parsed.map).toEqual({ key1: 'val1' });
      expect(parsed.set).toEqual(['item1', 'item2']);
      expect(parsed.fn).toBeUndefined();
    });

    it('fails fast with code PARSE when circular references are passed to safeSerializeSettings', () => {
      const circular: any = { name: 'circular' };
      circular.self = circular;

      expect(() => safeSerializeSettings(circular)).toThrow();
      try {
        safeSerializeSettings(circular);
      } catch (err: any) {
        expect(err.code).toBe('PARSE');
      }
    });

    it('migrates older schema versions up to SETTINGS_SCHEMA_VERSION (v4)', () => {
      const v1Settings = {
        schemaVersion: 1,
        activeProvider: 'anthropic'
      };
      const migrated = migrateSettingsDocument(v1Settings);
      expect(migrated.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(migrated.customEndpoints).toEqual({});
      expect(migrated.freeMode).toBe(true);
      expect(migrated.defaultTerminalProfileId).toBe('');
    });

    it('validates full consolidated payload from all settings tabs', () => {
      const consolidatedPayload = {
        telemetry: { enabled: false },
        freeMode: true,
        quotaAlertThreshold: 80,
        autoRotateProviders: true,
        temperature: 0.2,
        maxTokens: 4096,
        customEndpoints: {
          ollama: 'http://localhost:11434/v1',
          'fcc-proxy': 'http://localhost:8082/v1'
        },
        terminalProfiles: [
          { id: 'bash', name: 'Bash', shellId: 'bash-shell' }
        ],
        defaultTerminalProfileId: '',
        thirdPartyRuntimeEnabled: false,
        'editor.reviewPolicy': 'alwaysReview',
        'lsp.autoStart': true,
        editor: {
          fontSize: 13,
          tabSize: 2,
          minimap: true,
          bracketPairs: true,
          autoSave: 'afterDelay',
          autoSaveDelay: 1000,
          wordWrap: 'off',
          formatOnSave: false,
          chatFontFamily: 'sans',
          chatFontSize: 14,
          matrixDecodeEnabled: true,
          ukPunctuationEnabled: true
        },
        languageServers: {},
        security: {
          terminalPolicy: 'always-ask',
          fileAccessPolicy: 'workspace-only',
          systemAccessConfirmed: false,
          reviewPolicy: 'always-ask'
        },
        activeProvider: 'ty-code-free',
        activeModel: 'gemini-2.5-flash',
        activeHarness: 'default'
      };

      const patchResult = SettingsPatchSchema.safeParse(consolidatedPayload);
      expect(patchResult.success).toBe(true);
      if (patchResult.success) {
        expect(patchResult.data.editor?.chatFontFamily).toBe('sans');
        expect(patchResult.data.editor?.matrixDecodeEnabled).toBe(true);
        expect(patchResult.data.defaultTerminalProfileId).toBe('');
        expect(patchResult.data.security?.terminalPolicy).toBe('always-ask');
      }
    });

    it('forward compatibility: passthrough allows unknown future keys without rejecting save', () => {
      const futurePayload = {
        activeProvider: 'openrouter',
        experimentalFeatureXYZ: true,
        nestedFutureField: { nested: 123 },
        editor: {
          fontSize: 14,
          futureEditorOption: 'enabled'
        }
      };

      const result = SettingsPatchSchema.safeParse(futurePayload);
      expect(result.success).toBe(true);
      if (result.success) {
        expect((result.data as any).experimentalFeatureXYZ).toBe(true);
        expect((result.data as any).editor.futureEditorOption).toBe('enabled');
      }
    });
  });

  describe('Step 3: Corrupted File Recovery & Atomic Writes', () => {
    it('recovers from corrupt JSON on load, backs up to .corrupt- file, and uses defaults', async () => {
      const corruptData = '{"broken json: true, invalid syntax...';
      await fs.writeFile(testSettingsPath, corruptData, 'utf-8');

      const manager = new SettingsManager({ globalSettingsPath: testSettingsPath, watchFiles: false });
      const loaded = await manager.getLayerSettings('global');

      expect(loaded.schemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
      expect(loaded.activeProvider).toBe(DEFAULT_SETTINGS.activeProvider);

      // Verify that corrupt backup file was created in same directory
      const files = await fs.readdir(tempDir);
      const corruptBackup = files.find((f) => f.startsWith('settings.corrupt-'));
      expect(corruptBackup).toBeDefined();

      if (corruptBackup) {
        const backupContent = await fs.readFile(path.join(tempDir, corruptBackup), 'utf-8');
        expect(backupContent).toBe(corruptData);
      }

      // Verify save works cleanly after corrupt recovery
      await manager.saveLayer('global', { freeMode: false });
      const reloaded = await manager.getLayerSettings('global');
      expect(reloaded.freeMode).toBe(false);
    });

    it('writes atomically through .tmp file without leaving temporary debris on clean save', async () => {
      const manager = new SettingsManager({ globalSettingsPath: testSettingsPath, watchFiles: false });
      await manager.saveLayer('global', {
        activeProvider: 'openrouter',
        editor: { fontSize: 16 }
      });

      const files = await fs.readdir(tempDir);
      expect(files).toContain('settings.json');
      expect(files).not.toContain('settings.json.tmp');

      const content = JSON.parse(await fs.readFile(testSettingsPath, 'utf-8'));
      expect(content.activeProvider).toBe('openrouter');
      expect(content.editor.fontSize).toBe(16);
    });

    it('preserves defaults when patch contains undefined fields', async () => {
      const manager = new SettingsManager({ globalSettingsPath: testSettingsPath, watchFiles: false });
      await manager.saveLayer('global', {
        defaultTerminalProfileId: undefined as any
      });

      const reloaded = await manager.getLayerSettings('global');
      expect(reloaded.defaultTerminalProfileId).toBe('');
    });
  });
});
