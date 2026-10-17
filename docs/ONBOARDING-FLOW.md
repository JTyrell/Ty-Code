# Onboarding Flow & User Journey Architecture

> **Phase**: UnifiedProvisioning  
> **Brand**: Ty-Code  
> **Version**: 1.0.0  
> **Target**: User Onboarding, Provider Access Tiers, and Upgrade Guidance  
> **Evidence Artifact**: docs/traces/onboarding-provisioning.json

---

## 1. Overview & Core Philosophy

The Ty-Code Onboarding system balances immediate gratification with long-term developer empowerment:
1. **Zero-Trap Architecture**:
   - The user is never blocked or held hostage by an onboarding modal.
   - "Skip (Use Anonymous)" and close buttons are visible and active on every screen.
   - If an onboarding session is closed or interrupted, the app defaults to Tier 0 Anonymous Access so the user can immediately use the editor.
2. **Partial Completion is Valid**:
   - Every provider connected during the wizard is tested live with a 1-token query and saved to OS `safeStorage` immediately.
   - If a user connects OpenRouter and skips Groq, OpenRouter remains saved and active.
3. **Resumable State**:
   - Wizard step and path choices are persisted to local storage and disk (`ty-code-onboarding.json`), allowing interrupted flows to resume seamlessly.
4. **Re-runnable from Multiple Entry Points**:
   - Existing users can re-run the wizard at any time from **Settings > Providers**, **Settings > BYOK & Keys**, or by clicking the **Status Bar provider chip**.

---

## 2. Complete User Journeys

### Journey 1: Full Connect Path (Recommended, ~2-3 Minutes)
```
[App Launch] 
   └── Welcome Screen
          └── Click "Let's Go"
                 └── Choose Setup Path
                        └── Select "Connect Free Accounts"
                               └── Step 1: OpenRouter (One-click PKCE OAuth or Guided Key)
                                      └── Step 2: Groq (Console link + Paste Key + Live Test)
                                             └── Step 3: Google AI Studio (Console link + Paste Key + Live Test)
                                                    └── Summary: 15+ Free Models Active
                                                           └── Click "Start Coding"
```
- **Outcome**: 3 providers connected, 15+ models active, maximum rate limits, credentials saved in OS `safeStorage`.

---

### Journey 2: Instant Skip to Anonymous Tier (< 5 Seconds)
```
[App Launch] 
   └── Welcome Screen
          └── Click "Skip (Use Anonymous)"
                 └── Anonymous Access Activated Screen
                        ├── Clear explanation of ~50 req/hr limit & models
                        └── Click "Start Coding"
                               └── Workbench Active (Tier 0 Gateway Enabled)
                                      └── Status Bar: "Anonymous (Connect for more)"
```
- **Outcome**: Immediate coding capability, zero account creation, zero telemetry, local ledger attribution.

---

### Journey 3: Partial Connect & Later Resume
```
[App Launch] 
   └── Welcome Screen -> Choose Path -> OpenRouter Connected (Tested & Saved)
          └── User clicks "Skip this provider" on Groq
                 └── User closes the modal or navigates away
                        └── Ty-Code saves OpenRouter as active provider
                               └── Next day: User clicks Status Bar chip ("1 provider • 10 models")
                                      └── Settings > "Re-run Setup Wizard"
                                             └── Resumes or offers remaining providers
```
- **Outcome**: No duplicate keys, no credential loss, flexible progression.

---

### Journey 4: Local & Private (Air-gapped)
```
[App Launch] 
   └── Welcome Screen -> Choose Path
          └── Select "Local & Private"
                 └── Auto-detects http://localhost:11434
                        └── Lists locally installed models (e.g. qwen2.5-coder)
                               └── Summary: 100% Offline Active
```
- **Outcome**: Zero external network calls, zero telemetry, full offline operation.

---

## 3. Comprehensive Copy Deck

### Screen 1: Welcome (`welcome`)
- **Header**: `Welcome to Ty-Code`
- **Subheader**: `Free AI models for coding, out of the box. Connect your own free accounts for the best limits, or start instantly with anonymous access.`
- **Pillar 1**: `15+ Free Models` — `DeepSeek R1, Qwen 2.5 Coder, Llama 3.3, and Gemini 2.0 Flash at zero cost.`
- **Pillar 2**: `Local safeStorage` — `Zero server storage. Credentials land strictly in your OS encrypted credential vault.`
- **Pillar 3**: `Instant Fallback` — `Zero-config anonymous tier keeps you coding even if you have no keys.`
- **Primary CTA**: `Let's Go`
- **Secondary CTA**: `Skip (Use Anonymous)`

