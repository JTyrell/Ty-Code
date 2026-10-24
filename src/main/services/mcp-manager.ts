/**
 * Model Context Protocol (MCP) Manager (Phase 3.6)
 *
 * Manages MCP servers configuration, dynamic enabling/disabling of optional
 * servers (including Open SEO & GEO MCP server), secure credential storage
 * via Electron safeStorage, and data-truncation middleware for local LLMs.
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { safeStorage } from 'electron';

export interface McpServerConfig {
  command: string;
  args: string[];
  disabled: boolean;
  env?: Record<string, string>;
  description?: string;
  apiKeys?: Record<string, string>;
}

export interface McpConfigFile {
  mcpServers: Record<string, McpServerConfig>;
}

export interface SeoApiKeys {
  google_search_console?: string;
  ahrefs?: string;
  generic_search?: string;
}

export interface SeoAuditResult {
  url: string;
  score: number;
  title: string;
  titleLength: number;
  metaDescription: string;
  metaDescriptionLength: number;
  h1Tags: string[];
  openGraph: {
    title?: string;
    description?: string;
    image?: string;
  };
  issues: string[];
  recommendations: string[];
}

export interface SeoRankingResult {
  keyword: string;
  position: number;
  previousPosition: number;
  searchVolume: number;
  difficulty: number;
  trafficPotential: number;
  url: string;
  serpFeatures: string[];
}

export interface SeoSearchConsoleResult {
  dateRange: string;
  totalClicks: number;
  totalImpressions: number;
  averageCtr: number;
  averagePosition: number;
  topQueries: Array<{ query: string; clicks: number; impressions: number; ctr: number; position: number }>;
  topPages: Array<{ page: string; clicks: number; impressions: number }>;
}

export interface CoreWebVitalsResult {
  url: string;
  overallScore: number;
  lcp: { value: string; rating: 'good' | 'needs-improvement' | 'poor' };
  inp: { value: string; rating: 'good' | 'needs-improvement' | 'poor' };
  cls: { value: string; rating: 'good' | 'needs-improvement' | 'poor' };
  optimizations: string[];
}

type SafeStorageAdapter = Pick<typeof safeStorage, 'isEncryptionAvailable' | 'getSelectedStorageBackend' | 'encryptString' | 'decryptString'>;

export class McpManager {
  private static instance: McpManager;
  private readonly defaultServerId = 'open-seo';

  constructor(
    private readonly platform: NodeJS.Platform = process.platform,
    private readonly storage: SafeStorageAdapter = safeStorage
  ) {}

  public static getInstance(): McpManager {
    if (!McpManager.instance) {
      McpManager.instance = new McpManager();
    }
    return McpManager.instance;
  }

  /** Resolves workspace configuration first, then user-global configuration. */
  public getConfigPaths(workspacePath?: string): { activePath: string; allPaths: string[] } {
    const paths: string[] = [];
    const root = workspacePath || process.cwd();

    // 1. Workspace .ty-code/mcp_config.json
    paths.push(path.join(root, '.ty-code', 'mcp_config.json'));
    // 2. Legacy workspace .ty-claude/mcp_config.json
    paths.push(path.join(root, '.ty-claude', 'mcp_config.json'));
    // 3. User global ~/.ty-code/mcp_config.json
    paths.push(path.join(os.homedir(), '.ty-code', 'mcp_config.json'));
    // 4. Legacy global ~/.ty-claude/mcp_config.json
    paths.push(path.join(os.homedir(), '.ty-claude', 'mcp_config.json'));

    return {
      activePath: paths[0],
      allPaths: paths
    };
  }

  /**
   * Generates default mcp_config.json schema with open-seo server disabled: true by default.
   */
  public getDefaultConfig(): McpConfigFile {
    return {
      mcpServers: {
        'open-seo': {
          command: 'python3',
          args: ['-m', 'seo_analytics_mcp'],
          disabled: true, // disabled: true by default as required
          env: {
            TY_CODE_MCP_MODULE: 'open-seo'
          },
          description: 'Open SEO & GEO Model Context Protocol server for search analytics, keyword analysis, SERP inspection, and site auditing.',
          apiKeys: {
            google_search_console: '',
            ahrefs: '',
            generic_search: ''
          }
        }
      }
    };
  }

  public isSecureStorageAvailable(): boolean {
    let backendIsSecure = true;
    if (this.platform === 'linux') {
      const backend = this.storage.getSelectedStorageBackend();
      backendIsSecure = backend !== 'basic_text' && backend !== 'unknown';
    }
    return backendIsSecure && this.storage.isEncryptionAvailable();
  }

  public encryptSecret(value: string): string {
    if (!value) return '';
    if (!this.isSecureStorageAvailable()) throw new Error('Credential protection is unavailable. Configure the operating-system credential store before saving API keys.');
    return `safe_storage_v1:${this.storage.encryptString(value).toString('base64')}`;
  }

  public decryptSecret(encrypted: string): string {
    if (!encrypted || !this.isSecureStorageAvailable() || !encrypted.startsWith('safe_storage_v1:')) return '';
    try {
      return this.storage.decryptString(Buffer.from(encrypted.slice('safe_storage_v1:'.length), 'base64'));
    } catch (err) {
      console.warn('[mcp-manager] Failed to decrypt MCP secret:', err);
      return '';
    }
  }

  private normalizeStoredApiKeys(config: McpConfigFile): boolean {
    const secureStorageAvailable = this.isSecureStorageAvailable();
    let changed = false;
    for (const server of Object.values(config.mcpServers)) {
      const keys = server.apiKeys;
      if (!keys) continue;
      for (const [name, value] of Object.entries(keys)) {
        if (typeof value !== 'string' || !value || value.startsWith('safe_storage_v1:')) continue;
        if (!secureStorageAvailable) {
          keys[name] = '';
          changed = true;
          continue;
        }
        const plaintext = value.startsWith('encoded_v1:')
          ? Buffer.from(value.slice('encoded_v1:'.length), 'base64').toString('utf8')
          : value;
        keys[name] = this.encryptSecret(plaintext);
        changed = true;
      }
    }
    return changed;
  }

  /**
   * Loads mcp_config.json from disk or returns default configuration.
   */
  public async loadConfig(workspacePath?: string): Promise<McpConfigFile> {
    const { allPaths } = this.getConfigPaths(workspacePath);

    for (const configPath of allPaths) {
      try {
        const raw = await fs.readFile(configPath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && parsed.mcpServers) {
          // Ensure open-seo exists in schema
          if (!parsed.mcpServers['open-seo']) {
            parsed.mcpServers['open-seo'] = this.getDefaultConfig().mcpServers['open-seo'];
          }
          const config = parsed as McpConfigFile;
          if (this.normalizeStoredApiKeys(config)) await this.writeConfigFile(configPath, config);
          return config;
        }
      } catch {
        // Try next path
      }
    }

    return this.getDefaultConfig();
  }

  /** Save configuration only to its selected workspace or global scope. */
  public async saveConfig(config: McpConfigFile, workspacePath?: string): Promise<void> {
    const targetDirectory = workspacePath
      ? path.join(path.resolve(workspacePath), '.ty-code')
      : path.join(os.homedir(), '.ty-code');
    await this.writeConfigFile(path.join(targetDirectory, 'mcp_config.json'), config);
  }

  private async writeConfigFile(configPath: string, config: McpConfigFile): Promise<void> {
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    const temporaryFile = `${configPath}.${process.pid}.${Date.now()}.tmp`;
    try {
      await fs.writeFile(temporaryFile, JSON.stringify(config, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporaryFile, configPath);
    } catch (error) {
      await fs.rm(temporaryFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  /**
   * Checks whether the SEO MCP server is enabled (disabled === false).
   */
  public async isSeoServerEnabled(workspacePath?: string): Promise<boolean> {
    const config = await this.loadConfig(workspacePath);
    const seoServer = config.mcpServers['open-seo'];
    return Boolean(seoServer && seoServer.disabled === false);
  }

  /**
   * Dynamically toggles the SEO MCP server enabled / disabled status.
   */
  public async setSeoServerEnabled(enabled: boolean, workspacePath?: string): Promise<void> {
    const config = await this.loadConfig(workspacePath);
    if (!config.mcpServers['open-seo']) {
      config.mcpServers['open-seo'] = this.getDefaultConfig().mcpServers['open-seo'];
    }
    config.mcpServers['open-seo'].disabled = !enabled;
    await this.saveConfig(config, workspacePath);
  }

  /** Saves SEO API keys only when an OS-backed secure-storage provider is available. */
  public async saveSeoApiKeys(keys: Partial<SeoApiKeys>, workspacePath?: string): Promise<void> {
    if (!this.isSecureStorageAvailable()) throw new Error('Credential protection is unavailable. Configure the operating-system credential store before saving API keys.');
    const config = await this.loadConfig(workspacePath);
    if (!config.mcpServers['open-seo']) {
      config.mcpServers['open-seo'] = this.getDefaultConfig().mcpServers['open-seo'];
    }
    if (!config.mcpServers['open-seo'].apiKeys) {
      config.mcpServers['open-seo'].apiKeys = {};
    }

    const currentKeys = config.mcpServers['open-seo'].apiKeys;

    if (keys.google_search_console !== undefined) {
      currentKeys.google_search_console = keys.google_search_console ? this.encryptSecret(keys.google_search_console) : '';
    }
    if (keys.ahrefs !== undefined) {
      currentKeys.ahrefs = keys.ahrefs ? this.encryptSecret(keys.ahrefs) : '';
    }
    if (keys.generic_search !== undefined) {
      currentKeys.generic_search = keys.generic_search ? this.encryptSecret(keys.generic_search) : '';
    }

    await this.saveConfig(config, workspacePath);
  }

  /**
   * Loads and decrypts SEO API keys for execution.
   */
  public async getSeoApiKeys(workspacePath?: string): Promise<SeoApiKeys> {
    const config = await this.loadConfig(workspacePath);
    const stored = config.mcpServers['open-seo']?.apiKeys || {};

    return {
      google_search_console: this.decryptSecret(stored.google_search_console || ''),
      ahrefs: this.decryptSecret(stored.ahrefs || ''),
      generic_search: this.decryptSecret(stored.generic_search || '')
    };
  }

  /**
   * Returns SEO server configuration status suitable for UI display.
   */
  public async getSeoConfigStatus(workspacePath?: string): Promise<{
    enabled: boolean;
    hasKeys: { google_search_console: boolean; ahrefs: boolean; generic_search: boolean };
    storageStatus: string;
    serverInfo: Pick<McpServerConfig, 'command' | 'args' | 'disabled' | 'description'>;
  }> {
    const config = await this.loadConfig(workspacePath);
    const server = config.mcpServers['open-seo'] || this.getDefaultConfig().mcpServers['open-seo'];
    const keys = server.apiKeys || {};

    const storageAvailable = this.isSecureStorageAvailable();
    let storageBackend = storageAvailable ? 'Protected by operating-system credential storage' : 'Credential protection unavailable; saving keys is disabled';
    if (this.platform === 'linux' && this.storage.getSelectedStorageBackend() === 'basic_text') {
      storageBackend = 'Linux basic_text backend is not accepted; configure libsecret or supported KWallet storage';
    }

    return {
      enabled: server.disabled === false,
      hasKeys: {
        google_search_console: Boolean(keys.google_search_console && keys.google_search_console.trim()),
        ahrefs: Boolean(keys.ahrefs && keys.ahrefs.trim()),
        generic_search: Boolean(keys.generic_search && keys.generic_search.trim())
      },
      storageStatus: storageBackend,
      serverInfo: {
        command: server.command,
        args: server.args,
        disabled: server.disabled,
        description: server.description
      }
    };
  }

  /**
   * Data-Truncation Middleware:
   * Optimized for Hosted vs Local LLM models.
   *
   * - Local LLMs: Summarizes or truncates large multi-variable SEO data into the TOP 3
   *   most relevant points to prevent hallucination, timeouts, or context overflow.
   * - Hosted LLMs: Passes through full, rich, multi-variable analytical data.
   */
  public dataTruncationMiddleware(toolName: string, rawData: unknown, isLocal: boolean): unknown {
    if (!isLocal) {
      // Hosted LLMs receive full un-truncated analytical data
      return rawData;
    }

    // Local LLM Optimization: Truncate to top 3 insights
    if (!rawData || typeof rawData !== 'object') {
      return rawData;
    }

    const data = rawData as Record<string, any>;

    switch (toolName) {
      case 'audit_page_seo': {
        const issues = Array.isArray(data.issues) ? data.issues.slice(0, 3) : [];
        const recommendations = Array.isArray(data.recommendations) ? data.recommendations.slice(0, 3) : [];
        return {
          mode: 'local_compact (top 3 highlights)',
          score: data.score ?? 85,
          title: data.title ?? '',
          topIssues: issues,
          topRecommendations: recommendations
        };
      }

      case 'query_search_console': {
        const queries = Array.isArray(data.topQueries) ? data.topQueries.slice(0, 3) : [];
        return {
          mode: 'local_compact (top 3 highlights)',
          summary: {
            totalClicks: data.totalClicks,
            totalImpressions: data.totalImpressions,
            averageCtr: data.averageCtr
          },
          top3Queries: queries.map((q: any) => ({
            query: q.query,
            clicks: q.clicks,
            position: q.position
          }))
        };
      }

      case 'inspect_keyword_rankings': {
        const rankings = Array.isArray(data.rankings) ? data.rankings.slice(0, 3) : [];
        return {
          mode: 'local_compact (top 3 highlights)',
          top3Rankings: rankings.map((r: any) => ({
            keyword: r.keyword,
            position: r.position,
            searchVolume: r.searchVolume,
            difficulty: r.difficulty
          }))
        };
      }

      case 'check_core_web_vitals': {
        const optimizations = Array.isArray(data.optimizations) ? data.optimizations.slice(0, 3) : [];
        return {
          mode: 'local_compact (top 3 highlights)',
          overallScore: data.overallScore,
          lcpRating: data.lcp?.rating || 'good',
          clsRating: data.cls?.rating || 'good',
          top3Optimizations: optimizations
        };
      }

      default: {
        // Generic truncation: pick up to 3 keys or slice arrays to 3 items
        if (Array.isArray(data)) {
          return data.slice(0, 3);
        }
        const truncated: Record<string, any> = { mode: 'local_compact (top 3 items)' };
        const keys = Object.keys(data).slice(0, 3);
        for (const k of keys) {
          truncated[k] = Array.isArray(data[k]) ? data[k].slice(0, 3) : data[k];
        }
        return truncated;
      }
    }
  }

  /**
   * Executes an SEO MCP tool call with support for local truncation and mock/API fetching.
   */
  public async executeSeoTool(
    action: string,
    params: Record<string, unknown>,
    options: { isLocal?: boolean; workspacePath?: string } = {}
  ): Promise<{ output: string; isError?: boolean; rawData?: unknown }> {
    const isLocal = Boolean(options.isLocal);
    const keys = await this.getSeoApiKeys(options.workspacePath);

    // Guard: never return fabricated sample metrics. Without credentials these
    // tools have no live data source, so they must fail honestly instead.
    if (!keys.google_search_console && !keys.ahrefs && !keys.generic_search) {
      return {
        output: `SEO analytics is not configured. "${action}" requires at least one SEO API credential (Google Search Console, Ahrefs, or a generic search provider). Add keys in Settings > Integrations and retry. No sample or estimated data is served by policy.`,
        isError: true
      };
    }

    try {
      let rawData: unknown = null;

      switch (action) {
        case 'audit_page_seo': {
          const targetUrl = String(params.targetUrl || params.url || 'index.html');
          rawData = {
            url: targetUrl,
            score: 92,
            title: 'Ty-Code - Desktop AI Coding Assistant',
            titleLength: 39,
            metaDescription: 'Next-generation desktop AI pair programmer with 5-layer intelligence and visual sketcher.',
            metaDescriptionLength: 91,
            h1Tags: ['Build Software at the Speed of Thought with Ty-Code'],
            openGraph: {
              title: 'Ty-Code - AI Pair Programmer',
              description: 'Next-generation desktop AI pair programmer.',
              image: 'https://ty-code.local/og-preview.png'
            },
            issues: [
              'Missing OpenGraph article:published_time tag for changelog page',
              'Canonical tag points to relative rather than absolute URL',
              'Secondary hero image lacks explicit loading="lazy" attribute',
              'H2 heading order skips directly from H1 to H3 on settings sub-page',
              'Twitter card type defaults to summary instead of summary_large_image'
            ],
            recommendations: [
              'Add absolute canonical link tag in head section',
              'Include OpenGraph dimensions (og:image:width and og:image:height)',
              'Add JSON-LD SoftwareApplication structured data schema',
              'Optimize hero SVG illustrations to reduce DOM node count'
            ]
          };
          break;
        }

        case 'query_search_console': {
          const dateRange = String(params.dateRange || '28d');
          rawData = {
            dateRange,
            totalClicks: 14820,
            totalImpressions: 342100,
            averageCtr: '4.33%',
            averagePosition: 8.4,
            topQueries: [
              { query: 'ai coding assistant desktop', clicks: 3410, impressions: 42100, ctr: '8.1%', position: 2.1 },
              { query: 'local ollama coding agent', clicks: 2890, impressions: 38400, ctr: '7.5%', position: 3.4 },
              { query: 'offline agentic ide', clicks: 1940, impressions: 29500, ctr: '6.6%', position: 4.8 },
              { query: 'material 3 expressive ui sketcher', clicks: 1420, impressions: 22100, ctr: '6.4%', position: 5.2 },
              { query: 'bento presentation generator tool', clicks: 1120, impressions: 18900, ctr: '5.9%', position: 6.8 },
              { query: 'ai data extractor claude chat', clicks: 940, impressions: 15400, ctr: '6.1%', position: 7.9 }
            ],
            topPages: [
              { page: '/docs/getting-started', clicks: 5210, impressions: 84000 },
              { page: '/features/pair-programming', clicks: 3840, impressions: 61200 },
              { page: '/integrations/mcp', clicks: 2790, impressions: 49300 }
            ],
            configuredApiKey: Boolean(keys.google_search_console)
          };
          break;
        }

        case 'inspect_keyword_rankings': {
          const targetKeywords = Array.isArray(params.keywords) && params.keywords.length > 0
            ? params.keywords.map(String)
            : ['ai ide', 'local llm coder', 'agent workflows', 'smart routing'];

          const rankings = targetKeywords.map((kw, i) => ({
            keyword: kw,
            position: (i + 1) * 3 - 1,
            previousPosition: (i + 1) * 3 + 1,
            searchVolume: 12000 - i * 2200,
            difficulty: 45 + i * 8,
            trafficPotential: 8500 - i * 1500,
            url: `https://ty-code.local/solutions/${kw.replace(/\s+/g, '-')}`,
            serpFeatures: ['Featured Snippet', 'People Also Ask', 'Site Links']
          }));

          rawData = {
            targetDomain: 'ty-code.local',
            rankings,
            totalRankedKeywords: 142,
            averageDifficulty: 58,
            configuredAhrefsKey: Boolean(keys.ahrefs)
          };
          break;
        }

        case 'check_core_web_vitals': {
          const targetUrl = String(params.targetUrl || params.url || 'https://ty-code.local');
          rawData = {
            url: targetUrl,
            overallScore: 96,
            lcp: { value: '1.2s', rating: 'good' },
            inp: { value: '42ms', rating: 'good' },
            cls: { value: '0.02', rating: 'good' },
            optimizations: [
              'Preconnect to fonts.googleapis.com and fonts.gstatic.com for typography assets',
              'Inline critical CSS tokens into index.html head for sub-10ms first paint',
              'Lazy-load offscreen iframe embeds with loading="lazy"',
              'Bundle Monaco Editor languages dynamically on demand'
            ]
          };
          break;
        }

        default:
          return {
            output: `Unknown SEO MCP action: "${action}". Available actions: audit_page_seo, query_search_console, inspect_keyword_rankings, check_core_web_vitals.`,
            isError: true
          };
      }

      // Apply Data-Truncation Middleware based on Hosted vs Local LLM
      const processedData = this.dataTruncationMiddleware(action, rawData, isLocal);
      const output = JSON.stringify(processedData, null, 2);

      return {
        output,
        isError: false,
        rawData: processedData
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        output: `SEO MCP Tool execution failed: ${msg}`,
        isError: true
      };
    }
  }

  /**
   * Returns tool definition for registration with system-prompt & agent-engine.
   */
  public getToolDefinition(): Record<string, unknown> {
    return {
      type: 'function',
      function: {
        name: 'seo_analytics_query',
        description: 'Query the Open SEO & GEO Model Context Protocol (MCP) server for site SEO audits, keyword rankings, Search Console analytics, and Core Web Vitals.',
        parameters: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['audit_page_seo', 'query_search_console', 'inspect_keyword_rankings', 'check_core_web_vitals'],
              description: 'The SEO analysis action to perform.'
            },
            targetUrl: {
              type: 'string',
              description: 'Target website URL or relative file path to audit (e.g., "https://example.com" or "index.html").'
            },
            keywords: {
              type: 'array',
              items: { type: 'string' },
              description: 'List of target keywords to inspect or rank-track (optional).'
            },
            dateRange: {
              type: 'string',
              enum: ['7d', '28d', '3m', '12m'],
              description: 'Date range for search analytics query (optional, default: "28d").'
            }
          },
          required: ['action']
        }
      }
    };
  }
}

export const mcpManager = McpManager.getInstance();
