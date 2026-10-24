/**
 * Ty-Code Dynamic System Prompt Assembler — Schemas (Zod)
 *
 * Zod-validated contracts for every IPC boundary and cached-JSON read.
 * Zero runtime assumptions: anything crossing a process or disk boundary
 * is parsed through these schemas first.
 */

import { z } from 'zod';

/* ---------------------------------------------------------------- Role / Mode types */

export type RoleId =
  | 'fullstack' | 'frontend' | 'backend' | 'devops' | 'data' | 'refactor' | 'qa' | 'security' | 'debug'
  | 'review' | 'git' | 'release' | 'docs' | 'performance' | 'observability' | 'architecture'
  | 'codemod' | 'supply-chain' | 'integration' | 'ml' | 'mobile' | 'systems' | 'i18n' | 'devex'
  | 'ai-feature' | 'mentor'
  | 'game' | 'blockchain' | 'data-eng' | 'legal';

export type ToolScope = 'all' | 'read-only' | 'docs-only';
export type ModeId = 'BUILD' | 'REVIEW' | 'EXPLAIN' | 'DESIGN' | 'SHIP';
export type TaskClass = 'Trivial' | 'Small' | 'Medium' | 'Large' | 'Epic';
export type ProfileStatus = 'full' | 'minimal';

/* ---------------------------------------------------------------- Project Profile (Layer 1) */

export const ProjectProfileSchema = z.object({
  name: z.string().default('untitled'),
  languages: z.array(z.string()).default([]),
  frameworks: z.array(z.string()).default([]),
  pkgManager: z.enum(['npm', 'pnpm', 'yarn', 'uv', 'cargo', 'go', 'composer', 'gradle', 'maven']).optional(),
  testRunner: z.string().optional(),
  lintFormat: z.string().optional(),
  buildTool: z.string().optional(),
  repoLayout: z.string().default(''),
  deployTargets: z.array(z.string()).default([]),
  ciSummary: z.string().default(''),
  manifestHash: z.string(),
  profileStatus: z.enum(['full', 'minimal']).default('full')
});
export type ProjectProfile = z.infer<typeof ProjectProfileSchema>;

export const MinimalProfileSchema = ProjectProfileSchema.extend({
  profileStatus: z.literal('minimal')
});
export type MinimalProfile = z.infer<typeof MinimalProfileSchema>;

/* ---------------------------------------------------------------- Conventions Summary (Layer 4) */

export const ConventionsSummarySchema = z.object({
  fileNaming: z.string().default(''),
  importStyle: z.string().default(''),
  errorHandling: z.string().default(''),
  stateManagement: z.string().default(''),
  styling: z.string().default(''),
  testLayout: z.string().default(''),
  commentPolicy: z.string().default(''),
  forbiddenPatterns: z.array(z.string()).default([]),
  commitStyle: z.string().default(''),
  moduleBoundaries: z.string().default('')
});
export type ConventionsSummary = z.infer<typeof ConventionsSummarySchema>;

/* ---------------------------------------------------------------- Assembly Request / Result */

export const AssemblyRequestSchema = z.object({
  taskId: z.string().min(1),
  userPrompt: z.string().min(1),
  activeFiles: z.array(z.string()).default([]),
  activeMode: z.enum(['BUILD', 'REVIEW', 'EXPLAIN', 'DESIGN', 'SHIP']).optional(),
  modelLimitTokens: z.number().int().positive().default(128_000),
  taskClass: z.enum(['Trivial', 'Small', 'Medium', 'Large', 'Epic']).optional()
});
export type AssemblyRequest = z.infer<typeof AssemblyRequestSchema>;

export const AssemblyLayerSchema = z.object({
  id: z.string(),
  kind: z.enum(['core', 'profile', 'mode', 'role', 'quest', 'env']),
  label: z.string(),
  tokens: z.number().int().nonnegative(),
  pinned: z.boolean().default(false),
  tier: z.enum(['FULL', 'COMPACT', 'MICRO']).optional(),
  scope: z.enum(['all', 'read-only', 'docs-only']).optional(),
  dropped: z.boolean().default(false),
  reason: z.string().optional(),
  text: z.string().optional()
});
export type AssemblyLayer = z.infer<typeof AssemblyLayerSchema>;

export const AssemblyResultSchema = z.object({
  taskId: z.string().default(''),
  timestamp: z.number().int().nonnegative().optional(),
  systemPrompt: z.string(),
  pinnedSections: z.array(z.string()).default(['CORE', 'PROFILE']),
  roles: z.array(z.string()).default([]),
  mode: z.string(),
  taskClass: z.string(),
  scope: z.enum(['all', 'read-only', 'docs-only']).optional(),
  tokenEstimate: z.number().int().nonnegative(),
  budget: z.number().int().nonnegative(),
  degraded: z.boolean().default(false),
  assemblyMs: z.number().int().nonnegative(),
  cache: z.enum(['hit', 'miss']).default('miss'),
  layers: z.array(AssemblyLayerSchema).default([])
});
export type AssemblyResult = z.infer<typeof AssemblyResultSchema>;

/* ---------------------------------------------------------------- Role Preferences (Deliverable 2) */

export const RolePreferencesSchema = z.object({
  version: z.literal(1),
  updatedAt: z.string().datetime({ offset: true }).optional(),
  defaultMode: z.enum(['BUILD', 'REVIEW', 'EXPLAIN', 'DESIGN', 'SHIP']).default('BUILD'),
  roleOverrides: z.object({
    pin: z.array(z.string()).default([]),
    ban: z.array(z.string()).default([]),
    prefer: z.record(z.string(), z.number()).optional()
  }).optional(),
  scopeOverrides: z.record(z.string(), z.enum(['all', 'read-only', 'docs-only'] as const)).optional(),
  questGate: z.object({
    autoApproveMedium: z.boolean().default(false),
    requireApprovalFrom: z.enum(['Trivial', 'Small', 'Medium', 'Large', 'Epic']).default('Large')
  }).optional(),
  tokenBudget: z.object({
    systemPromptFraction: z.number().min(0).max(1).default(0.12),
    maxRoles: z.number().int().min(1).max(5).default(2)
  }).optional(),
  conventions: z.object({
    autoExtract: z.boolean().default(true),
    refreshOnHeadChange: z.boolean().default(true)
  }).optional(),
  modeBySignal: z.record(z.string(), z.string()).optional()
});
export type RolePreferences = z.infer<typeof RolePreferencesSchema>;

export type RolePreferencesRaw = z.input<typeof RolePreferencesSchema>;

/* ---------------------------------------------------------------- Assembly Cache Entry */

export interface AssemblyCacheEntry {
  result: AssemblyResult;
  key: string;
  createdAt: number;
}

/* ---------------------------------------------------------------- Secret-shape detection */

const SECRET_SHAPES = [
  /sk-[A-Za-z0-9]{20,}/,           // OpenAI-style
  /sk-or-v1-[A-Za-z0-9]{20,}/,     // OpenRouter
  /Bearer\s+[A-Za-z0-9\-_.+/]{20,}/i,
  /ghp_[A-Za-z0-9]{36,}/,          // GitHub
  /gho_[A-Za-z0-9]{36,}/,
  /sk_live_[A-Za-z0-9]{24,}/,      // Stripe
  /AIza[0-9A-Za-z\-_]{35,}/        // Google
];

export function containsSecretShape(value: unknown): boolean {
  const flat = JSON.stringify(value);
  return SECRET_SHAPES.some((re) => re.test(flat));
}
