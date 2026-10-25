# Connecting VS Code to Ty-Code Managed Free Fleet

Ty-Code exposes a local, high-speed OpenAI-compatible HTTP endpoint (`http://127.0.0.1:52140/v1`) that shares its managed fleet of free models (OpenRouter, Google AI Studio, Groq, HuggingChat, OpenKilo, GitHub Copilot, and Ollama) with external editors.

By connecting VS Code extensions to Ty-Code, you get unlimited access to Ty-Code's automated multi-provider failover, smart token optimization (RTK & Headroom), and quota tracking directly inside VS Code.

---

## 1. Quick Setup: Continue Extension (Recommended)

[Continue](https://continue.dev/) is an open-source AI code assistant for VS Code that natively connects to OpenAI-compatible endpoints.

### Step 1: Install Continue
1. Open VS Code.
2. Go to the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3. Search for **Continue** and click **Install**.

### Step 2: Configure Continue
Open your Continue configuration file:
- Windows: `%USERPROFILE%\.continue\config.json`
- macOS / Linux: `~/.continue/config.json`

Add Ty-Code's local endpoint to your `models` list:

```json
{
  "models": [
    {
      "title": "Ty-Code Managed Free Fleet",
      "provider": "openai",
      "model": "auto",
      "apiBase": "http://127.0.0.1:52140/v1",
      "apiKey": "<YOUR_TYCODE_BEARER_TOKEN>"
    },
    {
      "title": "Ty-Code Gemini 2.5 Flash",
      "provider": "openai",
      "model": "gemini-2.5-flash",
      "apiBase": "http://127.0.0.1:52140/v1",
      "apiKey": "<YOUR_TYCODE_BEARER_TOKEN>"
    },
    {
      "title": "Ty-Code GPT OSS 120B",
      "provider": "openai",
      "model": "openai/gpt-oss-120b",
      "apiBase": "http://127.0.0.1:52140/v1",
      "apiKey": "<YOUR_TYCODE_BEARER_TOKEN>"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Ty-Code Tab Completion",
    "provider": "openai",
    "model": "qwen2.5-coder:latest",
    "apiBase": "http://127.0.0.1:52140/v1",
    "apiKey": "<YOUR_TYCODE_BEARER_TOKEN>"
  }
}
```

> **Tip**: You can generate and write this file in one click from Ty-Code's **Settings > Integrations > External Editors** or using the IPC exporter.

---

## 2. Setup: Cline / Roo Code

[Cline](https://github.com/cline/cline) (formerly Claude Dev) supports OpenAI-compatible providers.

In your project's `.vscode/settings.json` (or User Settings):

```json
{
  "cline.apiProvider": "openai",
  "cline.openAiBaseUrl": "http://127.0.0.1:52140/v1",
  "cline.openAiApiKey": "<YOUR_TYCODE_BEARER_TOKEN>",
  "cline.openAiModelId": "auto",
  "cline.openAiCustomModelInfo": {
    "maxTokens": 8192,
    "contextWindow": 128000,
    "supportsImages": true,
    "supportsPromptCache": true
  }
}
```

---

## 3. Retrieving Your Local Auth Token

Ty-Code protects the local supply endpoint with an auto-generated Bearer token (`tycode_sk_...`) stored locally in operating-system secure storage.

To retrieve or copy your token:
1. In Ty-Code, open **Settings (`Ctrl+,`) > Integrations**.
2. Under **Local Model Supply Endpoint**, click **Copy Token**.
3. Alternatively, check the `tycode-settings.json` file in your user data directory.

---

## 4. Troubleshooting

- **Connection Refused**: Verify Ty-Code is running and the Local Supply Endpoint is active (green indicator in Ty-Code Settings).
- **Port Conflict**: If port `52140` is in use, Ty-Code automatically allocates the next available port. Check the current port in Settings.
- **LAN Access**: By default, Ty-Code listens strictly on `127.0.0.1`. If running VS Code inside WSL or another machine on the LAN, enable **LAN Exposure (0.0.0.0)** in Ty-Code Settings.
