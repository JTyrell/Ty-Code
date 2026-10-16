# Ty-Code Extension Security Model & Execution Sandboxing

**Status:** Production  
**Phase:** ExtensionsFix 5  
**Brand:** Ty-Code Desktop IDE  
**Last Updated:** 2026-10-16  

---

## 1. Executive Summary

Ty-Code implements a defense-in-depth security architecture for VS Code-compatible and Ty-Code extensions. The execution environment guarantees that untrusted community extensions cannot compromise the host system, access unauthorized workspace files, or manipulate the parent IDE DOM.

All extensions run within dedicated Node.js `worker_threads` with strict capability-based permissions, interactive user prompts for high-risk operations, isolated webview iframes, and static code pattern analysis.

```mermaid
graph TD
    UI[Ty-Code Renderer UI] -->|IPC: marketplace / extensions| Main[Main Process Host]
    Main -->|Capability RPC Validation| Worker[Extension Host Worker Thread]
    Worker -->|Shim: require('vscode')| Ext[Extension Runtime]
    Ext -->|Dangerous Op: write outside workspace| Prompt{User Approval Prompt}
    Prompt -->|Approved| Disk[Write to Disk]
    Prompt -->|Denied| Deny[PERMISSION_DENIED]
    Main -->|Webview HTML + Nonce| Iframe[Iframe Sandbox: allow-scripts only]
    Iframe <-->|MessageChannel Handshake| UI
```

---

## 2. Core Security Pillars

### 2.1 Isolated Worker Execution

1. **No Direct DOM Access:** Extensions execute inside a background worker thread (`node:worker_threads`). They have no direct reference to the electron `BrowserWindow`, React render tree, or parent document.
2. **Capability-Mediated Shim:** Extensions requiring `vscode` or `tycode` receive an in-memory capability shim (`src/main/services/extensions/extension-worker-runner.ts`). All system operations (`readFile`, `writeFile`, `findFiles`, `executeCommand`, `showInformationMessage`, `createTerminal`) are serialized and routed across a structured MessagePort channel to the host process.
3. **Crash Containment & Auto-Recovery:** If an extension throws an uncaught exception, leaks memory, or exits unexpectedly, the worker crash handler isolates the fault, logs the failure, marks the offending extension as `failed`, and auto-restarts a clean worker without crashing the Ty-Code IDE.

### 2.2 Capability-Based Permission Model

Extensions specify required capabilities in `package.json` under `"capabilities"`:

```json
{
  "name": "python-tools",
  "publisher": "tycode-team",
  "version": "1.0.0",
  "capabilities": [
    "workspace.fs.read",
    "workspace.fs.write",
    "commands.register",
    "languages.completion"
  ]
}
```

#### Enforced Capabilities:
| Capability | Scope & Impact | Risk Level | Validation Rule |
| :--- | :--- | :--- | :--- |
| `workspace.fs.read` | Read files within workspace root | Standard | Path containment check |
| `workspace.fs.write` | Write/modify files within workspace | Elevated | Path containment + Prompt if escaping |
| `commands.register` | Register & trigger editor commands | Standard | Catalog schema check |
| `languages.completion` | Provide autocomplete suggestions | Standard | Token limit check (50k chars) |
| `languages.hover` | Provide hover tooltips | Standard | Content sanitation |
| `window.messages` | Display notifications/dialogs | Standard | Sanitized text strings |
| `window.input` | Request user input text | Elevated | Modal focus containment |
| `terminal.open` | Create/interact with terminal sessions | Dangerous | Interactive user approval prompt |
| `webviews.create` | Render HTML webview panels | Elevated | Strict iframe sandbox |

Before any capability RPC call is dispatched, `ExtensionHost.validateCapabilityPermission()` checks the extension's declared manifest capabilities. If an undeclared capability is invoked, the call is immediately rejected with:
```
PERMISSION_DENIED: Extension "<id>" attempted to access capability "<call>" (requires "<cap>"), but manifest only declared [...].
```

### 2.3 User Approval Prompts for Dangerous Operations

Certain operations present significant security implications even if the base capability is declared:

1. **Writing Outside Workspace Containment:**
   When an extension invokes `workspace.fs.writeFile` targeting a relative path escaping the workspace containment root (`../` or absolute path outside root), the capability provider intercepts execution and prompts the user:
   ```ts
   const approved = await capabilityProvider.security.promptPermissionApproval({
     extensionId,
     capability: 'workspace.fs.write',
     action: 'write-outside-workspace',
     targetPath: relativePath
   });
   ```
   - If the user confirms, the operation proceeds to write the file.
   - If the user declines, the write throws:
     `PERMISSION_DENIED: User denied write access outside workspace containment for "<path>".`

2. **Terminal Execution:**
   Spawning shells or sending arbitrary CLI scripts via `terminal.sendText` requires explicit verification to protect developer workstations against arbitrary shell injections.

---

