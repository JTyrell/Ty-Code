/**
 * Ty-Code Dynamic System Prompt Assembler
 *
 * Composes Layer 0 Core, Layer 1 Project Profile, Mode Contract, Role Prompts (max 2),
 * Quest Workflow (if taskClass ≥ Medium), and Env Block into a single budget-guarded
 * system prompt per task.
 *
 * Token estimate: chars/4 prose, chars/3 code.
 * Budget = floor(modelLimitTokens * prefs.tokenBudget.systemPromptFraction).
 *
 * Deterministic Degradation Ladder (PART A):
 *   over budget → (1) drop role #2
 *               → (2) role #1 → COMPACT
 *               → (3) role #1 → MICRO
 *               → (4) drop Quest
 *               → (5) truncate repoLayout to 10 lines
 *   CORE, PROFILE identity fields, and MODE CONTRACT never drop.
 *
 * Pinned sections: CORE and PROFILE (for the 95% Auto-Compaction pass).
 * In-memory telemetry ring: records each assembly snapshot for observability.
 *
 * Brand: Ty-Code
 */

import crypto from 'crypto';
import * as path from 'path';
import type { RoleId, ModeId, TaskClass, ProjectProfile, ToolScope, AssemblyLayer, AssemblyResult, RolePreferences } from './schemas';
import { AssemblyResultSchema } from './schemas';
import { ROLE_REGISTRY, mostRestrictiveScope } from './role-registry';
import { MODE_CONTRACTS, modeScope } from './mode-contracts';
import { classify, type ClassifyPrefs } from './intent-classifier';
import { getRolePromptTier, tierTokens } from './compact-variants';
import { recordAssembly } from './telemetry-ring';

/* ---------------------------------------------------------------- Layer 0: Core (Pinned) */

const LAYER0_ORIGINAL = `You are Ty-Code, an autonomous senior software engineer embedded in a local-first, zero-trust agentic IDE.

PRIME DIRECTIVES:
1. Correctness over speed. Never guess when you can verify.
2. Repo truth over memory. Read the code before you claim anything about it.
3. Minimal footprint. Smallest diff that fully solves the stated problem.
4. Convention fidelity. Match the repo's existing patterns; never introduce a parallel paradigm.
5. Sovereignty. No code, keys, or telemetry leave this machine.

PROTOCOL: Every turn is exactly one of: (a) tool_call, (b) approval_request, (c) final answer.
Intent without a tool_call in the same turn is a protocol violation.
Read-before-write: never edit a file unread this session.
Verify with independent signals (tests, builds, LSP diagnostics, query plans) — report the signal, not your belief.
Honesty markers: tag unverified claims "(inferred)" or "(unverified)". Never fabricate paths, symbols, or line numbers.
Output hygiene: complete Markdown units, fenced code with language tags, no internal scaffolding in user-facing text.`;

/* ---------------------------------------------------------------- token estimation */

function isCodeBlock(text: string): boolean {
  return text.includes('```') || text.includes('    ') || /\n\s*[-*]\s/.test(text);
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  const codeish = isCodeBlock(text) ? 3 : 4;
  return Math.ceil(text.length / codeish);
}

/* ---------------------------------------------------------------- profile block builder */

function buildProfileBlock(profile: ProjectProfile | null, workspaceRoot: string): string {
  if (!profile) {
    return `## PROJECT PROFILE (auto-detected — minimal)
name: ${path.basename(workspaceRoot) || 'workspace'}
languages: (undetected)
frameworks: (undetected)
RULES: inspect the repo before assuming; never restate this block to the user.`;
  }
  return `## PROJECT PROFILE (auto-detected — treat as ground truth)
name: ${profile.name}
languages: ${(profile.languages || []).join(', ') || '(undetected)'}
frameworks: ${(profile.frameworks || []).join(', ') || '(undetected)'}
package_manager: ${profile.pkgManager || '(undetected)'}
test_runner: ${profile.testRunner || '(undetected)'}
lint_format: ${profile.lintFormat || '(undetected)'}
build_tool: ${profile.buildTool || '(undetected)'}
repo_layout: ${profile.repoLayout || '(undetected)'}
conventions: ${(profile as any).conventionsSummary || '(not yet extracted)'}
deploy_targets: ${(profile.deployTargets || []).join(', ') || '(none detected)'}
ci: ${profile.ciSummary || '(undetected)'}
RULES: When this profile conflicts with your defaults, the profile wins. Never restate this block to the user; act on it.`;
}

