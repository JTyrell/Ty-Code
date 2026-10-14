import type { ExtensionManifest } from '../../../preload/types';

type BuiltInApi = {
  editor: { getActiveDocument: () => Promise<{ text: string } | null>; applyActiveEdit: (content: string) => Promise<boolean> };
  commands: { registerCommand: (id: string, title: string, callback: () => unknown) => void };
  window: { showMessage: (message: string) => Promise<void> };
  terminal: { open: () => Promise<void> };
};

export function activatePythonSupport(api: BuiltInApi, manifest: ExtensionManifest): void {
  const prefix = `${manifest.publisher}.${manifest.name}.`;
  api.commands.registerCommand(`${prefix}createDocstring`, 'Python: Generate Docstring Template', async () => {
    const document = await api.editor.getActiveDocument();
    if (!document) return;
    const content = `${document.text.replace(/\s*$/, '')}\n    """\n    Summary of function.\n\n    Args:\n        param1: Description.\n\n    Returns:\n        Description of return value.\n    """\n`;
    await api.editor.applyActiveEdit(content);
    await api.window.showMessage('Python docstring template inserted at the end of the active document.');
  });
  api.commands.registerCommand(`${prefix}lintFile`, 'Python: Run Linter & Static Analysis', async () => {
    const document = await api.editor.getActiveDocument();
    if (!document) return;
    const issues: string[] = [];
    document.text.split('\n').forEach((line, index) => {
      if (/def\s+\w+\([^)]*$/.test(line)) issues.push(`Line ${index + 1}: Unclosed function parameter parentheses`);
      if (/^\s*except:\s*$/.test(line)) issues.push(`Line ${index + 1}: Bare 'except:' clause is discouraged`);
    });
    await api.window.showMessage(issues.length ? `Python checks found ${issues.length} issue(s):\n${issues.join('\n')}` : 'Python checks found no obvious issues.');
  });
  api.commands.registerCommand(`${prefix}runFile`, 'Python: Open Terminal', async () => {
    await api.terminal.open();
    await api.window.showMessage('Terminal opened. Review and run the Python command yourself.');
  });
}
