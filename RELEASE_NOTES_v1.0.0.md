# Ty-Code v1.0.0 Release Notes

**Release Date:** October 2026  
**Version:** v1.0.0  
**License:** MIT  

Welcome to the initial production release of **Ty-Code (v1.0.0)** — the standalone desktop AI coding assistant with Monaco editor intelligence, multi-provider model routing, and autonomous agent capabilities.

---

## Highlights

- **Multi-Provider AI Orchestration:** Native support for 350+ models across OpenRouter, OpenKilo, Google AI Studio, Groq, DeepSeek, local Ollama, and Free Claude Code (FCC) sidecar proxy.
- **Intelligent Model Router:** Automatic task classification (coding, reasoning, fast edits) and real-time auto-failover across healthy endpoints.
- **Monaco Code Intelligence:** Deep Monaco editor integration with real-time inline ghost-text completions, AST tokenization, and multi-file Myers diff visualization.
- **Integrated Terminal PTY:** Production-grade xterm.js terminal with session multiplexing, split panes, ANSI color rendering, and scrollback persistence.
- **Source Control Suite:** Visual Git staging, hunk-level diff inspections, branch switching, stash management, and commit workflows.
- **Security & Sandboxing:** OS-level Electron process isolation (`contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`), strict Content Security Policy, and hardware-backed credential encryption via `safeStorage`.
- **WCAG AA Accessibility:** Full screen-reader support, zero axe-core violations, 17.75:1 high-contrast typography, and reduced-motion mode.
- **Internationalization (i18n):** Complete localized interface across 6 languages: English, Spanish, Japanese, Chinese, German, and French.

---

## 📦 Download Packages

- **Windows:** `Ty-Code-Setup-1.0.0.exe` (NSIS Installer) / `Ty-Code-1.0.0-portable.exe`
- **macOS:** `Ty-Code-1.0.0-mac.dmg` / `Ty-Code-1.0.0-mac.zip` (Universal Intel/Apple Silicon)
- **Linux:** `Ty-Code-1.0.0-x64.AppImage` / `Ty-Code-1.0.0-x64.deb` / `Ty-Code-1.0.0-x64.rpm`

SHA-256 checksums are published in `SHA256SUMS.txt` accompanying the release assets.

---

## Known Issues

- Build-time dependency `electron-builder` has moderate-severity vulnerability in transitive dependency `sprintf-js` (GHSA-hp3w-g68c-fv3c). No runtime impact on end users. Documented in `docs/SECURITY_AUDIT_v1.0.0.md`. Will be resolved in v1.1.0.
