/**
 * Ty-Code Prompt Assembler — Compact Role Prompt Variant Generator
 *
 * Deterministically derives FULL, COMPACT, and MICRO tiers for all 30 expert roles
 * in ROLE_REGISTRY at module load time (zero LLM calls, zero network, zero disk I/O).
 * Powers the degradation ladder in the prompt assembler.
 *
 * Tiers:
 *   - FULL:    Original prompt verbatim.
 *   - COMPACT: Header + top-3 rules (ranked by signal score) + verify block.
 *   - MICRO:   Header + verify block only.
 *
 * Brand: Ty-Code
 */

import { ROLE_REGISTRY } from './role-registry';
import type { RoleId } from './schemas';

export type RoleTier = 'FULL' | 'COMPACT' | 'MICRO';

export interface RolePromptAST {
  header: string;
  rules: string[];
  verify: string;
}

export interface RoleTierPayload {
  prompt: string;
  tokens: number;
}

const CONSTRAINT_KEYWORDS = /\b(NEVER|ONLY|MUST|ALWAYS)\b|\bno\s+/i;
const SAFETY_TOKENS = /\b(validate|secret|auth|verify|test|baseline)\b/i;

/**
 * Token estimator for role prompt text (chars / 4).
 */
export function estimateRoleTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Parses raw role prompt Markdown into a structured AST:
 *   - header: First line matching /^## ROLE:/i
 *   - rules:  Lines starting with "- "
 *   - verify: Lines starting from "VERIFY:" to end of prompt
 */
export function parseRolePromptAST(rawPrompt: string): RolePromptAST {
  const lines = rawPrompt.split('\n');
  const headerIdx = lines.findIndex((l) => /^## ROLE:/i.test(l.trim()));
  const header = headerIdx >= 0 ? lines[headerIdx].trim() : lines[0]?.trim() || '';

  const rules: string[] = [];
  let inVerify = false;
  const verifyLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (/^VERIFY:/i.test(trimmed)) {
      inVerify = true;
    }

    if (inVerify) {
      verifyLines.push(line);
    } else if (trimmed.startsWith('- ')) {
      rules.push(trimmed);
    }
  }

  const verify = verifyLines.join('\n').trim();
  return { header, rules, verify };
}

/**
 * Scores and selects top-3 rules by signal priority:
 *   +2 constraint keywords (NEVER, ONLY, MUST, ALWAYS, no )
 *   +2 safety/verification tokens (validate, secret, auth, verify, test, baseline)
 *   +1 positional primacy (first rule)
 *   Ties broken by original order.
 */
export function rankRules(rules: string[], topK = 3): string[] {
  const scored = rules.map((rule, idx) => {
    let score = 0;
    if (CONSTRAINT_KEYWORDS.test(rule)) score += 2;
    if (SAFETY_TOKENS.test(rule)) score += 2;
    if (idx === 0) score += 1;
    return { rule, score, idx };
  });

  scored.sort((a, b) => b.score - a.score || a.idx - b.idx);
  return scored
    .slice(0, topK)
    .sort((a, b) => a.idx - b.idx)
    .map((s) => s.rule);
}

/**
 * Derives the 3 deterministic tiers for any role prompt.
 */
export function deriveRoleTiers(rawPrompt: string): Record<RoleTier, RoleTierPayload> {
  const ast = parseRolePromptAST(rawPrompt);

  const fullPrompt = rawPrompt.trim();
  const topRules = rankRules(ast.rules, 3);

  const compactParts = [ast.header, ...topRules, ast.verify].filter(Boolean);
  const compactPrompt = compactParts.join('\n').trim();

  const microParts = [ast.header, ast.verify].filter(Boolean);
  const microPrompt = microParts.join('\n').trim();

  return {
    FULL: {
      prompt: fullPrompt,
      tokens: estimateRoleTokens(fullPrompt)
    },
    COMPACT: {
      prompt: compactPrompt,
      tokens: estimateRoleTokens(compactPrompt)
    },
    MICRO: {
      prompt: microPrompt,
      tokens: estimateRoleTokens(microPrompt)
    }
  };
}

// Module-level precomputed cache
const tierCache = new Map<string, Record<RoleTier, RoleTierPayload>>();

function getCacheKey(roleId: string): string {
  return roleId.toLowerCase().trim();
}

/** Precompute all known roles in the registry at module load */
for (const [id, role] of Object.entries(ROLE_REGISTRY)) {
  if (role && role.prompt) {
    tierCache.set(getCacheKey(id), deriveRoleTiers(role.prompt));
  }
}

/**
 * Returns prompt text for a role at the requested degradation tier.
 */
export function getRolePromptTier(id: RoleId, tier: RoleTier = 'FULL'): string {
  const key = getCacheKey(id);
  let cached = tierCache.get(key);
  if (!cached) {
    const role = ROLE_REGISTRY[id];
    if (role?.prompt) {
      cached = deriveRoleTiers(role.prompt);
      tierCache.set(key, cached);
    }
  }
  return cached ? cached[tier].prompt : (ROLE_REGISTRY[id]?.prompt || '');
}

/**
 * Returns estimated token count (chars/4) for a role at the requested tier.
 */
export function tierTokens(id: RoleId, tier: RoleTier = 'FULL'): number {
  const key = getCacheKey(id);
  let cached = tierCache.get(key);
  if (!cached) {
    const role = ROLE_REGISTRY[id];
    if (role?.prompt) {
      cached = deriveRoleTiers(role.prompt);
      tierCache.set(key, cached);
    }
  }
  return cached ? cached[tier].tokens : estimateRoleTokens(ROLE_REGISTRY[id]?.prompt || '');
}

/**
 * Returns all tiers for a given role id.
 */
export function getRoleTiers(id: RoleId): Record<RoleTier, RoleTierPayload> | undefined {
  const key = getCacheKey(id);
  return tierCache.get(key);
}
