# Ty-Code Troubleshooting & Diagnostic Guide

This guide covers common setup, network, and runtime issues in Ty-Code and how to resolve them quickly.

---

## 1. Rate Limits (HTTP 429) & Provider Cooldown

### Symptoms
- Yellow/amber indicator in the Status Bar.
- Routing decision log mentions "cooling_down" or "Rate limit detected".

### Resolution
1. **Automatic Failover**: Ty-Code automatically shifts requests to another free provider (e.g. OpenKilo or FCC) using exponential backoff cooldown.
2. **Enable Free Mode**: Go to **Settings > Smart Orchestration** and ensure **One-Click Free Mode** and **Automatic Provider Failover** are enabled.
3. **Check Quotas**: Open the **Usage Dashboard** to see which providers have available monthly headroom.

---

## 2. Local Free-Provider Proxy Issues

### Symptoms
- "FCC server process not running" or connection errors to `http://localhost:8082`.

### Resolution
1. **Restart FCC Process**: In **Settings > Free Models (FCC)**, click **Restart Server**.
2. **Port Conflict**: Check if another application is using port 8082:
   ```powershell
   Get-NetTCPConnection -LocalPort 8082
   ```
   If needed, update the FCC proxy URL in **Settings > Endpoints**.
3. **One-Click Auto Setup**: Run **Auto-Setup Providers** in the FCC settings tab to re-verify credentials.

---

## 3. Local Ollama Integration

### Symptoms
- "Connection failed: Unable to reach http://localhost:11434".

### Resolution
1. Ensure Ollama is running locally:
   ```bash
   ollama serve
   ```
2. Verify models are pulled locally:
   ```bash
   ollama pull deepseek-coder:6.7b
   ollama pull qwen2.5-coder:7b
   ```
3. Set `OLLAMA_ORIGINS="*"` environment variable if running behind strict local firewalls.

---

## 4. OpenKilo Gateway Access

### Symptoms
- "Unauthorized" or 401 response on OpenKilo models.

### Resolution
1. Open **Settings > OpenKilo (Free Backup)**.
2. Click **Enable Anonymous Access (1-Click)** to restore the zero-config gateway key.
3. If you have custom API keys or paid tiers, click **Connect Account via OAuth** to authorize 350+ additional models.

---

## 5. Language Server Protocol (LSP) Diagnostics & IntelliSense

### Symptoms
- Status bar displays "LSP Error" or no completions appear.

### Resolution
1. Check **Settings > Language Servers (LSP)** for your active language.
2. Ensure language CLI binaries (e.g., `typescript-language-server`, `pyright`, `rust-analyzer`) are installed on your system `PATH`.
3. If binaries are missing, Ty-Code automatically falls back to built-in Monaco Editor syntax checking.

---

## 6. Clearing Cache & Re-running Setup

### Re-running Onboarding Wizard
To reset your first-launch state and re-run the wizard:
1. Open the Developer Tools (`Ctrl+Shift+I`) and run:
   ```javascript
   localStorage.removeItem('ty_code_onboarding_completed');
   ```
2. Reload the window (`Ctrl+R`).

### Clearing Request Cache
1. Open **Settings > Smart Orchestration > Quota Dashboard**.
2. Click **Refresh** to purge stale responses and sync real-time usage stats.
