import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    shouldDropSetActiveModelCall,
    lockActiveModel,
    isSameActiveModelTriple,
    activePairChanged,
    normalizeActiveModelTriple,
    resetActiveModelLockForTests,
    hasSyncLoopStormFired,
    SYNC_LOOP_MAX_CALLS_PER_WINDOW,
    SYNC_LOOP_QUIET_PERIOD_MS
} from './active-model-lock';

describe('active-model-lock: storm tripwire (permanent instrumentation)', () => {
    beforeEach(() => resetActiveModelLockForTests());

    it('admits healthy traffic below the threshold', () => {
        const t0 = 1_000_000;
        for (let i = 0; i < SYNC_LOOP_MAX_CALLS_PER_WINDOW; i++) {
            expect(shouldDropSetActiveModelCall(t0 + i)).toBe(false);
        }
    });

    it('declares a storm on the excess call, logs ONCE with a stack, and drops it', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const t0 = 2_000_000;
        for (let i = 0; i < SYNC_LOOP_MAX_CALLS_PER_WINDOW; i++) {
            shouldDropSetActiveModelCall(t0 + i);
        }
        expect(shouldDropSetActiveModelCall(t0 + SYNC_LOOP_MAX_CALLS_PER_WINDOW)).toBe(true);
        expect(errSpy).toHaveBeenCalledTimes(1);
        const message = String(errSpy.mock.calls[0]?.[0]);
        expect(message).toContain('[SYNC-LOOP] set-active-model storm detected');
        expect(message).toContain('at '); // captured stack of the first offending call
        expect(hasSyncLoopStormFired()).toBe(true);
        errSpy.mockRestore();
    });

    it('keeps dropping during the storm (no extra logs) and resumes after 2s of quiet', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const t0 = 3_000_000;
        for (let i = 0; i <= SYNC_LOOP_MAX_CALLS_PER_WINDOW; i++) shouldDropSetActiveModelCall(t0 + i);
        for (let i = 0; i < 50; i++) {
            expect(shouldDropSetActiveModelCall(t0 + SYNC_LOOP_MAX_CALLS_PER_WINDOW + 1 + i)).toBe(true);
        }
        expect(errSpy).toHaveBeenCalledTimes(1);
        // Complete silence for the quiet period, then the next call is admitted.
        const afterQuiet = t0 + SYNC_LOOP_MAX_CALLS_PER_WINDOW + 100 + SYNC_LOOP_QUIET_PERIOD_MS;
        expect(shouldDropSetActiveModelCall(afterQuiet)).toBe(false);
        // Window reset cleanly: a fresh burst below the threshold passes again.
        for (let i = 1; i < SYNC_LOOP_MAX_CALLS_PER_WINDOW; i++) {
            expect(shouldDropSetActiveModelCall(afterQuiet + i)).toBe(false);
        }
        errSpy.mockRestore();
    });

    it('never ends the storm while calls keep flowing (quiet clock runs on silence only)', () => {
        const t0 = 4_000_000;
        for (let i = 0; i <= SYNC_LOOP_MAX_CALLS_PER_WINDOW; i++) shouldDropSetActiveModelCall(t0 + i);
        for (let i = 1; i <= 30; i++) {
            expect(shouldDropSetActiveModelCall(t0 + SYNC_LOOP_MAX_CALLS_PER_WINDOW + i * 100)).toBe(true);
        }
    });
});

describe('active-model-lock: idempotent lock (primitive comparison)', () => {
    beforeEach(() => resetActiveModelLockForTests());

    it('locking the same pair twice: first transitions, second is a full no-op', () => {
        const first = lockActiveModel(
            { providerId: 'ty-code-free', modelId: 'google/gemma-4-31b-it:free', isAutoMode: false },
            'ty-code-free',
            'google/gemma-4-31b-it:free'
        );
        expect(first.changed).toBe(true);
        const second = lockActiveModel(
            { providerId: 'ty-code-free', modelId: 'google/gemma-4-31b-it:free', isAutoMode: false },
            'ty-code-free',
            'google/gemma-4-31b-it:free'
        );
        expect(second.changed).toBe(false);
        expect(second.triple).toEqual(first.triple);
    });

    it('compares BOTH provider AND model as primitives — any difference transitions', () => {
        lockActiveModel({ providerId: 'groq', modelId: 'openai/gpt-oss-120b', isAutoMode: false }, 'dp', 'dm');
        expect(lockActiveModel({ providerId: 'groq', modelId: 'openai/gpt-oss-20b', isAutoMode: false }, 'dp', 'dm').changed).toBe(true);
        expect(lockActiveModel({ providerId: 'groq', modelId: 'openai/gpt-oss-20b', isAutoMode: false }, 'dp', 'dm').changed).toBe(false);
        expect(lockActiveModel({ providerId: 'openai', modelId: 'openai/gpt-oss-20b', isAutoMode: false }, 'dp', 'dm').changed).toBe(true);
    });

    it('isSameActiveModelTriple uses primitives, never object identity', () => {
        const a = { providerId: 'p', modelId: 'm', isAutoMode: false };
        const b = { providerId: 'p', modelId: 'm', isAutoMode: false };
        expect(a).not.toBe(b);
        expect(isSameActiveModelTriple(a, b)).toBe(true);
        expect(isSameActiveModelTriple(a, { ...b, modelId: 'm2' })).toBe(false);
    });

    it('the first lock after boot is always a genuine transition (sentinel state)', () => {
        const first = lockActiveModel(
            { providerId: 'ty-code-free', modelId: 'google/gemma-4-31b-it:free', isAutoMode: false },
            'ty-code-free',
            'google/gemma-4-31b-it:free'
        );
        expect(first.changed).toBe(true);
    });

    it('normalizes auto mode and blank values', () => {
        expect(normalizeActiveModelTriple({ providerId: 'auto', modelId: 'x', isAutoMode: false }, 'dp', 'dm')).toEqual({
            providerId: 'auto',
            modelId: '',
            isAutoMode: true
        });
        expect(normalizeActiveModelTriple(null, 'dp', 'dm')).toEqual({ providerId: 'dp', modelId: 'dm', isAutoMode: false });
    });
});

describe('active-model-lock: pair comparison helper (broadcast suppression)', () => {
    it('activePairChanged compares provider+model primitives', () => {
        expect(activePairChanged({ providerId: 'a', modelId: 'm' }, { providerId: 'a', modelId: 'm' })).toBe(false);
        expect(activePairChanged({ providerId: 'a', modelId: 'm' }, { providerId: 'a', modelId: 'm2' })).toBe(true);
        expect(activePairChanged({ providerId: 'a', modelId: 'm' }, { providerId: 'b', modelId: 'm' })).toBe(true);
    });
});
