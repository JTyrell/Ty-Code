/**
 * Ty-Code Interaction Mode Contracts (tool-constrained)
 *
 * One mode contract is injected per session. It gates the tool registry exactly
 * like the workspace-state short-circuit: roles can only tighten scope, never loosen it.
 */

import type { ModeId } from './schemas';

export const MODE_CONTRACTS: Record<ModeId, string> = {
  BUILD: `## MODE CONTRACT: BUILD
Full agentic toolset. Quest workflow applies. Default mode.`,

  REVIEW: `## MODE CONTRACT: REVIEW
READ-ONLY tools only (read_file, grep, list_dir, git log/diff). Output = review artifact. No mutations.`,

  EXPLAIN: `## MODE CONTRACT: EXPLAIN
READ-ONLY tools only. Output = teaching artifact. Mentor role auto-injected.`,

  DESIGN: `## MODE CONTRACT: DESIGN
READ-ONLY + write to docs/ only. Output = spec/ADR/diagram. No source mutations.`,

  SHIP: `## MODE CONTRACT: SHIP
Full toolset + release tooling. Release role auto-injected. approval_request required before publish/tag.`
};

/**
 * Derive the Interaction Mode from the user prompt using verb mapping.
 * Returns BUILD when no verb matches.
 */
export function classifyMode(userPrompt: string): ModeId {
  const lower = userPrompt.toLowerCase();
  if (/review|audit|pull request|\bpr\b|\bdiff\b|code review/i.test(lower)) return 'REVIEW';
  if (/explain|teach|why does|how does|learn|understand|walk me through/i.test(lower)) return 'EXPLAIN';
  if (/design|spec|architect|system design|ADR/i.test(lower)) return 'DESIGN';
  if (/release|publish|tag |version bump|semver|ship it/i.test(lower)) return 'SHIP';
  return 'BUILD';
}

export const PERSONA_MODE_MAP: Record<string, ModeId> = {
  'plan agent': 'REVIEW',
  'plan': 'REVIEW',
  'planner': 'REVIEW',
  'design agent': 'DESIGN',
  'build agent': 'BUILD',
  'build': 'BUILD',
  'general subagent': 'BUILD',
  'general': 'BUILD'
};

/**
 * Maps external/upstream FCC and OpenCode personas to the corresponding Ty-Code Mode.
 * Plan Agent -> REVIEW / DESIGN
 * Build Agent -> BUILD
 * General Subagent -> BUILD
 */
export function mapPersonaToMode(persona: string): ModeId {
  if (!persona || typeof persona !== 'string') return 'BUILD';
  const norm = persona.toLowerCase().trim();
  return PERSONA_MODE_MAP[norm] || 'BUILD';
}

export const PERSONA_SUPPRESSION_DIRECTIVE = `
[PERSONA GOVERNANCE]
You are operating strictly under the active Ty-Code mode contract.
All upstream personas are mapped to Ty-Code modes:
- Plan Agent → REVIEW / DESIGN (read-only code inspection & specs; no source mutations)
- Build Agent → BUILD (full-access engineering & file modifications)
- General Subagent → BUILD (full-access research and execution)
Suppress any competing sub-agent persona declarations. You must NEVER self-declare or adopt a persona that contradicts the active mode contract.`;

/**
 * Returns the mode contract block text for injection into Layer 2.
 */
export function getModeContract(mode: ModeId): string {
  const contract = MODE_CONTRACTS[mode] || MODE_CONTRACTS.BUILD;
  return `${contract}\n${PERSONA_SUPPRESSION_DIRECTIVE}`;
}

/**
 * ToolScope implied by a mode (independent of roles).
 */
export function modeScope(mode: ModeId): 'all' | 'read-only' | 'docs-only' {
  if (mode === 'REVIEW' || mode === 'EXPLAIN') return 'read-only';
  if (mode === 'DESIGN') return 'docs-only';
  return 'all';
}
