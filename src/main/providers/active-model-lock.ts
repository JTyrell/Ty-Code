/**
 * Active-Model Lock (Prompt: Break the Model-Sync Echo Loop)
 *
 * Owns the main-process global active-model selection state that
 * ProviderGateway historically kept inline, plus two sync-hygiene guards:
 *
 * 1. STORM TRIPWIRE (permanent, ships in production): a renderer<->main
 *    state-sync ping-pong re-emits set-active-model hundreds of times per
 *    second. More than SYNC_LOOP_MAX_CALLS_PER_WINDOW calls inside one
 *    rolling SYNC_LOOP_WINDOW_MS declares a storm: the FIRST offending call
 *    is logged exactly once with its captured stack, and every further call
 *    is DROPPED until the channel has been completely quiet for
 *    SYNC_LOOP_QUIET_PERIOD_MS. Windows reset cleanly from timestamps only —
 *    no timers are retained, no counters grow unbounded.
 *
 * 2. IDEMPOTENT LOCK: re-locking the pair that is already locked is a full
 *    no-op (no state write, no log, no preferences write, no vault access,
 *    no broadcast). Equality is ALWAYS primitive string comparison of BOTH
 *    provider AND model — never object identity.
 *
 * ROUTING INVARIANT: this module holds state only. It never decides routing,
 * failover, or health. Before the first genuine lock the state is an empty
 * sentinel; every routing reader already treats blank provider/model exactly
 * like the previous default (auto routing + Ty-Code Free fallbacks in
 * sendChatRequest), so behavior is unchanged.
 */

export interface ActiveModelTriple {
    providerId: string;
    modelId: string;
    isAutoMode: boolean;
}

/** Rolling tripwire window in milliseconds. */
export const SYNC_LOOP_WINDOW_MS = 1000;
/** Calls tolerated per window before a storm is declared. */
export const SYNC_LOOP_MAX_CALLS_PER_WINDOW = 10;
/** Complete silence required before a storm is considered over (ms). */
export const SYNC_LOOP_QUIET_PERIOD_MS = 2000;

/**
 * Pre-lock sentinel. The FIRST lock call after boot is therefore always a
 * genuine transition (exactly one cold-boot lock line), and every identical
 * re-lock after it is silent.
 */
const UNLOCKED: ActiveModelTriple = { providerId: '', modelId: '', isAutoMode: true };

let currentActiveModel: ActiveModelTriple = { ...UNLOCKED };
let gatewayActiveOverride: { providerId: string; modelId: string } | null = null;

// --- Storm tripwire state (timestamps only; no timers) ----------------------
let windowStart = 0;
let windowCount = 0;
let stormActive = false;
let lastCallAt = 0;
let stormLogged = false;

/** Test/dev hook: resets tripwire counters AND the lock to the sentinel. */
export function resetActiveModelLockForTests(): void {
    currentActiveModel = { ...UNLOCKED };
    gatewayActiveOverride = null;
    windowStart = 0;
    windowCount = 0;
    stormActive = false;
    lastCallAt = 0;
    stormLogged = false;
}

/**
 * Rolling-window tripwire. Returns true when the caller must DROP the call.
 *
 * - Healthy traffic (< threshold per rolling second) passes through.
 * - The call that crosses the threshold declares the storm, logs ONCE with
 *   the first offending call's stack, and is itself dropped.
 * - While a storm is active every call is dropped; the storm ends only after
 *   SYNC_LOOP_QUIET_PERIOD_MS with NO calls at all, at which point the next
 *   call is admitted and the window restarts clean.
 */
