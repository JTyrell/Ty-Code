# Connecting JetBrains IDEs to Ty-Code Managed Free Fleet

Ty-Code enables developers working in JetBrains IDEs (IntelliJ IDEA, WebStorm, PyCharm, GoLand, Rider, PhpStorm, CLion) to leverage Ty-Code's local OpenAI-compatible endpoint (`http://127.0.0.1:52140/v1`).

Enjoy zero-cost LLM intelligence, multi-provider failover, and RTK/Headroom token savings directly within your favorite JetBrains workspace.

---

## 1. Quick Setup: Continue Plugin for JetBrains

The [Continue Plugin](https://plugins.jetbrains.com/plugin/22796-continue) brings full AI chat and tab-completion to JetBrains IDEs.

### Step 1: Install Continue Plugin
1. Open your JetBrains IDE (e.g. IntelliJ IDEA, WebStorm, PyCharm).
2. Go to **Settings / Preferences (`Ctrl+Alt+S` or `Cmd+,`) > Plugins**.
3. In the **Marketplace** tab, search for **Continue**.
4. Click **Install** and restart the IDE if prompted.

### Step 2: Configure Continue
Open `~/.continue/config.json`:
- Windows: `%USERPROFILE%\.continue\config.json`
- macOS / Linux: `~/.continue/config.json`

Add the Ty-Code model configuration:

```json
{
  "models": [
    {
      "title": "Ty-Code Managed Free Fleet",
      "provider": "openai",
      "model": "auto",
      "apiBase": "http://127.0.0.1:52140/v1",
      "apiKey": "<YOUR_TYCODE_BEARER_TOKEN>"
    }
  ],
  "tabAutocompleteModel": {
    "title": "Ty-Code Autocomplete",
    "provider": "openai",
    "model": "qwen2.5-coder:latest",
    "apiBase": "http://127.0.0.1:52140/v1",
    "apiKey": "<YOUR_TYCODE_BEARER_TOKEN>"
  }
}
```

Once saved, the Continue sidebar in your JetBrains IDE will immediately connect to Ty-Code and display available models.

---

## 2. Setup: JetBrains AI Assistant / Custom OpenAI LLM

If your JetBrains IDE supports custom OpenAI endpoints in the AI Assistant or third-party LLM plugins:
1. Open **Settings > Tools > AI Assistant** (or **LLM Providers**).
2. Add a new **OpenAI** provider:
   - **Server / Base URL**: `http://127.0.0.1:52140/v1`
   - **API Key**: `<YOUR_TYCODE_BEARER_TOKEN>`
   - **Model**: `auto` or select from the fleet catalog (e.g. `gemini-2.5-flash`, `llama-3.3-70b-versatile`).

---

## 3. Benefits of Using Ty-Code with JetBrains

- **Zero API Ingestion Costs**: Route heavy code queries through Ty-Code's free fleet.
- **Failover Protection**: If one upstream provider is throttled or down, Ty-Code automatically fails over to the next healthy candidate without breaking your editor session.
- **Privacy & Security**: All traffic remains local on `127.0.0.1` by default; credentials are never transmitted unencrypted.
