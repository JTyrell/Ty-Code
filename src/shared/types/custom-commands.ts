/**
 * Prompt E (Step 3) — custom commands shared contract.
 *
 * User- and project-authored Markdown command templates living in
 * `.tycode/commands/*.md` (project scope, git-shareable) and
 * `~/.tycode/commands/*.md` (user scope; project entries win on name clash).
 * Bodies support two substitution syntaxes:
 *
 *   $ARGUMENTS        → the whole raw argument string
 *   {name}            → the positional/named argument `name`
 *   {name:default}    → same, with a default used when the argument is absent
 *
 * Rendering is done main-side (never with eval) so the / menu, the palette,
 * and the chat submit path all substitute identically. Nothing here imports
 * Electron.
 */

import { z } from 'zod';

/** Workspace-relative directory holding project command templates. */
export const COMMANDS_DIR = '.tycode/commands';

export const CustomCommandScopeSchema = z.enum(['project', 'user']);
export type CustomCommandScope = z.infer<typeof CustomCommandScopeSchema>;

export const CustomCommandArgDefSchema = z.object({
  /** Placeholder name, e.g. `branch` for `{branch}`. */
  name: z.string().min(1).max(80),
  /** Value used when the caller did not supply this argument. */
  defaultValue: z.string().max(400).optional(),
  description: z.string().max(400).optional()
});
export type CustomCommandArgDef = z.infer<typeof CustomCommandArgDefSchema>;

export const CustomCommandSchema = z.object({
  /** Slug from the file stem; invoked as `/<name>`. */
  name: z.string().min(1).max(120),
  /** Display description: frontmatter `description` or the first body line. */
  description: z.string().max(500),
  scope: CustomCommandScopeSchema,
  /** Path of the file as displayed (workspace-relative POSIX, or `~/…`). */
  file: z.string().max(4096),
  /** Declared placeholders in first-appearance order (drives prompts/positions). */
  args: z.array(CustomCommandArgDefSchema).max(32).default([]),
  /** True when the body references $ARGUMENTS. */
  takesAllArguments: z.boolean().default(false)
});
export type CustomCommand = z.infer<typeof CustomCommandSchema>;

// ---------------------------------------------------------------------------
// Requests (every IPC body is strict-parsed)
// ---------------------------------------------------------------------------

export const CustomCommandsListRequestSchema = z
  .object({ workspacePath: z.string().min(1) })
  .strict();

const CommandNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9][a-z0-9._-]*$/, 'Command names must be lowercase slugs');

export const CustomCommandRenderRequestSchema = z
  .object({
    workspacePath: z.string().min(1),
    name: CommandNameSchema,
    /** Raw string typed after `/name `, split positionally at render time. */
    rawArgs: z.string().max(8000).default(''),
    /** Explicit per-placeholder values; win over positional rawArgs. */
    args: z.record(z.string().max(80), z.string().max(2000)).optional()
  })
  .strict();

export const CustomCommandRenderResultSchema = z.object({
  name: CommandNameSchema,
  /** The fully substituted prompt, ready to send to the agent. */
  prompt: z.string().min(1).max(64_000)
});
export type CustomCommandRenderResult = z.infer<typeof CustomCommandRenderResultSchema>;

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export const CUSTOM_COMMAND_CHANNELS = {
  list: 'customCommands:list',
  render: 'customCommands:render'
} as const;
