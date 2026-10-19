/**
 * Modular Skills & External Integration Registry (Phase 3.1)
 *
 * Provides a unified, toggleable module registry for external integrations
 * as optional 'Skills' or 'Features' without modifying core application logic.
 *
 * Supported across both hosted (OpenRouter / Groq) and local (Ollama) LLMs.
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { installEccAssets, removeEccAssets } from './ecc-installer';
import { mcpManager } from './mcp-manager';

export type LlmCompatibility = 'hosted' | 'local' | 'both';

export interface ExternalModule {
  id: string;
  name: string;
  description: string;
  isEnabled: boolean;
  llm_compatibility: LlmCompatibility;
  dependencies: string[];
  activation_hook: (workspacePath?: string) => Promise<boolean | void> | boolean | void;
  deactivation_hook?: (workspacePath?: string) => Promise<boolean | void> | boolean | void;
  category?: 'workflow' | 'export' | 'presentation' | 'ui' | 'mcp';
  version?: string;
}

export class ModuleRegistry {
  private modules = new Map<string, ExternalModule>();

  constructor() {
    this.registerDefaultModules();
  }

  /**
   * Registers default built-in modular skills and external integrations.
   * All modules default to isEnabled: false (user-toggleable).
   * User-facing names strictly avoid referencing original repository names.
   */
  private registerDefaultModules(): void {
    // 1. Advanced Agent Workflows (id: ecc-rules)
    this.registerModule({
      id: 'ecc-rules',
      name: 'Advanced Agent Workflows',
      description: 'Autonomous coding guidelines, multi-stage task decomposition, cognitive review standards, and specialized workflow rules.',
      isEnabled: false,
      llm_compatibility: 'both',
      dependencies: [],
      category: 'workflow',
      version: '1.2.0',
      deactivation_hook: async (workspacePath?: string) => {
        await removeEccAssets(workspacePath);
      },
      activation_hook: async (workspacePath?: string) => {
        const root = workspacePath || process.cwd();
        const dirs = [
          path.join(root, '.ty-code', 'skills', 'advanced-agent-workflows'),
          path.join(root, '.ty-code', 'rules'),
          path.join(root, '.ty-claude', 'skills', 'advanced-agent-workflows'),
          path.join(root, '.ty-claude', 'rules')
        ];
        for (const dir of dirs) {
          await fs.mkdir(dir, { recursive: true }).catch(() => {});
        }

        const skillContent = `---
name: "Advanced Agent Workflows"
description: "Autonomous task planning, multi-step validation, and high-precision code engineering."
---
# Advanced Agent Workflows (Ty-Code)

## Execution Standards
1. **Plan First**: Explore existing symbols with grep/view before mutating files.
2. **Atomic Edits**: Limit diffs to coherent logical units; verify compilation after every change.
3. **Cognitive Review**: Inspect generated diffs for edge-case coverage and potential regressions.
`;
        const ruleContent = `# Ty-Code Advanced Agent Rules
- Follow existing codebase style conventions strictly.
- Always run tests and typechecks to validate changes.
- Never commit secrets or unredacted credentials.
`;

        await Promise.all([
          fs.writeFile(path.join(root, '.ty-code', 'skills', 'advanced-agent-workflows', 'SKILL.md'), skillContent, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-code', 'rules', 'agent-workflows.md'), ruleContent, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'skills', 'advanced-agent-workflows', 'SKILL.md'), skillContent, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'rules', 'agent-workflows.md'), ruleContent, 'utf-8')
        ]).catch(() => {});

        // Safely provision complete ECC assets into global ~/.ty-code/, ~/.ty-claude/ and workspace
        await installEccAssets(workspacePath);
      }
    });

    // 2. Chat History Exporter (id: chat-history-exporter)
    this.registerModule({
      id: 'chat-history-exporter',
      name: 'Chat History Exporter',
      description: 'Export and backup complete conversation transcripts, code diffs, and tool traces into Markdown, JSON, and standalone HTML documents.',
      isEnabled: false,
      llm_compatibility: 'both',
      dependencies: [],
      category: 'export',
      version: '1.0.4',
      activation_hook: async (workspacePath?: string) => {
        const root = workspacePath || process.cwd();
        const dirs = [
          path.join(root, '.ty-code', 'modules', 'chat-history-exporter'),
          path.join(root, '.ty-code', 'skills', 'chat-exporter'),
          path.join(root, '.ty-claude', 'modules', 'chat-history-exporter'),
          path.join(root, '.ty-claude', 'skills', 'chat-exporter')
        ];
        for (const dir of dirs) {
          await fs.mkdir(dir, { recursive: true }).catch(() => {});
        }

        const template = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Ty-Code Session Transcript</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #0f172a; color: #f8fafc; padding: 24px; line-height: 1.6; }
    .msg { padding: 12px 16px; margin-bottom: 12px; border-radius: 8px; }
    .user { background: #1e293b; border-left: 4px solid #38bdf8; }
    .assistant { background: #334155; border-left: 4px solid #10b981; }
    pre { background: #020617; padding: 12px; border-radius: 6px; overflow-x: auto; font-family: monospace; }
  </style>
</head>
<body>
  <h1>Ty-Code Conversation Export</h1>
  <div id="conversation-container"></div>
</body>
</html>`;

        const skill = `---
name: "Chat History Exporter"
description: "Format and export Ty-Code chat history into clean HTML or Markdown."
---
# Chat History Exporter
Trigger when the user asks to save, download, or export the conversation session.`;

        await Promise.all([
          fs.writeFile(path.join(root, '.ty-code', 'modules', 'chat-history-exporter', 'export-template.html'), template, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-code', 'skills', 'chat-exporter', 'SKILL.md'), skill, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'modules', 'chat-history-exporter', 'export-template.html'), template, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'skills', 'chat-exporter', 'SKILL.md'), skill, 'utf-8')
        ]).catch(() => {});
      }
    });

    // 3. Single-File Presentation Generator (id: bento-generator)
    this.registerModule({
      id: 'bento-generator',
      name: 'Single-File Presentation Generator',
      description: 'Generate interactive, self-contained single-file HTML presentations and bento-box UI showcases with zero build step.',
      isEnabled: false,
      llm_compatibility: 'both',
      dependencies: [],
      category: 'presentation',
      version: '2.1.0',
      activation_hook: async (workspacePath?: string) => {
        const root = workspacePath || process.cwd();
        const dirs = [
          path.join(root, '.ty-code', 'templates', 'bento-generator'),
          path.join(root, '.ty-code', 'skills', 'bento-generator'),
          path.join(root, '.ty-claude', 'templates', 'bento-generator'),
          path.join(root, '.ty-claude', 'skills', 'bento-generator')
        ];
        for (const dir of dirs) {
          await fs.mkdir(dir, { recursive: true }).catch(() => {});
        }

        const bentoTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Ty-Code Bento Showcase</title>
  <style>
    body { background: #030712; color: #f9fafb; font-family: system-ui, -apple-system, sans-serif; padding: 32px; margin: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 16px; max-width: 1200px; margin: auto; }
    .card { background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 16px; padding: 24px; transition: transform 0.2s; }
    .card:hover { transform: translateY(-3px); border-color: rgba(56, 189, 248, 0.4); }
  </style>
</head>
<body>
  <h1>Interactive Bento Showcase</h1>
  <div class="grid">
    <div class="card"><h3>Overview</h3><p>Self-contained responsive component layout.</p></div>
    <div class="card"><h3>Architecture</h3><p>Zero external runtime dependencies.</p></div>
  </div>
</body>
</html>`;

        const skill = `---
name: "Single-File Presentation Generator"
description: "Generates beautiful, self-contained single-file HTML presentations and bento-box showcases."
---
# Bento & Presentation Generator
Use when user requests interactive slide decks, showcases, or bento layouts.`;

        await Promise.all([
          fs.writeFile(path.join(root, '.ty-code', 'templates', 'bento-generator', 'bento-layout.html'), bentoTemplate, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-code', 'skills', 'bento-generator', 'SKILL.md'), skill, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'templates', 'bento-generator', 'bento-layout.html'), bentoTemplate, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'skills', 'bento-generator', 'SKILL.md'), skill, 'utf-8')
        ]).catch(() => {});

        try {
          const baseSource = path.join(process.cwd(), 'src', 'main', 'templates', 'bento-base.html');
          const baseContent = await fs.readFile(baseSource, 'utf-8');
          await Promise.all([
            fs.writeFile(path.join(root, '.ty-code', 'templates', 'bento-generator', 'bento-base.html'), baseContent, 'utf-8'),
            fs.writeFile(path.join(root, '.ty-claude', 'templates', 'bento-generator', 'bento-base.html'), baseContent, 'utf-8')
          ]);
        } catch {
          // base file optional
        }
      }
    });

    // 4. Visual UI Sketcher (id: visual-ui-sketcher)
    this.registerModule({
      id: 'visual-ui-sketcher',
      name: 'Visual UI Sketcher',
      description: 'Generative UI wireframing, component mockups, and layout prototyping with instant visual code preview.',
      isEnabled: false,
      llm_compatibility: 'both',
      dependencies: ['node-pty'],
      category: 'ui',
      version: '1.4.1',
      activation_hook: async (workspacePath?: string) => {
        const root = workspacePath || process.cwd();
        const dirs = [
          path.join(root, '.ty-code', 'modules', 'visual-ui-sketcher'),
          path.join(root, '.ty-code', 'skills', 'visual-sketcher'),
          path.join(root, '.ty-claude', 'modules', 'visual-ui-sketcher'),
          path.join(root, '.ty-claude', 'skills', 'visual-sketcher')
        ];
        for (const dir of dirs) {
          await fs.mkdir(dir, { recursive: true }).catch(() => {});
        }

        const canvasHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Ty-Code UI Sketch Canvas</title>
  <style>
    body { background: #111827; color: #fff; font-family: sans-serif; display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100vh; margin: 0; }
    .canvas-box { border: 2px dashed #4b5563; border-radius: 12px; width: 80%; height: 70%; display: flex; align-items: center; justify-content: center; color: #9ca3af; }
  </style>
</head>
<body>
  <h2>UI Wireframe &amp; Sketch Prototype Canvas</h2>
  <div class="canvas-box">Interactive Component Canvas Ready</div>
</body>
</html>`;

        const skill = `---
name: "Visual UI Sketcher"
description: "Wireframes, layout mockups, and interactive visual UI prototypes."
---
# Visual UI Sketcher
Invoke when generating UI mockups, visual wireframes, or testing responsive component layouts.`;

        await Promise.all([
          fs.writeFile(path.join(root, '.ty-code', 'modules', 'visual-ui-sketcher', 'sketch-canvas.html'), canvasHtml, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-code', 'skills', 'visual-sketcher', 'SKILL.md'), skill, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'modules', 'visual-ui-sketcher', 'sketch-canvas.html'), canvasHtml, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'skills', 'visual-sketcher', 'SKILL.md'), skill, 'utf-8')
        ]).catch(() => {});

        try {
          const m3eSource = path.join(process.cwd(), 'src', 'renderer', 'public', 'm3e-canvas', 'index.html');
          const m3eContent = await fs.readFile(m3eSource, 'utf-8');
          await Promise.all([
            fs.writeFile(path.join(root, '.ty-code', 'modules', 'visual-ui-sketcher', 'index.html'), m3eContent, 'utf-8'),
            fs.writeFile(path.join(root, '.ty-claude', 'modules', 'visual-ui-sketcher', 'index.html'), m3eContent, 'utf-8')
          ]);
        } catch {}
      }
    });

    // 5. SEO & Analytics MCP (id: seo-analytics-mcp)
    this.registerModule({
      id: 'seo-analytics-mcp',
      name: 'SEO & Analytics MCP',
      description: 'Model Context Protocol server for automated site auditing, meta optimization, search performance analytics, and structured data extraction.',
      isEnabled: false,
      llm_compatibility: 'both',
      dependencies: ['python3'],
      category: 'mcp',
      version: '1.1.0',
      activation_hook: async (workspacePath?: string) => {
        const root = workspacePath || process.cwd();
        const dirs = [
          path.join(root, '.ty-code', 'mcp'),
          path.join(root, '.ty-code', 'skills', 'seo-analytics'),
          path.join(root, '.ty-claude', 'mcp'),
          path.join(root, '.ty-claude', 'skills', 'seo-analytics')
        ];
        for (const dir of dirs) {
          await fs.mkdir(dir, { recursive: true }).catch(() => {});
        }

        const mcpConfig = {
          name: 'seo-analytics',
          command: 'python3',
          args: ['-m', 'seo_analytics_mcp'],
          env: {
            TY_CODE_MCP_MODULE: 'seo-analytics'
          },
          tools: [
            {
              name: 'audit_page_seo',
              description: 'Analyze page HTML for title, meta tags, heading hierarchy, and OpenGraph headers.'
            },
            {
              name: 'check_core_web_vitals',
              description: 'Measure page speed, layout shift, and resource optimization metrics via the live PageSpeed API (credentials required).'
            }
          ]
        };

        const skill = `---
name: "SEO & Analytics MCP"
description: "Model Context Protocol tools for search optimization and web analytics auditing."
---
# SEO & Analytics Tools
Use to inspect meta tags, analyze page structure, and verify structured data schema compliance.`;

        const mcpJson = JSON.stringify(mcpConfig, null, 2);
        await Promise.all([
          fs.writeFile(path.join(root, '.ty-code', 'mcp', 'seo-analytics.json'), mcpJson, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-code', 'skills', 'seo-analytics', 'SKILL.md'), skill, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'mcp', 'seo-analytics.json'), mcpJson, 'utf-8'),
          fs.writeFile(path.join(root, '.ty-claude', 'skills', 'seo-analytics', 'SKILL.md'), skill, 'utf-8')
        ]).catch(() => {});

        // Enable Open SEO server in mcp_config.json
        await mcpManager.setSeoServerEnabled(true, workspacePath);
      },
      deactivation_hook: async (workspacePath?: string) => {
        // Disable Open SEO server in mcp_config.json
        await mcpManager.setSeoServerEnabled(false, workspacePath);
      }
    });
  }

  public registerModule(module: ExternalModule): void {
    this.modules.set(module.id, { ...module });
  }

  public unregisterModule(id: string): boolean {
    return this.modules.delete(id);
  }

  public getModule(id: string): ExternalModule | undefined {
    return this.modules.get(id);
  }

  public getAllModules(): ExternalModule[] {
    return Array.from(this.modules.values());
  }

  public setModuleEnabled(id: string, enabled: boolean): boolean {
    const mod = this.modules.get(id);
    if (!mod) return false;
    mod.isEnabled = enabled;
    return true;
  }
}

export const moduleRegistry = new ModuleRegistry();
