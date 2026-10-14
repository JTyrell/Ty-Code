# UI & Design System Context: Ty-Code

## Design Philosophy & Aesthetics

Ty-Code embraces a sleek, hyper-focused dark-mode developer aesthetic inspired by VS Code, Linear, and Antigravity. The UI balances information density with visual clarity, providing fluid split-pane resizing, crisp typography, and reactive micro-interactions that make agentic coding feel seamless and instantaneous.

---

## Color Palette & Theme Tokens

The default theme is **Obsidian Cyber** (harmonious deep dark palette with electric violet and cyan accents):

```css
:root {
  /* Surface Layers */
  --bg-primary: #121316;       /* Main editor background */
  --bg-secondary: #18191e;     /* Sidebar & panel background */
  --bg-tertiary: #1f2128;      /* Input fields & active tabs */
  --bg-hover: #272a34;         /* Hover state for list items */
  --bg-active: #2f3340;        /* Active selection background */
  
  /* Borders & Dividers */
  --border-subtle: #262833;    /* Thin panel boundaries */
  --border-strong: #3b3e4f;    /* Focus borders & active dividers */
  
  /* Brand & Status Accents */
  --accent-primary: #8b5cf6;   /* Electric Violet (Agent indicator & Primary CTA) */
  --accent-primary-hover: #7c3aed;
  --accent-cyan: #06b6d4;      /* Terminal & code highlights */
  --accent-green: #10b981;     /* Diff additions & success badges */
  --accent-red: #ef4444;       /* Diff deletions & error alerts */
  --accent-amber: #f59e0b;     /* Warning & pending approvals */

  /* Text & Typography */
  --text-primary: #f3f4f6;     /* Main titles & code text */
  --text-secondary: #9ca3af;   /* Muted captions & inactive tabs */
  --text-muted: #6b7280;       /* Line numbers & placeholder text */
  
  /* Fonts */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace;
}
```

---

## Component Layout Hierarchy

The UI is constructed from an adjustable multi-dock split layout:

```
+-----------------------------------------------------------------------------------+
|  TitleBar: [Icon] Ty-Code - /my-project   [Model: DeepSeek-V3 v] [Settings] [-][+][x]  |
+----+-------------------+------------------------------------+---------------------+
| A  | SIDEBAR           | MAIN EDITOR & WORKSPACE            | AI ASSISTANT        |
| c  |                   |                                    | SIDECAR             |
| t  | [Project Tree]    | [auth.ts x] [server.ts] [+]        |                     |
| i  | > src/            |------------------------------------| [Model: DeepSeek-V3]|
| v  |   > controllers/  | 1 | import { jwt } from 'auth';    |                     |
| i  |   > middleware/   | 2 |                                    | User:               |
| t  |     auth.ts       | 3 | export function verify() {     | "Add JWT validation"|
| y  |     logger.ts     | 4 |   // TODO: validation          |                     |
|    |   server.ts       | 5 | }                              | Agent:              |
| B  | package.json      |                                    | [Tool: read_file]   |
| a  | tsconfig.json     |------------------------------------| [Diff: auth.ts +12] |
| r  |                   | TERMINAL DRAWER (Collapsible)      | [Accept] [Reject]   |
|    |                   | $ npm run build                    |                     |
|    |                   | > Built successfully in 420ms      | [Prompt input...  ] |
+----+-------------------+------------------------------------+---------------------+
|  StatusBar: [Git: main] [Errors: 0] [UTF-8] [TypeScript]            [Tokens: 4.2k] |
+-----------------------------------------------------------------------------------+
```

### 1. Activity Bar (Leftmost narrow strip)
- Quick switcher for: Explorer (`Ctrl+Shift+E`), Global Search (`Ctrl+Shift+F`), Git Diffs (`Ctrl+Shift+G`), and Settings (`Ctrl+,`).

### 2. Sidebar Panel (Collapsible)
- **File Explorer**: Virtualized directory tree with file type icons, folder chevron expansion, active file selection, and right-click context menu (New File, New Folder, Rename, Delete).
- **Search Panel**: Regex/literal text search across workspace with instant match preview.

### 3. Main Workspace & Monaco Editor
- **Tab Bar**: Horizontal draggable tabs with dirty indicators (`•`), close buttons, and file change indicators.
- **Monaco Surface**: Full-featured code editor with syntax tokenization, autocompletion, bracket pair colorization, and minimap.
- **Diff Editor Dock**: Embedded `monaco.editor.createDiffEditor` appearing automatically when reviewing AI-proposed modifications, with floating `[Apply to File]` and `[Discard]` actions.

### 4. Integrated Terminal Drawer (Bottom)
- Collapsible drawer powered by `xterm.js` connected to native PTY instances.
- Multi-tab terminal support (`powershell`, `bash`, `node`).

### 5. AI Assistant Sidecar (Right)
- **Header**: Active model pill dropdown (instant switch between OpenRouter models, Groq, Ollama), token counter, and clear context button.
- **Message Stream**:
  - User prompts with avatar and timestamps.
  - Agent thoughts and status badges (e.g. `Inspecting workspace...`, `Executing git status`).
  - Interactive Tool Call Cards: Collapsible panels displaying tool arguments and execution output.
  - Interactive Diff Cards: Visual representation of added/deleted lines with single-click "Review in Diff Editor".
- **Input Bar**: Multi-line auto-expanding textarea with keyboard submit (`Enter` to send, `Shift+Enter` for newline), file drop target, and prompt stop button.

---

## Keyboard Shortcuts

| Shortcut | Action |
| :--- | :--- |
| `Ctrl+P` / `Cmd+P` | Quick Open File modal |
| `Ctrl+S` / `Cmd+S` | Save Active File |
| `Ctrl+Shift+S` / `Cmd+Shift+S` | Save All Files |
| `Ctrl+` ` / `Cmd+` ` | Toggle Integrated Terminal Drawer |
| `Ctrl+B` / `Cmd+B` | Toggle Sidebar Explorer |
| `Ctrl+L` / `Cmd+L` | Focus AI Chat Input |
| `Ctrl+Shift+D` | Open Active Diff Review |
