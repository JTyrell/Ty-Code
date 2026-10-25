# How Ty-Code Chooses Models: Smart Orchestration & Unified Experience (Layer 6)

## 1. Overview

Ty-Code's **Smart Orchestration Engine** (Layer 6) bridges multi-provider model aggregation with task-aware heuristics. Instead of forcing developers to manually switch between dozens of models and providers, Ty-Code automatically classifies incoming requests, selects the optimal free model, tracks monthly token quotas across all providers in real time, and gracefully rotates between providers when rate limits or saturation occur.

---

## 2. Intelligent Routing Rules

Ty-Code classifies prompts into one of six core task domains using syntactic patterns, lexical cues, attached context, and token payload size:

| Task Domain | Primary Selection | Context Window | Key Strengths & Routing Logic |
| :--- | :--- | :--- | :--- |
| **Code Generation** | `qwen/qwen3-coder:free` / `deepseek-coder` | 262,144 tokens | Automatically selected for refactoring, writing functions, algorithmic problem solving, tests, and syntax debugging. |
| **Complex Reasoning** | `deepseek/deepseek-r1-0528` / `deepseek-r1` | 164,000 tokens | Activated for chain-of-thought, mathematical proofs, architectural planning, logic puzzles, and multi-file analysis. |
| **Fast Responses** | `groq/openai/gpt-oss-120b` / `openai/gpt-oss-20b` | 131,072 tokens | Routed to ultra-fast Groq LPU inference for real-time Monaco inline ghost-text completions, keystroke autocompletion, and low-latency explanations. |
| **Large Context** | Long-context coding and multimodal models | 262,144+ tokens | Triggered when prompt and codebase context exceeds 32,000 tokens (e.g. multi-file repositories, large logs, AST indexes). |
| **Vision & Multimodal** | Vision-capable multimodal models | 131,072+ tokens | Selected whenever screenshots, UI wireframes, diagrams, or image attachments are present in the user request. |
| **Simple Queries** | `meta-llama/llama-3.2-3b-instruct:free` / `llama-3.1-8b` | 128,000 tokens | Conserves high-capacity quotas by handling straightforward greetings, command syntax lookups, and basic formatting with compact, fast models. |

---

## 3. Real-Time Quota Management & Multi-Provider Rotation

Ty-Code aggregates free-tier quotas across multiple independent providers, providing developers with **over 2.05 Billion free tokens per month**:

```mermaid
flowchart TD
    UserPrompt[User Prompt / Action] --> Classifier[Smart Classifier]
    Classifier --> TaskType{Task Domain}
    TaskType --> RoutingTable[Routing Table & Provider Pool]
    RoutingTable --> QuotaCheck{Provider Quota & Health Check}
    QuotaCheck -- Healthy --> Execute[Execute LLM Stream via Provider Gateway]
    QuotaCheck -- 429 Cooldown / Saturation --> Failover[Auto-Rotate to Backup Provider]
    Failover --> Execute
    Execute --> TokenEstimator[Real-time Token Estimator (Sub-5% Accuracy)]
    TokenEstimator --> Dashboard[Usage Dashboard & Decision Logs]
```

### Provider Allocations & Health Tracking

- **OpenKilo Gateway**: 500M tokens/month (40+ free models with anonymous access or API key).
- **Local Free Proxy**: 1.35B tokens/month across 61+ provider backends.
- **OpenRouter Free Tier**: 200M tokens/month (`:free` namespace).
- **Groq Cloud**: 50M tokens/month (Fast LPU inference).
- **Local Ollama**: Unlimited tokens/month (runs completely offline on local GPU/CPU).

### Accurate Token Estimation & Cost Projections

- Prompt and completion tokens are estimated using sub-5% BPE heuristic calibration (`charCount / 3.8`).
- Cost savings are calculated using the commercial industry baseline ($3.00 per 1M tokens), showing developers exact dollar savings in the UI.

---

## 4. User Controls & UI Visibility

### 1. Interactive Status Bar

Located at the bottom of the editor, the status bar displays:

- **Active Model**: Clean model name (e.g., `qwen3-coder:free`).
- **Provider Health Dot**: Green (Healthy), Amber (Cooling Down / Rate-Limited), Red (Quota Exhausted).
- **FREE Badge**: Highlights zero-cost model operation.
- **Headroom Indicator**: Real-time token usage (e.g., `⚡ 2.05B Free`).
- **One-Click Trigger**: Clicking opens the Usage & Quota Dashboard.

### 2. Usage & Quota Dashboard

Accessible from the Status Bar or Settings Modal:

- **Hero Metrics**: Total Free Tokens, Consumed Tokens, Dollar Savings ($), Global Quota percentage.
- **Provider Quota Gauges**: Real-time progress bars for each provider with status pills.
- **Routing Rules Guide**: Visual breakdown of all 6 classification rules.
- **Decision Logs (Power User Mode)**: Audit log showing exact timestamps, prompt snippets, task classifications, selected models, and reasoning.

### 3. One-Click Free Mode

A dedicated toggle in the Dashboard and Settings Modal that enforces $0 commercial spend by restricting routing strictly to free models and local providers.

---

## 5. Premium Coding Experience

- **Monaco Inline Ghost Text**: Powered by fast-response models (`openai/gpt-oss-20b` / `qwen3-coder`) with 200ms debounce typing detection.
- **Multi-File Context Awareness**: Reconciles large-context models (up to 262K tokens) for comprehensive workspace understanding.
- **Terminal & Git Integration**: Autonomous command generation, commit message synthesis, and merge conflict resolution.
