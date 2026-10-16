# Ty-Code Provider & Model Catalog

Comprehensive catalog of supported AI providers, models, free-tier quotas, rate-limit headers, and OS-level hardware credential encryption architecture in Ty-Code.

---

## 1. Supported Providers & Models

### 1.1 BYOK (Bring Your Own Key)

Users supply their own API key, stored encrypted via OS-level hardware backing (`Electron safeStorage`).

| Provider | Provider ID | Supported Models | Default Context | Default Model | Base URL |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Anthropic** | `anthropic` | `claude-3-5-sonnet-20241022`<br>`claude-3-5-haiku`<br>`claude-3-opus-20240229` | 200,000 | `claude-3-5-sonnet-20241022` | `https://api.anthropic.com/v1` |
| **OpenAI** | `openai` | `gpt-4o`<br>`gpt-4o-mini`<br>`o1`<br>`o3-mini` | 128,000 | `gpt-4o` | `https://api.openai.com/v1` |
| **Google Gemini** | `gemini` | `gemini-2.0-flash`<br>`gemini-1.5-pro`<br>`gemini-1.5-flash` | 1,000,000 | `gemini-2.0-flash` | `https://generativelanguage.googleapis.com/v1beta` |
| **Groq** | `groq` | `llama-3.3-70b-versatile`<br>`llama-3.1-8b-instant`<br>`mixtral-8x7b-32768` | 128,000 | `llama-3.3-70b-versatile` | `https://api.groq.com/openai/v1` |
| **DeepSeek** | `deepseek` | `deepseek-chat`<br>`deepseek-reasoner` | 64,000 | `deepseek-chat` | `https://api.deepseek.com` |
| **OpenRouter** | `openrouter` | 300+ commercial & open-source models with unified routing | Dynamic | `anthropic/claude-3.5-sonnet` | `https://openrouter.ai/api/v1` |

---

### 1.2 Free Tier Providers

Permanent and zero-cost cloud options with automated rate-limit extraction and failover.

