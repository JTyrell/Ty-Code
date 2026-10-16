# Ty-Code Extension Pipeline Trace Report (Phase 1)
**Trace Target**: `ms-python.python` (v2026.4.0) via Open VSX Registry (`https://open-vsx.org`)  
**Commit Hash**: `35837e4b8995e19c1315c0c6f43762f2b2a5928c`  
**Artifact**: [`docs/traces/extension-install-trace.json`](file:///docs/traces/extension-install-trace.json)  
**Verification Date**: 2026-10-16  

---

## 1. Executive Summary

A live, unmocked probe of the complete extension installation and execution pipeline (Hops E1 through E9) was conducted against the Open VSX registry. The probe instrumented every hop from the initial install trigger to UI visibility.

### Key Conclusions:
1. **First Failing Hop**: **Hop E5 (`MANIFEST_INVALID`)**
   - Hops **E1 through E4 succeed completely**: Open VSX metadata is fetched (`200 OK`), the 6.8MB VSIX package is downloaded and verified against the registry SHA-256 checksum (`232aeafb...`), and 2,382 archive files (24.2MB uncompressed) are cleanly extracted to `~/.ty-code/extensions/ms-python.python-2026.4.0/`.
   - At **Hop E5**, `ExtensionInstaller.validateManifest()` fails because `ExtensionManifestSchema` in [`src/preload/extension-schemas.ts`](file:///src/preload/extension-schemas.ts) applies strict schema checks that reject standard VS Code contribution keys (e.g., `shortTitle` in commands, `scope` in configuration, `menus`, `debuggers`, `grammars`, `problemMatchers`).
2. **Secondary Architectural Wall**: **Hop E6 (`HOST_REGISTRATION_FAILED`)**
   - Even if manifest parsing is made permissive, the extension host is architecturally hardwired to reject third-party packages.
   - [`src/renderer/src/services/extension-worker-host.ts`](file:///src/renderer/src/services/extension-worker-host.ts) explicitly ignores any extension where `!extension.isBuiltIn || extension.executionState !== 'built-in'`.
   - [`src/renderer/src/workers/extension-worker.ts`](file:///src/renderer/src/workers/extension-worker.ts) contains a hardcoded dictionary of 5 built-in modules (`ty-claude.*`) and throws: `"Only statically bundled built-in modules may execute."`
3. **Marketplace Status**: **METADATA-ONLY**
   - The marketplace UI and discovery service function as a catalog viewer. Download and extraction logic exist in [`src/main/services/marketplace/installer.ts`](file:///src/main/services/marketplace/installer.ts), but the runtime extension host does not execute community code.

---

## 2. 9-Hop Pipeline Waterfall & Measurements

The following table summarizes the live probe metrics captured in [`docs/traces/extension-install-trace.json`](file:///docs/traces/extension-install-trace.json):

| Hop | Name | Status | Latency | Payload Size | Failure Taxonomy | Technical Finding |
|---|---|:---:|:---:|:---:|:---:|---|
| **E1** | User clicks 'Install' on card | **PASS** | 1ms | 65 B | — | Request successfully dispatched via UI action. |
| **E2** | Marketplace fetches download URL | **PASS** | 926ms | 8.8 KB | — | Fetched Open VSX metadata (`https://open-vsx.org/api/ms-python/python`), resolved direct download URL. |
| **E3** | VSIX downloaded to disk | **PASS** | 15,922ms | 6,826,731 B | — | 6.8MB downloaded over HTTPS; SHA-256 `232aeafb01f069824fdd92d3e628c1c442bbcfa1d3cc945ff97076340bb2b4a6` matched registry checksum. |
| **E4** | VSIX extracted to directory | **PASS** | 84ms | 24,229,367 B | — | Unpacked 2,382 files into `~/.ty-code/extensions/ms-python.python-2026.4.0/` with Zip slip path traversal protection. |
| **E5** | Manifest parsed and validated | **FAIL** | 8ms | 114,834 B | `MANIFEST_INVALID` | `ExtensionManifestSchema` strictly rejects standard VS Code contributions (`shortTitle`, `scope`, `menus`, `debuggers`). |
| **E6** | Extension registered with host | **BLOCKED** | 0ms | 0 B | `HOST_REGISTRATION_FAILED` | `ExtensionWorkerHost.activate()` explicitly silences non-built-in extensions (`!isBuiltIn`). |
| **E7** | Extension activated | **SKIPPED** | 0ms | 0 B | `ACTIVATION_FAILED` | Prerequisite Hop E6 failed; no worker session allocated; 21 activation events suppressed. |
| **E8** | Extension API calls executed | **SKIPPED** | 0ms | 0 B | `API_CALL_FAILED` | Extension capability RPC cannot be invoked without an active worker session. |
| **E9** | Extension UI visible in app | **SKIPPED** | 0ms | 0 B | `UI_NOT_VISIBLE` | 23 contributed commands omitted from Command Palette; status bar items not rendered. |

---

## 3. Root Cause Analysis

### Hop E5: Manifest Invalidation Breakdown
In [`src/preload/extension-schemas.ts`](file:///src/preload/extension-schemas.ts#L30-L58):
```typescript
const ExtensionCommandSchema = z.object({
  command: z.string().min(3).max(160).regex(/^[a-z0-9][a-zA-Z0-9.-]*$/),
  title: z.string().min(1).max(160),
  category: z.string().max(80).optional(),
  icon: z.string().max(200).optional()
}).strict(); // <-- Rejects VS Code fields: shortTitle, enablement
```
When `ms-python.python` is unpacked, its `package.json` contains standard VS Code contribution points:
- `shortTitle` and `enablement` on commands
- `scope` and `markdownDescription` on configuration properties
- `menus`, `debuggers`, `breakpoints`, `grammars`, `problemMatchers`, `yamlValidation`, `languageModelTools`
Because `ExtensionInstaller.validateManifest()` invokes `ExtensionManifestSchema.parse()`, Zod aborts the install with `unrecognized_keys`, mapping immediately to `MANIFEST_INVALID`.

### Hop E6: Host Registration Gate
In [`src/renderer/src/services/extension-worker-host.ts`](file:///src/renderer/src/services/extension-worker-host.ts#L57-L62):
```typescript
async activate(extension: InstalledExtension): Promise<void> {
  const extensionId = ExtensionIdSchema.parse(extension.id);
  if (!extension.enabled || !extension.isBuiltIn || extension.executionState !== 'built-in') return;
  // ...
}
```
And in [`src/renderer/src/workers/extension-worker.ts`](file:///src/renderer/src/workers/extension-worker.ts#L109-L111):
```typescript
const builtin = registry.get(extensionId);
if (!builtin) throw new Error('Only statically bundled built-in modules may execute.');
```
Community marketplace extensions are stamped with `isBuiltIn: false` and `executionState: 'metadata-only'` (or `'installed'`). As a result, the extension host will never spawn a Worker session for them, preventing activation events (E7), API execution (E8), and UI representation (E9).

---

## 4. Static Scan: Metadata-Only Pattern Inventory

A scan of the codebase detected **11 explicit locations** enforcing metadata-only behavior:

| Category | File : Line | Code Pattern / Snippet | Description |
|---|---|---|---|
| `METADATA_ONLY_STATE` | [`extension-manager.ts:351`](file:///src/main/services/extension-manager.ts#L351) | `executionState: 'metadata-only'` | Sets state to metadata-only for marketplace installs. |
| `DISPLAY_ONLY` | [`extension-manager.ts:340`](file:///src/main/services/extension-manager.ts#L340) | `// Marketplace records are discovery metadata only...` | Architectural declaration that no code executes. |
| `EXECUTION_BLOCKED` | [`extension-manager.ts:383`](file:///src/main/services/extension-manager.ts#L383) | `throw new Error('Community extension execution is disabled...')` | Blocks user from enabling non-built-in extensions. |
| `DISPLAY_ONLY` | [`ExtensionDetail.tsx:208`](file:///src/renderer/src/components/ExtensionDetail.tsx#L208) | `'Community extensions are metadata-only and cannot run yet.'` | Tooltip informing user that extension cannot execute. |
| `EXECUTION_BLOCKED` | [`ExtensionDetail.tsx:195`](file:///src/renderer/src/components/ExtensionDetail.tsx#L195) | `disabled={!isBuiltIn}` | Disables enable/disable button for community extensions. |
| `DISPLAY_ONLY` | [`ExtensionDetail.tsx:211`](file:///src/renderer/src/components/ExtensionDetail.tsx#L211) | `<span>{isBuiltIn ? ... : 'Metadata only'}</span>` | Header button label displays 'Metadata only'. |
| `DISPLAY_ONLY` | [`ExtensionDetail.tsx:332`](file:///src/renderer/src/components/ExtensionDetail.tsx#L332) | `<span>{isBuiltIn ? ... : 'Metadata only'}</span>` | Footer button label displays 'Metadata only'. |
| `REGISTRATION_FILTER` | [`extension-host.ts:42`](file:///src/renderer/src/services/extension-host.ts#L42) | `if (extension.enabled && extension.isBuiltIn...)` | ExtensionHost filters out non-built-in extensions. |
| `REGISTRATION_FILTER` | [`extension-worker-host.ts:59`](file:///src/renderer/src/services/extension-worker-host.ts#L59) | `if (!extension.enabled \|\| !extension.isBuiltIn...) return;` | Worker host rejects activation of community extensions. |
| `EXECUTION_BLOCKED` | [`extension-worker.ts:110`](file:///src/renderer/src/workers/extension-worker.ts#L110) | `throw new Error('Only statically bundled built-in modules may execute.')` | Worker isolates reject dynamic or third-party modules. |
| `DISPLAY_ONLY` | [`ExtensionsPanel.tsx:173`](file:///src/renderer/src/components/ExtensionsPanel.tsx#L173) | `title="VSIX installation is unavailable until package validation..."` | UI disables manual VSIX package installation button. |

---

## 5. UI Tooling & Verification Commands

1. **In-App Trace Waterfall UI**:
   - Command Palette: `'Ty-Code: Trace Extension Install'`
   - Extensions Panel: Click the **Activity** icon in the panel toolbar to open the interactive waterfall modal.
2. **CLI Runner**:
   - Run live probe directly from terminal:
     ```bash
     npm run trace:extensions
     ```
   - Generated trace file:
     ```bash
     cat docs/traces/extension-install-trace.json
     ```
3. **CI / Truth Guard Integrity**:
   - All anti-phantom guards and live verification suites passing:
     ```bash
     npm run guards
     npm test
     ```
