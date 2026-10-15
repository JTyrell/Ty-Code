# Future Phase: Managed Language-Server Distribution

**Status:** Deferred. Current releases remain user-managed: Ty-Code detects system executables and workspace-local candidates, but never auto-runs workspace-local candidates. A user may explicitly configure an absolute executable path. This document specifies a future phase; it does not authorize downloads or launches in the current release.

## Goals

- Offer a safe, reproducible optional way to install and update supported LSP servers.
- Keep the current process boundary: server processes run in Electron main, and the renderer uses the typed LSP IPC contract.
- Keep a browser build viable without `child_process`, local executable paths, or access to the host filesystem.

## Supply-chain requirements

1. **Official sources only.** Maintain a reviewed manifest mapping each language-server id and version to the upstream project release, supported OS/architecture, archive URL, SHA-256 digest, signature/provenance metadata where upstream publishes it, expected executable, and expected version output. Do not use arbitrary GitHub mirrors, package indexes, user-supplied URLs, or a floating `latest` URL as a trusted source.
2. **Verify before extraction or execution.** Require a SHA-256 digest from a separately reviewed manifest and validate any upstream signature/checksum signature when available. Fetch and verify release metadata over TLS; fail closed on missing/mismatched digests, invalid signatures, unsupported architecture, or an unrecognized manifest. Hash the downloaded archive before extraction and the resulting executable after extraction.
3. **Bounded archive handling.** Enforce compressed and expanded byte limits, maximum entry count, path containment, symlink restrictions, duplicate-name rejection, and decompression-ratio limits. Reject absolute paths, `..` traversal, alternate data streams, and files escaping the per-user server cache. Extract into a new staging directory, validate expected layout and executable identity, then atomically promote it.
4. **Least privilege.** Install into a Ty-Code-owned per-user data directory, not the workspace, application install directory, or global PATH. Do not elevate privileges. Do not execute install hooks, post-install scripts, package lifecycle scripts, or content from the workspace.
5. **Runtime verification.** Before launch, re-check the cached executable's hash and resolved path against the verified manifest. Spawn only that exact path with a fixed, reviewed argument template and `shell: false` (using a cross-platform shim strategy where the upstream distribution requires it). Keep workspace-local discovery informational and separate from managed installation state.
6. **Auditability.** Record server id, version, source, digest, signature result, install time, and update outcome. Do not store workspace source contents, credentials, or arbitrary environment variables in this record.

## Per-platform archive and execution plan

The manifest will explicitly list supported OS and CPU architecture combinations. Do not infer that a universal binary or archive exists.

- **Windows:** Prefer upstream ZIP archives. Reject reparse points and symlinks; prevent path traversal and alternate data streams. Keep executables inside the verified per-user version directory. Handle `.cmd`/`.bat` launchers only with a reviewed, argument-safe strategy; otherwise require an upstream native executable or report the platform/version as unsupported.
- **macOS:** Select the architecture-specific upstream archive for Intel or Apple Silicon. Verify the archive before extraction, preserve required execute bits, and verify the resulting executable. Account for upstream signing/notarization metadata where supplied; do not bypass Gatekeeper or remove quarantine flags automatically.
- **Linux:** Select the architecture-specific tarball or upstream-supported package artifact. Preserve executable mode only for manifest-listed binaries. Do not run package-manager scripts. If upstream only distributes OS package formats that cannot be safely extracted and verified without script execution, keep that server user-managed for that platform rather than weakening the policy.

The implementation must maintain a per-version directory and a separately recorded active version so a validated update can be switched atomically and rolled back without overwriting a running server.

## Update and patch policy

- Ship a reviewed, version-pinned manifest with explicit release channel and architecture allowlists. No background update may replace a server without a user-visible policy and successful integrity checks.
- Query upstream release metadata only from the documented official endpoint. Enforce request timeouts, response-size caps, redirects restricted to approved upstream domains, and rate limits.
- For each update: download to staging, verify SHA-256 and signatures/provenance, scan archive structure and size, extract safely, run a bounded version probe, and only then publish as an available version.
- Keep the currently active version until the user selects the verified update or an explicit “update automatically” preference is designed and approved. A failed update must leave the prior version active.
- On startup, re-hash the active executable. If integrity validation fails, refuse to launch, report the exact reason, and offer a verified reinstall or the existing manual-path workflow.
- Track security advisories and upstream revocations. A revoked or compromised version must be disabled for new starts; provide a path to remove it and select a verified rollback version.
- Pin and review any downstream patches. Each patch requires an auditable upstream commit or internal security ticket, reproducible build/checksum evidence, and a release note. Never silently patch a binary after signature verification.

## Browser/Web language-server strategy

The browser build cannot spawn OS executables. Implement a separate `BrowserLanguageServerProvider` behind the existing language-provider boundary rather than weakening the desktop server policy.

- Run compatible servers as WASM inside dedicated Web Workers, with no DOM, Electron bridge, Node.js, arbitrary filesystem, or ambient network access.
- Evaluate each server independently for a maintained WASM build and license compatibility. TypeScript may use the in-browser TypeScript language service; Python, Rust, Go, Java, and C/C++ must remain marked unsupported until a specific maintained WASM distribution is reviewed and tested. Do not claim broad LSP support from syntax highlighting alone.
- Restrict project file access to an explicit virtual workspace filesystem backed by OPFS or an approved in-memory workspace. Enforce workspace path containment and file-size limits for all reads and writes.
- Keep worker RPC typed, versioned, bounded, cancellable, and timeout-protected. Do not permit WASM workers to fetch arbitrary network resources.
- Add a browser capability matrix and report when a feature uses native LSP, WASM LSP, or Monaco's built-in fallback.

## Acceptance criteria for the deferred phase

- [ ] Every managed binary is sourced from an official upstream manifest and passes digest/signature checks before extraction and execution.
- [ ] Archive traversal, symlink/reparse-point escapes, oversized archives, malicious redirects, and tampered executables are rejected in tests.
- [ ] Per-OS/architecture installation, update, active-version switch, and rollback are covered on Windows, macOS, and Linux CI.
- [ ] No install script or workspace-local executable is run by the managed-download feature.
- [ ] The browser provider uses only reviewed WASM workers and an explicit virtual workspace; unsupported languages are clearly reported.
- [ ] The manual absolute-path workflow remains available as an alternative, and security failures fail closed.

## Official upstream references used for current manual guidance

- TypeScript Language Server: <https://github.com/typescript-language-server/typescript-language-server>
- Pyright / Python LSP Server: <https://github.com/microsoft/pyright/blob/main/docs/installation.md> and <https://pypi.org/project/python-lsp-server/>
- rust-analyzer: <https://rust-analyzer.github.io/book/installation.html>
- gopls: <https://go.dev/gopls/>
- Eclipse JDT Language Server: <https://github.com/eclipse-jdtls/eclipse.jdt.ls>
- clangd: <https://clangd.llvm.org/installation.html>
