# Code Standards & Conventions: Ty-Code

## TypeScript & Language Standards

- **Strict Typing**: TypeScript `strict: true`, `noImplicitAny: true`, and `strictNullChecks: true` must be enabled across all modules. Avoid `any`; use `unknown` with type narrowing or generic constraints where dynamic data occurs.
- **Modern ES Features**: Target `ES2022` or later. Use `async/await`, optional chaining (`?.`), and nullish coalescing (`??`).
- **Module Format**: ESM (ECMAScript Modules) across the repository, bundled via Vite for renderer and esbuild/tsup for main/preload.

---

## IPC Communication Standards

All IPC calls between Electron Main and Renderer must strictly adhere to the typed channel pattern:

```typescript
// 1. Channel Definition (src/preload/types.ts)
export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface ElectronAPI {
  // File System
  readDirectory: (path: string) => Promise<IpcResponse<FileNode[]>>;
  readFile: (filePath: string) => Promise<IpcResponse<string>>;
  writeFile: (filePath: string, content: string) => Promise<IpcResponse<void>>;
  
  // Agent & AI
  startAgentTask: (prompt: string, options?: AgentTaskOptions) => Promise<IpcResponse<string>>;
  onAgentStream: (callback: (chunk: AgentStreamChunk) => void) => () => void;
  onToolInvocation: (callback: (tool: ToolInvocation) => void) => () => void;
  applyDiff: (diffId: string) => Promise<IpcResponse<void>>;
  
  // Terminal
  spawnPty: (options: PtyOptions) => Promise<IpcResponse<number>>;
  writePty: (ptyId: number, data: string) => void;
  onPtyData: (ptyId: number, callback: (data: string) => void) => () => void;
  resizePty: (ptyId: number, cols: number, rows: number) => void;
}
```

- **Naming Convention**: `domain:action` (e.g., `fs:read-file`, `agent:start-task`, `pty:spawn`).
- **Always Return `IpcResponse<T>`**: Every IPC handler must catch unhandled exceptions and return `{ success: false, error: err.message }` rather than crashing the process or leaving promises hanging.

---

## Monaco Editor Standards

1. **Model Lifecycle**:
   - Manage Monaco models via `monaco.editor.createModel(value, language, monaco.Uri.file(filePath))`.
   - Never create duplicate models for the same file path. Check `monaco.editor.getModel(uri)` first.
   - Always call `model.dispose()` when closing a file tab to release memory and syntax tree nodes.
2. **Diff Editor Integration**:
   - Use `monaco.editor.createDiffEditor` for comparing the disk version (original) with the agent's proposed version (modified).
   - Enable `renderSideBySide: true` with toggle to `renderSideBySide: false` (inline diff) based on viewport width.
   - Provide an explicit "Apply Changes" and "Reject Changes" control bar above the diff editor.

---

## React Component Architecture

- **Functional Components**: All UI components must be React functional components with TypeScript props interfaces.
- **State Management**:
  - Local state: React `useState` / `useReducer`.
  - Global state: `zustand` stores split by domain (`useWorkspaceStore`, `useEditorStore`, `useChatStore`, `useSettingsStore`).
- **CSS & Layout**:
  - Flexbox and CSS Grid for layout splitting.
  - Dark mode as default: VS Code dark palette (Background: `#1e1e1e`, Sidebar: `#252526`, ActivityBar: `#333333`, Border: `#3c3c3c`, Accent: `#007acc` / `#7c3aed`).

---

## Commit Message Format

Follow the Conventional Commits specification:
```
<type>(<scope>): <subject>

[optional body]

[optional footer(s)]
```

Types:
- `feat`: A new user-facing feature.
- `fix`: A bug fix.
- `refactor`: Code restructuring without behavior change.
- `perf`: Performance improvements.
- `docs`: Documentation updates.
- `test`: Adding or modifying tests.
- `chore`: Build scripts, dependencies, configuration.

Example: `feat(editor): add multi-tab dirty state and auto-save timer`
