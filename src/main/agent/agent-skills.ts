import fs from 'fs/promises';
import os from 'os';
import path from 'path';

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  trigger: string | RegExp;
  systemPrompt: string;
  tools: string[];
  examples: Array<{ input: string; output: string }>;
}

const CUSTOM_SKILLS_FILE = path.join(os.homedir(), '.tycode', 'skills.json');
const REGEX_TRIGGER_PREFIX = 'regex:';

export const BUILTIN_SKILLS: AgentSkill[] = [
  {
    id: 'code-review',
    name: 'Code Reviewer',
    description: 'Performs comprehensive code reviews with security and performance analysis',
    trigger: /review|audit|analyze code/i,
    systemPrompt: 'You are a senior code reviewer. Focus on: 1) Security vulnerabilities 2) Performance bottlenecks 3) Code style consistency 4) Potential bugs. Provide specific line numbers and actionable fixes.',
    tools: ['read_file', 'grep_search', 'list_dir'],
    examples: [
      {
        input: 'Review src/main/index.ts for security issues',
        output: 'Reads the file, flags unsafe IPC handlers and missing input validation with exact line numbers, then lists minimal fixes per finding.'
      },
      {
        input: 'Audit the authentication flow for vulnerabilities',
        output: 'Greps auth-related code paths, traces each entry point, and reports missing permission checks and hardcoded secrets with remediation steps.'
      }
    ]
  },
  {
    id: 'test-generator',
    name: 'Test Generator',
    description: 'Generates comprehensive test suites for code',
    trigger: /test|spec|coverage/i,
    systemPrompt: "You are a QA engineer. Generate tests that cover: 1) Happy paths 2) Edge cases 3) Error handling 4) Boundary conditions. Use the project's existing test framework.",
    tools: ['read_file', 'write_file', 'run_command'],
    examples: [
      {
        input: 'Write tests for the session store module',
        output: 'Reads the module, detects the existing test runner config, creates a spec file covering save/load/expiry/cleanup paths including edge cases, and runs the suite.'
      },
      {
        input: 'Increase test coverage for context-compactor',
        output: 'Analyzes uncovered branches, adds targeted cases for tool-call pairing and truncation, and reports the measured coverage delta.'
      }
    ]
  },
  {
    id: 'refactor',
    name: 'Code Refactorer',
    description: 'Refactors code for better maintainability and performance',
    trigger: /refactor|optimize|clean up/i,
    systemPrompt: 'You are a refactoring expert. Apply SOLID principles, remove code duplication, improve naming, and optimize performance. Always preserve existing functionality.',
    tools: ['read_file', 'write_file', 'replace_file_content'],
    examples: [
      {
        input: 'Refactor the provider gateway to reduce duplication',
        output: 'Reads the gateway, extracts repeated request-shaping logic into shared helpers, applies precise content replacements, and preserves all public APIs.'
      },
      {
        input: 'Clean up the chat store state actions',
        output: 'Groups related state updates, removes dead branches, renames ambiguous actions, and verifies typecheck still passes with no behavior change.'
      }
    ]
  }
];

function isBuiltinSkill(skill: AgentSkill): boolean {
  return BUILTIN_SKILLS.some((builtin) => builtin.id === skill.id);
}

function compileTrigger(triggerValue: unknown): RegExp | string | null {
  if (typeof triggerValue === 'string' && triggerValue.length > 0) {
    if (triggerValue.startsWith(REGEX_TRIGGER_PREFIX)) {
      try {
        return new RegExp(triggerValue.slice(REGEX_TRIGGER_PREFIX.length));
      } catch {
        return null;
      }
    }
    return triggerValue;
  }
  return null;
}

function normalizeSkillEntry(entry: any): AgentSkill | null {
  if (!entry || typeof entry !== 'object') return null;
  const id = typeof entry.id === 'string' && entry.id.trim() ? entry.id.trim() : '';
  const name = typeof entry.name === 'string' && entry.name.trim() ? entry.name.trim() : '';
  const description = typeof entry.description === 'string' ? entry.description : '';
  const systemPrompt = typeof entry.systemPrompt === 'string' && entry.systemPrompt.length > 0 ? entry.systemPrompt : '';
  const tools = Array.isArray(entry.tools) ? entry.tools.filter((tool: unknown): tool is string => typeof tool === 'string') : [];
  const trigger = compileTrigger(entry.trigger);
  const examples = Array.isArray(entry.examples)
    ? entry.examples
        .filter((example: any) => example && typeof example === 'object'
          && typeof example.input === 'string' && typeof example.output === 'string')
        .map((example: { input: string; output: string }) => ({ input: example.input, output: example.output }))
    : [];
  if (!id || !name || !systemPrompt || !trigger) return null;
  return { id, name, description, trigger, systemPrompt, tools, examples };
}

async function readCustomSkillsFile(filePath: string): Promise<AgentSkill[]> {
  try {
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    const skills: AgentSkill[] = [];
    for (const entry of parsed) {
      const normalized = normalizeSkillEntry(entry);
      if (normalized) skills.push(normalized);
    }
    return skills;
  } catch {
    return [];
  }
}

export class AgentSkillRegistry {
  private builtinSkills: AgentSkill[] = [...BUILTIN_SKILLS];
  private customSkills: AgentSkill[] = [];
  private loadedKey = '';

  listSkills(): AgentSkill[] {
    return [...this.builtinSkills, ...this.customSkills];
  }

  addSkill(skill: AgentSkill): void {
    if (isBuiltinSkill(skill)) return;
    const index = this.customSkills.findIndex((existing) => existing.id === skill.id);
    if (index >= 0) this.customSkills.splice(index, 1);
    this.customSkills.push(skill);
  }

  removeSkill(id: string): void {
    const index = this.customSkills.findIndex((skill) => skill.id === id);
    if (index >= 0) this.customSkills.splice(index, 1);
  }

  detectSkill(userMessage: string): AgentSkill | null {
    const message = userMessage || '';
    for (const skill of this.listSkills()) {
      if (typeof skill.trigger === 'string') {
        if (message.toLowerCase().includes(skill.trigger.toLowerCase())) return skill;
      } else if (skill.trigger.test(message)) {
        return skill;
      }
    }
    return null;
  }

  activateSkill(skill: AgentSkill): string {
    return `\n\n## Active Skill: ${skill.name}\n${skill.systemPrompt}\n\nUse these tools: ${skill.tools.join(', ')}`;
  }

  async ensureSkillsLoaded(workspacePath: string): Promise<void> {
    const workspaceFile = path.resolve(workspacePath, '.tycode-skills.json');
    const stamps: number[] = [];
    for (const file of [CUSTOM_SKILLS_FILE, workspaceFile]) {
      try {
        const stat = await fs.stat(file);
        stamps.push(stat.mtimeMs);
      } catch {
        stamps.push(-1);
      }
    }
    const stampKey = `${workspacePath}|${stamps.join('|')}`;
    if (stampKey === this.loadedKey) return;
    const globalCustom = await readCustomSkillsFile(CUSTOM_SKILLS_FILE);
    const workspaceCustom = await readCustomSkillsFile(workspaceFile);
    this.customSkills = [...globalCustom, ...workspaceCustom];
    this.loadedKey = stampKey;
  }

  async readSkillsDigest(): Promise<Array<{ id: string; name: string; description: string; tools: string[]; source: 'builtin' | 'custom' }>> {
    return this.listSkills().map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      tools: skill.tools.slice(0, 6),
      source: isBuiltinSkill(skill) ? 'builtin' : 'custom'
    }));
  }
}

export const skillRegistry = new AgentSkillRegistry();
