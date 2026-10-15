# Ty-Code Manual Smoke-Test Script (Under 3 Minutes)

This script provides a sequence of 6 copy-paste chat messages with expected outcomes so you can verify the end-to-end Ty-Code experience by hand in under 3 minutes.

---

## ⏱️ Pre-Flight Check (10 seconds)
Before running the smoke tests, ensure:
1. Ty-Code is open with a workspace folder open.
2. The bottom **Status Bar** shows an active provider (e.g. `OpenKilo`, `OpenRouter Free`, `Groq Free`, or local `Ollama`).
   * *If no provider is active, open **Settings > Diagnostics** and click **Run All Tests** to auto-select an operational zero-key tier.*

---

## 📋 6-Step Smoke Test Sequence

### Step 1: Reachability & Streaming Verification
**Message to Send:**
```text
Reply with exactly: TY-CODE ONLINE
```
- **Expected Outcome:**
  - The exact phrase `TY-CODE ONLINE` streams back into the chat window in real time without preamble or extra tokens.
  - The bottom status bar confirms the active provider and model name.
  - Response time is fast (< 2 seconds with cloud free providers; instant with local models).

---

### Step 2: Workspace File Creation (Diff Preview & Tool Call)
**Message to Send:**
```text
Create a file named smoke.md containing the line: hello from free AI
```
- **Expected Outcome:**
  - The AI invokes the `write_file` tool.
  - A green **Diff Preview Card** appears in chat showing `+ hello from free AI` for `smoke.md`.
  - When you click **Apply**, `smoke.md` appears in the File Explorer file tree with the exact content verified.

---

### Step 3: Surgical In-Place File Editing
**Message to Send:**
```text
In smoke.md replace 'free AI' with 'Ty-Code'
```
- **Expected Outcome:**
  - The AI invokes the `replace_file_content` tool (not a full file rewrite).
  - A surgical diff preview card appears before writing:
    - `- hello from free AI`
    - `+ hello from Ty-Code`
  - After clicking **Apply**, opening `smoke.md` shows the single line: `hello from Ty-Code`.

---

### Step 4: Workspace Tool Inspection
**Message to Send:**
```text
List the files in this workspace
```
- **Expected Outcome:**
  - A `list_dir` tool execution card appears in chat.
  - The AI inspects the current directory and names `smoke.md` along with any existing project files.
  - No errors or unauthorized directory traversal occur.

---

### Step 5: Terminal Execution & Security Policy
**Message to Send:**
```text
Run: echo smoke-test-ok
```
- **Expected Outcome:**
  - The AI invokes `run_command` with `echo smoke-test-ok`.
  - Behavior respects your configured **Terminal Security Policy** (**Settings > Security**):
    - **Ask** (Default): An approval confirmation card appears; once approved, command runs.
    - **Proceed**: Command executes automatically.
    - **Restricted**: Policy informs you if command execution requires explicit elevation.
  - The integrated bottom **Terminal Drawer** opens, displays the execution, and outputs `smoke-test-ok`.

---

### Step 6: Reasoning & Instruction Adherence
**Message to Send:**
```text
Explain in one sentence what a hash map is
```
- **Expected Outcome:**
  - A coherent, high-quality answer strictly constrained to **one single sentence** (e.g. *"A hash map is a data structure that stores key-value pairs and uses a hash function to compute an index for rapid retrieval."*).
  - If using a reasoning-enabled model (such as DeepSeek-R1 or OpenKilo Reasoning), a collapsible **Thinking / Reasoning** drawer is visible above the final sentence.

---

## 🧹 Post-Test Clean Up (Optional, 10 seconds)
You can delete the temporary verification file by sending:
```text
Delete smoke.md
```
Or delete it directly from the File Explorer.

---

## 🚨 Failure Protocol

If any step fails, hangs, or returns an error:
1. Open **Settings > Diagnostics** (`Ctrl+,` or `Cmd+,` $\rightarrow$ **Diagnostics** tab, or run `Ty-Code: Run Connection Diagnostics` from `Ctrl+P`).
2. Click **Run All Tests** to classify the failure into the fixed error taxonomy.
3. Switch to the **What's Needed Checklist (Remediation)** tab.
4. Click **Copy AI Coder Prompt**.
5. Paste the copied block into your AI coder chat verbatim:
   ```text
   Ty-Code diagnostics failed with: <CODE> at <step>. Evidence: <raw chunk>. Provider: <id>, model: <model>. Required fix category: <config|code|network|outage>. Propose the minimal fix, apply it if it is a code fix within src/, and re-run diagnostics to confirm PASS.
   ```
6. The building agent will automatically apply the minimal code fix in `src/` or provide the missing configuration link, then re-run diagnostics to confirm PASS.
