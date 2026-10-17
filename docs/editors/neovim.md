# Connecting Neovim to Ty-Code Managed Free Fleet

Ty-Code integrates with modern Neovim AI plugins via its local OpenAI-compatible endpoint at `http://127.0.0.1:52140/v1`.

Whether you use **avante.nvim** (Cursor-style AI inside Neovim) or **codecompanion.nvim**, you can route all completion, inline editing, and sidebar chat through Ty-Code's free fleet.

---

## 1. Setup with avante.nvim

[avante.nvim](https://github.com/yetone/avante.nvim) is an AI-powered coding companion that emulates Cursor's AI experience in Neovim.

### Configuration (`~/.config/nvim/lua/plugins/avante.lua`)

Add the following plugin specification:

```lua
return {
  "yetone/avante.nvim",
  event = "VeryLazy",
  lazy = false,
  version = false, -- Set this to "*" to always pull the latest release
  opts = {
    provider = "openai",
    openai = {
      endpoint = "http://127.0.0.1:52140/v1",
      model = "auto",
      api_key_name = "TYCODE_API_KEY",
      timeout = 30000,
      temperature = 0,
      max_tokens = 8192,
    },
  },
  init = function()
    -- Set the Bearer token for Ty-Code local endpoint
    vim.env.TYCODE_API_KEY = "<YOUR_TYCODE_BEARER_TOKEN>"
  end,
  build = "make", -- or "powershell -ExecutionPolicy Bypass -File Build.ps1 -BuildFromSource false" on Windows
  dependencies = {
    "stevearc/dressing.nvim",
    "nvim-lua/plenary.nvim",
    "MunifTanjim/nui.nvim",
    "nvim-tree/nvim-web-devicons",
  },
}
```

---

## 2. Setup with codecompanion.nvim

[codecompanion.nvim](https://github.com/olimorris/codecompanion.nvim) provides chat, inline suggestions, and custom AI workflows in Neovim.

### Configuration (`~/.config/nvim/lua/plugins/codecompanion.lua`)

```lua
return {
  "olimorris/codecompanion.nvim",
  dependencies = {
    "nvim-lua/plenary.nvim",
    "nvim-treesitter/nvim-treesitter",
  },
  opts = {
    adapters = {
      tycode = function()
        return require("codecompanion.adapters").extend("openai", {
          env = {
            url = "http://127.0.0.1:52140",
            api_key = "<YOUR_TYCODE_BEARER_TOKEN>",
          },
          schema = {
            model = {
              default = "auto",
            },
          },
        })
      end,
    },
    strategies = {
      chat = { adapter = "tycode" },
      inline = { adapter = "tycode" },
      agent = { adapter = "tycode" },
    },
  },
}
```

---

## 3. One-Click Exporter in Ty-Code

Rather than manually creating configuration files, you can use Ty-Code's built-in exporter:
1. Open Ty-Code.
2. Navigate to **Settings > Integrations > External Editors**.
3. Click **Export to Neovim (avante)** or **Export to Neovim (codecompanion)**.
4. Ty-Code will auto-populate the active port and token and write the Lua configuration file to your Neovim plugin directory (`~/.config/nvim/lua/plugins/`).
