/**
 * Prompt C Step 2 — Rules engine shared contract.
 *
 * Rules are lightweight, git-shareable Markdown files living in the
 * PROJECT-LOCAL `.tycode/rules/` directory. Each file carries a small frontmatter
 * header declaring how/when it is injected:
 *
 *   mode: always         → body is appended to the system prompt on every task
 *   mode: glob           → body is injected when a matching file enters context
 *   mode: model-decision → only the DESCRIPTION is listed; the model pulls the full
 *                          body on demand through the `load_rule` tool
 *   mode: manual         → injected only when the user references it via `@rule`
 *
 * `globs: []` (array of workspace-relative glob patterns) governs `glob` rules and
 * is meaningless for the other modes. Nothing here imports Electron.
 */

import { z } from 'zod';

export const RULES_INDEX_VERSION = 1 as const;

/** Workspace-relative directory holding user-authored, git-shareable rule files. */
export const RULES_DIR = '.tycode/rules';

export const RuleModeSchema = z.enum(['always', 'manual', 'model-decision', 'glob']);
export type RuleMode = z.infer<typeof RuleModeSchema>;

export const RuleMetaSchema = z.object({
  /** Stable slug derived from the file stem (used by `@rule` + `load_rule`). */
  name: z.string().min(1).max(120),
  /** Path relative to the workspace root (POSIX), e.g. `.tycode/rules/react.md`. */
  file: z.string().max(4096),
  title: z.string().max(200),
  /** One-line summary; shown in the model-decision catalog. */
  description: z.string().max(500),
  mode: RuleModeSchema,
  /** Glob patterns; only consulted for `mode: glob`. */
  globs: z.array(z.string().max(512)).max(64).default([])
});
export type RuleMeta = z.infer<typeof RuleMetaSchema>;

/** A rule file with its Markdown body (frontmatter stripped). */
export const RuleFileSchema = RuleMetaSchema.extend({
  body: z.string().max(64_000)
});
export type RuleFile = z.infer<typeof RuleFileSchema>;

/* --------------------------------------------------------------- IPC ------- */

export const RULE_CHANNELS = {
  list: 'rules:list',
  read: 'rules:read',
  save: 'rules:save',
  remove: 'rules:remove',
  /** Settings tester: which rules fire for a given file path. */
  test: 'rules:test'
} as const;

export const RulesListRequestSchema = z
  .object({ workspaceRoot: z.string().min(1).max(4096) })
  .strict();
export type RulesListRequest = z.infer<typeof RulesListRequestSchema>;

export const ReadRuleRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    name: z.string().min(1).max(120)
  })
  .strict();
export type ReadRuleRequest = z.infer<typeof ReadRuleRequestSchema>;

export const SaveRuleRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    name: z.string().min(1).max(120),
    title: z.string().max(200).default(''),
    description: z.string().max(500).default(''),
    mode: RuleModeSchema,
    globs: z.array(z.string().max(512)).max(64).default([]),
    body: z.string().max(64_000)
  })
  .strict();
export type SaveRuleRequest = z.infer<typeof SaveRuleRequestSchema>;

export const DeleteRuleRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    name: z.string().min(1).max(120)
  })
  .strict();
export type DeleteRuleRequest = z.infer<typeof DeleteRuleRequestSchema>;

export const TestRuleRequestSchema = z
  .object({
    workspaceRoot: z.string().min(1).max(4096),
    filePath: z.string().min(1).max(4096)
  })
  .strict();
export type TestRuleRequest = z.infer<typeof TestRuleRequestSchema>;

/** A rule that fired, with the reason (used by the Settings tester). */
export const FiredRuleSchema = z.object({
  rule: RuleMetaSchema,
  reason: z.enum(['always', 'glob-match', 'model-decision', 'manual'])
});
export type FiredRule = z.infer<typeof FiredRuleSchema>;

export const RuleTestResultSchema = z.object({
  filePath: z.string().max(4096),
  fired: z.array(FiredRuleSchema)
});
export type RuleTestResult = z.infer<typeof RuleTestResultSchema>;
