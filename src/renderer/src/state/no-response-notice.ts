/**
 * Blank-turn "no response" guard predicate.
 *
 * A turn that finalized with NO content, thoughts, tool executions, diffs or
 * document AND no error card would otherwise render an empty bubble that looks
 * like a frozen "Thinking…" state — the degenerate empty-stream symptom. This
 * pure predicate decides when to surface an actionable "no response received"
 * strip instead of blank, while protecting legitimate output-only turns:
 *   - a tool-only turn (toolExecutions present) is a real answer → no strip
 *   - a plan / document-push turn (proposedDiffs / proposedDocument) → no strip
 *   - an errored turn (error card) already shows the retry card → no strip
 *   - an intentional stop (cancelled) is user-initiated → no strip
 *
 * Kept as a standalone module (no store/window imports) so it is trivially
 * unit-testable in a plain node environment.
 */

export interface NoResponseNoticeInput {
  role: string;
  content: string;
  thoughts?: string[] | null;
  toolExecutions?: unknown[] | null;
  proposedDiffs?: unknown[] | null;
  proposedDocument?: unknown | null;
  hasErrorCard?: boolean;
  cancelled?: boolean;
}

export function shouldShowNoResponseNotice(input: NoResponseNoticeInput): boolean {
  if (input.role !== 'assistant') return false;
  // An intentional stop is not a missing response.
  if (input.cancelled) return false;

  const hadAnyOutput =
    (input.content || '').trim().length > 0 ||
    (Array.isArray(input.thoughts) && input.thoughts.length > 0) ||
    (Array.isArray(input.toolExecutions) && input.toolExecutions.length > 0) ||
    (Array.isArray(input.proposedDiffs) && input.proposedDiffs.length > 0) ||
    Boolean(input.proposedDocument) ||
    Boolean(input.hasErrorCard);

  return !hadAnyOutput;
}
