/**
 * Ty-Code Editor Settings & Keybindings Schemas
 * Standard JSON schema definitions and defaults matching VS Code specifications.
 */

export interface KeybindingItem {
  command: string;
  key: string;
  mac?: string;
  when?: string;
  category?: string;
  description?: string;
}

export interface EditorSettingsConfig {
  'editor.fontSize': number;
  'editor.fontFamily': string;
  'editor.tabSize': number;
  'editor.insertSpaces': boolean;
  'editor.wordWrap': 'off' | 'on' | 'wordWrapColumn' | 'bounded';
  'editor.minimap.enabled': boolean;
  'editor.minimap.side': 'right' | 'left';
  'editor.bracketPairColorization.enabled': boolean;
  'editor.guides.indentation': boolean;
  'editor.guides.bracketPairs': boolean;
  'editor.guides.highlightActiveIndentation': boolean;
  'editor.autoSave': 'off' | 'afterDelay' | 'onFocusChange';
  'editor.autoSaveDelay': number;
  'editor.lineNumbers': 'on' | 'off' | 'relative';
  'editor.renderWhitespace': 'none' | 'boundary' | 'selection' | 'trailing' | 'all';
  'editor.multiCursorModifier': 'alt' | 'ctrlCmd';
  'editor.formatOnSave': boolean;
  'editor.zenMode': boolean;
  'workbench.splitOrientation': 'horizontal' | 'vertical';
  'lsp.autoStart': boolean;
  'editor.reviewPolicy': 'alwaysReview' | 'autoApplySafeSingleFile';
  'lsp.servers': Record<string, {
    enabled: boolean;
    args?: string[];
    path?: string;
  }>;
}

export const DEFAULT_EDITOR_SETTINGS: EditorSettingsConfig = {
  'editor.fontSize': 13,
  'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  'editor.tabSize': 2,
  'editor.insertSpaces': true,
  'editor.wordWrap': 'off',
  'editor.minimap.enabled': true,
  'editor.minimap.side': 'right',
  'editor.bracketPairColorization.enabled': true,
  'editor.guides.indentation': true,
  'editor.guides.bracketPairs': true,
  'editor.guides.highlightActiveIndentation': true,
  'editor.autoSave': 'afterDelay',
  'editor.autoSaveDelay': 1000,
  'editor.lineNumbers': 'on',
  'editor.renderWhitespace': 'selection',
  'editor.multiCursorModifier': 'alt',
  'editor.formatOnSave': false,
  'editor.zenMode': false,
  'workbench.splitOrientation': 'vertical',
  'lsp.autoStart': true,
  'editor.reviewPolicy': 'alwaysReview',
  'lsp.servers': {
    typescript: { enabled: true, args: ['--stdio'] },
    python: { enabled: true, args: ['--stdio'] },
    rust: { enabled: true, args: [] },
    go: { enabled: true, args: [] },
    java: { enabled: true, args: [] },
    cpp: { enabled: true, args: ['--background-index'] }
  }
};

export const DEFAULT_KEYBINDINGS: KeybindingItem[] = [
  { command: 'workbench.action.quickOpen', key: 'Ctrl+P', mac: 'Cmd+P', category: 'Navigation', description: 'Go to File / Quick Open' },
  { command: 'workbench.action.showCommands', key: 'Ctrl+Shift+P', mac: 'Cmd+Shift+P', category: 'General', description: 'Show Command Palette' },
  { command: 'workbench.view.search', key: 'Ctrl+Shift+F', mac: 'Cmd+Shift+F', category: 'Navigation', description: 'Find in Files / Global Search' },
  { command: 'workbench.view.explorer', key: 'Ctrl+Shift+E', mac: 'Cmd+Shift+E', category: 'Navigation', description: 'Show File Explorer' },
  { command: 'workbench.view.sourceControl', key: 'Ctrl+Shift+G', mac: 'Cmd+Shift+G', category: 'Git', description: 'Show Source Control' },
  { command: 'workbench.action.terminal.toggle', key: 'Ctrl+`', mac: 'Cmd+`', category: 'Terminal', description: 'Toggle Terminal Panel' },
  { command: 'workbench.action.toggleMinimap', key: 'Ctrl+Shift+M', mac: 'Cmd+Shift+M', category: 'View', description: 'Toggle Minimap' },
  { command: 'workbench.action.toggleWordWrap', key: 'Alt+Z', mac: 'Option+Z', category: 'View', description: 'Toggle Word Wrap' },
  { command: 'workbench.action.toggleZenMode', key: 'Ctrl+K Z', mac: 'Cmd+K Z', category: 'View', description: 'Toggle Zen Mode' },
  { command: 'workbench.action.splitEditor', key: 'Ctrl+\\', mac: 'Cmd+\\', category: 'View', description: 'Split Editor' },
  { command: 'workbench.action.gotoLine', key: 'Ctrl+G', mac: 'Cmd+G', category: 'Navigation', description: 'Go to Line' },
  { command: 'workbench.action.gotoSymbol', key: 'Ctrl+Shift+O', mac: 'Cmd+Shift+O', category: 'Navigation', description: 'Go to Symbol in File' },
  { command: 'workbench.action.workspaceSymbol', key: 'Ctrl+T', mac: 'Cmd+T', category: 'Navigation', description: 'Go to Symbol in Workspace' },
  { command: 'editor.action.formatDocument', key: 'Shift+Alt+F', mac: 'Shift+Option+F', category: 'Editor', description: 'Format Document' },
  { command: 'editor.action.rename', key: 'F2', mac: 'F2', category: 'LSP', description: 'Rename Symbol' },
  { command: 'editor.action.goToDefinition', key: 'F12', mac: 'F12', category: 'LSP', description: 'Go to Definition' },
  { command: 'editor.action.findReferences', key: 'Shift+F12', mac: 'Shift+F12', category: 'LSP', description: 'Find All References' },
  { command: 'editor.action.goToImplementation', key: 'Ctrl+F12', mac: 'Cmd+F12', category: 'LSP', description: 'Go to Implementation' },
  { command: 'editor.action.quickFix', key: 'Ctrl+.', mac: 'Cmd+.', category: 'LSP', description: 'Code Action / Quick Fix' },
  { command: 'editor.action.save', key: 'Ctrl+S', mac: 'Cmd+S', category: 'File', description: 'Save File' }
];

