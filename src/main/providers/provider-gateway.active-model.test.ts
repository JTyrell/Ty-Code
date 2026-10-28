import { describe, it, expect, vi, beforeEach } from 'vitest';

// The gateway's import graph pulls Electron-touched modules; the unit under
// test here is only the active-model lock wiring, so the heavy edges are
// mocked at their boundary.
vi.mock('electron', () => ({
    BrowserWindow: class { },
    app: { isReady: () => true, getPath: () => '/tmp', isPackaged: true },
    safeStorage: { isEncryptionAvailable: () => true, encryptString: (v: string) => Buffer.from(v), decryptString: (v: Buffer) => String(v) },
    ipcMain: { handle: () => undefined, on: () => undefined }
}));
vi.mock('../ipc/settings-handlers', () => ({
    readStoredCredentials: async () => ({ keys: {} }),
    getProviderSettings: async () => ({ success: true, data: { apiKeys: {} } })
}));
vi.mock('../services/orchestration/user-preferences', () => ({
    userPreferences: { updatePreferences: vi.fn().mockResolvedValue(undefined) }
}));

import { ProviderGateway } from './provider-gateway';
import { resetActiveModelLockForTests } from './active-model-lock';

describe('ProviderGateway.setActiveModel echo-loop hardening', () => {
    beforeEach(() => {
        resetActiveModelLockForTests();
    });

    it('locking the same pair twice emits exactly ONE lock line', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const config = { providerId: 'ty-code-free', modelId: 'google/gemma-4-31b-it:free', isAutoMode: false };

        ProviderGateway.setActiveModel(config);
        ProviderGateway.setActiveModel(config);
        ProviderGateway.setActiveModel(config);

        const lockLines = logSpy.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('[GATEWAY] Active model locked to:'));
        expect(lockLines).toHaveLength(1);
        expect(lockLines[0]).toContain('provider=ty-code-free');
        logSpy.mockRestore();
    });

    it('a genuine change emits exactly one new lock line per transition', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        ProviderGateway.setActiveModel({ providerId: 'groq', modelId: 'openai/gpt-oss-120b', isAutoMode: false });
        ProviderGateway.setActiveModel({ providerId: 'groq', modelId: 'openai/gpt-oss-120b', isAutoMode: false });
        ProviderGateway.setActiveModel({ providerId: 'openai', modelId: 'gpt-4o', isAutoMode: false });
        ProviderGateway.setActiveModel({ providerId: 'openai', modelId: 'gpt-4o', isAutoMode: false });

        const lockLines = logSpy.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('[GATEWAY] Active model locked to:'));
        expect(lockLines).toHaveLength(2);
        logSpy.mockRestore();
    });

    it('the storm tripwire sheds a 100-call burst: one lock line, one [SYNC-LOOP] error', () => {
        const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { });
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => { });
        const config = { providerId: 'ty-code-free', modelId: 'google/gemma-4-31b-it:free', isAutoMode: false };

        for (let i = 0; i < 100; i++) ProviderGateway.setActiveModel(config);

        const lockLines = logSpy.mock.calls.map((c) => String(c[0])).filter((line) => line.includes('[GATEWAY] Active model locked to:'));
        expect(lockLines).toHaveLength(1);
        expect(errSpy).toHaveBeenCalledTimes(1);
        expect(String(errSpy.mock.calls[0]?.[0])).toContain('[SYNC-LOOP] set-active-model storm detected');
        logSpy.mockRestore();
        errSpy.mockRestore();
    });
});
