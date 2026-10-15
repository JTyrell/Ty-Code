# Getting Started with Free Providers in Ty-Code

Welcome to **Ty-Code**! Ty-Code is designed from the ground up to give developers access to frontier AI models completely free of charge, with zero required configuration, aggregated across **8+ free providers** and delivering over **2.05 Billion free tokens per month**.

---

## 1. Quick Start (Ready in 30 Seconds)

1. **Launch Ty-Code**: On first launch, the welcome screen appears.
2. **Enable Free Mode (Active by Default)**: Ty-Code automatically initializes anonymous connections to the **OpenKilo Gateway**, **OpenRouter Free**, **Groq Ultra-Fast**, and **Google AI Studio**.
3. **Start Prompting**: Open any file or press `Ctrl+N` to start chatting. The **Intelligent Model Router** automatically classifies your task and routes it to the optimal free model.

---

## 2. The 8+ Connected Free Providers

| Provider | Access Type | Highlight Models | Best For |
| :--- | :--- | :--- | :--- |
| **OpenRouter Free** | Free Tier (`:free`) | `deepseek-r1:free`, `qwen-2.5-coder-32b:free`, `llama-3.3-70b:free` | Deep mathematical reasoning & coding |
| **Groq Cloud** | Free Direct API | `llama-3.3-70b-versatile`, `llama-3.1-8b-instant` | Sub-100ms ultra-fast code generation |
| **OpenKilo Gateway** | Zero-Config Anonymous | `claude-3-5-sonnet`, `deepseek-r1-0528`, `qwen3-coder` | 40+ free models with zero API key setup |
| **Google AI Studio** | Free Tier (Gemini) | `gemini-2.0-flash-exp`, `gemini-1.5-pro` | 1M+ large context windows & multimodal vision |
| **GitHub Models** | Free via GitHub PAT | `gpt-4o-mini`, `Meta-Llama-3.1-70B` | Enterprise Azure-backed inference |
| **Together AI** | Free Tier | `Qwen2.5-Coder-32B`, `Mixtral-8x7B` | Open-weights coding and general chat |
| **Fireworks AI** | Free Tier | `qwen2p5-coder-32b`, `llama-v3p3-70b` | High-throughput low-latency inference |
| **Hugging Face** | Free Inference API | `Llama-3.3-70B-Instruct`, `Mistral-7B` | Community models & experimental architectures |
| **FCC Proxy** | Free Proxy | `claude-3-5-sonnet-fcc` | Community-pooled coding capacity |

---

## 3. Intelligent Model Routing Tiers

You never need to remember model parameters or context lengths. Ty-Code assigns every model to a capability tier and selects dynamically:

- **Tier S (Reasoning Specialist):** DeepSeek R1, Claude 3.5 Sonnet. Triggered by words like *"explain, analyze, architect, why, how, proof"*.
- **Tier A (Code Generation & Refactoring):** Qwen 2.5 Coder 32B, Llama 3.3 70B Versatile. Triggered by words like *"write, implement, fix, refactor, function, class"*.
- **Tier B (General Intelligence):** Llama 3.3 70B Instruct, GPT-4o Mini. Triggered by general questions and conversational queries.
- **Tier C (Fast Execution):** Groq Llama 8B Instant, Gemini 2.0 Flash Exp. Sub-100ms speed for quick queries, linting, and short questions.

---

## 4. User Preference Overrides & Mid-Conversation Switching

You can override automatic routing at any time:

1. **Quick Switch Shortcut (`Ctrl+M`):** Press `Ctrl+M` anywhere in the IDE to open the model selector dropdown.
2. **Preference Modes:**
   - **Auto (Default):** Multi-factor algorithm chooses the best healthy model.
   - **Fastest:** Always routes to sub-100ms LPU endpoints (Groq).
   - **Most Capable:** Always routes to Tier S frontier reasoning models.
   - **Preferred Provider:** Restricts selection to your chosen provider (e.g., Groq only).
   - **Manual:** Locks the specific model for the conversation.
3. **Context Preservation:** Switching models mid-conversation preserves all chat history and active file context.

---

## 5. Adding Custom Keys (BYOK)

Want to use your personal API keys or higher rate limits?

1. Open **Settings** (`Ctrl+,`) → **Providers & BYOK**.
2. **Auto-Detection:** Click "Scan Environment" to automatically import API keys found in `.env` or system environment variables.
3. **Guided Setup:** Click any provider card (e.g. Groq, OpenRouter, Anthropic) to get an API key and test your connection in real-time.
4. **Security:** All API keys are encrypted at rest using system-level safe storage.

---

## 6. Unified Provider Dashboard & Quota Management

Track your usage at any time:
- **Status Bar:** Look at the bottom right for active model, capability tier badge (`Tier S`, `Tier A`), and health status.
- **Unified Dashboard:** Click the status bar pill or open **Unified Dashboard** to see:
  - Real-time token consumption progress bars.
  - Estimated commercial cost savings ($).
  - Side-by-side provider benchmark comparisons.
  - AI-driven optimization recommendations (e.g. Groq quota warnings, model pinning).
