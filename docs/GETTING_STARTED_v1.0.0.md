# Ty-Code v1.0.0 Quickstart Guide (< 3 Minutes)

Welcome to **Ty-Code**! Get up and running in under three minutes with this simple step-by-step walkthrough.

---

## 1. Download & Install

Select the installer for your operating system:

- **Windows:** Download [`Ty-Code-Setup-1.0.0.exe`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-Setup-1.0.0.exe) and run the installer (or extract [`Ty-Code-1.0.0-win.zip`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0-win.zip) for portable mode).
- **macOS:** Download [`Ty-Code-1.0.0.dmg`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.dmg), open the disk image, and drag `Ty-Code.app` into your Applications folder.
- **Linux:** Download [`Ty-Code-1.0.0.AppImage`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.AppImage), mark it executable (`chmod +x Ty-Code-1.0.0.AppImage`), and run it. Debian/Ubuntu users can install [`ty-code_1.0.0_amd64.deb`](https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/ty-code_1.0.0_amd64.deb) via `sudo dpkg -i`.

---

## 2. Connect Your AI Provider (Pick One)

Open **Ty-Code** and click the **Settings (⚙️)** icon in the sidebar:

### Option A: 100% Free Cloud LLM (OpenRouter Free Tier)
1. Get a free API key at [OpenRouter](https://openrouter.ai).
2. In Ty-Code Settings → **Providers** → Select **OpenRouter**.
3. Paste your API key. (Keys are encrypted in your operating system's secure vault).
4. Select `deepseek/deepseek-chat` or `qwen/qwen-2.5-coder-32b-instruct:free`.

### Option B: 100% Local & Private (Ollama)
1. Install [Ollama](https://ollama.ai) and pull a model:
   ```bash
   ollama run qwen2.5-coder:7b
   ```
2. In Ty-Code Settings → **Providers** → Select **Ollama**.
3. Ty-Code auto-detects `http://localhost:11434` and loads your local models.

---

## 3. Open a Workspace & Code with AI

1. Click **File → Open Folder** or press `Ctrl+O` (`Cmd+O` on macOS) to select any project directory.
2. In the AI Chat sidecar on the right, type what you want the assistant to build:
   > *"Add a responsive navigation bar with dark mode toggle and unit tests"*
3. Watch Ty-Code's agent autonomously inspect files, write surgical edits, review diffs, and run commands.
4. Open the integrated terminal drawer with ``Ctrl+` `` whenever you want direct shell access.

Enjoy building with Ty-Code! 🚀
