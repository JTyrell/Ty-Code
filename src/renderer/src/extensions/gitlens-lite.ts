import type { ExtensionManifest } from '../../../preload/types';

type BuiltInApi = {
  commands: { registerCommand: (id: string, title: string, callback: () => unknown) => void };
  window: { showMessage: (message: string) => Promise<void> };
  git: { refresh: () => Promise<void>; copyRemoteUrl: () => Promise<string> };
};

export function activateGitlensLite(api: BuiltInApi, manifest: ExtensionManifest): void {
  const prefix = `${manifest.publisher}.${manifest.name}.`;
  api.commands.registerCommand(`${prefix}toggleLineBlame`, 'GitLens: Toggle Line Blame Annotations', async () => {
    await api.git.refresh();
    await api.window.showMessage('Source Control data refreshed.');
  });
  api.commands.registerCommand(`${prefix}viewFileHistory`, 'GitLens: View File Commit History', async () => {
    await api.git.refresh();
    await api.window.showMessage('Repository history refreshed in Source Control.');
  });
  api.commands.registerCommand(`${prefix}copyCommitUrl`, 'GitLens: Copy Remote Commit URL', async () => {
    const remote = await api.git.copyRemoteUrl();
    await api.window.showMessage(remote ? `Copied repository remote: ${remote}` : 'No repository remote is configured.');
  });
}
