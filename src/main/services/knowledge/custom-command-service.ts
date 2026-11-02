/**
 * Prompt E (Step 3) — custom command loader/renderer.
 *
 * Discovers Markdown command templates in the two `.tycode/commands/` scopes
 * (project-local, git-shareable — and the user's home directory; project wins
 * on a name clash) and renders them with `$ARGUMENTS` / `{name}` /
 * `{name:default}` substitution. Deliberately Electron-free and network-free:
 * plain node:fs over user-authored files, string substitution with no eval.
 */

import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  COMMANDS_DIR,
  type CustomCommand,
  type CustomCommandArgDef
} from '../../../shared/types/custom-commands';

const COMMANDS_MAX_FILES = 100;
const COMMAND_MAX_BYTES = 64 * 1024;
/** {name} or {name:default}; name must be a lowercase token, no nested braces. */
const PLACEHOLDER_SOURCE = '\\{([a-z][a-z0-9_-]{0,79})(?::([^{}\\n]{0,400}))?\\}';
const PLACEHOLDER_REGEX = new RegExp(PLACEHOLDER_SOURCE, 'g');
const TOKEN_REGEX = new RegExp(PLACEHOLDER_SOURCE, '');
const ARGUMENTS_TOKEN = '$ARGUMENTS';

/** Render error carrying the placeholders still missing values (for prompting). */
export class MissingArgumentsError extends Error {
  readonly missing: string[];
  constructor(missing: string[]) {
    super(`Missing value(s) for: ${missing.map((m) => `{${m}}`).join(', ')}`);
    this.name = 'MissingArgumentsError';
    this.missing = missing;
  }
}

interface ParsedTemplate {
  body: string;
  description: string;
  /** Declared placeholders in first-appearance order. */
  args: CustomCommandArgDef[];
  takesAllArguments: boolean;
}

class CustomCommandService {
  private slugToFileName(name: string): string {
    const clean = name.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '');
    return `${clean || 'command'}.md`;
  }

  /** Project + user command entries; project scope wins on name clash. */
  async list(workspacePath: string): Promise<CustomCommand[]> {
    const byName = new Map<string, CustomCommand>();
    const userDir = path.join(os.homedir(), '.tycode', 'commands');
    for (const entry of await this.scanDir(userDir, 'user', '~/.tycode/commands')) {
      byName.set(entry.name, entry);
    }
    if (workspacePath) {
      const projectDir = path.join(path.resolve(workspacePath), COMMANDS_DIR);
      for (const entry of await this.scanDir(projectDir, 'project', COMMANDS_DIR)) {
        byName.set(entry.name, entry);
      }
    }
    return [...byName.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  /**
   * Substitute a command body. Explicit `args` win over positional values
   * split from `rawArgs`, which win over in-template defaults. A `{name}`
   * with no value anywhere throws MissingArgumentsError — never a silent
   * empty substitution.
   */
  async render(workspacePath: string, name: string, rawArgs: string, args?: Record<string, string>): Promise<string> {
    const template = await this.find(workspacePath, name);
    if (!template) throw new Error(`No custom command named "${name}" (checked .tycode/commands in the project and your home directory).`);
    const body = template.body;

    // Positional mapping: bare tokens in declaration order; a trailing
    // $ARGUMENTS token receives whatever the named slots did not consume.
    const positional: Record<string, string> = {};
    const supplied = splitArgs(rawArgs);
    for (let i = 0; i < template.args.length; i++) {
      if (supplied[i] !== undefined) positional[template.args[i].name] = supplied[i];
    }
    const leftover = supplied.slice(template.args.length).join(' ');

    const missing: string[] = [];
    let prompt = body.replace(new RegExp(`\\$ARGUMENTS|${PLACEHOLDER_SOURCE}`, 'g'), (token, argName?: string, defaultValue?: string) => {
      if (token === ARGUMENTS_TOKEN || argName === undefined) {
        return rawArgs.trim() || leftover;
      }
      const explicit = args?.[argName];
      const positionalValue = positional[argName];
      if (explicit !== undefined && explicit !== '') return explicit;
      if (positionalValue !== undefined) return positionalValue;
      if (defaultValue !== undefined) return defaultValue;
      if (!missing.includes(argName)) missing.push(argName);
      return token;
    });
    if (missing.length > 0) throw new MissingArgumentsError(missing);
    return prompt.trim();
  }

  // ------------------------------------------------------------------ internals

  private async find(workspacePath: string, name: string): Promise<(ParsedTemplate & { scope: 'project' | 'user' }) | null> {
    // Project scope first: a project command shadows the user's own by name.
    for (const scope of ['project', 'user'] as const) {
      const dir = scope === 'project'
        ? (workspacePath ? path.join(path.resolve(workspacePath), COMMANDS_DIR) : '')
        : path.join(os.homedir(), '.tycode', 'commands');
      if (!dir) continue;
      const parsed = await this.readCommandFile(path.join(dir, this.slugToFileName(name)), scope);
      if (parsed) return parsed;
    }
    return null;
  }

  private async scanDir(dir: string, scope: 'project' | 'user', displayPrefix: string): Promise<CustomCommand[]> {
    let entries: string[];
    try {
      entries = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const commands: CustomCommand[] = [];
    for (const file of entries.filter((e) => e.toLowerCase().endsWith('.md')).slice(0, COMMANDS_MAX_FILES)) {
      const parsed = await this.readCommandFile(path.join(dir, file), scope);
      if (!parsed) continue;
      const name = file.replace(/\.md$/i, '').toLowerCase();
      commands.push({
        name,
        description: parsed.description,
        scope,
        file: `${displayPrefix}/${file}`,
        args: parsed.args,
        takesAllArguments: parsed.takesAllArguments
      });
    }
    return commands;
  }

  private async readCommandFile(abs: string, scope: 'project' | 'user'): Promise<(ParsedTemplate & { scope: 'project' | 'user' }) | null> {
    let raw: string;
    try {
      const stat = await fsp.stat(abs);
      if (!stat.isFile() || stat.size > COMMAND_MAX_BYTES) return null;
      raw = await fsp.readFile(abs, 'utf-8');
    } catch {
      return null;
    }
    const { frontmatter, body } = splitFrontmatter(raw);
    const description = frontmatter.description || firstProseLine(body);
    const declaredOrder = parseArgumentOrder(body);
    // Frontmatter `arguments:` can attach descriptions to declared placeholders.
    const fmArgs = parseFrontmatterArgs(frontmatter.argumentsRaw);
    const args: CustomCommandArgDef[] = [];
    for (const token of declaredOrder) {
      const extra = fmArgs.find((a) => a.name === token.name);
      args.push({
        name: token.name,
        ...(token.default !== undefined ? { defaultValue: token.default } : extra?.defaultValue !== undefined ? { defaultValue: extra.defaultValue } : {}),
        ...(extra?.description ? { description: extra.description } : {})
      });
    }
    return {
      body,
      description,
      args,
      takesAllArguments: body.includes(ARGUMENTS_TOKEN),
      scope
    };
  }
}

// ---------------------------------------------------------------------------
// Parsing helpers (dependency-free, like the rules frontmatter parser)
// ---------------------------------------------------------------------------

function splitFrontmatter(raw: string): { frontmatter: { description: string; argumentsRaw: string[] }; body: string } {
  const empty = { frontmatter: { description: '', argumentsRaw: [] as string[] }, body: raw.trim() };
  if (!raw.startsWith('---')) return empty;
  const end = raw.indexOf('\n---', 3);
  if (end === -1) return empty;
  const header = raw.slice(3, end).replace(/^\r?\n/, '');
  const body = raw.slice(end + 4).replace(/^\r?\n/, '').trim();

  let description = '';
  const argumentsRaw: string[] = [];
  const lines = header.split(/\r?\n/);
  let inArgsBlock = false;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (inArgsBlock && /^-\s+/.test(trimmed)) {
      argumentsRaw.push(trimmed.slice(1).trim());
      continue;
    }
    inArgsBlock = false;
    const keyMatch = /^([A-Za-z_][A-Za-z0-9_-]*)\s*:\s*(.*)$/.exec(trimmed);
    if (!keyMatch) continue;
    const key = keyMatch[1].toLowerCase();
    const rest = keyMatch[2].trim();
    if (key === 'description') {
      description = unquote(rest);
    } else if (key === 'arguments') {
      if (rest.startsWith('[')) {
        argumentsRaw.push(...splitInlineList(rest));
      } else if (rest === '' || rest === '|') {
        inArgsBlock = true;
      }
    }
  }
  return { frontmatter: { description, argumentsRaw }, body };
}

/** Ordered, deduplicated `{name}`/`{name:default}` tokens found in the body. */
function parseArgumentOrder(body: string): Array<{ name: string; default?: string }> {
  const out: Array<{ name: string; default?: string }> = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(PLACEHOLDER_REGEX)) {
    const token = TOKEN_REGEX.exec(match[0]);
    if (!token) continue;
    const name = token[1];
    const def = token[2];
    if (seen.has(name)) continue;
    seen.add(name);
    out.push(def !== undefined ? { name, default: def } : { name });
  }
  return out;
}

