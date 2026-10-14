import type { ExtensionManifest } from '../../../preload/types';

type BuiltInApi = {
  editor: { getActiveDocument: () => Promise<{ text: string } | null>; applyActiveEdit: (content: string) => Promise<boolean> };
  commands: { registerCommand: (id: string, title: string, callback: () => unknown) => void };
  window: { showMessage: (message: string) => Promise<void> };
};

export function activatePrettierFormatter(api: BuiltInApi, manifest: ExtensionManifest): void {
  const prefix = `${manifest.publisher}.${manifest.name}.`;
  const format = async () => {
    const document = await api.editor.getActiveDocument();
    if (!document) return;
    const formatted = document.text.split('\n').map((line) => line.trimEnd()).join('\n');
    await api.editor.applyActiveEdit(formatted);
    await api.window.showMessage('Trailing whitespace removed from the active document.');
  };
  api.commands.registerCommand(`${prefix}formatDocument`, 'Format Document (Trim Trailing Spaces)', format);
  api.commands.registerCommand(`${prefix}formatSelection`, 'Format Active Document', format);
}