/* ---------------------------------------------------------------- env block */

function buildEnvBlock(envContext: { hasWorkspace: boolean; workspaceRoot: string | null; activeFiles: string[] }): string {
  return `## ENVIRONMENT (O(1) state)
workspaceRoot: ${envContext.workspaceRoot ?? 'none'}
workspaceLoaded: ${envContext.hasWorkspace}
activeFiles: ${envContext.activeFiles.join(', ') || 'none'}
toolAvailability: ${envContext.hasWorkspace ? 'full suite' : 'limited — use request_workspace_open to open a folder'}`;
}

/* ---------------------------------------------------------------- quest block */

const QUEST_BLOCK = `## QUEST WORKFLOW (spec-driven execution)
For any task classified Medium or larger:

PHASE 1 — UNDERSTAND: read repo map + touched modules + conventions.
  Emit 3–7 "Context Notes": what exists, what must not break, hidden couplings.
PHASE 2 — SPEC: Goal / Non-Goals / Acceptance Criteria (each observable & testable) / Risks.
PHASE 3 — PLAN: ordered task list; each item ≤ one logical diff; mark human checkpoints.
PHASE 4 — EXECUTE: one task at a time; after each, run that task's verification signal before proceeding.
PHASE 5 — VERIFY & REPORT: run full affected suite; report delta vs acceptance criteria; list follow-ups.

GATES:
- Large/Epic: approval_request after PHASE 3. No execution before approval.
- Medium: auto-proceed unless terminal policy or user preference requires review.
- Small/Trivial: skip Quest; execute directly under Layer 0 protocol.`;

/* ---------------------------------------------------------------- assembly cache */

const assemblyCache = new Map<string, { result: AssemblyResult; key: string }>();

