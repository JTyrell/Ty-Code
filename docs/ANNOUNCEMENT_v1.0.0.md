# Ty-Code v1.0.0 Launch Announcements & Marketing Copy

This document contains pre-formatted launch announcement templates across social platforms for the **Ty-Code v1.0.0** production release.

---

## 1. Hacker News (Show HN)

**Title:** Show HN: Ty-Code – Open-source desktop AI coding IDE with multi-provider routing & Monaco intelligence

**Submission Text:**

Hi HN,

We built **Ty-Code** ([https://github.com/JTyrell/Ty-Code](https://github.com/JTyrell/Ty-Code)) because we wanted the autonomous coding capabilities of modern agentic coding tools (like Claude Code and Antigravity) wrapped inside a clean, high-performance desktop Monaco IDE, without being locked into expensive proprietary subscription fees.

### What makes Ty-Code different:
1. **Multi-Provider LLM Gateway:** Connects natively to 350+ models across OpenRouter, OpenKilo, Google AI Studio, Groq (~300 tok/s), DeepSeek V3/R1, and local private models via Ollama and LM Studio.
2. **Intelligent Model Router:** Automatically classifies task difficulty (complex reasoning, fast surgical edits, bulk generation) and routes to the best model, with real-time auto-failover if an API encounters rate limits.
3. **True Agentic Tool Loop:** Operates autonomously in your workspace with surgical file patching, Myers diff inspection, AST navigation, and interactive xterm.js PTY terminals.
4. **Desktop Native & Private:** Built with Electron, React 18, and Monaco Editor. All secrets are hardware-encrypted via OS `safeStorage` (Windows DPAPI, macOS Keychain, Linux Secret Service). Telemetry is 100% opt-in and off by default.
5. **Completely Free & Open Source:** MIT licensed.

Binaries are available for Windows (installer & portable), macOS (Universal dmg/zip), and Linux (AppImage, deb, rpm) with full SHA-256 checksum verification.

- **GitHub Release:** https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0
- **Downloads & Website:** https://ty-code.com

We'd love your feedback, bug reports, and pull requests!

---

## 2. Reddit

### r/programming / r/selfhosted / r/LocalLLaMA

**Post Title:** [Release] Ty-Code v1.0.0 – Standalone Desktop AI Coding IDE with Monaco Editor, Local Ollama, and Free/Low-Cost Cloud LLM Routing

**Post Body:**

Hey everyone,

Today we’re officially releasing **Ty-Code v1.0.0**, an open-source desktop AI coding assistant and editor designed to bring agentic coding workflows to everyone without proprietary lock-in.

### 🌟 Key Features:
- 💻 **Monaco Editor Core:** Full VS Code engine with inline completions, AST tokenization, multi-file diff viewer, and syntax highlighting.
- 🔌 **Zero/Low-Cost AI Providers:**
  - 100% offline, private inference via **Ollama** and **LM Studio** (`qwen2.5-coder`, `deepseek-r1`).
  - Free cloud tiers & 350+ models via **OpenRouter**, **Groq**, **DeepSeek Direct**, and **Google AI Studio**.
  - Drop-in support for **Free-Claude-Code** (`localhost:8082`).
- 🤖 **Agentic Capabilities:** Reads, edits, replaces code surgically, runs terminal commands in integrated PTY shells, and searches workspaces.
- 🛡️ **Zero Tracking & Hardware Encryption:** API keys are encrypted at rest using OS credential stores. No background tracking or phone-home telemetry.
- ♿ **WCAG AA Compliant:** Zero axe-core accessibility violations, full screen reader support, and high contrast styling.

### 📦 Download Links:
- **Windows:** [Ty-Code-Setup-1.0.0.exe](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-Setup-1.0.0.exe) | [Portable ZIP](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0-win.zip)
- **macOS (Intel & Apple Silicon):** [Ty-Code-1.0.0.dmg](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.dmg)
- **Linux:** [AppImage](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.AppImage) | [DEB](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/ty-code_1.0.0_amd64.deb) | [RPM](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/ty-code-1.0.0.x86_64.rpm)

Check out the code and release notes: [https://github.com/JTyrell/Ty-Code](https://github.com/JTyrell/Ty-Code)

---

## 3. X (Twitter) Thread

**Tweet 1/4:**  
🚀 Exciting news! We just released **Ty-Code v1.0.0**, an open-source desktop AI coding assistant & Monaco IDE!  
✨ Monaco Editor engine  
✨ Multi-provider routing (OpenRouter, Groq, Ollama, DeepSeek)  
✨ 100% private offline inference  
✨ Autonomous coding agent  
https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0

**Tweet 2/4:**  
Tired of expensive monthly subscriptions just to pair program with AI?  
Ty-Code routes your coding tasks across free and low-cost endpoints or runs fully local on your own GPU with @ollama and LM Studio. Zero vendor lock-in. 🔓

**Tweet 3/4:**  
Security first 🛡️:  
- OS-level credential encryption (`safeStorage`)  
- Strict process sandboxing & CSP  
- Zero unsolicited telemetry  
- Cryptographically verified releases & SHA-256 manifests  

**Tweet 4/4:**  
Get started today on Windows, macOS, or Linux!  
Download binaries: https://ty-code.com  
Star us on GitHub: https://github.com/JTyrell/Ty-Code ⭐  
Let us know what you build! #OpenSource #AI #WebDev #TypeScript #DeveloperTools

---

## 4. Discord Announcement Template

```markdown
@everyone 🚀 **Ty-Code v1.0.0 is officially released!**

We are thrilled to announce the first production release of **Ty-Code**!

### 🎉 What's New in v1.0.0:
- **Monaco Editor Intelligence:** Native code completions, multi-tab editing, split diffs, and AST symbol navigation.
- **Universal Provider Gateway:** Switch seamlessly between OpenRouter, Groq, DeepSeek, Google AI Studio, and local Ollama models.
- **Autonomous Tool Execution:** Terminal command execution, surgical code replacements, and live workspace search.
- **Cross-Platform Installers:** Verified production packages for Windows (`.exe` installer & portable `.zip`), macOS (`.dmg`), and Linux (`.AppImage`, `.deb`, `.rpm`).

📥 **Download Now:** https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0 or visit https://ty-code.com
⭐ **GitHub Repo:** https://github.com/JTyrell/Ty-Code

Drop your thoughts in #general or report any issues in #support! Happy coding! 💻⚡
```
