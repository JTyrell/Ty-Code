/**
 * Ty-Code Intent Classifier (Layer 2 role selection + mode inference)
 *
 * Heuristic-first via ROLE_REGISTRY signals + file-extension map.
 * Confidence: exactly 1 clean hit = high; 0 hits or >2 hits = low → optional
 * small-model refinement with strict JSON output {roles, mode} and 1500ms
 * AbortSignal; on timeout/error fall back to heuristic.
 *
 * Mode inference: explicit activeMode wins; else verb map
 * (review|audit→REVIEW, explain|teach→EXPLAIN, design|spec|architect→DESIGN,
 * release|publish|tag→SHIP, else BUILD).
 *
 * Preferences applied per spec §4: pins occupy slots first, bans removed,
 * prefer-weights reorder; final slice(0, maxRoles).
 */

import type { RoleId, ModeId, TaskClass } from './schemas';
import { ROLE_REGISTRY, ROLE_IDS, classifyRoles as baseClassifyRoles, mostRestrictiveScope, getRoleScope } from './role-registry';
import { classifyMode, modeScope } from './mode-contracts';
import type { RolePreferences } from './schemas';
import { policyEngine } from '../../services/policy/policy-engine';
import * as path from 'path';

const FILE_EXTENSION_ROLE_MAP: Record<string, RoleId> = {
  '.tsx': 'frontend', '.jsx': 'frontend', '.vue': 'frontend', '.css': 'frontend', '.scss': 'frontend',
  '.sql': 'data', '.sol': 'blockchain', '.unity': 'game', '.glsl': 'game', '.tf': 'devops',
  '.py': 'backend', '.go': 'backend', '.rs': 'systems', '.rb': 'backend', '.php': 'backend',
  '.java': 'backend', '.kt': 'backend', '.cs': 'backend', '.cpp': 'systems', '.c': 'systems', '.h': 'systems'
};

export interface ClassifyPrefs {
  pin?: string[];
  ban?: string[];
  prefer?: Record<string, number>;
  maxRoles?: number;
  defaultMode?: ModeId;
  modeBySignal?: Record<string, ModeId>;
  questGate?: { autoApproveMedium: boolean; requireApprovalFrom: TaskClass };
}

interface ClassifyResult {
  roles: RoleId[];
  mode: ModeId;
  taskClass: TaskClass;
  confidence: 'high' | 'low';
  scope: 'all' | 'read-only' | 'docs-only';
  degraded: boolean;
}

function signalHits(userPrompt: string): RoleId[] {
  const haystack = userPrompt.toLowerCase();
  const hits: RoleId[] = [];
  if (ROLE_REGISTRY.security.signals.test(haystack)) hits.push('security');
  if (ROLE_REGISTRY.debug.signals.test(haystack)) hits.push('debug');
  for (const id of ROLE_IDS) {
    if (id === 'security' || id === 'debug') continue;
    if (ROLE_REGISTRY[id].signals.test(haystack)) hits.push(id as RoleId);
  }
  return [...new Set(hits)];
}

function fileHintRoles(activeFiles: string[]): RoleId[] {
  const hints: RoleId[] = [];
  for (const f of activeFiles) {
    const ext = path.extname(f).toLowerCase();
    const role = FILE_EXTENSION_ROLE_MAP[ext];
    if (role && !hints.includes(role)) hints.push(role);
  }
  return hints;
}

function inferTaskClass(prompt: string, roles: RoleId[]): TaskClass {
  const lower = prompt.toLowerCase();
  if (lower.length > 1200 || /epic|platform|architecture|rewrite|migrate.*to/i.test(lower)) return 'Epic';
  if (lower.length > 400 || /implement|build|create|refactor|migrate|feature|system/i.test(lower)) return 'Medium';
  if (roles.some((r) => ['debug', 'security', 'review', 'architecture', 'performance'].includes(r))) return 'Small';
  return 'Small';
}

async function smallModelRefine(userPrompt: string, activeFiles: string[]): Promise<{ roles: RoleId[]; mode: ModeId } | null> {
  const { ProviderGateway, getVerifiedModels } = await import('../../providers/provider-gateway');
  try {
    const models = await getVerifiedModels();
    const free = models.find((m) => !m.requiresKey);
    if (!free) return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await ProviderGateway.sendChatRequest(free.providerId, free.modelId, [
        {
          role: 'system',
          content: 'You are an intent classifier. Output strict JSON only: {roles: string[], mode: "BUILD"|"REVIEW"|"EXPLAIN"|"DESIGN"|"SHIP"}. Roles must be from: fullstack, frontend, backend, devops, data, refactor, qa, security, debug, review, git, release, docs, performance, observability, architecture, codemod, supply-chain, integration, ml, mobile, systems, i18n, devex, ai-feature, mentor, game, blockchain, data-eng, legal.'
        },
        {
          role: 'user',
          content: `Prompt: ${userPrompt.slice(0, 2000)}\nActive files: ${activeFiles.join(', ')}`
        }
      ], false, undefined, undefined, 0, controller.signal);
      clearTimeout(timer);
      const cleaned = (response || '').trim();
      const jsonStart = cleaned.indexOf('{');
      if (jsonStart < 0) return null;
      const parsed = JSON.parse(cleaned.substring(jsonStart));
      const roles: RoleId[] = Array.isArray(parsed.roles) ? parsed.roles.filter((r: string) => Object.prototype.hasOwnProperty.call(ROLE_REGISTRY, r)) : [];
      const mode = (parsed.mode === 'BUILD' || parsed.mode === 'REVIEW' || parsed.mode === 'EXPLAIN' || parsed.mode === 'DESIGN' || parsed.mode === 'SHIP') ? parsed.mode : 'BUILD';
      return { roles, mode };
    } catch {
      clearTimeout(timer);
      return null;
    }
  } catch {
    return null;
  }
}

