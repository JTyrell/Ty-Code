/**
 * Prompt C Step 2 — Rules engine service.
 *
 * Reads user-authored Markdown rule files from the PROJECT-LOCAL, git-shareable
 * `.tycode/rules/` directory and turns them into system-prompt injections by mode:
 *   always         → full body, every task
 *   glob           → full body, when a matching workspace-relative file is in context
 *   model-decision → only the description is listed; the model fetches the body via
 *                    the `load_rule` tool (see resolveRule)
 *   manual         → never auto-injected; surfaced only through the `@rule` mention
 *
 * Strictly local: no Electron, no network. The only matching primitive is the shared
 * glob matcher from the knowledge foundation (same semantics as `.tycodeignore`).
 */

import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  RULES_DIR,
  type RuleMeta,
  type RuleFile,
  type RuleMode,
  type FiredRule,
  type RuleTestResult
} from '../../../shared/types/rules';
import { buildIgnoreMatcher } from './knowledge-fs';

const RULES_MAX_FILES = 200;
const RULE_MAX_BYTES = 256 * 1024;
const VALID_MODES: ReadonlySet<RuleMode> = new Set(['always', 'manual', 'model-decision', 'glob']);

class RulesService {
  private rulesDir(workspaceRoot: string): string {
    return path.join(path.resolve(workspaceRoot), RULES_DIR);
  }

  private slugToFileName(name: string): string {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${clean || 'rule'}.md`;
  }

  private fileNameToSlug(file: string): string {
    return path.posix.basename(file).replace(/\.md$/i, '');
  }

  /** Lists every rule's metadata (no bodies). Missing directory → empty list. */
  async list(workspaceRoot: string): Promise<RuleMeta[]> {
    const files = await this.ruleFiles(workspaceRoot);
    const metas: RuleMeta[] = [];
    for (const rel of files) {
      const parsed = await this.readRuleFile(workspaceRoot, rel);
      if (parsed) metas.push(stripBody(parsed));
    }
    return metas.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /** Reads a single rule (by slug) with its Markdown body; null if absent. */
  async read(workspaceRoot: string, name: string): Promise<RuleFile | null> {
    const rel = path.posix.join(RULES_DIR, this.slugToFileName(name));
    return this.readRuleFile(workspaceRoot, rel);
  }

  /**
   * Full-text resolution for the `load_rule` tool. Returns the body (frontmatter
   * stripped) or null. This is how a `model-decision` rule is materialized on demand.
   */
  async resolveRuleText(workspaceRoot: string, name: string): Promise<string | null> {
    const rule = await this.read(workspaceRoot, name);
    return rule ? rule.body : null;
  }

  /** Create/overwrite a rule file from structured fields. */
  async save(workspaceRoot: string, input: {
    name: string;
    title: string;
    description: string;
    mode: RuleMode;
    globs: string[];
    body: string;
  }): Promise<RuleMeta> {
    const dir = this.rulesDir(workspaceRoot);
    await fsp.mkdir(dir, { recursive: true });
    const rel = path.posix.join(RULES_DIR, this.slugToFileName(input.name));
    const abs = path.join(path.resolve(workspaceRoot), rel);

    const title = (input.title || input.name).trim();
    const frontmatter = ['---', `mode: ${input.mode}`];
    if (input.globs.length > 0) {
      frontmatter.push('globs:');
      for (const g of input.globs) frontmatter.push(`  - ${JSON.stringify(g)}`);
    }
    frontmatter.push(`description: ${JSON.stringify(input.description.trim())}`);
    frontmatter.push(`title: ${JSON.stringify(title)}`);
    frontmatter.push('---', '');

    const content = `${frontmatter.join('\n')}# ${title}\n\n${input.body.trim()}\n`;
    await fsp.writeFile(abs, content, 'utf-8');

    const parsed = await this.readRuleFile(workspaceRoot, rel);
    return parsed ? stripBody(parsed) : {
      name: this.fileNameToSlug(rel),
      file: rel,
      title,
      description: input.description.trim(),
      mode: input.mode,
      globs: input.globs
    };
  }

