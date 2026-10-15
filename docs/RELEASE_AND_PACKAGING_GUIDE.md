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
| `npm test` | Runs TypeScript typecheck and all validation scripts currently included in the package pipeline |
| `npm run test:agent` | Validates Phase 2 Core AI Agent Loop and Terminal PTY |
| `npm run test:git` | Validates Phase 3 Git engine, status, diff, commits, and remotes |
| `npm run test:extensions` | Validates extension manifest/settings schemas, inert registry installs, Worker RPC, built-in command lifecycle, and storage/path hardening |
| `npm run test:lsp` | Validates Phase 5 LSP protocol framing, JSON-RPC, and IntelliSense |
| `npm run test:polish` | Validates Phase 6 performance, Myers diff, virtual tree, and packaging |
| `npm run release:notes` | Generates release notes from recent conventional commits; the tagged-release workflow generates the SHA256 manifest |
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
- Inputs are capped at 200,000 combined characters; edit distance is capped at 2,000 before switching to a coarse replacement diff to bound trace memory.

### 3.2 Virtual File Tree (`src/renderer/src/components/VirtualFileTree.tsx`)
- Measures viewport container height and dynamically computes render indices:
  $$\text{startIndex} = \max(0, \lfloor\text{scrollTop} / \text{itemHeight}\rfloor - \text{overscan})$$
  $$\text{endIndex} = \min(\text{totalItems}, \lceil(\text{scrollTop} + \text{height}) / \text{itemHeight}\rceil + \text{overscan})$$
- Renders a viewport-sized slice with overscan; the Phase 6 harness checks the slice calculation and a synthetic 10,000-file tree, not browser frame rate or a guaranteed DOM count under every viewport.

### 3.3 Storage Cache (`src/renderer/src/services/storage-cache.ts`)
- The cache service uses IndexedDB when available, with an in-memory fallback, and expires entries when they are read.
- TTL behavior is validated on the in-memory fallback; IndexedDB persistence and integration into feature data flows are not currently claimed.

### 3.4 Memory Management & Cleanup
- Monaco models are disposed on tab closure (`editor.getModel()?.dispose()`) to prevent GPU and JS heap memory leaks.
- External filesystem watchers are not currently implemented; the explorer refreshes through explicit workspace refresh operations.

---

## 4. Packaging, Auto-Update & CI/CD

### 4.1 `electron-builder.yml`
Configuration supports:
- **Windows**:
  - `nsis`: Assisted installer with install-location choice, desktop/start-menu shortcuts, and uninstall support.
  - `portable`: Zero-install portable `.exe`.
  - Both use the Ty-Code mark configured as the Windows application icon.
- **macOS**:
  - `dmg` + `zip`: Universal binary containing both `x64` (Intel) and `arm64` (Apple Silicon).
  - Hardened runtime and entitlements; tagged workflow builds receive Apple signing/notarization credentials through repository secrets.
- **Linux**:
  - `AppImage`: Universal Linux distribution.
  - `deb`: Debian / Ubuntu packaging with desktop menu integration.
  - `rpm`: Fedora / RHEL packaging.
  - [`build/icon.svg`](../build/icon.svg) is the editable vector master, [`build/icon.png`](../build/icon.png) is the 1024px raster source, and [`build/icons/`](../build/icons/) contains the Linux hicolor sizes. `electron-builder` 26.15.3 converts the PNG to Windows `.ico` and macOS `.icns`; Linux packaging consumes the explicit PNG set. The packaged window also receives the PNG from `extraResources`. Regenerate raster assets with `python scripts/generate-brand-icon.py` (requires Pillow). Actual signed package appearance still needs per-OS smoke validation.

### 4.2 GitHub Actions Pipeline (`.github/workflows/build.yml`)
CI validates and builds on Windows, macOS, and Linux. Package jobs are configured for NSIS/portable, universal DMG/ZIP, AppImage/DEB/RPM; updater YAML manifests and blockmaps are included in uploaded artifacts. A tag release is published once by the dedicated release job; package commands use `--publish never`.

Before a tagged release, set the tag to exactly match `package.json`'s version and configure `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`, `MAC_CSC_LINK`, `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, and `APPLE_TEAM_ID` as repository secrets. The release workflow rejects a tag/version mismatch and fails early if required signing/notarization secrets are missing. Building `node-pty` locally on Windows also requires Visual Studio C++ Build Tools; the Windows CI runner supplies its native build environment. Actual notarization, package installation, auto-update, and rollback must be validated on signed platform builds before public distribution.

### 4.3 Auto-Update Pipeline (`UpdateManager`)
- Backed by `electron-updater`; packaged builds check on startup and users explicitly start downloads.
- The Settings > Editor Polish section provides a persistent `stable`, `beta`, or `nightly` channel selector; the main process validates the selection. Non-stable releases must use matching prerelease naming and publish updater metadata.
- Download progress is reported, and downloaded updates expose a one-click restart action.
- Installation rollback is not implemented by the application; retain a known-good signed release and validate the platform updater behavior before shipping.

---

## 5. API Reference (Preload Bridge Extensions)

```ts
// Update Management (flat preload bridge)
window.electronAPI.checkForUpdates(): Promise<UpdateCheckResult>
window.electronAPI.downloadUpdate(): Promise<{ success: boolean; error?: string }>
window.electronAPI.installUpdate(): Promise<{ success: boolean; error?: string }>
window.electronAPI.getUpdateChannel(): Promise<IpcResponse<string>>
window.electronAPI.setUpdateChannel(channel: string): Promise<IpcResponse<void>>
window.electronAPI.onUpdateStatus(callback: (status: { type: string; [key: string]: unknown }) => void): () => void
window.electronAPI.onUpdateProgress(callback: (progress: UpdateProgress) => void): () => void

// Recent Workspaces
window.electronAPI.getRecentWorkspaces(): Promise<IpcResponse<RecentWorkspace[]>>
window.electronAPI.addRecentWorkspace(folderPath: string): Promise<IpcResponse<RecentWorkspace[]>>
window.electronAPI.clearRecentWorkspaces(): Promise<IpcResponse<void>>

// Myers Diff
window.electronAPI.computeMyersDiff(params: { original: string; modified: string; contextLines?: number }): Promise<IpcResponse<MyersDiffResult>>

// App Metadata
window.electronAPI.getAppInfo(): Promise<IpcResponse<AppInfo>>
```
