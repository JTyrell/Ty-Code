import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'path';
import os from 'os';
import { ExtensionIdSchema, ExtensionManifestSchema, ExtensionMetadataSchema, validateExtensionSettings } from '../../preload/extension-schemas';
import type { ExtensionManifest, InstalledExtension, ExtensionMetadata } from '../../preload/types';

function getElectronUserData(): string | undefined {
  try {
    const electron = require('electron');
    if (electron?.app?.getPath) {
      return electron.app.getPath('userData');
    }
  } catch {
    // Running in pure Node test environment
  }
  return undefined;
}

export class ExtensionManager {
  private extensionsDir: string;
  private installedFile: string;
  private installedExtensions: Map<string, InstalledExtension> = new Map();
  private initialized = false;

  private extensionPathForId(id: string): string {
    const safeId = ExtensionIdSchema.parse(id);
    const base = path.resolve(this.extensionsDir);
    const target = path.resolve(base, safeId);
    if (!target.startsWith(`${base}${path.sep}`)) throw new Error('Extension storage path escapes the extension directory.');
    return target;
  }

  private validateSettings(manifest: ExtensionManifest, settings: unknown): Record<string, unknown> {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Extension settings must be an object.');
    const values = settings as Record<string, unknown>;
    const validation = validateExtensionSettings(manifest, values);
    if (!validation.valid) throw new Error(validation.errors.join(' '));
    return values;
  }

  constructor(customBaseDir?: string) {
    const base = customBaseDir || getElectronUserData() || os.homedir();
    const legacyDir = path.join(base, '.ty-claude', 'extensions');
    const newDir = path.join(base, '.ty-code', 'extensions');
    this.extensionsDir = existsSync(legacyDir) && !existsSync(newDir) ? legacyDir : newDir;
    this.installedFile = path.join(this.extensionsDir, 'installed.json');
  }