export function shouldDropSetActiveModelCall(now: number): boolean {
    if (stormActive) {
        if (now - lastCallAt >= SYNC_LOOP_QUIET_PERIOD_MS) {
            // Quiet period satisfied: storm over, admit this call with a fresh window.
            stormActive = false;
            stormLogged = false;
            windowStart = now;
            windowCount = 1;
            lastCallAt = now;
            return false;
        }
        lastCallAt = now;
        return true;
    }

    if (now - windowStart >= SYNC_LOOP_WINDOW_MS) {
        windowStart = now;
        windowCount = 1;
        lastCallAt = now;
        return false;
    }

    windowCount += 1;
    lastCallAt = now;
    if (windowCount > SYNC_LOOP_MAX_CALLS_PER_WINDOW) {
        stormActive = true;
        if (!stormLogged) {
            stormLogged = true;
            const stack = new Error('SYNC-LOOP first offending call').stack || '(stack unavailable)';
            console.error(
                `[SYNC-LOOP] set-active-model storm detected: ${windowCount} calls within ` +
                `${SYNC_LOOP_WINDOW_MS}ms (threshold: ${SYNC_LOOP_MAX_CALLS_PER_WINDOW}/window). ` +
                `Dropping further calls until ${SYNC_LOOP_QUIET_PERIOD_MS}ms of quiet. ` +
                `First offending call stack:\n${stack}`
            );
        }
        return true;
    }
    return false;
}

/**
 * Primitive equality for the active-model triple. Compares provider AND
 * model (and auto flag) as string/boolean primitives — never object
 * references.
 */
export function isSameActiveModelTriple(a: ActiveModelTriple, b: ActiveModelTriple): boolean {
    return a.providerId === b.providerId && a.modelId === b.modelId && a.isAutoMode === b.isAutoMode;
}

/**
 * Pure normalization shared by every lock entry point: blank provider/model
 * fall back to the given defaults; 'auto' provider or an explicit auto flag
 * engages adaptive routing (blank model).
 */
export function normalizeActiveModelTriple(
    config: { providerId?: string; modelId?: string; isAutoMode?: boolean } | null | undefined,
    defaultProvider: string,
    defaultModel: string
): ActiveModelTriple {
    const p = (config?.providerId || defaultProvider).trim();
    const m = (config?.modelId || defaultModel).trim();
    const isAuto = Boolean(config?.isAutoMode || p === 'auto');
    return {
        providerId: isAuto ? 'auto' : p,
        modelId: isAuto ? '' : m,
        isAutoMode: isAuto
    };
}

export interface LockActiveModelResult {
    /** True when the lock actually transitioned (caller may log/broadcast). */
    changed: boolean;
    /** The triple now locked (post-call state). */
    triple: ActiveModelTriple;
}

/**
 * Idempotent lock entry point. Applies the tripwire first, then normalizes,
 * then compares primitives against the current lock. An identical re-lock
 * returns changed:false and touches NOTHING.
 */
export function lockActiveModel(
    config: { providerId?: string; modelId?: string; isAutoMode?: boolean } | null | undefined,
    defaultProvider: string,
    defaultModel: string
): LockActiveModelResult {
    if (shouldDropSetActiveModelCall(Date.now())) {
        return { changed: false, triple: { ...currentActiveModel } };
    }

    const next = normalizeActiveModelTriple(config, defaultProvider, defaultModel);
    if (isSameActiveModelTriple(currentActiveModel, next)) {
        return { changed: false, triple: { ...currentActiveModel } };
    }

    currentActiveModel = next;
    gatewayActiveOverride = { providerId: next.providerId, modelId: next.modelId };
    return { changed: true, triple: { ...next } };
}

/** Read-only access for routing (same shape/semantics as before the split). */
export function getActiveModel(): ActiveModelTriple {
    return { ...currentActiveModel };
}

/** Read-only mirror of the locked pair (blank while unlocked). */
export function getGatewayActiveOverride(): { providerId: string; modelId: string } | null {
    return { providerId: currentActiveModel.providerId, modelId: currentActiveModel.modelId };
}

/**
 * Diagnostics for the dev-only storm generator hook: true once a storm has
 * been declared since the last reset (or is currently active).
 */
export function hasSyncLoopStormFired(): boolean {
    return stormLogged || stormActive;
}

/**
 * Primitive pair comparison used by the IPC handler to decide whether a
 * resolved selection differs from the previously persisted one (skip
 * saveSettings + broadcast when identical).
 */
export function activePairChanged(
    before: { providerId: string; modelId: string },
    after: { providerId: string; modelId: string }
): boolean {
    return before.providerId !== after.providerId || before.modelId !== after.modelId;
}