export function classify(
  userPrompt: string,
  activeFiles: string[] = [],
  prefs: ClassifyPrefs = {}
): ClassifyResult {
  const signalRoles = signalHits(userPrompt);
  const fileRoles = fileHintRoles(activeFiles);

  // Merge heuristic hits (signals dominate; file hints supplement)
  let heuristicRoles: RoleId[] = [...new Set([...signalRoles, ...fileRoles])];

  // Apply bans
  const ban = new Set(prefs.ban ?? []);
  heuristicRoles = heuristicRoles.filter((r) => !ban.has(r));

  // Confidence
  const totalHits = signalRoles.length + fileRoles.length;
  const confidence: 'high' | 'low' = totalHits === 1 ? 'high' : 'low';

  // Apply pins first (consume slots), then prefer-weighted reorder, then slice(0, maxRoles)
  const maxRoles = prefs.maxRoles ?? 2;
  const pin = (prefs.pin ?? []).filter((r) => !ban.has(r)) as RoleId[];
  const nonPin = heuristicRoles.filter((r) => !pin.includes(r));
  const prefer = prefs.prefer ?? {};
  nonPin.sort((a, b) => (prefer[b] ?? 0) - (prefer[a] ?? 0));
  const roles = [...new Set([...pin, ...nonPin])].slice(0, maxRoles);

  // Mode inference: explicit activeMode wins, else modeBySignal, else verb inference, else defaultMode
  const explicitMode = prefs.defaultMode;
  const modeBySignal = prefs.modeBySignal ?? {};
  let mode: ModeId = 'BUILD';
  for (const [signal, m] of Object.entries(modeBySignal)) {
    if (new RegExp(signal, 'i').test(userPrompt)) {
      mode = m as ModeId;
      break;
    }
  }
  if (mode === 'BUILD') {
    mode = classifyMode(userPrompt);
  }
  if (explicitMode) mode = explicitMode;

  // Enterprise policy enforcement: ensure mode is allowed, else fallback to policy default
  if (!policyEngine.isModeAllowed(mode)) {
    mode = policyEngine.getDefaultMode();
  }

  const scope = mostRestrictiveScope(roles);
  const taskClass = inferTaskClass(userPrompt, roles);

  return { roles, mode, taskClass, confidence, scope, degraded: false };
}

/**
 * Back-compat wrapper matching the older classifyIntent signature.
 */
export function classifyIntent(userPrompt: string, activeFiles: string[] = [], prefs: ClassifyPrefs = {}): { roles: RoleId[]; taskClass: TaskClass; mode: ModeId } {
  const result = classify(userPrompt, activeFiles, prefs);
  return { roles: result.roles, taskClass: result.taskClass, mode: result.mode };
}

/**
 * Runs the small-model refinement when confidence is low; falls back to heuristic.
 */
export async function classifyWithRefinement(
  userPrompt: string,
  activeFiles: string[] = [],
  prefs: ClassifyPrefs = {}
): Promise<ClassifyResult> {
  const heuristic = classify(userPrompt, activeFiles, prefs);
  if (heuristic.confidence === 'high') return heuristic;

  const refined = await smallModelRefine(userPrompt, activeFiles);
  if (!refined) return heuristic;

  // Merge refined roles with preference constraints
  const ban = new Set(prefs.ban ?? []);
  const pin = (prefs.pin ?? []).filter((r) => !ban.has(r)) as RoleId[];
  const refinedRoles = refined.roles.filter((r) => !ban.has(r) && !pin.includes(r));
  const maxRoles = prefs.maxRoles ?? 2;
  const roles = [...new Set([...pin, ...refinedRoles])].slice(0, maxRoles);
  const mode = prefs.defaultMode ?? refined.mode;
  const scope = mostRestrictiveScope(roles);
  const taskClass = inferTaskClass(userPrompt, roles);

  return { roles, mode, taskClass, confidence: 'low', scope, degraded: false };
}
