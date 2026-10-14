# Ty-Claude 🚀

> **A Standalone Desktop AI Coding Assistant & Monaco IDE**  
> Powered by Electron, Monaco Editor (VS Code engine), and a multi-provider LLM gateway inspired by [`free-claude-code`](https://github.com/Alishahryar1/free-claude-code).

---

## Overview

**Ty-Claude** brings the agentic power of **Claude Code** and **Antigravity** into a native desktop application. It integrates the **Monaco Editor** as its primary code editing environment and connects seamlessly to free, low-cost, or local LLMs (OpenRouter, Groq, DeepSeek, Ollama, LM Studio), liberating developers from expensive proprietary API subscriptions.

### Key Highlights
- 🖥️ **Monaco Editor Core**: VS Code's editing engine with syntax highlighting, language servers, multi-file tabs, and side-by-side diff review.
- 🤖 **Agentic Coding Engine**: Autonomous multi-turn agent capable of reading files, writing code, executing surgical text replacements, running terminal commands, and searching directories.
- 🔌 **Pluggable & Zero/Low-Cost AI Providers**:
  - **OpenRouter**: Access hundreds of models, including free tiers (DeepSeek V3, DeepSeek R1, Qwen 2.5 Coder, Llama 3.3).
  - **Groq**: Lightning-fast inference (~300+ tokens/sec).
  - **DeepSeek Direct**: Official API support.
  - **Local Ollama / LM Studio**: 100% private, offline inference (`qwen2.5-coder`, `deepseek-r1`).
  - **Free-Claude-Code Proxy**: Direct compatibility with `Alishahryar1/free-claude-code` proxy servers (`http://localhost:8082`).
- 🛡️ **Security Sandboxing**: Hardware-encrypted API keys via Electron `safeStorage`, strict context isolation, and workspace boundary sanitization.
- 📦 **Cross-Platform**: Ready to package as a standalone executable for Windows (`.exe`), macOS (`.dmg`), and Linux (`.AppImage`).

---

## Architecture

Ty-Claude enforces strict separation between presentation, native system access, and the AI agent loop:

```
+---------------------------------------------------------------------------------+
|                       Chromium Renderer (React 18 + Monaco)                     |
|  - Monaco Editor & Diff Editor      - Project File Explorer Tree                |
|  - AI Assistant Sidecar Chat        - Integrated Shell Drawer                   |
+---------------------------------------------------------------------------------+
                                       |
                   contextBridge (window.electronAPI)
                                       |
+---------------------------------------------------------------------------------+
|                           Electron Main (Node.js LTS)                           |
|  - Secure FileSystem Manager        - SafeStorage Key Encryptor                 |
|  - Cross-Platform PTY Shell         - Agentic Execution State Machine           |
+---------------------------------------------------------------------------------+
                                       |
+---------------------------------------------------------------------------------+
|                         Multi-Provider LLM Gateway                              |
|  - OpenRouter API                   - Local Ollama (localhost:11434)            |
|  - Groq (300+ tokens/sec)           - Free-Claude-Code Proxy (localhost:8082)   |
+---------------------------------------------------------------------------------+
```

---

## Directory Layout

```
ty-claude/
├── context/                        # Persistent project memory & architecture specs
│   ├── AGENTS.md                   # AI roles, permissions & escalation paths
│   ├── ai-workflow-rules.md        # 5-phase roadmap & security constraints
│   ├── architecture-context.md     # System boundaries, data flows & invariants
│   ├── code-standards.md           # TypeScript, IPC & Monaco lifecycle rules
│   ├── domain-spec.md              # Tool JSON schemas & benchmark metrics
│   ├── progress-tracker.md         # Milestones, task lists & decisions
│   ├── project-overview.md         # Executive summary & core goals
│   └── ui-context.md               # Obsidian Cyber theme tokens & layout
├── scripts/
│   └── dev.mjs                     # Orchestrator for Vite + esbuild + Electron
├── src/
│   ├── main/                       # Electron Main Process (Node.js)
│   │   ├── index.ts                # Application lifecycle & IPC registry
│   │   ├── agent/                  # Agent reasoning loop & tool executor
│   │   ├── providers/              # Multi-provider gateway & SSE parser
│   │   └── ipc/                    # Secure FS, settings, and shell handlers
│   ├── preload/                    # Isolated contextBridge bridge
│   │   ├── index.ts                # window.electronAPI exposure
│   │   └── types.ts                # Shared IPC TypeScript contracts
│   └── renderer/                   # React 18 User Interface
│       ├── index.html              # HTML DOM entry
│       └── src/
│           ├── components/         # TitleBar, Sidebar, EditorArea, Chat, Terminal
│           ├── state/              # Zustand global stores (workspace, chat)
│           └── index.css           # Modern Obsidian Cyber design system
├── package.json
├── tsconfig.json
└── vite.config.ts
```

---

## Getting Started

### 1. Prerequisites
- **Node.js**: v20+ LTS (Tested on v24)
- **npm**: v10+

### 2. Installation
```bash
npm install
```

### 3. Launch Development Server
```bash
npm run dev
```

### 4. Build Production Bundle
```bash
npm run build
```

---

## Agentic Tools Reference

| Tool | Purpose |
| :--- | :--- |
| `read_file` | Reads workspace file content with line slicing (`startLine`, `endLine`). |
| `replace_file_content` | Performs atomic, exact string replacement with collision verification. |
| `write_file` | Creates a new file or overwrites an existing file safely. |
| `run_command` | Executes shell commands in the project directory with real-time output. |
| `list_dir` | Lists directory files and folders with depth control. |
| `grep_search` | Rapidly searches for patterns or regex across workspace files. |

---

## License
MIT
