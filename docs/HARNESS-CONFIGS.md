# Ty-Code Local Supply Endpoint: Harness Configuration Guide

Ty-Code exposes a local OpenAI-compatible and FCC-compatible supply layer running on `http://127.0.0.1:52140/v1` (default port). Any external coding agent CLI or editor extension can point to this endpoint to access Ty-Code's full 61-provider free model fleet and connected pro subscriptions (GitHub Copilot, ChatGPT) at zero cost.

Authentication is handled via an auto-generated local token (`tycode_sk_...`) generated on application boot and retrievable via Settings > Integrations or Status Bar.

---

## 1. Claude Code CLI (`claude`)

Point Anthropic Claude Code CLI to Ty-Code's local endpoint using standard environment variables:

```bash
# In your terminal or ~/.bashrc / ~/.zshrc / PowerShell profile:
export ANTHROPIC_BASE_URL="http://127.0.0.1:52140/v1"
export ANTHROPIC_API_KEY="tycode_sk_YOUR_LOCAL_TOKEN"

# Launch session with Claude 3.5 Sonnet:
claude --model claude-3-5-sonnet
```

Or configure via `~/.claude/settings.json`:
```json
{
  "apiBaseUrl": "http://127.0.0.1:52140/v1",
  "apiKey": "tycode_sk_YOUR_LOCAL_TOKEN",
  "model": "claude-3-5-sonnet"
}
```

---

## 2. OpenAI Codex CLI (`codex`)

Point OpenAI Codex CLI to Ty-Code's endpoint:

```bash
export OPENAI_API_BASE="http://127.0.0.1:52140/v1"
export OPENAI_API_KEY="tycode_sk_YOUR_LOCAL_TOKEN"

# Launch codex session:
codex --model gpt-4o
```

Or in `~/.codex/config.json`:
```json
{
  "api_base": "http://127.0.0.1:52140/v1",
  "api_key": "tycode_sk_YOUR_LOCAL_TOKEN",
  "model": "gpt-4o"
}
```

---

## 3. OpenCode (`opencode`)

Configure `~/.config/opencode/opencode.json`:

```json
{
  "active_provider": "tycode-local",
  "providers": {
    "tycode-local": {
      "endpoint": "http://127.0.0.1:52140/v1",
      "api_key": "tycode_sk_YOUR_LOCAL_TOKEN",
      "default_model": "deepseek/deepseek-r1"
    }
  }
}
```

---

## 4. Pi Agent (`pi`)

Pass the local endpoint directly or configure via CLI options:

```bash
pi-cli --endpoint http://127.0.0.1:52140/v1 \
       --api-key tycode_sk_YOUR_LOCAL_TOKEN \
       --model meta-llama/llama-3.3-70b-instruct
```

---

## 5. Cline (VS Code Extension)

In VS Code `settings.json` or Cline extension UI:

```json
{
  "cline.apiProvider": "openai-compatible",
  "cline.openAiBaseUrl": "http://127.0.0.1:52140/v1",
  "cline.openAiApiKey": "tycode_sk_YOUR_LOCAL_TOKEN",
  "cline.openAiModelId": "qwen/qwen-2.5-coder-32b-instruct"
}
```

---

## 6. Aider (`aider`)

Launch Aider pair-programming with git repo integration pointing to Ty-Code:

```bash
aider --openai-api-base http://127.0.0.1:52140/v1 \
      --openai-api-key tycode_sk_YOUR_LOCAL_TOKEN \
      --model openai/claude-3-5-sonnet
```

Or persist in your project `.aider.conf.yml`:
```yaml
openai-api-base: http://127.0.0.1:52140/v1
openai-api-key: tycode_sk_YOUR_LOCAL_TOKEN
model: openai/claude-3-5-sonnet
edit-format: diff
```

---

## 7. Hermes Agent (`hermes`)

Configure Hermes multi-step reasoning agent:

```bash
export HERMES_ENDPOINT="http://127.0.0.1:52140/v1"
export HERMES_API_KEY="tycode_sk_YOUR_LOCAL_TOKEN"
export HERMES_MODEL="deepseek/deepseek-r1"

hermes-agent --reasoning-effort high
```

---

## 8. DeepSeek Native CLI (`deepseek`)

Point DeepSeek's native agent harness to Ty-Code's local loopback:

```bash
export DEEPSEEK_API_BASE="http://127.0.0.1:52140/v1"
export DEEPSEEK_API_KEY="tycode_sk_YOUR_LOCAL_TOKEN"

deepseek-cli --model deepseek-reasoner
```

---

## 9. Grok Build (`grok`)

Point xAI Grok build and bootstrapping harness:

```bash
export GROK_API_BASE="http://127.0.0.1:52140/v1"
export GROK_API_KEY="tycode_sk_YOUR_LOCAL_TOKEN"

grok-build --model grok-2
```

---

## 10. Muse Code (`muse`)

Point Muse frontend & creative coding harness:

```bash
export MUSE_API_ENDPOINT="http://127.0.0.1:52140/v1"
export MUSE_API_KEY="tycode_sk_YOUR_LOCAL_TOKEN"

muse-code --model gpt-4o
```

---

## 11. VS Code Chat (`vscode-chat`)

For VS Code Language Model API redirects, configure in VS Code settings:

```json
{
  "github.copilot.advanced": {
    "debug.overrideEngine": "custom",
    "debug.overrideCapiEngineUrl": "http://127.0.0.1:52140/v1",
    "debug.overrideBearerToken": "tycode_sk_YOUR_LOCAL_TOKEN"
  }
}
```

---

## Security & LAN Exposure

- **Default Binding**: `127.0.0.1` (localhost only). Non-loopback requests are rejected with `403 Forbidden`.
- **LAN Exposure (`0.0.0.0`)**: If you wish to serve mobile devices or LAN build machines, enable the LAN toggle in **Settings > Integrations**. You must explicitly accept the security warning acknowledgement.
- **Attribution**: Free-model supply layer powered by free-claude-code (FCC), AGPL-3.0 / MIT, https://github.com/Alishahryar1/free-claude-code
