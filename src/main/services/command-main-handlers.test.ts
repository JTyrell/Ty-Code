/**
 * Main-process command backends — unit tests.
 *
 * Runs under `vitest.main.config.ts`, which is plain Node with no Electron. That
 * is the point: every Electron-specific behaviour these handlers depend on is
 * injected through `MainCommandAdapters`, so the logic is checked here with
 * fakes and the real wiring lives in `command-main-adapters.ts`.
 */

import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  createMainCommandHandlers,
  createMainContextProvider,
  FccSidecarStatusResultSchema,
  MAIN_BACKED_COMMANDS,
  MAIN_DEFERRED_COMMANDS,
  MainOwnedContextSchema,
  UpdateCheckCommandResultSchema,
  type MainCommandAdapters,
  type UpdateCheckInput,
  type FccSidecarStatusInput
} from './command-main-handlers';
import type { CommandHandlerContext } from './command-executor';
import {
  findBrandToken,
  getCommandEntry,
  listRequiredHandlers
} from './command-registry';

/** What the fakes record, so tests assert on effects rather than return values. */
interface AdapterCalls {
  opened: Array<string | undefined>;
  closed: Array<number | undefined>;
  quits: number;
  devToolsToggles: Array<number | undefined>;
}

function healthyFcc(): FccSidecarStatusInput {
  return {
    running: true,
    port: 8765,
    pid: 4242,
    health: 'healthy',
    version: '0.9.4',
    mode: 'native-sidecar',
    providersCount: 3,
    restartCount: 0,
    uptimeSeconds: 128,
    freeTokensAllocated: 1_300_000_000,
    freeTokensUsed: 250_000
  };
}

function createFakeAdapters(overrides: Partial<MainCommandAdapters> = {}) {
  const calls: AdapterCalls = { opened: [], closed: [], quits: 0, devToolsToggles: [] };
  const adapters: MainCommandAdapters = {
    openWindow: (reveal) => {
      calls.opened.push(reveal);
    },
    closeWindow: (windowId) => {
      calls.closed.push(windowId);
      return true;
    },
    quit: () => {
      calls.quits += 1;
    },
    toggleDevTools: (windowId) => {
      calls.devToolsToggles.push(windowId);
      return true;
    },
    checkForUpdates: async () => ({ updateAvailable: false, currentVersion: '1.0.0' }),
    fccStatus: () => healthyFcc(),
    contexts: {
      devToolsAllowed: () => true,
      updatersAvailable: () => true,
      workspaceOpen: () => true,
      configurationsExist: () => false
    },
    ...overrides
  };
  return { adapters, calls };
}

/** A real registry entry, so handlers are exercised with the table as shipped. */
function handlerContext(entryId: string, windowId?: number): CommandHandlerContext {
  const entry = getCommandEntry(entryId);
  if (!entry) throw new Error(`test fixture references unknown entry '${entryId}'`);
  return { entry, args: {}, contexts: {}, windowId };
}

describe('main command handler coverage', () => {
  it('registers exactly the keys it advertises', () => {
    const { adapters } = createFakeAdapters();
    const handlers = createMainCommandHandlers(adapters);
    expect(Object.keys(handlers).sort()).toEqual([...MAIN_BACKED_COMMANDS].sort());
  });

  it('accounts for every main-target command in the shipped registry', () => {
    // The audit that makes "hidden > dead" enforceable: a registry entry whose
    // command main cannot run must be listed as deferred on purpose, otherwise
    // it silently becomes a row the renderer hides with nobody knowing why.
    const { main } = listRequiredHandlers();
    const backed = new Set<string>(MAIN_BACKED_COMMANDS);
    const unaccounted = main.filter((key) => !backed.has(key) && !(key in MAIN_DEFERRED_COMMANDS));
    expect(unaccounted).toEqual([]);
  });

  it('never lists a command as both backed and deferred', () => {
    const overlap = Object.keys(MAIN_DEFERRED_COMMANDS).filter((key) =>
      (MAIN_BACKED_COMMANDS as readonly string[]).includes(key)
    );
    expect(overlap).toEqual([]);
  });

  it('gives every deferred command a reason naming its missing backend', () => {
    for (const [key, reason] of Object.entries(MAIN_DEFERRED_COMMANDS)) {
      expect(reason.length, `${key} needs an explanatory reason`).toBeGreaterThan(10);
      expect(findBrandToken(reason, key)).toBeUndefined();
    }
  });

  it('leaves the deferred process explorer unregistered so the row is hidden', () => {
    const { adapters } = createFakeAdapters();
    const handlers = createMainCommandHandlers(adapters);
    expect(handlers).not.toHaveProperty('window.openProcessExplorer');
  });
});

