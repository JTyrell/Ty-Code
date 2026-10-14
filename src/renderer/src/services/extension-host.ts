import type { InstalledExtension, ExtensionCommand } from '../../../preload/types';
import { ElectronCapabilityProvider } from './extension-capability-provider';
import { ExtensionWorkerHost } from './extension-worker-host';

export interface Disposable { dispose: () => void; }
export type CommandHandler = (...args: unknown[]) => Promise<unknown> | unknown;

export class ExtensionHost {
  private providerByExtension = new Map<string, ElectronCapabilityProvider>();
  private workerHost = new ExtensionWorkerHost((extensionId) => {
    let provider = this.providerByExtension.get(extensionId);
    if (!provider) {
      provider = new ElectronCapabilityProvider();
      provider.setCurrentExtension(extensionId);
      this.providerByExtension.set(extensionId, provider);
    }
    provider.setActiveExtensions(this.activeExtensions);
    return provider;
  });
  private activeExtensions: InstalledExtension[] = [];

  getRegisteredCommands(): ExtensionCommand[] {
    return this.workerHost.getRegisteredCommands().map((command) => ({ ...command, category: 'Extension', isBuiltIn: true }));
  }

  hasCommand(commandId: string): boolean { return this.workerHost.getRegisteredCommands().some((command) => command.id === commandId); }

  async executeCommand(commandId: string, ...args: unknown[]): Promise<unknown> {
    const owner = this.workerHost.getRegisteredCommands().find((command) => command.id === commandId)?.extensionId;
    if (!owner) throw new Error(`Command "${commandId}" is not registered or its extension is disabled.`);
    return await this.workerHost.executeCommand(owner, commandId, args);
  }

  async initializeExtensions(extensions: InstalledExtension[]): Promise<void> {
    this.activeExtensions = extensions;
    for (const provider of this.providerByExtension.values()) provider.setActiveExtensions(extensions);
    await this.workerHost.initialize(extensions);
  }

  async activateBuiltInExtension(extension: InstalledExtension): Promise<void> {
    this.activeExtensions = this.activeExtensions.map((item) => item.id === extension.id ? extension : item);
    if (extension.enabled && extension.isBuiltIn && extension.executionState === 'built-in') {
      await this.workerHost.activate(extension);
    } else {
      this.workerHost.deactivate(extension.id);
    }
  }

  deactivateExtension(extensionId: string): void {
    this.workerHost.deactivate(extensionId);
    this.providerByExtension.delete(extensionId);
  }

}

export const extensionHost = new ExtensionHost();