  private getBuiltInExtensions(): InstalledExtension[] {
    return [
      {
        id: 'ty-claude.python-support',
        manifest: {
          name: 'python-support',
          publisher: 'ty-claude',
          version: '1.2.0',
          displayName: 'Python Language Support & Linter',
          description: 'Rich Python syntax awareness, PEP8 formatting checks, docstring generator, and AST diagnostics.',
          categories: ['Languages', 'Linters'],
          capabilities: ['commands.register', 'editor.read', 'editor.edit', 'window.messages', 'terminal.open'],
          contributes: {
            commands: [
              { command: 'ty-claude.python-support.createDocstring', title: 'Python: Generate Docstring Template', category: 'Python' },
              { command: 'ty-claude.python-support.lintFile', title: 'Python: Run Linter & Static Analysis', category: 'Python' },
              { command: 'ty-claude.python-support.runFile', title: 'Python: Execute Current File in Terminal', category: 'Python' }
            ],
            languages: [
              { id: 'python', aliases: ['Python', 'py'], extensions: ['.py', '.pyw'] }
            ],
            configuration: {
              title: 'Python Configuration',
              properties: {
                'python.linting.enabled': { type: 'boolean', default: true, description: 'Enable real-time Python syntax and linting checks.' },
                'python.formatting.provider': { type: 'string', default: 'built-in', enum: ['built-in', 'black', 'autopep8'], description: 'Default formatter provider.' }
              }
            }
          }
        },
        enabled: true,
        isBuiltIn: true,
        installPath: path.join(this.extensionsDir, 'ty-claude.python-support'),
        installedAt: Date.now()
      },
      {
        id: 'ty-claude.typescript-support',
        manifest: {
          name: 'typescript-support',
          publisher: 'ty-claude',
          version: '1.3.1',
          displayName: 'TypeScript & JavaScript Essentials',
          description: 'Type definitions lookup, ESLint checks, import organizer, and TSConfig helper.',
          categories: ['Languages', 'Tools'],
          capabilities: ['commands.register', 'editor.read', 'editor.edit', 'window.messages'],
          contributes: {
            commands: [
              { command: 'ty-claude.typescript-support.organizeImports', title: 'TypeScript: Organize & Clean Imports', category: 'TypeScript' },
              { command: 'ty-claude.typescript-support.addMissingTypes', title: 'TypeScript: Annotate Inferred Types', category: 'TypeScript' },
              { command: 'ty-claude.typescript-support.runLint', title: 'JavaScript/TypeScript: Run ESLint Check', category: 'TypeScript' }
            ],
            languages: [
              { id: 'typescript', aliases: ['TypeScript', 'ts'], extensions: ['.ts', '.tsx'] },
              { id: 'javascript', aliases: ['JavaScript', 'js'], extensions: ['.js', '.jsx', '.mjs'] }
            ],
            configuration: {
              title: 'TypeScript Configuration',
              properties: {
                'typescript.suggest.completeFunctionCalls': { type: 'boolean', default: true, description: 'Complete function calls with parameter placeholders.' },
                'typescript.format.semicolons': { type: 'string', default: 'insert', enum: ['insert', 'remove', 'ignore'], description: 'Format semicolons style.' }
              }
            }
          }
        },
        enabled: true,
        isBuiltIn: true,
        installPath: path.join(this.extensionsDir, 'ty-claude.typescript-support'),
        installedAt: Date.now()
      },
      {
        id: 'ty-claude.gitlens-lite',
        manifest: {
          name: 'gitlens-lite',
          publisher: 'ty-claude',
          version: '2.0.0',
          displayName: 'GitLens Lite - Code Annotation & History',
          description: 'Inline file blame annotations, commit heatmaps, branch comparison, and commit SHA inspector.',
          categories: ['Git & SCM', 'Tools'],
          capabilities: ['commands.register', 'window.messages', 'git.read'],
          contributes: {
            commands: [
              { command: 'ty-claude.gitlens-lite.toggleLineBlame', title: 'GitLens: Toggle Line Blame Annotations', category: 'GitLens' },
              { command: 'ty-claude.gitlens-lite.viewFileHistory', title: 'GitLens: View File Commit History', category: 'GitLens' },
              { command: 'ty-claude.gitlens-lite.copyCommitUrl', title: 'GitLens: Copy Remote Commit URL', category: 'GitLens' }
            ],
            configuration: {
              title: 'GitLens Configuration',
              properties: {
                'gitlens.blame.statusBar': { type: 'boolean', default: true, description: 'Show Git blame in status bar and tab header.' },
                'gitlens.blame.annotationStyle': { type: 'string', default: 'compact', enum: ['compact', 'detailed'], description: 'Inline blame annotation format.' }
              }
            }
          }
        },
        enabled: true,
        isBuiltIn: true,
        installPath: path.join(this.extensionsDir, 'ty-claude.gitlens-lite'),
        installedAt: Date.now()
      },
      {
        id: 'ty-claude.prettier-formatter',
        manifest: {
          name: 'prettier-formatter',
          publisher: 'ty-claude',
          version: '3.1.0',
          displayName: 'Prettier & Code Formatter',
          description: 'Multi-language code formatting on save and selection for JS, TS, HTML, CSS, JSON, and Markdown.',
          categories: ['Linters', 'Tools'],
          capabilities: ['commands.register', 'editor.read', 'editor.edit', 'window.messages'],
          contributes: {
            commands: [
              { command: 'ty-claude.prettier-formatter.formatDocument', title: 'Format Document (Prettier)', category: 'Prettier' },
              { command: 'ty-claude.prettier-formatter.formatSelection', title: 'Format Selection', category: 'Prettier' }
            ],
            configuration: {
              title: 'Prettier Configuration',
              properties: {
                'prettier.formatOnSave': { type: 'boolean', default: true, description: 'Automatically format files upon saving.' },
                'prettier.tabWidth': { type: 'number', default: 2, description: 'Number of spaces per indentation-level.' },
                'prettier.singleQuote': { type: 'boolean', default: true, description: 'Use single quotes instead of double quotes.' }
              }
            }
          }
        },
        enabled: true,
        isBuiltIn: true,
        installPath: path.join(this.extensionsDir, 'ty-claude.prettier-formatter'),
        installedAt: Date.now()
      },
      {
        id: 'ty-claude.ai-copilot',
        manifest: {
          name: 'ai-copilot',
          publisher: 'ty-claude',
          version: '1.0.4',
          displayName: 'Ty-Code AI Copilot (Inline Assistant)',
          description: 'Context-aware code completion, prompt-to-code generation, and automated refactoring in Monaco editor.',
          categories: ['AI', 'Tools'],
          capabilities: ['commands.register', 'editor.read', 'editor.edit', 'window.messages', 'window.input', 'agent.request'],
          contributes: {
            commands: [
              { command: 'ty-claude.ai-copilot.generateCode', title: 'AI Copilot: Generate Code at Cursor', category: 'AI Copilot' },
              { command: 'ty-claude.ai-copilot.explainSelection', title: 'AI Copilot: Explain Selected Code', category: 'AI Copilot' },
              { command: 'ty-claude.ai-copilot.generateTests', title: 'AI Copilot: Generate Unit Tests', category: 'AI Copilot' }
            ],
            configuration: {
              title: 'AI Copilot Configuration',
              properties: {
                'copilot.inlineSuggestions.enabled': { type: 'boolean', default: true, description: 'Enable inline ghost text completions.' },
                'copilot.debounceMs': { type: 'number', default: 150, description: 'Typing debounce delay before requesting completions.' }
              }
            }
          }
        },
        enabled: true,
        isBuiltIn: true,
        installPath: path.join(this.extensionsDir, 'ty-claude.ai-copilot'),
        installedAt: Date.now()
      }
    ];
  }

