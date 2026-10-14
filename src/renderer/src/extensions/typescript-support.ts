import type { ExtensionManifest } from '../../../preload/types';

type BuiltInApi = {
  editor: { getActiveDocument: () => Promise<{ text: string } | null>; applyActiveEdit: (content: string) => Promise<boolean> };
  commands: { registerCommand: (id: string, title: string, callback: () => unknown) => void };
  window: { showMessage: (message: string) => Promise<void> };
};

export function activateTypescriptSupport(api: BuiltInApi, manifest: ExtensionManifest): void {
  const prefix = `${manifest.publisher}.${manifest.name}.`;
  api.commands.registerCommand(`${prefix}organizeImports`, 'TypeScript: Organize & Clean Imports', async () => {
    const document = await api.editor.getActiveDocument();
    if (!document) return;
    const lines = document.text.split('\n');
    const imports = lines.filter((line) => line.trim().startsWith('import ')).sort();
    const body = lines.filter((line) => !line.trim().startsWith('import '));
    await api.editor.applyActiveEdit([...imports, ...(imports.length ? [''] : []), ...body].join('\n'));
    await api.window.showMessage('Imports sorted and organized.');
  });
  api.commands.registerCommand(`${prefix}addMissingTypes`, 'TypeScript: Annotate Inferred Types', async () => {
    await api.window.showMessage('Type annotation analysis is not available yet.');
  });
  api.commands.registerCommand(`${prefix}runLint`, 'JavaScript/TypeScript: Run Checks', async () => {
    await api.window.showMessage('TypeScript diagnostics are provided by the configured language server.');
  });
}
