/**
 * Stage 2a — Zod tool-argument schemas, the single source of truth for tool
 * argument CORRECTNESS.
 *
 * Each data-manipulating tool declares a Zod schema here. The Agentic loop
 * validates arguments AFTER alias normalisation and BEFORE execution, so the
 * model receives a structured, machine-readable `invalid_arguments` refusal
 * instead of a downstream tool error. Schemas fold the tolerated alias families
 * (e.g. `path`→`filePath`, `old_str`/`searchText`→`targetContent`) onto the
 * canonical executor field names, matching Stage 1c.
 *
 * Tools with no schema listed here are passed through unvalidated (control-flow
 * and zero-arg tools), so this registry never rejects a legitimate call.
 *
 * Brand: Ty-Code
 */

import { z } from 'zod';

/** Structured refusal returned to the model when arguments fail validation. */
export interface InvalidToolArguments {
  status: 'invalid_arguments';
  tool: string;
  expected: unknown;
  received: Record<string, unknown>;
  hint: string;
}

export type ToolArgumentValidation =
  | { valid: true; args: Record<string, unknown> }
  | { valid: false; error: InvalidToolArguments };

type Args = Record<string, unknown>;

/** Copy `to` from the first defined key in `froms` when `to` is absent. */
function fold(args: Args, to: string, froms: string[]): Args {
  if (args[to] === undefined) {
    for (const from of froms) {
      if (args[from] !== undefined) {
        args[to] = args[from];
        break;
      }
    }
  }
  return args;
}

const stringOrUndefined = z.string().optional();
const integerOrUndefined = z.number().int().optional();

/** Per-tool canonical argument schema. Preprocessing folds aliases first. */
export const TOOL_ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  read_file: z.preprocess(
    (raw) => fold({ ...(raw as Args) }, 'filePath', ['path', 'file', 'filename']),
    z.object({ filePath: z.string().min(1), startLine: integerOrUndefined, endLine: integerOrUndefined }).passthrough()
  ),
  write_file: z.preprocess(
    (raw) => fold({ ...(raw as Args) }, 'filePath', ['path', 'file', 'filename']),
    z.object({ filePath: z.string().min(1), content: z.string() }).passthrough()
  ),
  replace_file_content: z.preprocess(
    (raw) => {
      const a = fold({ ...(raw as Args) }, 'filePath', ['path', 'file', 'filename']);
      fold(a, 'targetContent', ['searchText', 'old_str', 'oldString', 'oldContent', 'search']);
      fold(a, 'replacementContent', ['replaceText', 'new_str', 'newString', 'newContent', 'replace']);
      return a;
    },
    z.object({ filePath: z.string().min(1), targetContent: z.string().min(1), replacementContent: z.string() }).passthrough()
  ),
  run_command: z.preprocess(
    (raw) => fold({ ...(raw as Args) }, 'command', ['cmd', 'script', 'shell']),
    z.object({ command: z.string().min(1), cwd: stringOrUndefined, timeoutMs: integerOrUndefined }).passthrough()
  ),
  list_dir: z.preprocess(
    (raw) => {
      const a = fold({ ...(raw as Args) }, 'directoryPath', ['directoryPath', 'dirPath', 'path', 'directory', 'dir', 'folder', 'target']);
      return a;
    },
    z.object({ directoryPath: stringOrUndefined, recursive: z.boolean().optional() }).passthrough()
  ),
  grep_search: z.preprocess(
    (raw) => fold({ ...(raw as Args) }, 'query', ['query', 'pattern', 'regex', 'search']),
    z.object({ query: z.string().min(1), isRegex: z.boolean().optional(), caseInsensitive: z.boolean().optional() }).passthrough()
  ),
  semantic_search: z.object({ query: z.string().min(1), limit: z.number().optional() }).passthrough(),
  load_rule: z.object({ name: z.string().min(1) }).passthrough(),
  git_commit: z.object({ message: z.string().min(1) }).passthrough(),
  git_log: z.object({ filePath: stringOrUndefined, limit: z.number().optional() }).passthrough(),
  git_diff: z.object({ filePath: stringOrUndefined, staged: z.boolean().optional() }).passthrough()
};

/**
 * Validate tool arguments against the canonical schema. Returns the
 * (alias-folded) args on success, or a structured `invalid_arguments` error on
 * failure. A tool with no registered schema is always valid (pass-through).
 */
export function validateToolArguments(name: string, args: Args): ToolArgumentValidation {
  const schema = TOOL_ARG_SCHEMAS[name];
  if (!schema) return { valid: true, args };
  const result = schema.safeParse(args ?? {});
  if (result.success) {
    return { valid: true, args: result.data as Args };
  }
  const hint = result.error.issues
    .map((issue) => `${issue.path.join('.') || name}: ${issue.message}`)
    .join('; ');
  return {
    valid: false,
    error: {
      status: 'invalid_arguments',
      tool: name,
      expected: toolExpectedShape(name),
      received: (args ?? {}) as Args,
      hint
    }
  };
}

/** A compact, human/LLM-readable description of expected fields for a tool. */
export function toolExpectedShape(name: string): unknown {
  const schema = TOOL_ARG_SCHEMAS[name];
  if (!schema) return { note: 'no argument schema; arguments passed through' };
  try {
    // zod v4 exposes a toJSON for many types; fall back to the raw type marker.
    const json = (schema as unknown as { toJSON?: () => unknown }).toJSON?.();
    if (json) return json;
  } catch {
    // ignore and fall through
  }
  return { tool: name };
}