  async init(): Promise<void> {
    if (this.initialized) return;
    await fs.mkdir(this.extensionsDir, { recursive: true });

    // 1. Populate built-in extensions
    const builtIns = this.getBuiltInExtensions();
    for (const b of builtIns) {
      b.executionState = 'built-in';
      this.installedExtensions.set(b.id, b);
    }

    // 2. Load persisted user extensions
    try {
      const data = await fs.readFile(this.installedFile, 'utf-8');
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Stored extensions must be an object.');
      for (const [id, rawRecord] of Object.entries(parsed as Record<string, unknown>)) {
        try {
          const safePath = this.extensionPathForId(id);
          if (!rawRecord || typeof rawRecord !== 'object' || Array.isArray(rawRecord)) continue;
          const record = rawRecord as { enabled?: unknown; settings?: unknown; manifest?: unknown; executionState?: unknown; installPath?: unknown };
          const builtIn = this.installedExtensions.get(id);
          if (builtIn) {
            const settings = record.settings === undefined ? builtIn.settings : this.validateSettings(builtIn.manifest, record.settings);
            builtIn.enabled = typeof record.enabled === 'boolean' ? record.enabled : builtIn.enabled;
            builtIn.settings = settings;
            continue;
          }
          if (!record.manifest) continue;
          const manifest = ExtensionManifestSchema.parse(record.manifest);
          if (`${manifest.publisher}.${manifest.name}` !== id) continue;
          const settings = record.settings === undefined ? {} : this.validateSettings(manifest, record.settings);
          const executionState = record.executionState === 'installed' ? 'installed' : 'metadata-only';
          let installPath = safePath;
          if (typeof record.installPath === 'string' && record.installPath) {
            const resolved = path.resolve(record.installPath);
            const base = path.resolve(this.extensionsDir);
            if (resolved.startsWith(`${base}${path.sep}`)) {
              installPath = resolved;
            }
          }
          const enabled = executionState === 'installed' && typeof record.enabled === 'boolean' ? record.enabled : false;
          this.installedExtensions.set(id, {
            id,
            manifest,
            enabled,
            isBuiltIn: false,
            installPath,
            installedAt: Date.now(),
            settings,
            executionState
          });
        } catch (error) {
          console.warn(`[Extensions] Ignoring invalid stored extension "${id}":`, error);
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        const backupPath = `${this.installedFile}.corrupt-${Date.now()}.bak`;
        await fs.rename(this.installedFile, backupPath).catch(() => undefined);
        console.error(`[Extensions] Preserved invalid extension registry at ${backupPath}.`, error);
      }
      await this.persist();
    }

    this.initialized = true;

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { extensionHost } = require('./extensions/extension-host');
      for (const ext of this.installedExtensions.values()) {
        void extensionHost.registerExtension(ext);
      }
    } catch {
      // ignore if running in test environment without full extension host
    }
  }

