import type { ExtensionManifest } from '../../../preload/types';

type BuiltInApi = {
  editor: { getActiveDocument: () => Promise<{ text: string } | null>; applyActiveEdit: (content: string) => Promise<boolean> };
  commands: { registerCommand: (id: string, title: string, callback: () => unknown) => void };
  window: { showMessage: (message: string) => Promise<void>; showInput: (prompt: string, value?: string) => Promise<string | undefined> };
  agent: { request: (prompt: string) => Promise<void> };
};

export function activateAiCopilot(api: BuiltInApi, manifest: ExtensionManifest): void {
  const prefix = `${manifest.publisher}.${manifest.name}.`;
  api.commands.registerCommand(`${prefix}generateCode`, 'AI Copilot: Generate Code at Cursor', async () => {
    const document = await api.editor.getActiveDocument();
    if (!document) return;
    const request = await api.window.showInput('Describe the code change to request from the AI assistant.');
    if (request) await api.agent.request(request);
  });
  api.commands.registerCommand(`${prefix}explainSelection`, 'AI Copilot: Explain Selected Code', async () => {
    const document = await api.editor.getActiveDocument();
    if (document) await api.agent.request('Explain the active file and highlight its main responsibilities.');
  });
  api.commands.registerCommand(`${prefix}generateTests`, 'AI Copilot: Generate Unit Tests', async () => {
    const document = await api.editor.getActiveDocument();
    if (document) await api.agent.request('Create or update appropriate tests for the active file. Inspect the project test conventions first.');
  });
}