| Provider | Provider ID | Flagship Free Models | Daily/Minute Rate Limits | "Get Free Key" URL |
| :--- | :--- | :--- | :--- | :--- |
| **OpenRouter Free** | `openrouter` | `deepseek/deepseek-r1:free`<br>`qwen/qwen-2.5-coder-32b-instruct:free`<br>`meta-llama/llama-3.3-70b-instruct:free`<br>`google/gemini-2.0-flash-exp:free` | 20 requests / min<br>200 requests / day | [openrouter.ai/keys](https://openrouter.ai/keys) |
| **Groq Free Tier** | `groq` | `llama-3.3-70b-versatile`<br>`llama-3.1-8b-instant`<br>`mixtral-8x7b-32768` | 30 requests / min<br>14,400 requests / day<br>300+ tokens/sec | [console.groq.com/keys](https://console.groq.com/keys) |
| **Google AI Studio** | `google-ai-studio` | `gemini-2.0-flash`<br>`gemini-1.5-pro` | 15 requests / min<br>1,500 requests / day<br>1M token window | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) |

---

### 1.3 Local / Private Providers

Zero-telemetry, 100% offline local inference on localhost.

| Provider | Provider ID | Default Endpoint | Auto-Detected Models | Hardware Requirement |
| :--- | :--- | :--- | :--- | :--- |
| **Ollama** | `ollama` | `http://localhost:11434/v1` | `qwen2.5-coder`<br>`llama3.2`<br>`deepseek-r1`<br>`codellama` | Local GPU (VRAM >= 8GB) or Apple Silicon |

Auto-detection checks `http://localhost:11434/api/tags` and automatically registers discovered local models with zero user configuration.

---

## 2. Rate-Limit Header Extraction & Quota Tracking

Ty-Code extracts provider rate limits on every HTTP response and tracks them in the persistent SQLite usage ledger.

### 2.1 Extracted Headers

| Provider | Remaining Requests Header | Remaining Tokens Header | Reset Timestamp Header | Retry-After Header |
| :--- | :--- | :--- | :--- | :--- |
| **OpenRouter** | `x-ratelimit-remaining` | `x-ratelimit-remaining-tokens` | `x-ratelimit-reset` | `retry-after` |
| **Groq** | `x-ratelimit-remaining-requests` | `x-ratelimit-remaining-tokens` | `x-ratelimit-reset-requests` | `retry-after` |
| **OpenAI** | `x-ratelimit-remaining-requests` | `x-ratelimit-remaining-tokens` | `x-ratelimit-reset-requests` | `retry-after` |
| **Anthropic** | `anthropic-ratelimit-requests-remaining` | `anthropic-ratelimit-tokens-remaining` | `anthropic-ratelimit-requests-reset` | `retry-after` |
| **Google Gemini** | `x-ratelimit-remaining` | - | `x-ratelimit-reset` | `retry-after` |

### 2.2 Reset Time Parsing & Friendly Display

Ty-Code normalizes reset values into epoch timestamps and calculates human-readable countdowns:
- **Epoch ms**: `1729112400000` -> `resets in 2h 15m`
- **Relative seconds**: `60` -> `resets in 60s`
- **ISO 8601 strings**: `2026-10-16T18:00:00Z` -> `resets in 45m`
- **Active state**: When no cooldown or rate-limit is detected -> `active`

---

## 3. Secure Per-User Credential Storage Architecture

### 3.1 Encryption via `Electron safeStorage`

Ty-Code never writes plaintext API keys to disk. Credentials are hardware-encrypted using:
- **Windows**: Data Protection API (DPAPI) via `CryptProtectData`
- **macOS**: Keychain Services hardware enclave
- **Linux**: Secret Service API / `libsecret` (GNOME Keyring / KWallet)

### 3.2 Storage Path & Structure

- **Storage Location**: `app.getPath('userData')/credentials.json`
- **File Permissions**: `0o600` (read/write only by the operating system user)
- **Format**:
```json
{
  "version": 1,
  "storageBackend": "windows_dpapi",
  "lastUpdated": 1729112400000,
  "credentials": {
    "openrouter": {
      "providerId": "openrouter",
      "encryptedKey": "safe_storage_v1:AQAAANCMnd8BFdERjHoAwE/Cl+sBAAAA...",
      "label": "OpenRouter Free Key",
      "createdAt": 1729110000000,
      "lastUsedAt": 1729112400000
    }
  }
}
```

### 3.3 Security Invariants

1. **Reveal Key**: Decrypted only temporarily into memory for the active UI session. It is never logged or written to disk in plaintext.
2. **Revocation**: Calling `credentials:delete` purges the encrypted key from `credentials.json` and disconnects rate-limit attribution.
3. **Encrypted Migration Bundle**: Cross-device export encrypts the bundle with AES-256-GCM and a PBKDF2-derived key (100,000 rounds of SHA-256), requiring an optional user passphrase.
4. **Pre-Save Connection Test**: Live 1-token verification pings the provider before any key is persisted. Invalid keys are rejected and never saved.

---

## 4. SQLite Usage Ledger Schema

Located at `app.getPath('userData')/usage-ledger.db`:

```sql
CREATE TABLE IF NOT EXISTS usage_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  provider_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  prompt_tokens INTEGER NOT NULL,
  completion_tokens INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  latency_ms INTEGER NOT NULL,
  error_count INTEGER NOT NULL,
  success_count INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_provider ON usage_ledger(provider_id);
CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_ledger(timestamp);
```

### 4.1 Token Counting Accuracy

1. **Provider-Reported Usage**: Extracted from stream SSE `usage` chunks (`prompt_tokens`, `completion_tokens`, `total_tokens`). Marked as `isExactUsage: true`.
2. **Estimation Fallback**: When provider headers omit token counts, accurate tokenizer approximation is computed (~3.8 characters per token for source code & English text).
3. **Ledger Aggregates**: Provides exact breakdowns of exact vs estimated tokens per model.
