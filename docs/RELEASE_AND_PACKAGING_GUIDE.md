# Ty-Code Desktop: Release, Packaging & Operations Guide

This document covers user documentation, developer workflow, packaging setup, auto-updates, and performance optimizations implemented for **Phase 6: Polish, Performance Optimization & Cross-Platform Packaging**.

---

## 1. User Guide

### 1.1 Welcome Page & Quick Start
When no editor tabs are open, Ty-Code displays an interactive **Welcome Page**:
- **Recent Workspaces**: Quick-access listing of recently opened repositories with relative timestamps and paths.
- **Quick Actions**: One-click triggers for *Open Folder* (<kbd>Ctrl+O</kbd>), *New File* (<kbd>Ctrl+N</kbd>), *Toggle Terminal* (<kbd>Ctrl+\`</kbd>), and *Command Palette* (<kbd>Ctrl+Shift+P</kbd>).
- **Interactive Tour**: Start an interactive 6-step walkthrough anytime by clicking **Take the Interactive Tour** or selecting it from the Command Palette.
- **Keyboard Cheatsheet**: Quick reference of frequent hotkeys.

### 1.2 Themes & Accessibility
Ty-Code supports multiple curated themes accessible via the TitleBar theme picker or Settings:
- **Dark (Default)**: Deep blue-gray palette optimized for low eye strain.
- **Light**: Crisp high-legibility theme for bright environments.
- **High Contrast**: WCAG 2.1 AA compliant theme with bold borders (`#00E5FF` accents) and deep blacks.

### 1.3 Toast Notification Center
Non-intrusive toast alerts appear in the bottom-right corner for:
- File saving and operations
- Git commits, branch switches, and stashes
- Auto-update status notifications
- Extension installation and activation events

### 1.4 Virtual File Tree & Drag-and-Drop
- The explorer leverages **windowed virtual scrolling**; workspaces with 10,000+ files scroll smoothly at 60fps with zero UI stutter.
- Files and folders can be dragged and dropped directly into the file tree or onto tabs.
- Full right-click context menus provide options to rename, delete, duplicate, copy path, or reveal in system file explorer.

### 1.5 Multi-Language Support (i18n)
Ty-Code includes built-in localization across 6 languages:
- English (`en`)
- Spanish (`es`)
- Japanese (`ja`)
- Simplified Chinese (`zh`)
- German (`de`)
- French (`fr`)

---

## 2. Developer Guide

### 2.1 Scripts & Workflows

| Command | Purpose |
| :--- | :--- |
| `npm run dev` | Starts Vite dev server + launches Electron main process in hot-reload mode |
| `npm run build` | Compiles `src/main`, `src/preload`, and `src/renderer` for production |
| `npm test` | Runs the full verification test suite across all 5 phases |
| `npm run test:agent` | Validates Phase 2 Core AI Agent Loop and Terminal PTY |
| `npm run test:git` | Validates Phase 3 Git engine, status, diff, commits, and remotes |
| `npm run test:extensions` | Validates extension manifest/settings schemas, inert registry installs, Worker RPC, built-in command lifecycle, and storage/path hardening |
| `npm run test:lsp` | Validates Phase 5 LSP protocol framing, JSON-RPC, and IntelliSense |
| `npm run test:polish` | Validates Phase 6 performance, Myers diff, virtual tree, and packaging |
| `npm run release:notes` | Generates conventional-commit release notes with SHA256 checksums |
| `npm run package:win` | Packages Windows NSIS installer and portable executable |
| `npm run package:mac` | Packages macOS universal DMG and ZIP |
| `npm run package:linux` | Packages Linux AppImage, DEB, and RPM |
| `npm run package:all` | Packages all target platforms |

---

## 3. Performance & Architecture

### 3.1 Myers Diff Algorithm (`src/main/services/myers-diff.ts`)
Unified diff generation uses Eugene Myers' $O(ND)$ greedy algorithm to compute shortest edit scripts (SES):
- Minimal addition/deletion hunks with line-offset tracking.
- Standard unified diff format (`@@ -start,len +start,len @@`).
- Safe execution bounded to 200,000 characters.

### 3.2 Virtual File Tree (`src/renderer/src/components/VirtualFileTree.tsx`)
- Measures viewport container height and dynamically computes render indices:
  $$\text{startIndex} = \max(0, \lfloor\text{scrollTop} / \text{itemHeight}\rfloor - \text{overscan})$$
  $$\text{endIndex} = \min(\text{totalItems}, \lceil(\text{scrollTop} + \text{height}) / \text{itemHeight}\rceil + \text{overscan})$$
- Renders fewer than 45 DOM elements simultaneously regardless of whether the workspace contains 100 or 100,000 files.
- Flattening 10,000 files completes in under 7 milliseconds.

### 3.3 Storage Cache (`src/renderer/src/services/storage-cache.ts`)
- Backed by browser IndexedDB (`ty-code-cache-v1`) with transparent in-memory fallback.
- Configurable TTL (Time-To-Live) for caching remote LSP symbols, marketplace manifests, and git diff summaries.
- Automatic eviction of stale cache entries.

### 3.4 Memory Management & Cleanup
- Monaco models are disposed on tab closure (`editor.getModel()?.dispose()`) to prevent GPU and JS heap memory leaks.
- File system watchers are debounced (250ms) to prevent event storming during bulk build actions.

---

## 4. Packaging, Auto-Update & CI/CD

### 4.1 `electron-builder.yml`
Configuration supports:
- **Windows**:
  - `nsis`: One-click installer with desktop shortcut and uninstall support.
  - `portable`: Zero-install portable `.exe`.
- **macOS**:
  - `dmg` + `zip`: Universal binary containing both `x64` (Intel) and `arm64` (Apple Silicon).
  - Hardened runtime and entitlements for Apple Notarization.
- **Linux**:
  - `AppImage`: Universal Linux distribution.
  - `deb`: Debian / Ubuntu packaging with desktop menu integration.
  - `rpm`: Fedora / RHEL packaging.

### 4.2 GitHub Actions Pipeline (`.github/workflows/build.yml`)
Automated multi-platform CI/CD triggered on tags and pull requests:
- Matrix runners: `windows-latest`, `macos-latest`, `ubuntu-latest`.
- Runs full test suite (`npm test`).
- Builds production bundles (`npm run build`).
- Generates artifacts with electron-builder and publishes releases to GitHub Releases.

### 4.3 Auto-Update Pipeline (`UpdateManager`)
- Backed by `electron-updater`.
- Supports channel switching (`stable`, `beta`, `nightly`).
- Background download with download progress reporting.
- Ready-to-install prompt and one-click application restart.

---

## 5. API Reference (Preload Bridge Extensions)

```ts
// Update Management
window.electronAPI.update.checkForUpdates(): Promise<UpdateCheckResult>
window.electronAPI.update.downloadUpdate(): Promise<void>
window.electronAPI.update.quitAndInstall(): Promise<void>
window.electronAPI.update.getChannel(): Promise<string>
window.electronAPI.update.setChannel(channel: 'stable' | 'beta' | 'nightly'): Promise<void>
window.electronAPI.update.onStatus(callback: (status: UpdateStatus) => void): () => void

// Recent Workspaces
window.electronAPI.workspace.getRecentWorkspaces(): Promise<RecentWorkspace[]>
window.electronAPI.workspace.addRecentWorkspace(path: string): Promise<void>
window.electronAPI.workspace.clearRecentWorkspaces(): Promise<void>

// Myers Diff
window.electronAPI.diff.computeMyersDiff(original: string, modified: string, filename?: string): Promise<MyersDiffResult>

// App Metadata
window.electronAPI.app.getInfo(): Promise<{ name: string; version: string; platform: string; arch: string }>
```
