# Getting Started with Free Models in Ty-Code

Welcome to **Ty-Code**! This guide walks you through starting your autonomous coding workflow using our aggregated pool of over **2.05 Billion free tokens per month** without requiring API keys or paid subscriptions.

---

## 1. Quick Start (Ready in < 60 Seconds)

1. **Launch Ty-Code**: On first launch, the **Welcome Wizard** appears automatically.
2. **Click "Enable Free Mode"**: This activates anonymous access to the OpenKilo Gateway, prepares the local free-provider proxy, and pre-warms connection pools.
3. **Select a Quick Task or Open a Project**: Click any sample task (e.g. "Create Debounce Utility with Tests") or press `Ctrl+O` to open your workspace.
4. **Start Coding**: You're ready! Ty-Code automatically classifies your prompts and selects the best free model.

---

## 2. The 2.05B+ Monthly Free Token Pool

Ty-Code aggregates quotas across 5 independent provider networks to ensure you never run out of capacity:

| Provider | Monthly Free Pool | Included Frontier Models |
| :--- | :--- | :--- |
| **OpenKilo Gateway** | **500,000,000 tokens** | DeepSeek R1-0528, Qwen3 Coder, Llama 3.3 70B, Gemma 3 27B, Mistral Small |
| **Local Free Proxy (FCC)** | **1,350,000,000 tokens** | 61+ provider endpoints & community mirrors |
| **OpenRouter Free Tier** | **200,000,000 tokens** | `:free` namespace models (long-context multimodal, reasoning, and coding models) |
| **Groq Cloud** | **50,000,000 tokens** | Ultra-fast LPU inference (`openai/gpt-oss-120b`, `qwen/qwen3.6-27b`) |
| **Local Ollama** | **Unlimited** | Fully private local models (`deepseek-coder`, `qwen2.5-coder`) |

---

## 3. Working with Coding Agents: Build vs. Plan Mode

Ty-Code provides specialized OpenCode agents tailored to different phases of development:

### 🛠️ Build Agent (Default)
- **Permissions**: Full workspace read, write, edit, patch, and terminal execution.
- **Best For**: Writing code, creating files, implementing features, running tests, and fixing bugs.

### 📋 Plan Agent (Read-Only Safety)
- **Permissions**: Strictly read-only (`view`, `ls`, `grep`, `glob`, `diagnostics`). Refuses file modifications and asks for explicit approval before running terminal commands.
- **Best For**: Code exploration, architectural review, codebase onboarding, and security audits.

Toggle between modes anytime using the Agent Mode selector in the top-right of the Assistant panel.

---

## 4. Automatic Model Selection & Fallback

You do not need to manually configure model parameters. Ty-Code automatically handles routing:
- **Writing Functions & Code**: Routed to **Qwen3 Coder** (262K context).
- **Complex Architecture & Debugging**: Routed to **DeepSeek R1** (164K reasoning tokens).
- **Inline Ghost-Text Autocomplete**: Routed to **Groq LPU** for sub-second responses.
- **Screenshots & UI Diagrams**: Routed to a long-context multimodal model.
- **Rate-Limit Failover**: If any provider hits a temporary rate limit (HTTP 429), OmniRoute automatically fails over to the next healthy provider in under 50ms without interrupting your task.

---

## 5. Monitoring Your Quota & Costs

- **Status Bar**: Check the bottom bar for active model, provider health indicator, and real-time free tokens remaining.
- **Usage Dashboard**: Click the status bar pill or open **Preferences > Smart Orchestration > Open Quota Dashboard** to see live token gauges, market cost savings, and routing decision logs.