describe('main-owned contexts', () => {
  it('strips a renderer-owned key instead of letting main clobber it', () => {
    // Merged *over* the calling window's snapshot, so a stray `editorOpen` here
    // would grey out the whole Go menu in every window. Declaring it via a
    // variable sidesteps the excess-property check and proves the runtime guard.
    const leaked = {
      devToolsAllowed: true,
      updatersAvailable: true,
      workspaceOpen: true,
      configurationsExist: true,
      editorOpen: false
    };
    const parsed = MainOwnedContextSchema.parse(leaked);
    expect(parsed).not.toHaveProperty('editorOpen');
    expect(Object.keys(parsed).sort()).toEqual([
      'configurationsExist',
      'devToolsAllowed',
      'updatersAvailable',
      'workspaceOpen'
    ]);
  });

  it('re-reads the adapters on every call so a menu never paints stale state', () => {
    let workspaceOpen = false;
    const { adapters } = createFakeAdapters({
      contexts: {
        devToolsAllowed: () => true,
        updatersAvailable: () => true,
        workspaceOpen: () => workspaceOpen,
        configurationsExist: () => false
      }
    });
    const provider = createMainContextProvider(adapters);

    expect(provider().workspaceOpen).toBe(false);
    workspaceOpen = true;
    expect(provider().workspaceOpen).toBe(true);
  });

  it('reports only the four keys main owns', () => {
    const { adapters } = createFakeAdapters();
    expect(createMainContextProvider(adapters)()).toEqual({
      devToolsAllowed: true,
      updatersAvailable: true,
      workspaceOpen: true,
      configurationsExist: false
    });
  });
});

describe('window and app commands', () => {
  it('opens a plain workbench window for New Window', async () => {
    const { adapters, calls } = createFakeAdapters();
    const result = await createMainCommandHandlers(adapters)['window.newWindow'](
      {},
      handlerContext('file.new-window')
    );
    expect(calls.opened).toEqual([undefined]);
    expect(result).toEqual({ opened: true });
  });

  it('carries the terminal reveal for New Terminal Window', async () => {
    const { adapters, calls } = createFakeAdapters();
    const result = await createMainCommandHandlers(adapters)['terminal.newWindow'](
      {},
      handlerContext('terminal.new-window')
    );
    // The reveal travels in the load hash: an event sent before the new
    // renderer subscribes would be lost, a hash survives its boot ordering.
    expect(calls.opened).toEqual(['terminal']);
    expect(result).toEqual({ opened: true, reveal: 'terminal' });
  });

  it('closes the window that originated the activation', async () => {
    const { adapters, calls } = createFakeAdapters();
    const result = await createMainCommandHandlers(adapters)['window.close'](
      {},
      handlerContext('file.close-window', 7)
    );
    expect(calls.closed).toEqual([7]);
    expect(result).toEqual({ closed: true });
  });

  it('reports a close that found no window instead of claiming success', async () => {
    const { adapters } = createFakeAdapters({ closeWindow: () => false });
    const result = await createMainCommandHandlers(adapters)['window.close'](
      {},
      handlerContext('file.close-window')
    );
    expect(result).toEqual({ closed: false });
  });

  it('quits the application', async () => {
    const { adapters, calls } = createFakeAdapters();
    const result = await createMainCommandHandlers(adapters)['app.quit'](
      {},
      handlerContext('file.exit')
    );
    expect(calls.quits).toBe(1);
    expect(result).toEqual({ quitting: true });
  });

  it('toggles devtools on the calling window and reports a refusal', async () => {
    const { adapters, calls } = createFakeAdapters();
    const handlers = createMainCommandHandlers(adapters);
    await handlers['window.toggleDevTools']({}, handlerContext('help.toggle-dev-tools', 3));
    expect(calls.devToolsToggles).toEqual([3]);

    const refused = createFakeAdapters({ toggleDevTools: () => false });
    const result = await createMainCommandHandlers(refused.adapters)['window.toggleDevTools'](
      {},
      handlerContext('help.toggle-dev-tools')
    );
    expect(result).toEqual({ toggled: false });
  });
});

