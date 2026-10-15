# AGENTS & Workflow Protocols: Ty-Code

## Specialized Agent Roles & Responsibilities

In developing and maintaining Ty-Code, the system leverages specialized persona domains to maintain high architectural integrity, zero security vulnerabilities, and rock-solid developer experience:

### 1. Chief Systems Architect / Desktop Lead
- **Domain**: Electron lifecycle, process orchestration (Main vs Preload vs Renderer), window management, native system packaging, and cross-platform build targets.
- **Responsibilities**:
  - Enforce strict Electron sandboxing (`contextIsolation: true`, `nodeIntegration: false`).
  - Standardize typed IPC schemas between Renderer and Main processes.
  - Ensure zero native crash states and handle OS-specific signals (SIGINT, SIGTERM, App Nap).

### 2. Agentic Engine Specialist
- **Domain**: Autonomous LLM agent state machine, tool-calling lifecycle, system prompt construction, context window budgeting, and error reflection.
- **Responsibilities**:
  - Build the multi-turn agent loop with iteration budgets, early termination checks, and timeout handling.
  - Implement workspace tools: `read_file`, `write_file`, `replace_file_content`, `run_command`, `grep_search`, `list_dir`.
  - Design diff generation, verification, and atomic patch mechanisms.

### 3. Multi-Provider & Protocol Specialist (Inspired by `free-claude-code`)
- **Domain**: Low-latency LLM provider integrations, streaming SSE parsers, API translation between Anthropic/OpenAI schema, and local inference connectors.
- **Responsibilities**:
  - Implement pluggable provider adapters (OpenRouter, Groq, DeepSeek, NVIDIA NIM, Ollama, LM Studio).
  - Handle streaming Server-Sent Events (SSE) parsing, token accumulation, and tool-call payload streaming.
  - Manage rate limits, exponential backoff retries, and automatic model fallback.

### 4. UI/UX & Monaco Specialist
- **Domain**: React 18/19 presentation tier, Monaco Editor lifecycle, Xterm.js terminal emulator, splitter docking layout, and sidecar chat interface.
- **Responsibilities**:
  - Integrate `@monaco-editor/react` with syntax highlighting, custom themes, tabs, and dirty-state indicators.
  - Embed the Monaco Diff Editor (`monaco.editor.createDiffEditor`) for side-by-side patch review and inline chunk approval.
  - Provide modern dark-mode aesthetics, micro-interactions, and responsive layout resizing.

### 5. Security & Persistence Guardian
- **Domain**: OS-backed credential storage, path sanitization, shell injection prevention, and context memory persistence.
- **Responsibilities**:
  - Save API keys only when Electron `safeStorage` can use a secure OS credential backend; fail closed on unsupported Linux `basic_text` and unavailable backends.
  - Restrict agent filesystem access strictly to the active workspace folder (prevent directory traversal via `..` or symbolic links).
  - Intercept dangerous terminal commands and enforce explicit user confirmation before execution.

---

## Communication Protocols

1. **Context First**: Before making architectural changes or creating new modules, inspect the `/context/` markdown files. Treat these specifications as the project's persistent memory.
2. **Explicit Contracts**: Main and Renderer communicate strictly over strongly typed IPC channels defined in `src/preload/types.ts`. No untyped or arbitrary `eval` payloads are permitted.
3. **Persistent Memory Updates**: Update `progress-tracker.md` upon completing milestones or encountering blockers.
4. **Non-Destructive Testing**: Test runner actions and shell commands executed by agents must execute in isolated working directories or non-destructive sandbox environments.

---

## Escalation Paths & Decision Matrix

| Scenario | Protocol | Escalation Action |
| :--- | :--- | :--- |
| **API Provider Rate Limit / Outage** | Automated Fallback | Fallback to secondary configured provider (e.g., OpenRouter -> Groq -> Local Ollama) and notify user via status pill. |
| **Destructive Command Attempted** (`rm -rf`, `git reset --hard`) | User Intercept | Pause agent execution, render modal with warning & exact command line, require explicit button press. |
| **File Edit Conflict / Hash Mismatch** | Diff Rejection | Refuse to apply patch if file has changed on disk since read. Request agent re-read file and regenerate diff. |
| **Ambiguous User Requirement** | Direct Clarification | Ask clarifying questions with structured options instead of making assumptions on core architecture. |
