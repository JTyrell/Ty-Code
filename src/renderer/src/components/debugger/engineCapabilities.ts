import type { AnalysisEngine } from '../../state/debugger-store';

/**
 * What each diagnostics engine actually does, and the rule ids it actually emits.
 *
 * This file exists because the Engines tab used to be prose written independently
 * of the engines. It claimed the static analyzer ships `race-condition-guard` and
 * `unreachable-branches`, the profiler "monitors re-render velocity, IPC frame
 * buffering, and garbage collection pressure to maintain a 60 FPS" experience,
 * the architecture engine "enforces contextBridge security" and a "safeStorage
 * keyring", and the AI analyst checks "WCAG AA accessibility compliance". None of
 * those strings appear anywhere in `src/main/services/debugger-engines/` — they
 * were invented, and they were the most convincing kind of fabrication because
 * they describe capability rather than findings, so no sweep could ever refute
 * them.
 *
 * Every `ruleId` below is a real literal from the engine named in `sourceFile`,
 * and `scripts/no-fake-debugger-findings.mjs` fails the build if that stops being
 * true. Descriptions are written from the engine sources too: what they read, what
 * they execute, and what they are bounded by.
 *
 * Rule lists are representative, not exhaustive — the engines emit more rules than
 * fit on a card, which is why the label says "example rules". A listing may never
 * contain an id the engine does not emit.
 *
 * Every id is therefore written exactly as the engine writes it. The AI analyst is
 * the one card without a rule catalog: it detects nothing new, so it lists the
 * `ai-insight` prefix its records are built from rather than inventing per-rule
 * names it does not have.
 */
export interface EngineRuleExample {
  /** Which aspect of the code the rule covers. Prose, so it is free to change. */
  readonly aspect: string;
  /** The engine's literal rule id. Must exist in `sourceFile`. */
  readonly ruleId: string;
}

export interface EngineCapabilityCard {
  readonly engine: AnalysisEngine;
  readonly title: string;
  readonly subtitle: string;
  /**
   * The card's status badge. Carries only what is structurally true — that the
   * engine reads files rather than runs them, or that the AI pass needs a model —
   * because no code in the app tracks per-engine liveness, so "Active" and
   * "Enforced" were states nothing could report.
   */
  readonly badge: string;
  readonly description: string;
  /** Path relative to the repository root; the guard reads it. */
  readonly sourceFile: string;
  readonly rules: readonly EngineRuleExample[];
  /** Card accent colour, kept here so the rendering stays a single map. */
  readonly accent: string;
  readonly iconBackground: string;
}

export const ENGINE_CAPABILITY_CARDS: readonly EngineCapabilityCard[] = [
  {
    engine: 'static',
    title: 'Static AST Engine',
    subtitle: 'AST / Syntax / Secrets',
    badge: 'Reads, never runs',
    description:
      'Parses TypeScript and JavaScript with the compiler API and walks the resulting syntax tree without executing the file. Reports unused declarations, unreachable statements, awaits and promise chains with no rejection handler, possible null dereferences, string-concatenated SQL, and credential literals.',
    sourceFile: 'src/main/services/debugger-engines/static-engine.ts',
    rules: [
      { aspect: 'Floating promises', ruleId: 'no-floating-promise' },
      { aspect: 'Unhandled await', ruleId: 'no-unsafe-await' },
      { aspect: 'Dead code', ruleId: 'no-unreachable-code' },
      { aspect: 'Secret literals', ruleId: 'secret-credential-assignment' }
    ],
    accent: 'var(--accent-primary)',
    iconBackground: 'rgba(99, 102, 241, 0.2)'
  },
  {
    engine: 'dynamic',
    title: 'Dynamic Profiler',
    subtitle: 'Sandbox / Errors / Heap',
    badge: 'Executes the file',
    description:
      'Forks the target file into a sandboxed child process with a wall-clock budget and resource limits, then reports what actually happened: thrown errors, unhandled rejections, crashes, timeouts, and the heap and resident-memory delta across the run. Database files additionally get read-only query profiling.',
    sourceFile: 'src/main/services/debugger-engines/dynamic-engine.ts',
    rules: [
      { aspect: 'Unhandled rejection', ruleId: 'dyn-unhandled-rejection' },
      { aspect: 'Budget overrun', ruleId: 'dyn-execution-timeout' },
      { aspect: 'Memory growth', ruleId: 'dyn-memory-spike' },
      { aspect: 'Query profiling', ruleId: 'dyn-db-query-profile' }
    ],
    accent: 'var(--accent-primary)',
    iconBackground: 'rgba(168, 85, 247, 0.2)'
  },
  {
    engine: 'arch',
    title: 'Architecture Boundary Engine',
    subtitle: 'Import graph / Cycles / Debt',
    badge: 'Workspace-wide',
    description:
      'Builds an import graph across workspace source files and scores structural health from it: circular dependencies, god files, oversized files, and scans that had to stop early. Compares the observed structure against the project profile to flag drift, and re-checks correction-memory entries the team has already agreed to.',
    sourceFile: 'src/main/services/debugger-engines/arch-engine.ts',
    rules: [
      { aspect: 'Circular imports', ruleId: 'arch-circular-dependency' },
      { aspect: 'Concentrated file', ruleId: 'arch-god-file' },
      { aspect: 'Layer drift', ruleId: 'arch-drift-bypassed-data-layer' },
      { aspect: 'Agreed correction', ruleId: 'arch-correction-violation' }
    ],
    accent: 'var(--accent-green)',
    iconBackground: 'rgba(16, 185, 129, 0.2)'
  },
  {
    engine: 'ai',
    title: 'AI Analyst Engine',
    subtitle: 'Multi-Perspective Reasoning',
    badge: 'Needs a model key',
    description:
      'Sends the other engines\' findings to a model under one of three role prompts and returns interpretation rather than new detections: a staff engineer weighing root cause and fix, a QA lead naming the test cases the findings imply, and a product manager stating business risk and refactoring cost in non-technical terms.',
    sourceFile: 'src/main/services/debugger-engines/ai-analyst.ts',
    rules: [
      { aspect: 'Per-role report (dev / qa / pm)', ruleId: 'ai-insight' }
    ],
    accent: 'var(--accent-primary)',
    iconBackground: 'rgba(236, 72, 153, 0.2)'
  }
];

/**
 * Role breakdown rows for the metrics tab, in display order.
 *
 * The labels say how many findings a role has and how they divide by severity.
 * They deliberately do not say "readiness", "coverage" or "quality", and they
 * deliberately do not show a percentage of anything: the engines report findings,
 * not how many checks passed, so there is no denominator for a score. The panel
 * this replaces rendered three fixed bar widths for all three roles.
 */
export const ROLE_BREAKDOWN: ReadonlyArray<{
  role: 'dev' | 'qa' | 'pm';
  label: string;
  accent: string;
}> = [
  { role: 'dev', label: 'Developer (DEV) findings', accent: 'var(--accent-primary)' },
  { role: 'qa', label: 'Quality Assurance (QA) findings', accent: 'var(--accent-amber)' },
  { role: 'pm', label: 'Product Experience (PM) findings', accent: 'var(--accent-primary)' }
];