  async persist(): Promise<void> {
    const records: Record<string, { enabled: boolean; settings?: Record<string, unknown>; manifest?: ExtensionManifest; executionState?: string; installPath?: string }> = {};
    for (const [id, ext] of this.installedExtensions.entries()) {
      records[id] = {
        enabled: ext.enabled,
        settings: ext.settings,
        manifest: ext.isBuiltIn ? undefined : ext.manifest,
        executionState: ext.executionState,
        installPath: ext.installPath
      };
    }
    const tempFile = `${this.installedFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempFile, JSON.stringify(records, null, 2), 'utf-8');
    await fs.rename(tempFile, this.installedFile);
  }

  getInstalledExtensions(): InstalledExtension[] {
    return Array.from(this.installedExtensions.values());
  }

  async registerInstalledExtension(installed: InstalledExtension): Promise<void> {
    await this.init();
    this.installedExtensions.set(installed.id, installed);
    await this.persist();
  }

  async installExtension(metadata: ExtensionMetadata | ExtensionManifest): Promise<InstalledExtension> {
    await this.init();
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new Error('Extension metadata must be an object.');
    const fromMarketplace = 'namespace' in metadata;
    const validMetadata = fromMarketplace ? ExtensionMetadataSchema.parse(metadata) : undefined;
    let manifestInput: unknown;
    const id = fromMarketplace
      ? validMetadata!.id
      : `${(metadata as ExtensionManifest).publisher}.${(metadata as ExtensionManifest).name}`;
    ExtensionIdSchema.parse(id);
    if (this.installedExtensions.get(id)?.isBuiltIn) throw new Error(`Built-in extension "${id}" cannot be replaced.`);
    if (this.installedExtensions.has(id)) throw new Error(`Extension "${id}" is already installed.`);

    let manifest: ExtensionManifest;
    if ('manifest' in metadata) {
      manifestInput = (metadata as unknown as { manifest: unknown }).manifest;
    } else if ('contributes' in metadata) {
      manifestInput = metadata;
    } else {
      const m = validMetadata!;
      manifestInput = {
        name: m.name,
        publisher: m.namespace,
        version: m.version,
        displayName: m.displayName || m.name,
        description: m.description,
        icon: m.iconUrl,
        categories: m.categories || ['Tools'],
        contributes: {}
      };
    }

    manifest = ExtensionManifestSchema.parse(manifestInput);
    if (`${manifest.publisher}.${manifest.name}` !== id) throw new Error('Extension ID must match the manifest publisher and name.');
    // Marketplace records are discovery metadata only; no files or executable package code are installed.
    const extPath = this.extensionPathForId(id);

    const installed: InstalledExtension = {
      id,
      manifest,
      enabled: false,
      isBuiltIn: false,
      installPath: extPath,
      installedAt: Date.now(),
      settings: {},
      executionState: 'metadata-only'
    };

    this.installedExtensions.set(id, installed);
    await this.persist();
    return installed;
  }

  async uninstallExtension(id: string): Promise<void> {
    await this.init();
    const ext = this.installedExtensions.get(ExtensionIdSchema.parse(id));
    if (!ext) throw new Error(`Extension "${id}" is not installed.`);
    if (ext.isBuiltIn) throw new Error(`Built-in extension "${id}" cannot be uninstalled. Disable it instead.`);

    const safePath = this.extensionPathForId(id);
    const resolvedPath = path.resolve(ext.installPath);
    const base = path.resolve(this.extensionsDir);
    if (resolvedPath !== safePath && !resolvedPath.startsWith(`${base}${path.sep}`)) {
      throw new Error('Stored extension path failed containment validation.');
    }
    if (ext.executionState === 'installed' && existsSync(ext.installPath)) {
      await fs.rm(ext.installPath, { recursive: true, force: true }).catch(() => undefined);
    }
    this.installedExtensions.delete(id);
    await this.persist();
  }

  async toggleExtension(id: string, enabled: boolean): Promise<InstalledExtension> {
    await this.init();
    const ext = this.installedExtensions.get(ExtensionIdSchema.parse(id));
    if (!ext) throw new Error(`Extension "${id}" not found.`);
    if (enabled && !ext.isBuiltIn && ext.executionState === 'metadata-only') {
      throw new Error('Community extension execution is disabled until the third-party runtime completes security review.');
    }
    if (typeof enabled !== 'boolean') throw new Error('Extension enabled state must be boolean.');

    ext.enabled = enabled;
    await this.persist();

    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { extensionHost } = require('./extensions/extension-host');
      if (enabled) {
        await extensionHost.enableExtension(ext.id);
      } else {
        await extensionHost.disableExtension(ext.id);
      }
    } catch {
      // ignore
    }

    return ext;
  }

  async updateSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    await this.init();
    const ext = this.installedExtensions.get(ExtensionIdSchema.parse(id));
    if (!ext) throw new Error(`Extension "${id}" not found.`);
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) throw new Error('Extension settings must be an object.');

    const merged = { ...(ext.settings || {}), ...settings };
    ext.settings = this.validateSettings(ext.manifest, merged);
    await this.persist();
  }

  async installFromVsix(filePath: string): Promise<InstalledExtension> {
    await this.init();
    if (!filePath || !existsSync(filePath)) {
      throw new Error('VSIX package file is unavailable or does not exist at specified path.');
    }
    // Delegate to installer
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { extensionInstaller } = require('./marketplace/installer');
    const result = await extensionInstaller.installFromVsix(filePath);
    if (!result.success || !result.installedExtension) {
      throw new Error(result.error || 'VSIX installation failed.');
    }
    return result.installedExtension as InstalledExtension;
  }
}

export const extensionManager = new ExtensionManager();
