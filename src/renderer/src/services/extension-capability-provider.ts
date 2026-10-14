import type { ExtensionCapability, ExtensionCapabilityRequest, InstalledExtension } from '../../../preload/types';
import type { ExtensionDocument, ExtensionCapabilityProvider as ProviderContract } from '../../../main/services/extension-api';
import { useChatStore } from '../state/chat-store';
import { useExtensionStore } from '../state/extension-store';
import { useGitStore } from '../state/git-store';
import { useWorkspaceStore } from '../state/workspace-store';
import { toast } from '../state/toast-store';
import { useExtensionPromptStore } from '../state/extension-prompt-store';

export type ExtensionCapabilityMethod =
  | 'workspace.read-file' | 'workspace.write-file'
  | 'editor.get-active-document' | 'editor.apply-active-edit'
  | 'window.show-message' | 'window.show-input' | 'terminal.open' | 'agent.request'
  | 'git.refresh' | 'git.copy-remote-url';

export class ElectronCapabilityProvider implements ProviderContract {
  private activeExtensions = new Map<string, InstalledExtension>();
  private commandRegistration: ((extensionId: string, commandId: string, title: string) => () => void) | null = null;
  private commandExecutor: ((extensionId: string, commandId: string, args: unknown[]) => Promise<unknown>) | null = null;

  bindCommandRegistry(
    register: (extensionId: string, commandId: string, title: string) => () => void,
    execute: (extensionId: string, commandId: string, args: unknown[]) => Promise<unknown>
  ): void {
    this.commandRegistration = register;
    this.commandExecutor = execute;
  }

  setActiveExtensions(extensions: InstalledExtension[]): void {
    this.activeExtensions = new Map(extensions.map((extension) => [extension.id, extension]));
  }

  private requireCapability(extensionId: string, capability: ExtensionCapability): InstalledExtension {
    const extension = this.activeExtensions.get(extensionId);
    if (!extension?.isBuiltIn || !extension.enabled || extension.executionState !== 'built-in') {
      throw new Error('Only enabled built-in extensions may use Ty-Code Extension API capabilities.');
    }
    if (!(extension.manifest.capabilities || []).includes(capability)) {
      throw new Error(`Extension "${extensionId}" has not declared "${capability}".`);
    }
    return extension;
  }

  private async workspaceRequest(extensionId: string, capability: 'workspace.fs.read' | 'workspace.fs.write', method: ExtensionCapabilityRequest['method'], relativePath: string, content?: string): Promise<unknown> {
    this.requireCapability(extensionId, capability);
    const response = await window.electronAPI.extensionCapability({ extensionId, capability, method, relativePath, content });
    if (!response.success) throw new Error(response.error || 'Workspace capability request failed.');
    return response.data;
  }

  workspace = {
    readFile: async (relativePath: string): Promise<string> => String(await this.workspaceRequest(this.currentExtensionId(), 'workspace.fs.read', 'workspace.read-file', relativePath) ?? ''),
    writeFile: async (relativePath: string, content: string): Promise<void> => { await this.workspaceRequest(this.currentExtensionId(), 'workspace.fs.write', 'workspace.write-file', relativePath, content); }
  };

  commands = {
    register: (commandId: string, title: string) => {
      const extensionId = this.currentExtensionId();
      this.requireCapability(extensionId, 'commands.register');
      const dispose = this.commandRegistration?.(extensionId, commandId, title);
      return { dispose: dispose || (() => undefined) };
    },
    execute: async (commandId: string, args: unknown[]): Promise<unknown> => {
      const extensionId = this.currentExtensionId();
      this.requireCapability(extensionId, 'commands.register');
      if (!this.commandExecutor) throw new Error('Command execution is unavailable.');
      return this.commandExecutor(extensionId, commandId, args);
    }
  };

  editor = {
    getActiveDocument: async (): Promise<ExtensionDocument | null> => {
      this.requireCapability(this.currentExtensionId(), 'editor.read');
      const { openTabs, activeTabPath } = useWorkspaceStore.getState();
      const tab = openTabs.find((item) => item.path === activeTabPath);
      return tab ? { uri: tab.path, fileName: tab.name, languageId: tab.language, lineCount: tab.content.split('\n').length, text: tab.content } : null;
    },
    applyActiveEdit: async (content: string): Promise<boolean> => {
      this.requireCapability(this.currentExtensionId(), 'editor.edit');
      const { activeTabPath, openTabs, updateTabContent } = useWorkspaceStore.getState();
      const tab = openTabs.find((item) => item.path === activeTabPath);
      if (!tab) return false;
      updateTabContent(tab.path, content);
      return true;
    }
  };

