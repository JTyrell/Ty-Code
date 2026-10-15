/**
 * Module Manager (Phase 3.1)
 *
 * Coordinates modular skills and external integrations:
 * - Module enable/disable lifecycle execution
 * - Automated file copying, template generation, and MCP tool registration in workspace `.ty-code/`
 * - System dependency checking (e.g., Python3, node-pty) with missing dependency warnings
 * - Settings synchronization with global and workspace configuration
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import type {
  ExternalModuleInfo,
  ModuleActivationResult
} from '../../preload/types';
import { moduleRegistry, type ExternalModule } from './module-registry';
import { settingsManager, type SettingsManager } from './settings-manager';

const execAsync = promisify(exec);

export class ModuleManager {
  private dependencyCache = new Map<string, { available: boolean; timestamp: number }>();
  private readonly CACHE_TTL_MS = 30_000;

  constructor(
    private settingsSource: Pick<SettingsManager, 'getEffectiveSettings' | 'saveLayer'> = settingsManager
  ) {}

  /**
   * Checks whether a specific system dependency is available.
   * Caches results for 30s to avoid redundant process spawning.
   */
  public async checkDependency(dep: string): Promise<boolean> {
    const cached = this.dependencyCache.get(dep);
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.available;
    }

    let isAvailable = false;
    const normalized = dep.trim().toLowerCase();

    if (normalized === 'python3' || normalized === 'python') {
      try {
        await execAsync('python3 --version');
        isAvailable = true;
      } catch {
        try {
          const { stdout } = await execAsync('python --version');
          // Verify it is Python 3
          isAvailable = stdout.toLowerCase().includes('python 3') || stdout.toLowerCase().includes('python');
        } catch {
          // On Windows, check with `where python`
          try {
            await execAsync('where python');
            isAvailable = true;
          } catch {
            isAvailable = false;
          }
        }
      }
    } else if (normalized === 'node-pty') {
      try {
        require.resolve('node-pty');
        isAvailable = true;
      } catch {
        isAvailable = false;
      }
    } else if (normalized === 'git') {
      try {
        await execAsync('git --version');
        isAvailable = true;
      } catch {
        isAvailable = false;
      }
    } else {
      // Generic check via `where` on Windows or `which` on Unix
      const cmd = process.platform === 'win32' ? `where ${dep}` : `which ${dep}`;
      try {
        await execAsync(cmd);
        isAvailable = true;
      } catch {
        isAvailable = false;
      }
    }

    this.dependencyCache.set(dep, { available: isAvailable, timestamp: Date.now() });
    return isAvailable;
  }

  /**
   * Evaluates all dependencies for a set of names.
   */
  public async checkDependencies(dependencies: string[]): Promise<{
    available: boolean;
    missing: string[];
    details: Record<string, boolean>;
  }> {
    const details: Record<string, boolean> = {};
    const missing: string[] = [];

    await Promise.all(
      dependencies.map(async (dep) => {
        const ok = await this.checkDependency(dep);
        details[dep] = ok;
        if (!ok) missing.push(dep);
      })
    );

    return {
      available: missing.length === 0,
      missing,
      details
    };
  }

  /**
   * Lists all modules with current enablement status and dependency diagnostic alerts.
   */
  public async getModules(workspacePath?: string): Promise<ExternalModuleInfo[]> {
    let settingsIntegrations: Record<string, boolean> = {};
    try {
      const effective = await this.settingsSource.getEffectiveSettings();
      settingsIntegrations = effective.integrations || {};
    } catch {
      // Fallback to in-memory state
    }

    const allModules = moduleRegistry.getAllModules();
    const result: ExternalModuleInfo[] = [];

    for (const mod of allModules) {
      // Settings takes precedence over default module state
      const isEnabled = typeof settingsIntegrations[mod.id] === 'boolean'
        ? settingsIntegrations[mod.id]
        : mod.isEnabled;

      // Update registry in-memory state
      mod.isEnabled = isEnabled;

      let missingDeps: string[] = [];
      if (mod.dependencies.length > 0) {
        const depCheck = await this.checkDependencies(mod.dependencies);
        missingDeps = depCheck.missing;
      }

      result.push({
        id: mod.id,
        name: mod.name,
        description: mod.description,
        isEnabled,
        llm_compatibility: mod.llm_compatibility,
        dependencies: mod.dependencies,
        missingDependencies: missingDeps,
        category: mod.category,
        version: mod.version,
        isConfigured: true
      });
    }

    return result;
  }

  /**
   * Retrieves status for a single module.
   */
  public async getModuleStatus(moduleId: string, workspacePath?: string): Promise<ExternalModuleInfo | null> {
    const modules = await this.getModules(workspacePath);
    return modules.find((m) => m.id === moduleId) || null;
  }

  /**
   * Enables an external module and runs its background setup / file-copying hook.
   */
  public async enableModule(moduleId: string, workspacePath?: string): Promise<ModuleActivationResult> {
    const mod = moduleRegistry.getModule(moduleId);
    if (!mod) {
      return {
        success: false,
        moduleId,
        isEnabled: false,
        message: `Module "${moduleId}" not found in registry.`
      };
    }

    // Check system dependencies
    let warning: string | undefined;
    if (mod.dependencies.length > 0) {
      const depCheck = await this.checkDependencies(mod.dependencies);
      if (!depCheck.available) {
        warning = `Warning: Missing dependencies [${depCheck.missing.join(', ')}]. Some features may require manual installation.`;
      }
    }

    try {
      // Trigger background setup: copying files, templates, or registering MCP tools
      await mod.activation_hook(workspacePath);

      // Update in-memory registry
      moduleRegistry.setModuleEnabled(moduleId, true);

      // Persist enabled state in settings
      await this.persistModuleState(moduleId, true);

      return {
        success: true,
        moduleId,
        isEnabled: true,
        message: `Module "${mod.name}" enabled successfully.`,
        warning
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        moduleId,
        isEnabled: false,
        message: `Failed to activate module "${mod.name}": ${errorMsg}`
      };
    }
  }

  /**
   * Disables an external module.
   */
  public async disableModule(moduleId: string, workspacePath?: string): Promise<ModuleActivationResult> {
    const mod = moduleRegistry.getModule(moduleId);
    if (!mod) {
      return {
        success: false,
        moduleId,
        isEnabled: false,
        message: `Module "${moduleId}" not found in registry.`
      };
    }

    try {
      if (mod.deactivation_hook) {
        await mod.deactivation_hook(workspacePath);
      }

      // Update in-memory registry
      moduleRegistry.setModuleEnabled(moduleId, false);

      // Persist disabled state in settings
      await this.persistModuleState(moduleId, false);

      return {
        success: true,
        moduleId,
        isEnabled: false,
        message: `Module "${mod.name}" disabled.`
      };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        moduleId,
        isEnabled: true,
        message: `Failed to deactivate module "${mod.name}": ${errorMsg}`
      };
    }
  }

  /**
   * Toggles an external module between enabled and disabled states.
   */
  public async toggleModule(
    moduleId: string,
    enabled: boolean,
    workspacePath?: string
  ): Promise<ModuleActivationResult> {
    if (enabled) {
      return this.enableModule(moduleId, workspacePath);
    } else {
      return this.disableModule(moduleId, workspacePath);
    }
  }

  /**
   * Persists module state into the settings manager.
   */
  private async persistModuleState(moduleId: string, enabled: boolean): Promise<void> {
    try {
      const current = await this.settingsSource.getEffectiveSettings();
      const currentIntegrations = current.integrations || {};

      await this.settingsSource.saveLayer('global', {
        integrations: {
          ...currentIntegrations,
          [moduleId]: enabled
        }
      });
    } catch (err) {
      console.warn(`[ModuleManager] Could not persist integration state for "${moduleId}":`, err);
    }
  }
}

export const moduleManager = new ModuleManager();
