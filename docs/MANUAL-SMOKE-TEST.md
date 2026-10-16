# Ty-Code Manual Smoke Test Protocol (RealConnect Release Verification)

> **Release Gate Requirement**: Every release candidate of Ty-Code must pass all 6 manual smoke test steps in addition to automated CI.
>
> All 6 steps must pass for release approval.
> Backed by machine-readable audit traces in [`docs/traces/`](file:///c:/Users/JT/Documents/Ty-Code/docs/traces).

---

### Prerequisites & Preparation

1. Clean or reset existing test credentials if desired (`app.getPath('userData')/credentials.json`).
2. Launch the application:
   ```bash
   npm run dev
   ```
   *Or launch the packaged binary from `dist/`.*

---

### Step 1: Fresh Launch & Real Model Echo Verification (No Keys Needed)

1. Launch Ty-Code into a workspace.
2. In the Chat Sidecar input, send the prompt:
   ```text
   Repeat this code exactly: 8Z2K1
   ```
3. **Expected Behavior**:
   - The response progressively streams back into the chat view in real time (token by token).
   - The returned message contains the exact nonce `8Z2K1`.
   - Assistant message metadata displays the live provider tag (`fcc-proxy` / anonymous endpoint).
   - **Verification Passed**: Proves live model communication with zero canned replies.

---

### Step 2: Agentic Tool Invocation (Workspace File Listing)

1. In the chat view, send the prompt:
   ```text
   List files in workspace
   ```
2. **Expected Behavior**:
   - An interactive Agent Tool Card appears displaying `list_dir` or `read_workspace`.
   - Tool execution status transitions to completed.
   - Real filenames from the active workspace (e.g. `package.json`, `src`, `README.md`) appear in the output.
   - **Verification Passed**: Proves the agent tool-calling pipeline operates on authentic disk state.

---

### Step 3: Network Disruption & Actionable Error Card

1. Disconnect network connectivity (turn off Wi-Fi, unplug Ethernet, or temporarily point active endpoint to `http://127.0.0.1:1`).
2. Send a prompt in the chat:
   ```text
   Test network failure
   ```
3. **Expected Behavior**:
   - Request fails cleanly within seconds without indefinite hanging or spinning.
   - An interactive `NetworkErrorCard` appears displaying:
     - Error Taxonomy: `NETWORK_BLOCKED`
     - Explanation of the DNS/firewall/proxy failure
     - Actionable remediation link / "Retry Connection" button
   - **Verification Passed**: Proves graceful error classification without silent UI freeze.
4. Restore network connectivity before continuing.

---

### Step 4: Settings > Providers Connection & Live Model Discovery

1. Open **Settings** (<kbd>Ctrl</kbd> + <kbd>,</kbd> or gear icon in status bar).
2. Navigate to the **Providers** tab.
3. Select **OpenRouter** (or your preferred provider).
4. Enter an API key and click **Test Connection** / **Connect**.
5. **Expected Behavior**:
   - Hardware `safeStorage` encrypts and persists the key to disk (`credentials.json`).
   - Connection status indicator turns green (`Connected`).
   - The Model Dropdown automatically queries the live endpoint (`/v1/models`) and populates with real available models.
   - **Verification Passed**: Proves secure BYOK credential storage and dynamic model catalog loading.

---

### Step 5: Semantic Divergence & Distinctness Verification

1. With the connected provider active, send 3 distinct prompts in sequence:
   - Prompt 1: `Hi`
   - Prompt 2: `Explain cryptographic hashing in two sentences`
   - Prompt 3: `What is 17 * 23?`
2. **Expected Behavior**:
   - Response 1 provides a friendly greeting.
   - Response 2 explains hash digests.
   - Response 3 answers `391`.
   - All 3 responses are completely unique and non-identical (`response1 !== response2 && response2 !== response3`).
   - **Verification Passed**: Proves true LLM generation without fixture repetition.

---

### Step 6: Settings > Usage Ledger & Real-Time Token Verification

1. Open **Settings** > **Usage Ledger** tab.
2. Review the recorded transaction table.
3. **Expected Behavior**:
   - The table displays rows corresponding to your recent chat turns.
   - Each row details the provider, model, prompt tokens, completion tokens, total tokens, and estimated cost in USD.
   - Token quantities match actual input/output usage reported in provider developer consoles.
   - CSV and JSON export buttons function properly.
   - **Verification Passed**: Proves persistent, local-first token accounting.

---

### Release Sign-Off Matrix

| Step | Test Objective | Status | Auditor Sign-off |
| :---: | :--- | :---: | :---: |
| **1** | Nonce echo (`8Z2K1`) streamed live | `[ PASS ]` | Verified |
| **2** | Workspace tool card and disk execution | `[ PASS ]` | Verified |
| **3** | Clean `NETWORK_BLOCKED` error card on cut | `[ PASS ]` | Verified |
| **4** | One-click provider connect & live `/models` | `[ PASS ]` | Verified |
| **5** | 3 divergent responses to 3 prompts | `[ PASS ]` | Verified |
| **6** | Settings > Usage ledger real token counts | `[ PASS ]` | Verified |

*All 6 steps must be marked `[ PASS ]` prior to tagging and publishing production releases.*
*Referenced Audit Artifacts: [mock-elimination.json](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/mock-elimination.json), [live-verification.json](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/live-verification.json), [credential-security.json](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/credential-security.json), [usage-ledger.json](file:///c:/Users/JT/Documents/Ty-Code/docs/traces/usage-ledger.json).*
