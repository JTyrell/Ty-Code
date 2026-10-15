# Remaining Release Validation Plan

**Status:** Planned; the checks below are not yet evidence of passing results.  The existing `npm test` and production build remain the baseline gate.  Keep measured outputs and platform artifacts with CI runs so release claims can be traced to evidence.

## Current evidence boundary

- `npm test` runs strict TypeScript plus phase-specific Node validation scripts. It does not collect code coverage or launch the Electron renderer.
- `npm run test:polish` exercises in-memory/service/config behavior. Its synthetic file-tree check does not measure the real `VirtualFileTree` DOM, file-system load, or frame rate.
- Theme and CI configuration assertions are not WCAG audits. The guide's accessibility and smooth-scrolling statements must not be described as measured until the checks below pass.
- Monaco is lazy-loaded. Record startup both before and after opening an editor/diff surface.

## Gate 1 — Establish coverage measurement

1. Add a maintained TypeScript-capable unit-test runner and V8 coverage provider (candidate: Vitest with `@vitest/coverage-v8`); migrate reusable service assertions from the existing scripts incrementally and retain integration tests that use real IPC/process behavior.
2. Emit machine-readable and human-readable coverage reports in CI. Define the initial denominator explicitly: production TypeScript under `src/main/services`, `src/main/agent`, `src/main/providers`, `src/renderer/src/services`, and `src/renderer/src/state`.
3. Require **at least 80% line and branch coverage** for that declared scope before calling the scoped gate green. Do not call this whole-app coverage; add renderer component coverage to the denominator as UI tests are introduced, and expand the threshold gate before making an overall coverage claim.
4. Keep negative/error paths represented: IPC validation, cancellation/cleanup, rollback, workspace/path boundaries, provider failures, LSP start/stop and workspace changes, and updater failures.

**Acceptance evidence:** CI coverage summary and HTML report with the exact denominator, line/branch percentages, and threshold result; baseline `npm test` and `npm run build` still pass.

## Gate 2 — Measure app performance in Electron

Add a repeatable Electron E2E benchmark harness, using a fixed fixture and a packaged or production-equivalent build. Record OS, CPU, Electron/Node versions, commit SHA, raw samples, and summary in a CI artifact (for example `perf-results.json`). Use at least five cold starts for startup measurements; avoid turning noisy hosted-runner measurements into release blockers until a stable reference runner is designated.

| Measurement | Method | Target |
| --- | --- | --- |
| Startup to interactive shell | Cold-start Electron; capture app-ready/`ready-to-show` and renderer shell-ready separately; report median and p95 | p95 < 2 s to interactive shell |
| Working set | Sum Electron process working sets after 60 s idle with a 1,000-file workspace; repeat with Monaco editor and diff open | < 500 MB per recorded scenario |
| Editor interaction | CDP trace while typing 500 characters in Monaco and scrolling the file tree; report frame and input-to-paint distributions | p95 frame <= 16.7 ms; p95 input-to-paint < 16 ms |
| File-tree load | Real 10,000-file fixture through the filesystem handler and actual `VirtualFileTree`; record first usable render and DOM node count | Load < 500 ms; DOM remains viewport-bounded (assert against rendered rows plus overscan, not a formula-only count) |
| Project indexing | Retain the 1,000-file fixture; report measured duration and assert the stated bound | < 10 s; record actual value (do not infer a 1.2 s claim from a looser bound) |
| Inline completion | Measure with `performance.now()` across repeated cold/cache-hit calls in the actual provider path | p95 < 300 ms; cache-hit measurement reported separately, target < 2 ms |
| Time to first token | Local deterministic mock SSE provider; measure Enter-to-first-delta overhead in renderer. Live provider benchmarks are separate and key-dependent | < 800 ms cloud / < 300 ms Groq for app overhead with a matching deterministic fixture |

**Acceptance evidence:** artifact includes raw samples, median/p95, fixture size, environment, and pass/fail thresholds. Any mock-provider TTFT report is labeled app overhead only, not external-provider latency.

## Gate 3 — Accessibility and keyboard verification

1. Run an accessibility tree/axe audit against the real Electron renderer (or a controlled preload mock with the same screens) for Welcome, editor, diff review, Settings, Chat, Source Control, Terminal, Extensions, Command Palette, Quick Open, and onboarding.
2. Cover dark, light, and high-contrast themes. Require zero **critical or serious** automated violations. Check text contrast >= 4.5:1 for normal text and >= 3:1 for large text and essential UI controls; report each theme separately.
3. Automate keyboard-only navigation for each view: all controls reachable, visible focus, dialogs focus-contained and Escape-dismissable where appropriate, and no keyboard traps outside dialogs.
4. Add and validate `prefers-reduced-motion` handling for nonessential motion. Check Monaco's keyboard/screen-reader accessibility support configuration and representative editor interactions.
5. Run a documented manual assistive-technology pass: NVDA (Windows), VoiceOver (macOS), and Orca (Linux), covering navigation landmarks, names/states, dialogs, editor, terminal, and review actions.

**Acceptance evidence:** versioned axe report per theme/view, contrast report, keyboard checklist, manual AT results by OS/reader, and fixes for every critical/serious finding. Do not claim WCAG 2.1 AA from theme names or static CSS assertions alone.

## Gate 4 — Signed release and update behavior

1. With repository signing secrets configured, build Windows NSIS/portable, universal macOS DMG/ZIP, and Linux AppImage/DEB/RPM on their supported CI runners.
2. Install or launch each format on its target OS; verify app icon, startup, workspace open, settings persistence, PTY open/close, and clean shutdown. Record macOS notarization status. Test Windows native PTY teardown in packaged Electron, not only standalone Node.
3. Publish a test prerelease. Validate stable/beta/nightly selection, update detection, manifest/blockmap availability, download progress, download/install, relaunch, and version transition using real release metadata. Keep a known-good signed release for operator recovery; application-level updater rollback is not implemented.
4. Run an advisory production dependency audit (`npm audit --omit=dev`) and record triage for any findings before public distribution.

**Acceptance evidence:** per-OS artifact hashes, signatures/notarization, install and smoke-test results, update logs, and resolved or explicitly accepted dependency findings.

## Execution order

1. Introduce coverage tooling and make the scoped threshold visible in CI.
2. Add deterministic Electron E2E fixtures and startup/memory instrumentation; first capture a baseline before enforcing hosted-runner limits.
3. Add per-theme axe/contrast and keyboard checks, then complete manual assistive-technology runs.
4. Extend performance traces to editor interaction, file-tree DOM, indexing, inline completion, and mock SSE TTFT.
5. Complete signed per-OS install/PTY smoke tests and test-prerelease updater validation.
6. Update [context/progress-tracker.md](../context/progress-tracker.md) only with measured outcomes and environment details; keep public release blocked until the applicable signing, install, update, accessibility, and coverage gates pass.