/** Frontmatter argument items: `branch`, `{name: branch}`, `branch=main`. */
function parseFrontmatterArgs(items: string[]): CustomCommandArgDef[] {
  const out: CustomCommandArgDef[] = [];
  for (const item of items) {
    const text = unquote(item);
    if (!text) continue;
    // Wrapped token form: {branch:main} or {branch}
    const token = /^\{([a-z][a-z0-9_-]{0,79})(?::([^{}]*))?\}$/.exec(text);
    if (token) {
      out.push(token[2] !== undefined ? { name: token[1], defaultValue: token[2] } : { name: token[1] });
      continue;
    }
    // name=default form
    const eq = /^([a-z][a-z0-9_-]{0,79})=(.*)$/.exec(text);
    if (eq) {
      out.push({ name: eq[1], defaultValue: eq[2] });
      continue;
    }
    // Bare name, optionally "name: description"
    const colon = /^([a-z][a-z0-9_-]{0,79}):\s*(.+)$/.exec(text);
    if (colon) {
      out.push({ name: colon[1], description: colon[2].trim() });
      continue;
    }
    const bare = /^([a-z][a-z0-9_-]{0,79})$/.exec(text);
    if (bare) out.push({ name: bare[1] });
  }
  return out;
}

/** Split the raw argument string: whitespace-separated, "quoted groups" kept whole. */
export function splitArgs(raw: string): string[] {
  const out: string[] = [];
  const regex = /"([^"]*)"|(\S+)/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(raw)) !== null) {
    out.push(match[1] !== undefined ? match[1] : match[2]);
  }
  return out;
}

function splitInlineList(rest: string): string[] {
  return rest
    .replace(/^\[|\]$/g, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function unquote(value: string): string {
  const quoted = /^(["'])(.*)\1$/.exec(value.trim());
  return quoted ? quoted[2] : value.trim();
}

function firstProseLine(body: string): string {
  const line = body.split(/\r?\n/).find((l) => l.trim() && !l.trim().startsWith('#'));
  return (line || body).trim().slice(0, 120);
}

export const customCommandService = new CustomCommandService();