function assemblyCacheKey(
  profileHash: string,
  roles: RoleId[],
  mode: ModeId,
  taskClass: TaskClass,
  prefsHash: string,
  conventionsHash: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${profileHash}:${roles.join(',')}:${mode}:${taskClass}:${prefsHash}:${conventionsHash}`)
    .digest('hex');
}

/* ---------------------------------------------------------------- assembleSystemPrompt */

export interface AssembleOptions {
  taskId: string;
  userPrompt: string;
  activeFiles: string[];
  workspaceRoot: string;
  profile: ProjectProfile | null;
  activeMode?: ModeId;
  modelLimitTokens: number;
  taskClass?: TaskClass;
  preferences: RolePreferences;
  envContext: { hasWorkspace: boolean; workspaceRoot: string | null; activeFiles: string[] };
  conventionsHash?: string;
}

export interface AssembleOutput extends AssemblyResult {
  scope: ToolScope;
}

export function assembleSystemPrompt(opts: AssembleOptions): AssembleOutput {
  const start = Date.now();
  const {
    taskId,
    userPrompt,
    activeFiles,
    workspaceRoot,
    profile,
    activeMode,
    modelLimitTokens,
    taskClass: requestedTaskClass,
    preferences,
    envContext,
    conventionsHash = ''
  } = opts;

  const prefsHash = crypto.createHash('sha256').update(JSON.stringify(preferences)).digest('hex').slice(0, 16);
  const profileHash = profile?.manifestHash || 'none';

  // Classify roles + mode (with preferences applied)
  const classPrefs: ClassifyPrefs = {
    pin: preferences.roleOverrides?.pin,
    ban: preferences.roleOverrides?.ban,
    prefer: preferences.roleOverrides?.prefer,
    maxRoles: preferences.tokenBudget?.maxRoles ?? 2,
    defaultMode: preferences.defaultMode,
    modeBySignal: preferences.modeBySignal as Record<string, ModeId> | undefined,
    questGate: preferences.questGate
  };
  const classification = classify(userPrompt, activeFiles, classPrefs);
  const roles = classification.roles;
  const mode = activeMode ?? classification.mode;
  const taskClass = requestedTaskClass ?? classification.taskClass;
  const scope = mostRestrictiveScope(roles);

  // Cache lookup
  const cacheKey = assemblyCacheKey(profileHash, roles, mode, taskClass, prefsHash, conventionsHash);
  const cached = assemblyCache.get(cacheKey);
  if (cached) {
    const hitResult: AssemblyResult = {
      ...cached.result,
      taskId,
      timestamp: Date.now(),
      cache: 'hit',
      assemblyMs: Date.now() - start
    };
    recordAssembly(hitResult);
    return {
      ...hitResult,
      scope
    };
  }

  // Budget
  const budget = Math.floor(modelLimitTokens * (preferences.tokenBudget?.systemPromptFraction ?? 0.12));

  // Build raw blocks
  const coreBlock = LAYER0_ORIGINAL;
  const profileBlock = buildProfileBlock(profile, workspaceRoot);
  const modeBlock = MODE_CONTRACTS[mode] || '';
  const isQuestEligible = taskClass === 'Medium' || taskClass === 'Large' || taskClass === 'Epic';
  const questBlock = isQuestEligible ? QUEST_BLOCK : '';
  const envBlock = buildEnvBlock(envContext);

  // Build initial structured layers array (PART A & B contract)
  const layers: AssemblyLayer[] = [
    {
      id: 'core',
      kind: 'core',
      label: 'CORE Directives',
      tokens: estimateTokens(coreBlock),
      pinned: true,
      dropped: false,
      text: coreBlock
    },
    {
      id: 'profile',
      kind: 'profile',
      label: `Profile: ${profile?.name || path.basename(workspaceRoot) || 'Workspace'}`,
      tokens: estimateTokens(profileBlock),
      pinned: true,
      dropped: false,
      text: profileBlock
    },
    {
      id: 'mode',
      kind: 'mode',
      label: `MODE: ${mode}`,
      tokens: estimateTokens(modeBlock),
      pinned: false,
      scope: modeScope(mode),
      dropped: false,
      text: modeBlock
    }
  ];

  if (roles[0]) {
    const r1Text = getRolePromptTier(roles[0], 'FULL');
    layers.push({
      id: `role_${roles[0]}`,
      kind: 'role',
      label: `ROLE: ${ROLE_REGISTRY[roles[0]]?.name || roles[0]}`,
      tokens: tierTokens(roles[0], 'FULL'),
      pinned: false,
      tier: 'FULL',
      scope: ROLE_REGISTRY[roles[0]]?.scope || 'all',
      dropped: false,
      text: r1Text
    });
  }

  if (roles[1]) {
    const r2Text = getRolePromptTier(roles[1], 'FULL');
    layers.push({
      id: `role_${roles[1]}`,
      kind: 'role',
      label: `ROLE: ${ROLE_REGISTRY[roles[1]]?.name || roles[1]}`,
      tokens: tierTokens(roles[1], 'FULL'),
      pinned: false,
      tier: 'FULL',
      scope: ROLE_REGISTRY[roles[1]]?.scope || 'all',
      dropped: false,
      text: r2Text
    });
  }

  if (isQuestEligible && questBlock) {
    layers.push({
      id: 'quest',
      kind: 'quest',
      label: 'QUEST Workflow',
      tokens: estimateTokens(questBlock),
      pinned: false,
      dropped: false,
      text: questBlock
    });
  }

  layers.push({
    id: 'env',
    kind: 'env',
    label: 'Environment Context',
    tokens: estimateTokens(envBlock),
    pinned: false,
    dropped: false,
    text: envBlock
  });

  const getActiveTokens = () => layers.filter((l) => !l.dropped).reduce((sum, l) => sum + l.tokens, 0);

  let totalTokens = getActiveTokens();
  let degraded = false;

  // ═════════════════════════════════════════════════════════════════════════
  // DEGRADATION LADDER (Unified Prompt PART A)
  // over budget → (1) drop role #2
  //             → (2) role #1 → COMPACT
  //             → (3) role #1 → MICRO
  //             → (4) drop Quest
  //             → (5) truncate repoLayout to 10 lines
  // NEVER drop CORE, PROFILE identity fields, or MODE CONTRACT.
  // ═════════════════════════════════════════════════════════════════════════

  // Step (1): Drop role #2
  if (totalTokens > budget && roles[1]) {
    const role2Layer = layers.find((l) => l.id === `role_${roles[1]}`);
    if (role2Layer && !role2Layer.dropped) {
      role2Layer.dropped = true;
      role2Layer.reason = 'budget: role #2 cut';
      degraded = true;
      totalTokens = getActiveTokens();
    }
  }

  // Step (2): Swap role #1 → COMPACT
  if (totalTokens > budget && roles[0]) {
    const role1Layer = layers.find((l) => l.id === `role_${roles[0]}`);
    if (role1Layer && !role1Layer.dropped && role1Layer.tier === 'FULL') {
      role1Layer.tier = 'COMPACT';
      role1Layer.text = getRolePromptTier(roles[0], 'COMPACT');
      role1Layer.tokens = estimateTokens(role1Layer.text);
      degraded = true;
      totalTokens = getActiveTokens();
    }
  }

  // Step (3): Swap role #1 → MICRO
  if (totalTokens > budget && roles[0]) {
    const role1Layer = layers.find((l) => l.id === `role_${roles[0]}`);
    if (role1Layer && !role1Layer.dropped && role1Layer.tier === 'COMPACT') {
      role1Layer.tier = 'MICRO';
      role1Layer.text = getRolePromptTier(roles[0], 'MICRO');
      role1Layer.tokens = estimateTokens(role1Layer.text);
      degraded = true;
      totalTokens = getActiveTokens();
    }
  }

  // Step (4): Drop Quest
  if (totalTokens > budget) {
    const questLayer = layers.find((l) => l.id === 'quest');
    if (questLayer && !questLayer.dropped) {
      questLayer.dropped = true;
      questLayer.reason = 'budget: quest workflow cut';
      degraded = true;
      totalTokens = getActiveTokens();
    }
  }

  // Step (5): Truncate repoLayout to 10 lines
  if (totalTokens > budget) {
    const profileLayer = layers.find((l) => l.id === 'profile');
    if (profileLayer && !profileLayer.dropped && profileLayer.text) {
      const lines = profileLayer.text.split('\n');
      if (lines.length > 10) {
        profileLayer.text = lines.slice(0, 10).join('\n') + '\n...';
        profileLayer.tokens = estimateTokens(profileLayer.text);
        degraded = true;
        totalTokens = getActiveTokens();
      }
    }
  }

  // Build the unified system prompt from non-dropped layers
  const systemPrompt = layers
    .filter((l) => !l.dropped && l.text)
    .map((l) => `[PINNED:${l.pinned}] ${l.label.toUpperCase()}\n${l.text}`)
    .join('\n\n');

  const result: AssemblyResult = {
    taskId,
    timestamp: Date.now(),
    systemPrompt,
    pinnedSections: ['CORE', 'PROFILE'],
    roles,
    mode,
    taskClass,
    scope,
    tokenEstimate: totalTokens,
    budget,
    degraded,
    assemblyMs: Date.now() - start,
    cache: 'miss',
    layers
  };

  // Validate contract & persist to RAM cache & telemetry ring
  AssemblyResultSchema.parse(result);
  assemblyCache.set(cacheKey, { result, key: cacheKey });
  recordAssembly(result);

  return {
    ...result,
    scope
  };
}

export function invalidateAssemblyCache(): void {
  assemblyCache.clear();
}
