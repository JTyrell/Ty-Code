# Ty-Code Extension API Matrix

## Runtime policy

The current extension runtime launches only statically bundled, trusted built-ins inside a dedicated module Web Worker. Worker calls cross a versioned, Zod-validated RPC boundary and are mediated by the Electron capability provider. Marketplace listings are metadata-only; no package is downloaded or executed. The third-party preference is explicit and persisted, but is not an execution switch in this release. Community extensions remain disabled. VSIX selection returns an unavailable response until archive verification and extraction are implemented.

All extension RPC messages are limited to 256 KiB, correlated by UUID and per-session nonce, validated by method-specific parameter schemas, and limited to 32 concurrent calls. Calls time out; malformed or unresponsive Worker sessions are terminated and may restart at most once.

## Supported today

| API area | Supported behavior | Capability / policy |
| --- | --- | --- |
| `commands` | Register and run statically bundled built-in commands; IDs must be declared in the manifest and begin with the owning extension ID. Duplicate registration is rejected. | `commands.register` |
| `workspace.fs` | Read existing files up to 200 KiB and write text up to 50,000 characters using workspace-relative paths. The active workspace, path containment, symlink targets and sensitive `.env` segments are checked in main. | `workspace.fs.read`, `workspace.fs.write` |
| `editor` | Read the active document and apply content to its open editor tab as a dirty edit. Disk writes remain user-controlled via normal save behavior. | `editor.read`, `editor.edit` |
| `window` | Show a Ty-Code toast message and request a string through an accessible modal prompt. | `window.messages`, `window.input` |
| `terminal` | Open the integrated terminal surface. Command text and process creation are not exposed to extensions. | `terminal.open` |
| `agent` | A trusted built-in can submit a request to the existing AI assistant flow after a user invokes its registered command. | `agent.request` |
| `git` | Refresh source-control state and copy the configured repository remote. No mutating Git action is exposed through the extension API. | `git.read` |

## Declared but not available in this rollout

| API area | Current behavior | Future requirement |
| --- | --- | --- |
| `languages` providers | Completion and hover registration throw an explicit unsupported error. No built-in currently declares these capabilities. | Add bounded request/result schemas and editor lifecycle disposal before enabling either capability. |
| `webviews` | Creation throws an explicit unsupported error; no extension UI is rendered in the host Worker. | Use an iframe with `sandbox="allow-scripts"`, omit `allow-same-origin`, and exchange a nonce-verified `MessageChannel` at creation. Do not trust `event.origin` alone. |
| Browser-hosted workspace provider | A provider-agnostic contract exists, but the browser provider is deferred and all operations fail closed. | Implement workspace storage with OPFS/IndexedDB, an approved Git adapter, and an explicit network allowlist; keep the Worker contract unchanged. |
| Third-party runtime | Preference is stored only. Registry entries are metadata-only and cannot activate, register commands, or be enabled. | Keep default-off; add package signature/ID validation, manifest review, workspace containment, permissions and a security review before execution. |
| VSIX packages | The file picker is limited to `.vsix`; the manager refuses installation instead of fabricating a manifest. | Add safe ZIP extraction, archive/manifest validation, zip-slip and resource limits, and artifact review before enabling. |

## Not supported

Extension code has no `window`, DOM, Electron bridge, Node.js, `require`, `process`, native modules, `child_process`, arbitrary filesystem, or raw network access. Extensions cannot read/write outside the selected workspace through the mediated workspace API, access `.env` paths, run terminal commands, perform mutating Git operations, or load code dynamically from an extension storage directory. These limits are runtime constraints, not promises inferred from marketplace metadata.

## Extension manifest and settings

IDs use lowercase `publisher.name` slugs. Manifest versions must be semantic versions. Command contributions must use the full `<publisher>.<name>.<command>` namespace. Unknown manifest keys are rejected. Configuration settings are limited to boolean, string, and finite number values; setting keys, primitive types and enum membership are checked against the validated manifest before persistence.

## Author guidance

Treat this API as a Ty-Code-specific contract, not a drop-in host for packages that expect Node.js or an editor workbench runtime. For current distribution, provide listings as discovery metadata only and keep executable logic inside reviewed, statically bundled built-ins. A future third-party compatibility layer will document its exact API surface and migration rules before it is enabled.
