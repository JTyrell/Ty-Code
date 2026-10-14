import fs from 'fs/promises';
import path from 'path';
import os from 'os';
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

  constructor(customBaseDir?: string) {
    const base = customBaseDir || getElectronUserData() || os.homedir();
    this.extensionsDir = path.join(base, '.ty-claude', 'extensions');
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
          contributes: {
            commands: [
              { command: 'python.createDocstring', title: 'Python: Generate Docstring Template', category: 'Python' },
              { command: 'python.lintFile', title: 'Python: Run Linter & Static Analysis', category: 'Python' },
              { command: 'python.runFile', title: 'Python: Execute Current File in Terminal', category: 'Python' }
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
          contributes: {
            commands: [
              { command: 'typescript.organizeImports', title: 'TypeScript: Organize & Clean Imports', category: 'TypeScript' },
              { command: 'typescript.addMissingTypes', title: 'TypeScript: Annotate Inferred Types', category: 'TypeScript' },
              { command: 'typescript.runLint', title: 'JavaScript/TypeScript: Run ESLint Check', category: 'TypeScript' }
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
          contributes: {
            commands: [
              { command: 'gitlens.toggleLineBlame', title: 'GitLens: Toggle Line Blame Annotations', category: 'GitLens' },
              { command: 'gitlens.viewFileHistory', title: 'GitLens: View File Commit History', category: 'GitLens' },
              { command: 'gitlens.copyCommitUrl', title: 'GitLens: Copy Remote Commit URL', category: 'GitLens' }
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
          contributes: {
            commands: [
              { command: 'prettier.formatDocument', title: 'Format Document (Prettier)', category: 'Prettier' },
              { command: 'prettier.formatSelection', title: 'Format Selection', category: 'Prettier' }
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
          displayName: 'Ty-Claude AI Copilot (Inline Assistant)',
          description: 'Context-aware code completion, prompt-to-code generation, and automated refactoring in Monaco editor.',
          categories: ['AI', 'Tools'],
          contributes: {
            commands: [
              { command: 'copilot.generateCode', title: 'AI Copilot: Generate Code at Cursor', category: 'AI Copilot' },
              { command: 'copilot.explainSelection', title: 'AI Copilot: Explain Selected Code', category: 'AI Copilot' },
              { command: 'copilot.generateTests', title: 'AI Copilot: Generate Unit Tests', category: 'AI Copilot' }
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
      this.installedExtensions.set(b.id, b);
    }

    // 2. Load persisted user extensions
    try {
      const data = await fs.readFile(this.installedFile, 'utf-8');
      const parsed = JSON.parse(data) as Record<string, { enabled?: boolean; settings?: Record<string, unknown>; manifest?: ExtensionManifest }>;
      for (const [id, record] of Object.entries(parsed)) {
        if (this.installedExtensions.has(id)) {
          // Merge enabled state and settings for built-ins
          const existing = this.installedExtensions.get(id)!;
          existing.enabled = record.enabled ?? existing.enabled;
          existing.settings = record.settings || existing.settings;
        } else if (record.manifest) {
          // User installed extension
          this.installedExtensions.set(id, {
            id,
            manifest: record.manifest,
            enabled: record.enabled ?? true,
            isBuiltIn: false,
            installPath: path.join(this.extensionsDir, id),
            installedAt: Date.now(),
            settings: record.settings || {}
          });
        }
      }
    } catch {
      // First boot or no installed.json yet
      await this.persist();
    }

    this.initialized = true;
  }

  private async persist(): Promise<void> {
    const records: Record<string, { enabled: boolean; settings?: Record<string, unknown>; manifest?: ExtensionManifest }> = {};
    for (const [id, ext] of this.installedExtensions.entries()) {
      records[id] = {
        enabled: ext.enabled,
        settings: ext.settings,
        manifest: ext.isBuiltIn ? undefined : ext.manifest
      };
    }
    await fs.writeFile(this.installedFile, JSON.stringify(records, null, 2), 'utf-8');
  }

  getInstalledExtensions(): InstalledExtension[] {
    return Array.from(this.installedExtensions.values());
  }

  async installExtension(metadata: ExtensionMetadata | ExtensionManifest): Promise<InstalledExtension> {
    await this.init();
    const id = 'id' in metadata && metadata.id ? metadata.id : `${(metadata as ExtensionManifest).publisher}.${(metadata as ExtensionManifest).name}`;

    let manifest: ExtensionManifest;
    if ('manifest' in metadata) {
      manifest = (metadata as unknown as { manifest: ExtensionManifest }).manifest;
    } else if ('contributes' in metadata) {
      manifest = metadata as ExtensionManifest;
    } else {
      const m = metadata as ExtensionMetadata;
      manifest = {
        name: m.name,
        publisher: m.namespace,
        version: m.version,
        displayName: m.displayName || m.name,
        description: m.description,
        icon: m.iconUrl,
        categories: m.categories || ['Tools'],
        contributes: {
          commands: [
            { command: `${m.name}.activate`, title: `${m.displayName || m.name}: Launch Action`, category: m.displayName || m.name }
          ]
        }
      };
    }

    const extPath = path.join(this.extensionsDir, id);
    await fs.mkdir(extPath, { recursive: true });
    await fs.writeFile(path.join(extPath, 'package.json'), JSON.stringify(manifest, null, 2), 'utf-8');

    const installed: InstalledExtension = {
      id,
      manifest,
      enabled: true,
      isBuiltIn: false,
      installPath: extPath,
      installedAt: Date.now(),
      settings: {}
    };

    this.installedExtensions.set(id, installed);
    await this.persist();
    return installed;
  }

  async uninstallExtension(id: string): Promise<void> {
    await this.init();
    const ext = this.installedExtensions.get(id);
    if (!ext) throw new Error(`Extension "${id}" is not installed.`);
    if (ext.isBuiltIn) throw new Error(`Built-in extension "${id}" cannot be uninstalled. Disable it instead.`);

    this.installedExtensions.delete(id);
    await fs.rm(ext.installPath, { recursive: true, force: true }).catch(() => undefined);
    await this.persist();
  }

  async toggleExtension(id: string, enabled: boolean): Promise<InstalledExtension> {
    await this.init();
    const ext = this.installedExtensions.get(id);
    if (!ext) throw new Error(`Extension "${id}" not found.`);

    ext.enabled = enabled;
    await this.persist();
    return ext;
  }

  async updateSettings(id: string, settings: Record<string, unknown>): Promise<void> {
    await this.init();
    const ext = this.installedExtensions.get(id);
    if (!ext) throw new Error(`Extension "${id}" not found.`);

    ext.settings = { ...ext.settings, ...settings };
    await this.persist();
  }

  async installFromVsix(filePath: string): Promise<InstalledExtension> {
    await this.init();
    // Validate file exists
    await fs.access(filePath);
    const fileName = path.basename(filePath, '.vsix');
    const [publisher, name] = fileName.includes('.') ? fileName.split('.') : ['custom', fileName];

    // Read or construct package manifest
    const manifest: ExtensionManifest = {
      name: name || fileName,
      publisher: publisher || 'local',
      version: '1.0.0',
      displayName: name || fileName,
      description: `Installed locally from VSIX package (${path.basename(filePath)})`,
      categories: ['Tools'],
      contributes: {
        commands: [
          { command: `${name}.open`, title: `${name}: Execute Command`, category: name }
        ]
      }
    };

    return await this.installExtension(manifest);
  }
}

export const extensionManager = new ExtensionManager();
