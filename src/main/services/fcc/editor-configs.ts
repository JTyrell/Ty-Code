/**
 * Editor Configuration Exporter (Phase FCC-5)
 *
 * One-click configuration exporter for external editors (VS Code, JetBrains, Neovim)
 * pointing to Ty-Code's local OpenAI-compatible supply endpoint (FCC-3).
 *
 * Supported editors:
 * 1. VS Code: Continue extension (~/.continue/config.json) & Cline/Roo Code (.vscode/settings.json)
 * 2. JetBrains: Continue plugin (~/.continue/config.json) & Custom OpenAI LLM setup
 * 3. Neovim: avante.nvim & codecompanion.nvim (Lua configuration)
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { localSupplyEndpoint } from './local-supply-endpoint';

export interface EditorConfigSnippet {
  editor: 'vscode' | 'jetbrains' | 'neovim';
  variant: string;
  filename: string;
  targetPath: string;
  content: string;
  instructions: string;
  fileType: 'json' | 'lua' | 'xml';
}

export class EditorConfigExporter {
  private static instance: EditorConfigExporter | null = null;

  public static getInstance(): EditorConfigExporter {
    if (!EditorConfigExporter.instance) {
      EditorConfigExporter.instance = new EditorConfigExporter();
    }
    return EditorConfigExporter.instance;
  }

  /**
   * Resolves the active endpoint URL and Bearer token
   */
  public getEndpointInfo(): { baseUrl: string; authToken: string; port: number; host: string } {
    const status = localSupplyEndpoint.getStatus();
    const port = status.port || 52140;
    const host = status.host === '0.0.0.0' ? '127.0.0.1' : (status.host || '127.0.0.1');
    const baseUrl = `http://${host}:${port}/v1`;
    const authToken = localSupplyEndpoint.getAuthToken();
    return { baseUrl, authToken, port, host };
  }

  /**
   * Generates VS Code configurations (Continue, Cline, settings.json)
   */
  public generateVsCodeConfig(variant: 'continue' | 'cline' | 'settings' = 'continue'): EditorConfigSnippet {
    const { baseUrl, authToken } = this.getEndpointInfo();
    const homeDir = os.homedir();

    if (variant === 'continue') {
      const targetPath = path.join(homeDir, '.continue', 'config.json');
      const config = {
        models: [
          {
            title: 'Ty-Code Managed Free Fleet',
            provider: 'openai',
            model: 'auto',
            apiBase: baseUrl,
            apiKey: authToken
          },
          {
            title: 'Ty-Code Gemini 2.5 Flash',
            provider: 'openai',
            model: 'gemini-2.5-flash',
            apiBase: baseUrl,
            apiKey: authToken
          },
          {
            title: 'Ty-Code GPT OSS 120B',
            provider: 'openai',
            model: 'openai/gpt-oss-120b',
            apiBase: baseUrl,
            apiKey: authToken
          }
        ],
        tabAutocompleteModel: {
          title: 'Ty-Code Code Completion',
          provider: 'openai',
          model: 'qwen2.5-coder:latest',
          apiBase: baseUrl,
          apiKey: authToken
        },
        customCommands: [
          {
            name: 'review',
            prompt: 'Review this code using Ty-Code fleet standards and propose improvements.',
            description: 'Review code with Ty-Code'
          }
        ],
        allowAnonymousTelemetry: false
      };

      return {
        editor: 'vscode',
        variant: 'continue',
        filename: 'config.json',
        targetPath,
        content: JSON.stringify(config, null, 2),
        fileType: 'json',
        instructions: `Place this configuration into your Continue config file (~/.continue/config.json). Ty-Code's local endpoint at ${baseUrl} will serve all models.`
      };
    }

    if (variant === 'cline') {
      const targetPath = path.join(process.cwd(), '.vscode', 'settings.json');
      const settings = {
        'cline.apiProvider': 'openai',
        'cline.openAiBaseUrl': baseUrl,
        'cline.openAiApiKey': authToken,
        'cline.openAiModelId': 'auto',
        'cline.openAiCustomModelInfo': {
          maxTokens: 8192,
          contextWindow: 128000,
          supportsImages: true,
          supportsPromptCache: true
        }
      };

      return {
        editor: 'vscode',
        variant: 'cline',
        filename: 'settings.json',
        targetPath,
        content: JSON.stringify(settings, null, 2),
        fileType: 'json',
        instructions: `Add these keys to your workspace or user .vscode/settings.json. Cline will route requests to Ty-Code.`
      };
    }

    // Default settings.json
    const targetPath = path.join(process.cwd(), '.vscode', 'settings.json');
    const genericSettings = {
      'tycode.localEndpoint': baseUrl,
      'tycode.apiKey': authToken,
      'github.copilot.advanced': {
        debug: {
          overrideProxyUrl: baseUrl
        }
      }
    };

    return {
      editor: 'vscode',
      variant: 'settings',
      filename: 'settings.json',
      targetPath,
      content: JSON.stringify(genericSettings, null, 2),
      fileType: 'json',
      instructions: `Save in .vscode/settings.json to point VS Code extensions to Ty-Code.`
    };
  }

  /**
   * Generates JetBrains configurations (IntelliJ, WebStorm, PyCharm, GoLand)
   */
  public generateJetBrainsConfig(variant: 'continue' | 'custom' = 'continue'): EditorConfigSnippet {
    const { baseUrl, authToken } = this.getEndpointInfo();
    const homeDir = os.homedir();

    if (variant === 'continue') {
      const targetPath = path.join(homeDir, '.continue', 'config.json');
      const config = {
        models: [
          {
            title: 'Ty-Code JetBrains Fleet',
            provider: 'openai',
            model: 'auto',
            apiBase: baseUrl,
            apiKey: authToken
          }
        ],
        tabAutocompleteModel: {
          title: 'Ty-Code JetBrains Autocomplete',
          provider: 'openai',
          model: 'qwen2.5-coder:latest',
          apiBase: baseUrl,
          apiKey: authToken
        }
      };

      return {
        editor: 'jetbrains',
        variant: 'continue',
        filename: 'config.json',
        targetPath,
        content: JSON.stringify(config, null, 2),
        fileType: 'json',
        instructions: `Configure Continue plugin in JetBrains (IntelliJ, PyCharm, WebStorm). Copy to ~/.continue/config.json.`
      };
    }

    // Custom OpenAI integration XML snippet for JetBrains options
    const targetPath = path.join(process.cwd(), '.idea', 'tycode-llm.xml');
    const xmlContent = `<?xml version="1.0" encoding="UTF-8"?>
<project version="4">
  <component name="TyCodeLlmConfiguration">
    <option name="provider" value="OpenAI" />
    <option name="apiBaseUrl" value="${baseUrl}" />
    <option name="apiKey" value="${authToken}" />
    <option name="defaultModel" value="auto" />
  </component>
</project>`;

    return {
      editor: 'jetbrains',
      variant: 'custom',
      filename: 'tycode-llm.xml',
      targetPath,
      content: xmlContent,
      fileType: 'xml',
      instructions: `Add to your JetBrains .idea folder or set OpenAI Custom Server in Tools > AI Assistant / LLM to ${baseUrl}.`
    };
  }

  /**
   * Generates Neovim configurations (avante.nvim, codecompanion.nvim)
   */
  public generateNeovimConfig(variant: 'avante' | 'codecompanion' = 'avante'): EditorConfigSnippet {
    const { baseUrl, authToken, port } = this.getEndpointInfo();
    const homeDir = os.homedir();

    if (variant === 'avante') {
      const targetPath = path.join(homeDir, '.config', 'nvim', 'lua', 'plugins', 'avante-tycode.lua');
      const luaContent = `-- Ty-Code Local Model Fleet Configuration for avante.nvim
-- Powered by Ty-Code (Phase FCC-5)
-- Endpoint: ${baseUrl}

return {
  "yetone/avante.nvim",
  event = "VeryLazy",
  lazy = false,
  opts = {
    provider = "openai",
    openai = {
      endpoint = "${baseUrl}",
      model = "auto",
      api_key_name = "TYCODE_API_KEY",
      timeout = 30000,
      temperature = 0,
      max_tokens = 8192,
    },
  },
  init = function()
    -- Set environment variable for avante openai adapter
    vim.env.TYCODE_API_KEY = "${authToken}"
  end,
}
`;

      return {
        editor: 'neovim',
        variant: 'avante',
        filename: 'avante-tycode.lua',
        targetPath,
        content: luaContent,
        fileType: 'lua',
        instructions: `Add this file to ~/.config/nvim/lua/plugins/avante-tycode.lua. Avante will seamlessly use Ty-Code's local free model fleet.`
      };
    }

    // codecompanion.nvim
    const targetPath = path.join(homeDir, '.config', 'nvim', 'lua', 'plugins', 'codecompanion-tycode.lua');
    const luaContent = `-- Ty-Code Local Model Fleet Configuration for codecompanion.nvim
-- Powered by Ty-Code (Phase FCC-5)
-- Endpoint: http://127.0.0.1:${port}

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
            url = "http://127.0.0.1:${port}",
            api_key = "${authToken}",
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
    },
  },
}
`;

    return {
      editor: 'neovim',
      variant: 'codecompanion',
      filename: 'codecompanion-tycode.lua',
      targetPath,
      content: luaContent,
      fileType: 'lua',
      instructions: `Add to ~/.config/nvim/lua/plugins/codecompanion-tycode.lua to connect CodeCompanion to Ty-Code.`
    };
  }

  /**
   * One-click export to target file
   */
  public async exportToFile(targetPath: string, content: string): Promise<{ success: boolean; path: string; error?: string }> {
    try {
      await fs.mkdir(path.dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, content, { encoding: 'utf8', mode: 0o600 });
      return { success: true, path: targetPath };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, path: targetPath, error: msg };
    }
  }

  /**
   * High-level export handler
   */
  public async exportConfig(
    editor: 'vscode' | 'jetbrains' | 'neovim',
    variant?: string,
    customPath?: string
  ): Promise<{ success: boolean; snippet: EditorConfigSnippet; savedToPath?: string; error?: string }> {
    let snippet: EditorConfigSnippet;

    switch (editor) {
      case 'vscode':
        snippet = this.generateVsCodeConfig((variant as 'continue' | 'cline' | 'settings') || 'continue');
        break;
      case 'jetbrains':
        snippet = this.generateJetBrainsConfig((variant as 'continue' | 'custom') || 'continue');
        break;
      case 'neovim':
        snippet = this.generateNeovimConfig((variant as 'avante' | 'codecompanion') || 'avante');
        break;
      default:
        throw new Error(`Unsupported editor: ${editor}`);
    }

    const savePath = customPath || snippet.targetPath;
    const writeResult = await this.exportToFile(savePath, snippet.content);

    return {
      success: writeResult.success,
      snippet,
      savedToPath: writeResult.success ? savePath : undefined,
      error: writeResult.error
    };
  }

  /**
   * Retrieves all available config snippets at once for quick copy/preview
   */
  public getAllConfigs(): Record<string, EditorConfigSnippet> {
    return {
      'vscode-continue': this.generateVsCodeConfig('continue'),
      'vscode-cline': this.generateVsCodeConfig('cline'),
      'jetbrains-continue': this.generateJetBrainsConfig('continue'),
      'jetbrains-custom': this.generateJetBrainsConfig('custom'),
      'neovim-avante': this.generateNeovimConfig('avante'),
      'neovim-codecompanion': this.generateNeovimConfig('codecompanion')
    };
  }
}

export const editorConfigExporter = EditorConfigExporter.getInstance();
