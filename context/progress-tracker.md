# Progress Tracker: Ty-Claude Desktop

## Current Phase
- **Phase 5: Advanced Editor Features & Language Server Protocol (LSP) (COMPLETED)**

## Current Goal
- Deliver VS Code-grade editor capabilities including Language Server Protocol (LSP) support for 6 core languages, Monaco IntelliSense providers, Command Palette, Quick Open, Outline view, Global Search and Replace, and split editor layouts.

## Completed
- [x] **Phase 1: Foundation, Architectural Specification & Core Scaffolding**
- [x] **Phase 2: Terminal Integration (Production-Grade PTY) & Polished Streaming UI**
- [x] **Phase 3: Git Integration & Source Control Panel**
- [x] **Phase 4: Extension Marketplace & Plugin Architecture**
- [x] **Phase 5: Advanced Editor Features & Language Server Protocol (LSP)**:
  - **LSP Client Protocol Implementation (`src/main/services/lsp-client.ts`)**:
    - Full JSON-RPC 2.0 stdio framing over subprocesses with `Content-Length` header parsing.
    - Chunk re-assembly, multi-message packet splitting, error trapping, and request-response matching with timeouts.
    - Server notification dispatching (`textDocument/publishDiagnostics`, `window/showMessage`, `window/logMessage`).
    - Document synchronization protocol (`didOpen`, `didChange`, `didSave`, `didClose`).
    - IntelliSense methods (`completion`, `hover`, `definition`, `typeDefinition`, `implementation`, `references`, `rename`, `documentSymbol`, `workspaceSymbol`, `codeAction`, `signatureHelp`).
  - **LSP Manager & Server Lifecycle (`src/main/services/lsp-manager.ts`)**:
    - Auto-detection and lifecycle management (start/stop/restart) for 6 core languages:
      1. TypeScript/JavaScript (`typescript-language-server`)
      2. Python (`pyright-langserver` or `pylsp`)
      3. Rust (`rust-analyzer`)
      4. Go (`gopls`)
      5. Java (`jdtls`)
      6. C/C++ (`clangd`)
    - Binary discovery across system PATH, `node_modules/.bin`, and custom configured paths.
    - Graceful fallback: when an LSP binary is absent or disabled, seamlessly falls back to Monaco's built-in IntelliSense and language features without breaking editor interactions.
  - **Monaco LSP Adapter (`src/renderer/src/services/monaco-lsp-adapter.ts`)**:
    - Registered Monaco providers for completions, hover tooltips, definition navigation (<kbd>F12</kbd>), references (<kbd>Shift+F12</kbd>), symbol renaming (<kbd>F2</kbd>), outline hierarchy, and signature help.
    - Debounced document synchronization on editor change and save events.
  - **Global Search & Replace Engine (`src/renderer/src/components/SearchPanel.tsx` & `src/main/ipc/fs-handlers.ts`)**:
    - Global workspace text search with regex support, case-sensitivity toggle (`Aa`), whole-word matching (`\b`), and include/exclude glob filters.
    - Collapsible file results tree with match counts, line numbers, and snippet previews.
    - Multi-file Replace in Files with single-file and replace-all execution and dry-run preview.
    - Search history dropdown.
  - **Command Palette (`src/renderer/src/components/CommandPalette.tsx`)**:
    - <kbd>Ctrl+Shift+P</kbd> fuzzy search across built-in editor actions, navigation, LSP server commands, and dynamically contributed extension commands.
  - **Quick Open (`src/renderer/src/components/QuickOpen.tsx`)**:
    - <kbd>Ctrl+P</kbd> fuzzy workspace file search with prefix actions:
      - `:line` (e.g. `:42`) jumps to line in active editor.
      - `@symbol` lists and jumps to symbols in file (outline).
      - `>` switches directly to Command Palette mode.
  - **Outline View (`src/renderer/src/components/OutlineView.tsx`)**:
    - Document symbol tree with search filtering, expandable hierarchy (classes, functions, interfaces, properties), and click-to-jump navigation.
  - **Editor Polish & Split Editor (`src/renderer/src/components/EditorArea.tsx`)**:
    - Horizontal and vertical split editor panes with independent tab views.
    - Minimap toggle, word wrap toggle (<kbd>Alt+Z</kbd>), Zen mode (distraction-free).
    - Bracket pair colorization, indent guides, active indent highlight, and multi-cursor editing (<kbd>Alt+Click</kbd>).
    - Interactive breadcrumbs displaying directory hierarchy and active language status.
  - **Settings UI & Configuration Schemas**:
    - Added "Language Servers (LSP)", "Editor Polish", and "Keybindings" tabs to `SettingsModal.tsx`.
    - Defined `SETTINGS_JSON_SCHEMA` and `KEYBINDINGS_JSON_SCHEMA` in `src/main/services/config-schemas.ts`.
  - **Testing & Verification**:
    - Comprehensive test suite `scripts/validate-phase5.mjs` (`npm run test:lsp`) passing 100% across all 8 assertions.
    - Full regression test suite (`npm test`) passing 100% across Phase 2, 3, 4, and 5.
    - Production build (`npm run build`) succeeded without error.

## In Progress
- [ ] Phase 6: Autonomous Agent Multi-Turn Planning & Deep Reasoning.

## Next Up
- [ ] Implement vector embeddings & semantic code search for large codebases.
- [ ] Inline ghost-text autocomplete engine for Monaco Editor.

## Architecture Decisions
1. **Direct TypeScript Provider & Agent vs Python Sidecar**:
   - *Option A (Pure TypeScript Native)*: Implement the provider gateway directly in TypeScript within Electron's Main process. Benefits: Single runtime (no Python or `uv` installation required on end-user machine), smaller installer binary, zero inter-process latency.
   - *Option B (Hybrid with Python `fcc-server` Subprocess)*: Bundle or spawn the Python `free-claude-code` FastAPI server as a background sidecar. Benefits: Directly reuses all 17+ upstream `free-claude-code` providers without re-implementation; Downsides: Requires Python runtime or PyInstaller sidecar binary.
   - *Recommendation*: Implement native TypeScript providers for the key providers (OpenRouter, Groq, DeepSeek, Ollama) while providing an optional proxy endpoint setting to point to any running `free-claude-code` or custom proxy server.
2. **Monaco Integration**: Use `@monaco-editor/react` with custom Monaco instance management to ensure diff editor support and prevent memory leaks.
3. **Electron Security**: Enforce `contextIsolation: true`, `nodeIntegration: false`, and sanitize all file paths against the open workspace root.

## Session Notes
- Phase 2 terminal/streaming regression pass completed on 2026-10-14: 18 agent integration assertions pass, the existing Git suite passes, strict TypeScript passes, and the production build succeeds.
- Native Windows PTY emitted/received a command in a standalone Node smoke test; node-pty printed an `AttachConsole failed` teardown trace after the process exited. Validate PTY shutdown inside the packaged Electron runtime and on macOS/Linux before claiming cross-platform release readiness.
- A headless browser without Electron's preload bridge can verify renderer labels/fallback states only; it cannot validate IPC-backed terminal spawning or persisted sessions.
- All 8 context files in `/context/` are updated and in sync with the Ty-Claude desktop application architecture.