export const SETTINGS_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Ty-Code Editor Settings',
  type: 'object',
  properties: {
    'editor.fontSize': {
      type: 'number',
      default: 13,
      minimum: 8,
      maximum: 36,
      description: 'Controls the font size in pixels.'
    },
    'editor.fontFamily': {
      type: 'string',
      default: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
      description: 'Controls the font family.'
    },
    'editor.tabSize': {
      type: 'integer',
      default: 2,
      minimum: 1,
      maximum: 8,
      description: 'The number of spaces a tab is equal to.'
    },
    'editor.insertSpaces': {
      type: 'boolean',
      default: true,
      description: 'Insert spaces when pressing Tab.'
    },
    'editor.wordWrap': {
      type: 'string',
      enum: ['off', 'on', 'wordWrapColumn', 'bounded'],
      default: 'off',
      description: 'Controls how lines should wrap.'
    },
    'editor.minimap.enabled': {
      type: 'boolean',
      default: true,
      description: 'Controls whether the minimap is shown.'
    },
    'editor.bracketPairColorization.enabled': {
      type: 'boolean',
      default: true,
      description: 'Controls whether bracket pair colorization is enabled.'
    },
    'editor.guides.indentation': {
      type: 'boolean',
      default: true,
      description: 'Controls whether the editor should render indent guides.'
    },
    'editor.autoSave': {
      type: 'string',
      enum: ['off', 'afterDelay', 'onFocusChange'],
      default: 'afterDelay',
      description: 'Controls auto save of dirty editors.'
    },
    'editor.autoSaveDelay': {
      type: 'integer',
      default: 1000,
      minimum: 100,
      description: 'Controls the delay in ms after which a dirty editor is saved.'
    },
    'workbench.splitOrientation': {
      type: 'string',
      enum: ['horizontal', 'vertical'],
      default: 'vertical',
      description: 'Controls default split orientation for multi-editor layout.'
    },
    'lsp.autoStart': {
      type: 'boolean',
      default: true,
      description: 'Automatically launch user-managed language servers when opening supported files.'
    },
    'editor.reviewPolicy': {
      type: 'string',
      enum: ['alwaysReview', 'autoApplySafeSingleFile'],
      default: 'alwaysReview',
      description: 'Auto-apply only classifier-approved low-risk single-file edits in a tracked, in-workspace file; multi-file changes always require review.'
    },
    'lsp.servers': {
      type: 'object',
      description: 'Language server configurations keyed by language identifier.',
      additionalProperties: {
        type: 'object',
        properties: {
          enabled: { type: 'boolean' },
          args: { type: 'array', items: { type: 'string' } },
          path: { type: 'string' }
        }
      }
    }
  }
};

export const KEYBINDINGS_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'Ty-Code Keybindings',
  type: 'array',
  items: {
    type: 'object',
    required: ['command', 'key'],
    properties: {
      command: { type: 'string', description: 'The identifier of the command to execute' },
      key: { type: 'string', description: 'Key combination (e.g. Ctrl+Shift+P)' },
      mac: { type: 'string', description: 'Mac key combination (e.g. Cmd+Shift+P)' },
      when: { type: 'string', description: 'Condition when the key is active' },
      category: { type: 'string', description: 'Command category' },
      description: { type: 'string', description: 'User-friendly description' }
    }
  }
};