  languages = {
    registerCompletionProvider: (): never => { throw new Error('Language provider registration is not available in the built-in runtime.'); },
    registerHoverProvider: (): never => { throw new Error('Language provider registration is not available in the built-in runtime.'); }
  };

  window = {
    showMessage: async (message: string): Promise<void> => {
      this.requireCapability(this.currentExtensionId(), 'window.messages');
      toast.info('Extension', message.slice(0, 2_000));
    },
    showInput: async (prompt: string, value?: string): Promise<string | undefined> => {
      this.requireCapability(this.currentExtensionId(), 'window.input');
      return useExtensionPromptStore.getState().requestInput(prompt, value);
    }
  };

  terminal = {
    open: async (): Promise<void> => {
      this.requireCapability(this.currentExtensionId(), 'terminal.open');
      const { isTerminalOpen, toggleTerminal } = useChatStore.getState();
      if (!isTerminalOpen) toggleTerminal();
    },
    sendText: async (_text: string): Promise<void> => {
      throw new Error('Terminal command execution requires an explicit user action and is not exposed to extensions.');
    }
  };

  agent = {
    request: async (prompt: string): Promise<void> => {
      this.requireCapability(this.currentExtensionId(), 'agent.request');
      const workspace = useWorkspaceStore.getState();
      if (!workspace.workspacePath) throw new Error('Open a workspace before requesting AI assistance.');
      const activeTab = workspace.openTabs.find((item) => item.path === workspace.activeTabPath);
      await useChatStore.getState().sendMessage(prompt, workspace.workspacePath, activeTab?.path, activeTab?.content);
    }
  };

  webviews = { create: (): never => { throw new Error('Extension webviews are not available in this release.'); } };

  git = {
    refresh: async (): Promise<void> => {
      this.requireCapability(this.currentExtensionId(), 'git.read');
      await useGitStore.getState().refreshStatus();
    },
    copyRemoteUrl: async (): Promise<string> => {
      this.requireCapability(this.currentExtensionId(), 'git.read');
      const remoteUrl = useGitStore.getState().status?.remoteUrl || '';
      if (remoteUrl) await navigator.clipboard.writeText(remoteUrl);
      return remoteUrl;
    }
  };

  private currentId = '';
  setCurrentExtension(extensionId: string): void { this.currentId = extensionId; }
  private currentExtensionId(): string { return this.currentId; }
}

export interface WebCapabilityProvider extends ProviderContract {
  readonly providerKind: 'web';
}

export class DeferredWebCapabilityProvider implements WebCapabilityProvider {
  readonly providerKind = 'web' as const;
  private unsupported(): never { throw new Error('Browser workspace capabilities are not configured.'); }
  workspace = { readFile: async (_path: string): Promise<string> => this.unsupported(), writeFile: async (_path: string, _content: string): Promise<void> => this.unsupported() };
  commands = { register: (_id: string, _title: string) => ({ dispose: () => undefined }), execute: async (_id: string, _args: unknown[]): Promise<unknown> => this.unsupported() };
  editor = { getActiveDocument: async (): Promise<ExtensionDocument | null> => this.unsupported(), applyActiveEdit: async (_content: string): Promise<boolean> => this.unsupported() };
  languages = { registerCompletionProvider: (): never => this.unsupported(), registerHoverProvider: (): never => this.unsupported() };
  window = { showMessage: async (_message: string): Promise<void> => this.unsupported(), showInput: async (_prompt: string): Promise<string | undefined> => this.unsupported() };
  terminal = { open: async (): Promise<void> => this.unsupported(), sendText: async (_text: string): Promise<void> => this.unsupported() };
  webviews = { create: (): never => this.unsupported() };
  agent = { request: async (_prompt: string): Promise<void> => this.unsupported() };
  git = { refresh: async (): Promise<void> => this.unsupported(), copyRemoteUrl: async (): Promise<string> => this.unsupported() };
}
