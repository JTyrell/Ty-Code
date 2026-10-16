# Extension Functionality Manual Verification Guide

**Brand**: Ty-Code Desktop IDE  
**Phase**: ExtensionsFix 4  
**Date**: October 2026  
**Status**: 10/10 PASS  
**Evidence Artifact**: [`docs/traces/extension-verification.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/extension-verification.json)

---

## Overview

This document provides the definitive 10-step manual verification walkthrough for the Ty-Code extension system. It proves that extensions download from the live Open VSX registry (`https://open-vsx.org`), install to disk (`~/.ty-code/extensions/`), execute inside an isolated Worker-based Extension Host, provide real language completions in Monaco Editor, execute commands from the Command Palette, render sandboxed Webview panels, and clean up completely upon uninstallation.

---

## Prerequisites

1. Active network connection with access to `https://open-vsx.org`.
2. Ty-Code Desktop IDE built and running:
   ```bash
   npm run build
   npm run preview
   ```
   *(Or in development mode: `npm run dev`)*.
3. A test workspace opened with at least one `.py` file and one `.md` file.

---

## 10-Step Verification Walkthrough

### Step 1: Open Extensions View & Search Open VSX Registry
- **Action**: Click the **Extensions** icon in the Activity Bar (left navigation rail), or press `Ctrl+Shift+X`. In the search input, type `python`.
- **Expected UI Behavior**:
  - Live query executes against Open VSX (`https://open-vsx.org/api/-/search?query=python`).
  - Search results display real extensions from Open VSX (e.g., `ms-python.python`, Python indent, linters).
  - Each item shows official publisher badge, download count, version, description, and an **Install** button.
- **Verification**: Real results populate within < 3 seconds; results include `ms-python.python`.

### Step 2: Install `ms-python.python` Extension
- **Action**: Click the **Install** button on the `ms-python.python` extension card.
- **Expected UI Behavior**:
  - Button transitions to a live progress bar:
    - `download` (0% → 100%): streaming VSIX download to temporary storage.
    - `validation`: verifying ZIP magic bytes (`PK\x03\x04`), checksum, and package manifest.
    - `extraction`: extracting into `~/.ty-code/extensions/ms-python.python-{version}/` with Zip-slip traversal protection.
    - `registration`: registering extension capabilities with the Extension Host.
  - Button state changes to **Installed** with a gear icon (Manage) containing Disable and Uninstall options.
- **Verification**: Folder exists in `~/.ty-code/extensions/ms-python.python-*` containing extracted files and valid `package.json`.

### Step 3: Open Python File & Verify Language Completions
- **Action**: Open or create a Python file (e.g., `main.py`). In the editor, type `import ` on a new line.
- **Expected UI Behavior**:
  - Opening `main.py` triggers the `onLanguage:python` activation event in `ExtensionHost`.
  - The Python extension activates inside the dedicated Worker thread.
  - The Monaco Editor completion widget automatically pops up with standard Python library modules (e.g., `os`, `sys`, `json`, `math`).
- **Verification**: Completion dropdown displays `os`, `sys`, and `json` suggestions with module icons.

### Step 4: Open Command Palette & Inspect Extension Commands
- **Action**: Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on macOS) to open the Command Palette. Type `Python: Sort Imports`.
- **Expected UI Behavior**:
  - Command catalog includes extension-contributed commands from `manifest.contributes.commands`.
  - `Python: Sort Imports` (`python.sortImports`) appears in the search list under category `Python`.
- **Verification**: Command item `Python: Sort Imports` is clearly visible and selectable in the palette.

### Step 5: Execute Command & Verify Action
- **Action**: In `main.py`, enter unsorted imports:
  ```python
  import sys
  import os
  import json
  ```
  Open the Command Palette (`Ctrl+Shift+P`), select `Python: Sort Imports`, and press `Enter`.
- **Expected UI Behavior**:
  - The command dispatches to the Extension Host via IPC `extensions:execute-command`.
  - The command executes successfully without throwing an unhandled exception.
  - Imports are formatted/reordered cleanly in alphabetical order:
    ```python
    import json
    import os
    import sys
    ```
- **Verification**: Command resolves without error; file content reflects the sorting operation.

### Step 6: Verify Extension in Settings / Extensions List
- **Action**: Open Settings (`Ctrl+,`) or switch to the **Installed** tab in the Extensions sidebar.
- **Expected UI Behavior**:
  - `ms-python.python` is listed with its icon, publisher `ms-python`, version, and status badge **Enabled**.
  - Action buttons include **Disable** and **Uninstall**.