### Screen 2: Choose Path (`path_choice`)
- **Header**: `Choose Your Setup Path`
- **Subheader**: `Select how you want to power Ty-Code. You can switch or connect additional providers anytime in Settings.`
- **Card A (Recommended)**:
  - Title: `Connect Free Accounts`
  - Badge: `Recommended (~2-3 min)`
  - Description: `Connect OpenRouter, Groq, and Google AI Studio for 15+ models, 10x higher rate limits, and full ownership under your own free developer quota.`
- **Card B**:
  - Title: `Local & Private`
  - Badge: `100% Offline`
  - Description: `Use Ollama on this machine. Zero telemetry, zero external network calls. Perfect for sensitive enterprise codebases.`
- **Card C**:
  - Title: `Anonymous (Instant Skip)`
  - Badge: `No Accounts Required`
  - Description: `Start coding immediately with 3 free models via OpenKilo gateway (~50 req/hour). No signups or credit cards needed.`

### Screen 3: Connect OpenRouter (`openrouter`)
- **Title**: `Connect OpenRouter — Most Popular • 10+ free models`
- **Tagline**: `Access 15+ top free models including DeepSeek R1 and Qwen 2.5 Coder`
- **Instructions**:
  1. `Sign up at OpenRouter with Google or GitHub (takes ~30 seconds)`
  2. `Open the "Keys" section in the dashboard`
  3. `Click "Create Key" and give it a name (e.g. Ty-Code)`
  4. `Copy the generated key (starts with sk-or-v1-)`
- **Buttons**:
  - `Open OpenRouter →` (opens system browser)
  - `One-Click Connect (OAuth PKCE)` (triggers PKCE flow)
  - `I already have a key` (reveals KeyInputField)
  - `Skip this provider`
- **Input Placeholder**: `sk-or-v1-... (50+ characters)`

### Screen 4: Connect Groq (`groq`)
- **Title**: `Connect Groq — Ultra-Fast • 300+ tok/s`
- **Tagline**: `Ultra-fast LPU inference (300+ tok/s) with generous daily free quota`
- **Instructions**:
  1. `Sign up at Groq Console with email or Google`
  2. `Navigate to "API Keys" in the left sidebar`
  3. `Click "Create API Key" and enter a name`
  4. `Copy your new key (starts with gsk_)`
- **Input Placeholder**: `gsk_... (40+ characters)`

### Screen 5: Connect Google AI Studio (`google-gemini`)
- **Title**: `Connect Google AI Studio — Multimodal • Large Context`
- **Tagline**: `Gemini 2.0 Flash with multimodal reasoning and large free tiers`
- **Instructions**:
  1. `Sign in with your Google account at Google AI Studio`
  2. `Click "Get API Key" or "Create API Key"`
  3. `Choose or create a Google Cloud project`
  4. `Copy your generated key (starts with AIza, exactly 39 characters)`
- **Input Placeholder**: `AIza... (exact 39 characters)`

### Screen 6: Anonymous Access Activated (`skip_anonymous`)
- **Title**: `Anonymous Access Activated`
- **Body**: `You are ready to code immediately! We have enabled the Tier 0 anonymous gateway so you can ask coding questions and edit code without registering anywhere.`
- **Details**:
  - `3 free models: DeepSeek R1, Qwen3 Coder, and Llama 3.3 70B via OpenKilo gateway.`
  - `Shared rate limits: ~50 requests per hour per instance.`
  - `Zero tracking: No account, no login, zero personally identifying info transmitted.`
  - `Upgrade anytime: Connect your own free accounts from the status bar or Settings for 10x higher quota.`
- **Actions**: `Actually, Let Me Connect Accounts` | `Start Coding`

### Screen 7: Summary (`summary`)
- **Title**: `You're All Set!`
- **Body**: `Your provider configuration is active. Credentials are encrypted in your OS safeStorage, and anonymous fallback is ready if any provider runs out of quota.`
- **Actions**: `Start Coding`

---

## 4. Rate-Limit Upsell & Reminder Cadence

### Rate-Limit Upsell (HTTP 429)
When a user on Tier 0 Anonymous Access encounters rate limiting:
- **Card Title**: `[RATE_LIMITED] Quota Exhausted / Rate Limited`
- **Banner**: `Anonymous tier limit reached — connect your free OpenRouter account for 10x more requests`
- **Action**: One-click button `Connect Free Accounts Now →` opens the wizard directly at Step 3 (`openrouter`).

### Gentle Reminder Cadence for Skippers
For users who skipped onboarding and have zero connected provider keys:
- **Day 3 Trigger**: First gentle reminder appears at least 72 hours after initial launch.
- **Cadence**: Never shown more frequently than once every 7 calendar days.
- **Dismissible Forever**: User can dismiss the reminder with a single click ("Don't remind again"), which permanently disables future reminder toasts.