## 3. Webview Sandboxing & Nonce Handshake

Webviews rendered by extensions (e.g. documentation viewers, interactive editors, previews) adhere to strict browser sandbox isolation:

1. **Strict Iframe Sandbox Attributes:**
   ```html
   <iframe sandbox="allow-scripts" srcDoc="..." />
   ```
   - `allow-scripts`: Permits JavaScript execution inside the iframe.
   - **NEVER `allow-same-origin`**: Ensures the iframe has an opaque origin (`origin: null`). Any attempt to access `window.parent.document`, `window.top.localStorage`, or `parent.require` throws a cross-origin `DOMException: Blocked a frame with origin "null" from accessing a cross-origin frame.`

2. **Cryptographic Nonce & MessageChannel Handshake:**
   - On webview initialization, Ty-Code generates a random 32-character hexadecimal nonce.
   - Ty-Code instantiates a dedicated `MessageChannel` and transfers `port2` into the iframe via `postMessage({ type: 'webview-init', nonce }, '*', [channel.port2])`.
   - The iframe script receives the port and acknowledges the handshake by returning `{ type: 'handshake-ack', nonce }`.
   - Only messages received through this authenticated channel are processed.

---

## 4. Static Code Pattern Scanner

During extension install and activation, `ExtensionSecurityScanner` analyzes JavaScript and TypeScript source files for dangerous code patterns:

| Rule ID | Pattern Detected | Severity | Rationale |
| :--- | :--- | :--- | :--- |
| `eval-call` | `/\beval\s*\(/` | Warning | Arbitrary string code execution; bypasses static analysis. |
| `function-constructor` | `/\b(?:new\s+Function\|Function\s*\()/` | Warning | Runtime code synthesis from dynamic strings. |
| `untrusted-remote-import` | `/\bimport\s*\(\s*['"\`]https?:\/\//i` | Warning | Dynamic fetching and execution of unvetted remote scripts. |
| `process-escape-binding` | `/\bprocess\.(?:binding\|_linkedBinding\|mainModule)\b/` | Warning | Attempting to access low-level Node.js internals or bypass sandboxing. |

**Enforcement Policy:** Warnings are logged to the IDE security ledger and presented in the extension details panel to empower the developer's informed choice without breaking legacy polyfills.

---

## 5. Marketplace Trust & Abuse Prevention

1. **Default Registry:** Ty-Code connects to [Open VSX](https://open-vsx.org) (`https://open-vsx.org`), the vendor-neutral, open-source extension registry maintained by the Eclipse Foundation.
2. **Download Metrics & Community Ratings:** Download counts, star ratings, and last updated timestamps from Open VSX metadata are displayed on all extension cards and detail modals.
3. **Abuse Reporting ("Report Extension"):** Every extension detail view includes a direct "Report Extension" link navigating to Ty-Code's security advisory template on GitHub, prefilling the extension identifier, publisher, and version.
4. **VSIX Digital Signature Verification (Future Roadmap):** Open VSX signature manifests (`.signature.p7s`) will be cryptographically verified against publisher public keys prior to extraction in a future release.

---

## 6. Anti-Phantom CI Guards

To prevent regression into metadata-only or mock marketplace architectures, Ty-Code enforces three automated CI guard scripts in every build and test run:

| Script | Purpose | Enforcement Action |
| :--- | :--- | :--- |
| `scripts/no-metadata-only-marketplace.mjs` | Verifies real VSIX download, ZIP magic byte checks, extraction, and extension host registration in both backend services and frontend panels. | Fails build if mock or simulated metadata-only stubs are reintroduced. |
| `scripts/no-fake-extension-data.mjs` | Scans for hardcoded extension catalogs or arrays in production code; verifies extension lists come solely from real Open VSX API calls or disk directory scans. | Fails build if static mock catalogs exist. |
| `scripts/verify-extension-artifacts.mjs` | Inspects all 5 extension trace files in `docs/traces/` and verifies they contain `timestamp`, `gitCommit`, and `command`, and are not stale relative to recent code commits. | Fails build if evidence artifacts are missing or stale. |

---

## 7. Trace Artifacts & Evidence Ledger

The security and execution posture of Ty-Code is verified by committed trace artifacts:

- [`docs/traces/openvsx-integration.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/openvsx-integration.json): Live registry query, metadata extraction, and VSIX download metrics.
- [`docs/traces/extension-execution.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/extension-execution.json): Worker thread activation, command execution, and language provider registration.
- [`docs/traces/extension-verification.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/extension-verification.json): Live end-to-end test results across registry reachability, activation, and command registration.
- [`docs/traces/extension-security.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/extension-security.json): Validation of capability permissions, out-of-workspace approval prompts, webview sandbox isolation, and security pattern scanning.
- [`docs/traces/extension-install-trace.json`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/extension-install-trace.json): Hop-by-hop audit trail from UI card click through network download, extraction, and host registration.
