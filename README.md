# Ty-Code 🚀

> **The Local-First AI IDE That Respects Your Code.**
> Ty-Code delivers Cursor-level productivity with zero cloud exfiltration. Start free with zero configuration, or bring your own key for premium models. 100% local data sovereignty.

[![Powered by FCC](https://img.shields.io/badge/Model%20Supply-free--claude--code-indigo.svg)](https://github.com/Alishahryar1/free-claude-code)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

---

## Overview

**Ty-Code** is a native desktop AI IDE built on the **Monaco Editor** (the VS Code engine). It ships with a built-in **Ty-Code Free Tier (Zero Configuration)** so you can start coding instantly, and a seamless **One-Key Premium** upgrade path when you want GPT-4o, Claude 3.5 Sonnet, Qwen-Max, and 100+ more. Everything runs behind a strict **Zero-Telemetry Guarantee**, backed by the [`free-claude-code`](https://github.com/Alishahryar1/free-claude-code) supply layer.

### Feature Grid

1. **Zero-Friction Onboarding:** "Start coding in seconds with our built-in Free Tier. No sign-ups, no credit cards. Upgrade seamlessly with a single API key when you're ready."
2. **OS-Level Credential Encryption:** "We don't store your keys in plaintext `.env` files. Ty-Code uses native `safeStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service) to encrypt your credentials at rest."
3. **Intelligent Agentic Harness:** "Our ReAct execution loop features built-in task scoping, todo tracking, and background agent delegation. The AI plans before it acts, preventing runaway token costs."
4. **True Zero-Telemetry:** "No silent analytics. No code exfiltration. Your workspace remains entirely under your control, making Ty-Code the ideal choice for HIPAA, defense, and enterprise environments."

---

## 📥 Downloads (v1.0.0 Production Release)

Download official binaries directly from the [GitHub v1.0.0 Release](https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0) or visit our [Cloudflare Pages Download Site](https://ty-code.com):

| Platform | Format | Direct Download |
| :--- | :--- | :--- |
| **Windows** (x64) | NSIS Installer | [`Ty-Code-Setup-1.0.0.exe`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-Setup-1.0.0.exe) |
| **Windows** (x64) | Portable ZIP | [`Ty-Code-1.0.0-win.zip`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0-win.zip) |
| **macOS** (Universal) | Disk Image | [`Ty-Code-1.0.0.dmg`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.dmg) |
| **Linux** (x64) | AppImage | [`Ty-Code-1.0.0.AppImage`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.AppImage) |
| **Linux** (x64) | Debian Package | [`ty-code_1.0.0_amd64.deb`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/ty-code_1.0.0_amd64.deb) |
| **Linux** (x64) | RedHat RPM | [`ty-code-1.0.0.x86_64.rpm`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/ty-code-1.0.0.x86_64.rpm) |
| **All Platforms** | Checksums | [`SHA256SUMS.txt`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/SHA256SUMS.txt) |

Verify checksums before running:
```bash
sha256sum -c SHA256SUMS.txt --ignore-missing
```

---

## Architecture

Ty-Code enforces strict separation between presentation, native system access, and the AI agent loop:

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
ty-code/
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
npm ci
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

## Cloudflare Pages website

The public Ty-Code download site is maintained separately from the Electron renderer in `website/` and deploys from the repository root with the Pages Functions in `functions/`:

```bash
npm run dev:website
npm run typecheck:website
npm run test:website
npm run build:website
```

Configure Cloudflare Pages to use the repository root, build command `npm run build:website`, and output directory `website-dist`. See [docs/WEBSITE_SECURITY.md](docs/WEBSITE_SECURITY.md) for the WAF, TLS, HTTP headers, release verification, and privacy setup checklist. A public release with a matching `SHA256SUMS.txt` is required before download links appear.

## Attribution & Upstream Model Supply

Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code

Ty-Code integrates with the `free-claude-code` sidecar daemon over a decoupled local loopback HTTP interface (`http://127.0.0.1:8082`). This provides zero-cost access to 61 curated providers without copyleft taint on Ty-Code's core MIT codebase. For architectural details and binary integrity verification, see [docs/FCC-INTEGRATION-ARCHITECTURE.md](docs/FCC-INTEGRATION-ARCHITECTURE.md) and [docs/THIRD-PARTY.md](docs/THIRD-PARTY.md).

## License
MIT