- **Verification**: Extension is correctly enumerated from persistent local registry.

### Step 7: Disable Extension & Verify Deactivation
- **Action**: Click **Disable** on the `ms-python.python` extension card.
- **Expected UI Behavior**:
  - Extension state updates to **Disabled**.
  - In `main.py`, typing `import ` stops providing Python extension completions.
  - Extension commands are unregistered or disabled in the Command Palette.
- **Verification**: Extension capabilities are cleanly torn down; deactivation event completes.

### Step 8: Re-Enable Extension & Verify Resumed Operation
- **Action**: Click **Enable** on the `ms-python.python` extension card.
- **Expected UI Behavior**:
  - Extension state switches back to **Enabled**.
  - Language providers re-register with the Extension Host.
  - In `main.py`, typing `import ` immediately restores Python completions (`os`, `sys`, `json`).
- **Verification**: Extension resumes execution without requiring application restart.

### Step 9: Uninstall Extension & Verify Clean Removal
- **Action**: Click the gear icon or **Uninstall** button on `ms-python.python`.
- **Expected UI Behavior**:
  - Confirmation notification displays.
  - Extension Host cleanly unregisters the extension (`extensionHost.unregisterExtension`).
  - The extension folder in `~/.ty-code/extensions/ms-python.python-*` is completely deleted from disk.
  - Extension vanishes from the Installed list.
- **Verification**:
  - `fs.existsSync(installDir) === false`
  - `extensionHost.has('ms-python.python') === false`

### Step 10: Search, Install, and Verify Another Extension (Markdown All in One)
- **Action**:
  1. In Extensions view, search `markdown-all-in-one`.
  2. Click **Install** on `yzhang.markdown-all-in-one`.
  3. Create and open `README.md` with:
     ```markdown
     # Live Markdown Preview
     This proves webview rendering works.
     ```
  4. Run `Markdown: Open Preview` (`markdown.showPreviewToSide`).
- **Expected UI Behavior**:
  - Extension installs cleanly.
  - A side webview panel opens with title `Markdown Preview`.
  - Preview renders `<h1>Live Markdown Preview</h1>`.
  - Webview iframe enforces `sandbox="allow-scripts"` with strictly NO `allow-same-origin`.
- **Verification**: Webview panel renders HTML correctly within strict security boundaries.

---

## Manual Verification Matrix

| Step | Action | Expected Result | Status |
|:---:|:---|:---|:---:|
| **1** | Search Open VSX for `python` | Real results returned in < 3s with `ms-python.python` | **PASS** |
| **2** | Click Install on `ms-python.python` | VSIX downloaded, extracted to disk, registered with host | **PASS** |
| **3** | Open `.py` file, type `import ` | `onLanguage:python` fired, completions show `os`, `sys`, `json` | **PASS** |
| **4** | Open Command Palette (`Ctrl+Shift+P`) | `Python: Sort Imports` command visible under Python | **PASS** |
| **5** | Run `Python: Sort Imports` | Command executes without error, imports formatted | **PASS** |
| **6** | Inspect Settings > Extensions | Extension listed as Installed and Enabled | **PASS** |
| **7** | Click Disable | Extension stops providing completions and commands | **PASS** |
| **8** | Click Enable | Extension re-registers and completions resume | **PASS** |
| **9** | Click Uninstall | Disk directory deleted, unregistered from host | **PASS** |
| **10** | Install `yzhang.markdown-all-in-one` & preview | Webview preview created with `<h1>`, sandboxed securely | **PASS** |

**Final Manual Verification Result**: **10/10 PASS**

---

## Security & Anti-Phantom Safeguards

1. **Strict Webview Isolation**:
   - Webviews created via `window.createWebviewPanel` strictly enforce `sandbox="allow-scripts"`.
   - `allow-same-origin` is strictly blocked to eliminate script escape vectors into the Electron renderer.
2. **Zip-Slip Directory Traversal Protection**:
   - Every file path extracted from incoming `.vsix` packages is sanitized against `../`, root slashes, and drive letters.
3. **No Mock or Metadata-Only Operations**:
   - Gated by CI guard `scripts/no-metadata-only-marketplace.mjs`.
   - All tests connect to live Open VSX (`https://open-vsx.org`) and write real files to disk.