describe('Check for Updates reports a visible result', () => {
  async function runCheck(result: UpdateCheckInput) {
    const { adapters } = createFakeAdapters({ checkForUpdates: async () => result });
    const raw = await createMainCommandHandlers(adapters)['app.checkForUpdates'](
      {},
      handlerContext('help.check-for-updates')
    );
    return UpdateCheckCommandResultSchema.parse(raw);
  }

  it('names the new version when one is available', async () => {
    const result = await runCheck({
      updateAvailable: true,
      currentVersion: '1.0.0',
      latestVersion: '1.1.0'
    });
    expect(result.summary).toBe('Ty-Code 1.1.0 is available (you are on 1.0.0).');
    expect(result.updateAvailable).toBe(true);
  });

  it('still reports availability when the version is unknown', async () => {
    const result = await runCheck({ updateAvailable: true, currentVersion: '1.0.0' });
    expect(result.summary).toBe('An update is available (you are on 1.0.0).');
  });

  it('says up to date only when a check really ran', async () => {
    const result = await runCheck({ updateAvailable: false, currentVersion: '1.0.0' });
    expect(result.summary).toBe('Ty-Code is up to date (1.0.0).');
  });

  it('does not claim an up-to-date verdict for a development build', async () => {
    // The update manager short-circuits in dev and returns "no update" without
    // touching the network. Reporting that as "up to date" would be a canned
    // answer standing in for a check that never happened.
    const result = await runCheck({
      updateAvailable: false,
      currentVersion: '1.0.0',
      latestVersion: '1.0.0',
      releaseNotes: 'Application is running in development mode.',
      devMode: true
    });
    expect(result.summary).toBe('Update checking needs a packaged build (running 1.0.0).');
  });

  it('surfaces the failure rather than swallowing it', async () => {
    const result = await runCheck({
      updateAvailable: false,
      currentVersion: '1.0.0',
      error: 'net::ERR_INTERNET_DISCONNECTED'
    });
    expect(result.summary).toBe('Update check could not complete: net::ERR_INTERNET_DISCONNECTED');
  });

  it('keeps the structured fields alongside the sentence', async () => {
    const result = await runCheck({
      updateAvailable: true,
      currentVersion: '1.0.0',
      latestVersion: '1.1.0',
      releaseDate: '2026-10-01'
    });
    expect(result.latestVersion).toBe('1.1.0');
    expect(result.releaseDate).toBe('2026-10-01');
  });

  it('rejects a malformed updater payload instead of rendering undefined', async () => {
    const { adapters } = createFakeAdapters({
      // `currentVersion` missing: the schema must fail loudly here rather than
      // let "Ty-Code is up to date (undefined)" reach a toast.
      checkForUpdates: async () => ({ updateAvailable: false }) as unknown as UpdateCheckInput
    });
    await expect(
      createMainCommandHandlers(adapters)['app.checkForUpdates'](
        {},
        handlerContext('help.check-for-updates')
      )
    ).rejects.toThrow();
  });
});

describe('FCC sidecar status reports a visible result', () => {
  async function runFcc(status: FccSidecarStatusInput) {
    const { adapters } = createFakeAdapters({ fccStatus: () => status });
    const raw = await createMainCommandHandlers(adapters)['fcc.sidecarStatus'](
      {},
      handlerContext('tycode.fcc-sidecar-status')
    );
    return FccSidecarStatusResultSchema.parse(raw);
  }

  it('reports a healthy sidecar with its port and provider count', async () => {
    const result = await runFcc(healthyFcc());
    expect(result.summary).toBe(
      'FCC sidecar is healthy on port 8765 (v0.9.4, 3 providers).'
    );
    expect(result.pid).toBe(4242);
    expect(result.uptimeSeconds).toBe(128);
  });

  it('singularises one provider', async () => {
    const result = await runFcc({ ...healthyFcc(), providersCount: 1 });
    expect(result.summary).toContain('1 provider).');
  });

  it('reports degradation as degradation', async () => {
    const result = await runFcc({ ...healthyFcc(), health: 'degraded' });
    expect(result.summary).toBe('FCC sidecar is degraded on port 8765 (v0.9.4, 3 providers).');
  });

  it('reports a stopped sidecar without inventing a port health', async () => {
    const result = await runFcc({ ...healthyFcc(), running: false });
    expect(result.summary).toBe('FCC sidecar is not running.');
  });

  it('reports a contradictory reading instead of guessing', async () => {
    // `running` with health `stopped` happens mid-restart; the honest move is to
    // echo what was observed rather than pick one of the two.
    const result = await runFcc({ ...healthyFcc(), health: 'stopped' });
    expect(result.summary).toBe("FCC sidecar reports 'stopped' on port 8765 (v0.9.4).");
  });

  it('rejects a malformed status payload', () => {
    const { adapters } = createFakeAdapters({
      fccStatus: () => ({ running: true }) as unknown as FccSidecarStatusInput
    });
    // This handler is synchronous, unlike `app.checkForUpdates`: the sidecar
    // manager reports live state, so there is nothing to await, and asserting a
    // rejection here would be testing a calling convention the code never
    // promised. The executor invokes handlers as `await handler(...)` inside a
    // `try`, which captures a synchronous throw exactly like a rejection and
    // records it as `handler_threw` — so what matters is that a bad payload
    // stops here instead of reaching a summary rendered as `undefined`.
    expect(() =>
      createMainCommandHandlers(adapters)['fcc.sidecarStatus'](
        {},
        handlerContext('tycode.fcc-sidecar-status')
      )
    ).toThrow(ZodError);
  });
});

describe('user-facing strings carry no third-party branding', () => {
  it('keeps every summary free of forbidden and ambiguous tokens', async () => {
    const { adapters } = createFakeAdapters({
      checkForUpdates: async () => ({
        updateAvailable: true,
        currentVersion: '1.0.0',
        latestVersion: '1.1.0'
      })
    });
    const handlers = createMainCommandHandlers(adapters);

    const update = UpdateCheckCommandResultSchema.parse(
      await handlers['app.checkForUpdates']({}, handlerContext('help.check-for-updates'))
    );
    const fcc = FccSidecarStatusResultSchema.parse(
      await handlers['fcc.sidecarStatus']({}, handlerContext('tycode.fcc-sidecar-status'))
    );

    expect(findBrandToken(update.summary)).toBeUndefined();
    expect(findBrandToken(fcc.summary)).toBeUndefined();
  });
});