  /** Delete a rule file by slug; returns whether something was removed. */
  async remove(workspaceRoot: string, name: string): Promise<boolean> {
    const rel = path.posix.join(RULES_DIR, this.slugToFileName(name));
    try {
      await fsp.unlink(path.join(path.resolve(workspaceRoot), rel));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Builds the system-prompt injection block for a task.
   * `contextFiles` are workspace-relative paths currently in context (active/open files).
   * Manual rules are intentionally NOT included here (they arrive only via `@rule`).
   */
  async buildInjection(workspaceRoot: string, contextFiles: string[]): Promise<string> {
    const rules = await this.list(workspaceRoot);
    if (rules.length === 0) return '';

    const always = rules.filter((r) => r.mode === 'always');
    const normalized = contextFiles.map((f) => f.replace(/\\/g, '/').replace(/^\/+/, ''));
    const globMatched = rules.filter((r) => {
      if (r.mode !== 'glob' || r.globs.length === 0) return false;
      const matcher = buildIgnoreMatcher(r.globs);
      return normalized.some((f) => matcher(f));
    });
    const modelDecisions = rules.filter((r) => r.mode === 'model-decision');

    const sections: string[] = [];
    if (always.length > 0) {
      const blocks: string[] = [];
      for (const r of always) {
        const body = await this.bodyOf(workspaceRoot, r.name);
        if (body) blocks.push(`### ${r.title || r.name}\n${body}`);
      }
      if (blocks.length) sections.push(`[PROJECT RULES — ALWAYS]\n${blocks.join('\n\n')}`);
    }

    if (globMatched.length > 0) {
      const blocks: string[] = [];
      for (const r of globMatched) {
        const body = await this.bodyOf(workspaceRoot, r.name);
        if (body) blocks.push(`### ${r.title || r.name} (matches ${r.globs.join(', ')})\n${body}`);
      }
      if (blocks.length) sections.push(`[PROJECT RULES — MATCHING CURRENT FILES]\n${blocks.join('\n\n')}`);
    }

    if (modelDecisions.length > 0) {
      const catalog = modelDecisions.map((r) => `- ${r.name}: ${r.description || r.title}`).join('\n');
      sections.push(
        `[PROJECT RULES — AVAILABLE ON DEMAND]\n` +
          `These project rules are relevant but not yet loaded. Call the \`load_rule\` tool with the rule ` +
          `name to read a rule's full guidance before making related changes.\n${catalog}`
      );
    }

    return sections.join('\n\n');
  }

  /** Settings tester: which rules would fire for a single file path. */
  async testFile(workspaceRoot: string, filePath: string): Promise<RuleTestResult> {
    const rules = await this.list(workspaceRoot);
    const rel = filePath.replace(/\\/g, '/').replace(/^\/+/, '');
    const fired: FiredRule[] = [];
    for (const r of rules) {
      if (r.mode === 'always') {
        fired.push({ rule: r, reason: 'always' });
      } else if (r.mode === 'glob') {
        const matcher = buildIgnoreMatcher(r.globs);
        if (r.globs.length > 0 && matcher(rel)) fired.push({ rule: r, reason: 'glob-match' });
      } else if (r.mode === 'model-decision') {
        fired.push({ rule: r, reason: 'model-decision' });
      }
    }
    return { filePath: rel, fired };
  }

  // ---------------------------------------------------------------- internals

  private async bodyOf(workspaceRoot: string, name: string): Promise<string | null> {
    const rule = await this.read(workspaceRoot, name);
    return rule ? rule.body : null;
  }

  private async ruleFiles(workspaceRoot: string): Promise<string[]> {
    const dir = this.rulesDir(workspaceRoot);
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return [];
    }
    return entries
      .filter((e) => e.toLowerCase().endsWith('.md'))
      .slice(0, RULES_MAX_FILES)
      .map((e) => path.posix.join(RULES_DIR, e));
  }

  private async readRuleFile(workspaceRoot: string, rel: string): Promise<RuleFile | null> {
    const abs = path.join(path.resolve(workspaceRoot), rel);
    let raw: string;
    try {
      const stat = await fsp.stat(abs);
      if (!stat.isFile() || stat.size > RULE_MAX_BYTES) return null;
      raw = await fsp.readFile(abs, 'utf-8');
    } catch {
      return null;
    }
    const { fields, body } = parseFrontmatter(raw);
    const mode = VALID_MODES.has(fields.mode as RuleMode) ? (fields.mode as RuleMode) : 'manual';
    const name = this.fileNameToSlug(rel);
    return {
      name,
      file: rel,
      title: fields.title || deriveTitle(body, name),
      description: fields.description || firstLine(body),
      mode,
      globs: fields.globs,
      body
    };
  }
}

function stripBody(rule: RuleFile): RuleMeta {
  return { name: rule.name, file: rule.file, title: rule.title, description: rule.description, mode: rule.mode, globs: rule.globs };
}

function deriveTitle(body: string, fallback: string): string {
  const heading = body.match(/^\s*#\s+(.+)$/m);
  return heading ? heading[1].trim().slice(0, 200) : fallback;
}

function firstLine(body: string): string {
  const line = body.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#'));
  return (line || '').trim().slice(0, 500);
}

interface FrontmatterFields {
  mode: string;
  title: string;
  description: string;
  globs: string[];
}

/**
 * Minimal, dependency-free frontmatter parser supporting the rule header subset:
 *   mode: glob
 *   title: "..."            description: '...'
 *   globs: ["a", "b"]       globs:\n  - a\n  - b
 * A document without a leading `---` block is treated as body-only (mode absent).
 */
export function parseFrontmatter(raw: string): { fields: FrontmatterFields; body: string } {
  const fields: FrontmatterFields = { mode: '', title: '', description: '', globs: [] };
  if (!raw.startsWith('---')) return { fields, body: raw.trim() };

  const end = raw.indexOf('\n---', 3);
  if (end === -1) return { fields, body: raw.trim() };

  const header = raw.slice(3, end).replace(/^\r?\n/, '');
  const body = raw.slice(end + 4).replace(/^\r?\n/, '').trim();
  const lines = header.split(/\r?\n/);

  let inGlobsList = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // Sequence items under a `globs:` key (2-space or more indentation).
    if (inGlobsList && /^-\s+/.test(trimmed)) {
      fields.globs.push(unquote(trimmed.slice(1).trim()));
      continue;
    }
    inGlobsList = false;

    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === 'mode') {
      fields.mode = unquote(value).toLowerCase();
    } else if (key === 'title') {
      fields.title = unquote(value);
    } else if (key === 'description') {
      fields.description = unquote(value);
    } else if (key === 'globs') {
      if (value.startsWith('[')) {
        fields.globs = parseInlineArray(value);
      } else if (value === '') {
        inGlobsList = true;
      } else {
        fields.globs = [unquote(value)];
      }
    }
  }

  return { fields, body };
}

function parseInlineArray(value: string): string[] {
  const inner = value.replace(/^\[/, '').replace(/\]$/, '').trim();
  if (!inner) return [];
  return inner
    .split(',')
    .map((s) => unquote(s.trim()))
    .filter((s) => s.length > 0);
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    return value.slice(1, -1);
  }
  return value;
}

export const rulesService = new RulesService();
