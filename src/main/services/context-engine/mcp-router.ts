/**
 * Ty-Code Context Engine: Dynamic MCP Server Router
 *
 * Automatically routes and recommends Model Context Protocol (MCP) servers
 * based on the scanned workspace profile (languages, frameworks, databases, architecture).
 *
 * Strict Security & Locality Guarantee:
 * - Only suggests and starts local stdio MCP servers (Zero-Cloud by default).
 * - Never communicates with cloud MCP servers without explicit user approval.
 * - 100% local execution.
 */

import path from 'node:path';
import type { WorkspaceProfile } from './types';
import { mcpManager, type McpConfigFile, type McpServerConfig } from '../mcp-manager';

export interface MCPServerConfig {
  id: string;
  name: string;
  command: string;
  args: string[];
  disabled: boolean;
  env?: Record<string, string>;
  description: string;
  trigger: string;
  category: 'database' | 'browser' | 'filesystem' | 'data' | 'tools';
}

/**
 * Local MCP Server Registry mapping detected stack traits to local stdio MCP servers.
 */
export function getRecommendedMCPs(profile: WorkspaceProfile): MCPServerConfig[] {
  const recommendations: MCPServerConfig[] = [];
  const addedIds = new Set<string>();

  const frameworksLower = (profile.frameworks || []).map((f) => f.toLowerCase());
  const databasesLower = (profile.databases || []).map((d) => d.toLowerCase());
  const primaryLangLower = (profile.primaryLanguage || '').toLowerCase();
  const architectureLower = (profile.architecture || '').toLowerCase();

  // ───────────────────────────────────────────────────────────────────────────
  // 1. DATABASES
  // ───────────────────────────────────────────────────────────────────────────
  if (databasesLower.some((d) => d.includes('postgres'))) {
    recommendations.push({
      id: 'postgres',
      name: 'PostgreSQL MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-postgres'],
      disabled: false,
      env: {
        DATABASE_URL: 'postgresql://localhost:5432'
      },
      description: 'Inspect schemas, execute read-only queries, and analyze PostgreSQL tables locally via stdio.',
      trigger: 'Database: PostgreSQL',
      category: 'database'
    });
    addedIds.add('postgres');
  }

  if (databasesLower.some((d) => d.includes('sqlite'))) {
    recommendations.push({
      id: 'sqlite',
      name: 'SQLite MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-sqlite'],
      disabled: false,
      description: 'Interact with local SQLite databases, inspect schemas, and query tables via stdio.',
      trigger: 'Database: SQLite',
      category: 'database'
    });
    addedIds.add('sqlite');
  }

  if (databasesLower.some((d) => d.includes('mysql') || d.includes('mariadb'))) {
    recommendations.push({
      id: 'mysql',
      name: 'MySQL MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-mysql'],
      disabled: false,
      description: 'Inspect MySQL schemas and tables via local stdio protocol.',
      trigger: 'Database: MySQL',
      category: 'database'
    });
    addedIds.add('mysql');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 2. FRAMEWORKS & UI TESTING
  // ───────────────────────────────────────────────────────────────────────────
  const hasFrontendUi =
    frameworksLower.some((f) =>
      ['react', 'next.js', 'vue', 'nuxt', 'svelte', 'angular', 'remix', 'astro'].includes(f)
    ) || architectureLower.includes('next.js') || architectureLower.includes('component');

  if (hasFrontendUi && !addedIds.has('puppeteer')) {
    recommendations.push({
      id: 'puppeteer',
      name: 'Puppeteer Browser MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-puppeteer'],
      disabled: false,
      description: 'Automate headless browser interactions, take screenshots, and test UI components locally.',
      trigger: 'UI Framework: React / Next.js / Frontend',
      category: 'browser'
    });
    addedIds.add('puppeteer');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 3. PROGRAMMING LANGUAGES & DATA ANALYSIS
  // ───────────────────────────────────────────────────────────────────────────
  if (primaryLangLower === 'python' || frameworksLower.some((f) => ['pandas', 'pytorch', 'tensorflow'].includes(f))) {
    recommendations.push({
      id: 'python-pandas',
      name: 'Local Data Analysis MCP Server',
      command: 'python',
      args: ['-m', 'mcp_server_pandas'],
      disabled: false,
      description: 'Perform local in-memory tabular data inspection and pandas dataframe analysis via stdio.',
      trigger: 'Language: Python / Data Science',
      category: 'data'
    });
    addedIds.add('python-pandas');
  }

  // ───────────────────────────────────────────────────────────────────────────
  // 4. CORE WORKSPACE & REPOSITORY TOOLS
  // ───────────────────────────────────────────────────────────────────────────
  if (!addedIds.has('filesystem')) {
    recommendations.push({
      id: 'filesystem',
      name: 'Local Filesystem MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
      disabled: false,
      description: 'Standard Model Context Protocol filesystem interface for local file reading and directory inspection.',
      trigger: 'Workspace: Core Local Filesystem',
      category: 'filesystem'
    });
    addedIds.add('filesystem');
  }

  if (architectureLower.includes('monorepo') || architectureLower.includes('microservices')) {
    recommendations.push({
      id: 'git',
      name: 'Git Repository MCP Server',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-git'],
      disabled: false,
      description: 'Interact with Git commit history, branches, and diffs across workspaces via stdio.',
      trigger: 'Architecture: Monorepo / Multi-Package',
      category: 'tools'
    });
    addedIds.add('git');
  }

  return recommendations;
}

/**
 * Injects recommended MCP server configurations into the workspace's mcp_config.json
 * without overwriting custom servers or cloud keys.
 */
export async function injectRecommendedMCPs(
  workspacePath: string,
  profile: WorkspaceProfile
): Promise<{ injected: string[]; total: number }> {
  const recommendations = getRecommendedMCPs(profile);
  const currentConfig: McpConfigFile = await mcpManager.loadConfig(workspacePath);
  const existingServers = currentConfig.mcpServers || {};

  const injected: string[] = [];

  for (const rec of recommendations) {
    if (!existingServers[rec.id]) {
      existingServers[rec.id] = {
        command: rec.command,
        args: rec.args,
        disabled: false,
        env: rec.env,
        description: rec.description
      };
      injected.push(rec.name);
    }
  }

  if (injected.length > 0) {
    currentConfig.mcpServers = existingServers;
    await mcpManager.saveConfig(currentConfig, workspacePath);
  }

  return {
    injected,
    total: Object.keys(existingServers).length
  };
}
