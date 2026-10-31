/**
 * Task runner contract tests (Prompt 5b Step 4: Terminal menu).
 *
 * Proves the three properties the Terminal menu's task rows depend on:
 *
 *  - **A task finishes when its sentinel says so, not when the PTY does.** Tasks
 *    run in a persistent interactive shell that stays alive, so completion is a
 *    marker in the output stream — and the shell echoes that marker back before
 *    running it, which is the bug these tests exist to keep fixed.
 *  - **Discovery may fail without failing the menu.** A bad `tasks.json` yields
 *    an empty list *and* the reason, so Run Task… explains itself instead of
 *    showing nothing.
 *  - **Every decline is a sentence.** Nothing here throws out of an IPC
 *    boundary; a refusal names what is missing and what to do about it.
 *
 * Runs in pure Node — no Electron, no PTY, no files on disk. Every effect is
 * injected through `TaskRunnerDeps`, and the three deterministic stubs
 * (`delay`, `now`, `randomRunId`) are what make the lifecycle assertions exact.
 */

import path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_TRACKED_TASK_RUNS,
  TASKS_DIR_NAME,
  TASKS_FILE_NAME,
  TASKS_SCAFFOLD
} from '../../shared/types/tasks';
import {
  createTaskRunner,
  parseJsonLoose,
  resolveShellFlavour,
  scanForSentinel,
  sentinelFor,
  stripTrailingCommas,
  wrapWithSentinel,
  type TaskRunner,
  type TaskRunnerDeps,
  type TaskTerminalLike
} from './task-runner-service';

/**
 * A literal rather than a temp dir, and POSIX-shaped on purpose: `quoteArg`
 * leaves `/repo/dist` unquoted but would quote a Windows path, so building the
 * workspace path with `path.join` would make the argument-quoting assertions
 * pass on one platform and fail on the other.
 */
const WORKSPACE = '/repo';
const TASKS_PATH = path.join(WORKSPACE, TASKS_DIR_NAME, TASKS_FILE_NAME);
const PACKAGE_PATH = path.join(WORKSPACE, 'package.json');
const RELPATH = path.join(TASKS_DIR_NAME, TASKS_FILE_NAME);
const NOW = 1_700_000_000_000;
const SENT = sentinelFor('run1');

describe('task runner service (Prompt 5b Step 4)', () => {
  const logged: string[] = [];
  const warned: string[] = [];

  interface Harness {
    runner: TaskRunner;
    /** Everything written to a terminal, in order. */
    writes: Array<{ command: string; terminalId: string; execute: boolean }>;
    /** The `cwd` each terminal resolution was asked for. */
    resolves: Array<{ cwd: string | undefined }>;
    /** Milliseconds each restart waited before writing. */
    delays: number[];
    /** runId lists pushed to subscribers, in order. */
    snapshots: string[][];
    /** Which PTY observers `dispose()` detached, in order. */
    detached: string[];
    control: {
      dispatch: 'ok' | 'refused' | 'error';
      dispatchReason: string;
      terminalError: string | null;
      shell: TaskTerminalLike;
    };
    emit(terminalId: string, data: string): void;
    exitTerminal(terminalId: string, exitCode: number): void;
  }

  function makeHarness(files: Record<string, string> = {}): Harness {
    const store = new Map(Object.entries(files));
    const writes: Harness['writes'] = [];
    const resolves: Harness['resolves'] = [];
    const delays: number[] = [];
    const snapshots: string[][] = [];
    const detached: string[] = [];

    // Mutable so a test can flip the world under a live runner — a restart whose
    // write is refused, a shell that changed flavour, a terminal that vanished.
    const control = {
      dispatch: 'ok' as 'ok' | 'refused' | 'error',
      dispatchReason: 'The terminal is still starting.',
      terminalError: null as string | null,
      shell: { terminalId: 'term-1', shellId: 'bash', shellPath: '/bin/bash' } as TaskTerminalLike
    };

    let outputListener: ((terminalId: string, data: string) => void) | null = null;
    let exitListener: ((terminalId: string, exitCode: number) => void) | null = null;
    let issued = 0;

    const deps: TaskRunnerDeps = {
      resolveTerminal: (opts) => {
        resolves.push({ cwd: opts.cwd });
        const failure = control.terminalError;
        if (failure) return { success: false, error: failure };
        return { success: true, data: control.shell };
      },
      dispatchCommand: async (command, opts) => {
        writes.push({ command, terminalId: opts.terminalId, execute: opts.execute !== false });
        if (control.dispatch === 'error') return { success: false, error: 'The terminal bridge is gone.' };
        if (control.dispatch === 'refused') {
          return { success: true, data: { dispatched: false, reason: control.dispatchReason } };
        }
        return { success: true, data: { dispatched: true, terminalId: opts.terminalId } };
      },
      observeTerminalOutput: (listener) => {
        outputListener = listener;
        return () => {
          detached.push('output');
          outputListener = null;
        };
      },
      observeTerminalExit: (listener) => {
        exitListener = listener;
        return () => {
          detached.push('exit');
          exitListener = null;
        };
      },
      readFileOrNull: (absolutePath) => store.get(absolutePath) ?? null,
      // No real timers: a restart test must not wait 250 ms to prove it waited.
      delay: async (ms) => {
        delays.push(ms);
      },
      now: () => NOW,
      randomRunId: () => `run${(issued += 1)}`
    };

    const runner = createTaskRunner(deps);
    runner.subscribe((tasks) => snapshots.push(tasks.map((task) => task.runId)));

    return {
      runner,
      writes,
      resolves,
      delays,
      snapshots,
      detached,
      control,
      emit: (terminalId, data) => outputListener?.(terminalId, data),
      exitTerminal: (terminalId, exitCode) => exitListener?.(terminalId, exitCode)
    };
  }

  beforeEach(() => {
    logged.length = 0;
    warned.length = 0;
    // Captured into plain arrays rather than inspected as spies: `finish` logs
    // the outcome that no menu can show, and that log line is an assertion.
    vi.spyOn(console, 'info').mockImplementation((...args: unknown[]) => {
      logged.push(args.map(String).join(' '));
    });
    vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warned.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('shell flavour', () => {
    it('maps each registry shell id to the syntax it speaks', () => {
      expect(resolveShellFlavour('cmd', 'C:\\Windows\\System32\\cmd.exe')).toBe('cmd');
      expect(resolveShellFlavour('powershell', 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')).toBe(
        'powershell'
      );
      expect(resolveShellFlavour('pwsh', '/usr/bin/pwsh')).toBe('powershell');
      for (const shellId of ['bash', 'zsh', 'sh', 'git-bash', 'wsl', 'user-shell']) {
        expect(resolveShellFlavour(shellId, '/anything/at/all')).toBe('posix');
      }
    });

    it('sniffs the executable name for a custom shell, and falls back to posix', () => {
      expect(resolveShellFlavour('custom', 'C:\\Tools\\cmd.exe')).toBe('cmd');
      expect(resolveShellFlavour('custom', '/opt/pwsh-7/pwsh')).toBe('powershell');
      expect(resolveShellFlavour('custom', '/usr/local/bin/PowerShell')).toBe('powershell');
      // An unrecognised shell gets POSIX syntax rather than a refusal: `fish`
      // still runs `cmd; echo "…:$?"`, and guessing wrong is louder than asking.
      expect(resolveShellFlavour('custom', '/usr/bin/fish')).toBe('posix');
    });
  });

  describe('sentinel wrapping', () => {
    it('uses a separator that runs whatever the command did', () => {
      expect(wrapWithSentinel('npm run build', 'posix', 'run1')).toBe(`npm run build; echo "${SENT}:$?"`);
      expect(wrapWithSentinel('npm run build', 'cmd', 'run1')).toBe(
        `npm run build & echo ${SENT}:%errorlevel%`
      );
      expect(wrapWithSentinel('npm run build', 'powershell', 'run1')).toBe(
        `npm run build; Write-Host "${SENT}:$LASTEXITCODE"`
      );
      // `&&` short-circuits: a failing build would print no sentinel and its row
      // would sit in Show Running Task… until the app closed.
      expect(wrapWithSentinel('npm run build', 'posix', 'run1')).not.toContain('&&');
      expect(wrapWithSentinel('npm run build', 'cmd', 'run1')).not.toContain('&&');
    });

    it('puts the sentinel on its own line for a multi-line command', () => {
      const selection = 'cd packages\nnpm run build';
      expect(wrapWithSentinel(selection, 'posix', 'run1')).toBe(`${selection}\necho "${SENT}:$?"`);
      expect(wrapWithSentinel(selection, 'cmd', 'run1')).toBe(`${selection}\necho ${SENT}:%errorlevel%`);
      expect(wrapWithSentinel(selection, 'powershell', 'run1')).toBe(
        `${selection}\nWrite-Host "${SENT}:$LASTEXITCODE"`
      );
    });

    it('normalises CRLF and trailing whitespace before wrapping', () => {
      const wrapped = wrapWithSentinel('echo one\r\necho two\r\n  ', 'posix', 'run1');
      expect(wrapped).toBe(`echo one\necho two\necho "${SENT}:$?"`);
      expect(wrapped).not.toContain('\r');
    });

    it('gives every run a marker no other run can produce', () => {
      expect(sentinelFor('run1')).not.toBe(sentinelFor('run2'));
      expect(wrapWithSentinel('true', 'posix', 'run1')).not.toContain(sentinelFor('run2'));
    });
  });

  describe('sentinel scanning', () => {
    it('ignores the shell echoing the wrapped line back (regression)', () => {
      // A live PTY echoes what was written, so the marker reaches the stream
      // followed by the *name* of the exit-code variable. Reading only the first
      // occurrence and waiting out the 32-character bound reported this run as
      // finished during its first chunk of output — every build longer than a
      // line ended that way.
      const echoed = `npm run build; echo "${SENT}:$?"\r\n`;
      expect(scanForSentinel(echoed + 'x'.repeat(200), SENT)).toBeNull();
    });

    it('ignores a cmd echo however much output follows it (regression)', () => {
      const echoed = `npm run build & echo ${SENT}:%errorlevel%\r\n`;
      expect(scanForSentinel(echoed + 'y'.repeat(5_000), SENT)).toBeNull();
    });

    it('reads the exit code from the shell output that follows the echo', () => {
      const echoed = `npm run build; echo "${SENT}:$?"\r\n`;
      expect(scanForSentinel(`${echoed}${SENT}:0\r\n`, SENT)).toEqual({ exitCode: 0 });
      expect(scanForSentinel(`${echoed}${SENT}:1\r\n`, SENT)).toEqual({ exitCode: 1 });
      expect(scanForSentinel(`${echoed}${SENT}:130\r\n`, SENT)).toEqual({ exitCode: 130 });
    });

    it('waits through an unexpanded wrapper variable', () => {
      expect(scanForSentinel(`${SENT}:$?`, SENT)).toBeNull();
      expect(scanForSentinel(`${SENT}:$LASTEXITCODE` + 'z'.repeat(500), SENT)).toBeNull();
      expect(scanForSentinel(`${SENT}:%errorlevel%` + 'z'.repeat(500), SENT)).toBeNull();
    });

    it('reports a marker with no code once the bounded wait is passed', () => {
      expect(scanForSentinel(`${SENT}:` + 'a'.repeat(31), SENT)).toBeNull();
      const resolved = scanForSentinel(`${SENT}:` + 'a'.repeat(32), SENT);
      expect(resolved).not.toBeNull();
      // The code stays unknown rather than becoming 1: PowerShell prints the
      // marker with nothing after it while `$LASTEXITCODE` is unset, and
      // guessing a failure would turn a successful run red.
      expect(resolved?.exitCode).toBeUndefined();
    });

    it('returns null when the marker has not appeared at all', () => {
      expect(scanForSentinel('npm run build\r\nCompiling 42 files…\r\n', SENT)).toBeNull();
      expect(scanForSentinel('', SENT)).toBeNull();
      // A prefix of the marker, and a marker with no colon, are both still output.
      expect(scanForSentinel('__TYCODE_TASK_DONE_run1', SENT)).toBeNull();
      expect(scanForSentinel('__TYCODE_TASK_DONE_run1__', SENT)).toBeNull();
    });

    it('does not match another run\'s marker', () => {
      expect(scanForSentinel(`${sentinelFor('run2')}:0`, SENT)).toBeNull();
      expect(scanForSentinel('__TYCODE_TASK_DONE_run9__:0', SENT)).toBeNull();
    });

    it('reassembles a marker the PTY split across two chunks', () => {
      let tail = '';
      const feed = (chunk: string) => {
        tail = (tail + chunk).slice(-4_000);
        return scanForSentinel(tail, SENT);
      };
      expect(feed(`done\r\n${SENT.slice(0, 12)}`)).toBeNull();
      expect(feed(`${SENT.slice(12)}:0\r\n`)).toEqual({ exitCode: 0 });
    });
  });

  describe('JSONC parsing', () => {
    it('keeps a // that is inside a string', () => {
      // `node scripts//dev.js` and a URL both contain the comment marker; eating
      // them would silently rewrite the command the user configured.
      expect(parseJsonLoose('{ "command": "node scripts//dev.js https://example.com" }')).toEqual({
        command: 'node scripts//dev.js https://example.com'
      });
    });

    it('strips line and block comments', () => {
      const text = [
        '// the build',
        '{',
        '  /* inline */ "version": "2.0.0", // trailing',
        '  "tasks": []',
        '}'
      ].join('\n');
      expect(parseJsonLoose(text)).toEqual({ version: '2.0.0', tasks: [] });
    });

    it('treats an escaped quote as part of the string, not its end', () => {
      expect(parseJsonLoose('{ "a": "say \\"hi\\" // not a comment" }')).toEqual({
        a: 'say "hi" // not a comment'
      });
    });

    it('drops a trailing comma before a brace or bracket, but not inside a string', () => {
      expect(stripTrailingCommas('{ "a": 1, }')).toBe('{ "a": 1 }');
      expect(stripTrailingCommas('[ 1, 2, ]')).toBe('[ 1, 2 ]');
      expect(stripTrailingCommas('{ "a": "x," }')).toBe('{ "a": "x," }');
    });

    it('still throws on text that is not JSON at all', () => {
      expect(() => parseJsonLoose('not json')).toThrow();
    });
  });

  describe('discovery', () => {
    it('reports nothing to run when no workspace is open', () => {
      expect(makeHarness().runner.list(null)).toEqual({ tasks: [], source: 'none' });
    });

    it('reports nothing when the workspace declares neither file', () => {
      expect(makeHarness().runner.list(WORKSPACE)).toEqual({ tasks: [], source: 'none' });
    });

    it('prefers tasks.json outright over package.json scripts', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [{ label: 'from-tasks', command: 'echo tasks' }]
        }),
        [PACKAGE_PATH]: JSON.stringify({ scripts: { build: 'tsc', test: 'vitest run' } })
      });
      const list = runner.list(WORKSPACE);
      expect(list.source).toBe('tasks.json');
      expect(list.sourcePath).toBe(TASKS_PATH);
      // Precedence, not merge: npm rows beside tasks rows would offer the same
      // work twice with different working directories.
      expect(list.tasks.map((task) => task.id)).toEqual(['from-tasks']);
      expect(list.error).toBeUndefined();
    });

    it('reports an empty tasks.json as tasks.json, not as nothing found', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({ version: '2.0.0', tasks: [] }),
        [PACKAGE_PATH]: JSON.stringify({ scripts: { build: 'tsc' } })
      });
      const list = runner.list(WORKSPACE);
      // The file exists and was honoured. Falling through to package.json here
      // would offer rows the workspace explicitly replaced.
      expect(list.source).toBe('tasks.json');
      expect(list.tasks).toEqual([]);
      expect(list.error).toBeUndefined();
    });

    it('falls back to package.json scripts and marks npm run build as the build', () => {
      const { runner } = makeHarness({
        [PACKAGE_PATH]: JSON.stringify({
          name: 'x',
          scripts: { build: 'tsc', 'test:unit': 'vitest run', dev: 'node dev.js' }
        })
      });
      const list = runner.list(WORKSPACE);
      expect(list.source).toBe('package.json');
      expect(list.sourcePath).toBe(PACKAGE_PATH);
      expect(list.tasks).toEqual([
        { id: 'package:build', label: 'build', command: 'npm run build', source: 'package.json', isBuildDefault: true },
        { id: 'package:test:unit', label: 'test:unit', command: 'npm run test:unit', source: 'package.json', isBuildDefault: false },
        { id: 'package:dev', label: 'dev', command: 'npm run dev', source: 'package.json', isBuildDefault: false }
      ]);
    });

    it('explains an unparseable tasks.json instead of showing an empty menu', () => {
      const { runner } = makeHarness({ [TASKS_PATH]: '{ "tasks": [ }' });
      const list = runner.list(WORKSPACE);
      expect(list.tasks).toEqual([]);
      expect(list.source).toBe('none');
      expect(list.sourcePath).toBe(TASKS_PATH);
      // The note names the file, so the user knows what to go and fix.
      expect(list.error).toContain(`${RELPATH} could not be parsed`);
    });

    it('explains an unparseable package.json the same way', () => {
      const { runner } = makeHarness({ [PACKAGE_PATH]: '{ nope' });
      const list = runner.list(WORKSPACE);
      expect(list.source).toBe('none');
      expect(list.error).toContain('package.json could not be parsed');
    });

    it('accepts the JSONC VS Code itself writes and drops fields it does not honour', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: [
          '// See https://code.visualstudio.com/docs/editor/tasks',
          '{',
          '  "version": "2.0.0",',
          '  "tasks": [',
          '    {',
          '      "label": "build",',
          '      "type": "shell",',
          '      "command": "npm run build", // the real build',
          '      "problemMatcher": ["$tsc"],',
          '    },',
          '  ],',
          '}'
        ].join('\n')
      });
      const list = runner.list(WORKSPACE);
      expect(list.error).toBeUndefined();
      // `problemMatcher` is stripped rather than parsed and ignored: a build that
      // looks parsed but is not would be worse than one that says nothing.
      expect(list.tasks).toEqual([
        { id: 'build', label: 'build', command: 'npm run build', source: 'tasks.json', isBuildDefault: false }
      ]);
    });

    it('names every entry it could not honour', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'keep', command: 'echo keep' },
            { label: 'spawn', type: 'process', command: 'node x.js' },
            { label: 'nope', type: 'npm' },
            { label: 'nocommand', type: 'shell' },
            'a string entry'
          ]
        })
      });
      const list = runner.list(WORKSPACE);
      expect(list.tasks.map((task) => task.id)).toEqual(['keep']);
      expect(list.error).toContain('4 task(s) skipped');
      expect(list.error).toContain("a task of type 'process'");
      expect(list.error).toContain('an npm task with no script');
      expect(list.error).toContain("'nocommand' (no command)");
      expect(list.error).toContain('a malformed entry');
    });

    it('substitutes the workspace folder and warns about any other variable', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            {
              label: 'tool',
              command: 'node ${workspaceFolder}/tool.js',
              args: ['--out', '${workspaceFolder}/dist']
            },
            { label: 'mystery', command: 'echo ${input:which}' }
          ]
        })
      });
      const list = runner.list(WORKSPACE);
      expect(list.tasks[0].command).toBe(`node ${WORKSPACE}/tool.js --out ${WORKSPACE}/dist`);
      // Half-substituted is worse than unsubstituted, so the menu says which
      // variable it could not expand rather than running something and hoping.
      expect(list.error).toContain('a variable Ty-Code does not substitute');
    });

    it('substitutes the workspace into options.cwd', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'app', command: 'npm run build', options: { cwd: '${workspaceFolder}/packages/app' } }
          ]
        })
      });
      expect(runner.list(WORKSPACE).tasks[0].cwd).toBe(`${WORKSPACE}/packages/app`);
    });

    it('quotes an argument a shell would otherwise split', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [{ label: 'say', command: 'node build.js', args: ['a b', '', 'plain'] }]
        })
      });
      expect(runner.list(WORKSPACE).tasks[0].command).toBe('node build.js "a b" "" plain');
    });

    it('turns an npm entry into an npm run command', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [{ label: 'unit', type: 'npm', script: 'test:unit' }]
        })
      });
      expect(runner.list(WORKSPACE).tasks).toEqual([
        { id: 'unit', label: 'unit', command: 'npm run test:unit', source: 'tasks.json', isBuildDefault: false }
      ]);
    });

    it('promotes a lone build-group task instead of leaving Run Build Task… empty', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'watch', command: 'tsc -w' },
            { label: 'build', command: 'tsc', group: 'build' }
          ]
        })
      });
      const tasks = runner.list(WORKSPACE).tasks;
      expect(tasks.find((task) => task.id === 'build')?.isBuildDefault).toBe(true);
      expect(tasks.find((task) => task.id === 'watch')?.isBuildDefault).toBe(false);
    });

    it('respects an explicit isDefault beside other build tasks', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'build-a', command: 'a', group: { kind: 'build' } },
            { label: 'build-b', command: 'b', group: { kind: 'build', isDefault: true } }
          ]
        })
      });
      const tasks = runner.list(WORKSPACE).tasks;
      expect(tasks.find((task) => task.id === 'build-a')?.isBuildDefault).toBe(false);
      expect(tasks.find((task) => task.id === 'build-b')?.isBuildDefault).toBe(true);
    });

    it('leaves two unmarked build tasks ambiguous rather than guessing', () => {
      const { runner } = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'build-a', command: 'a', group: 'build' },
            { label: 'build-b', command: 'b', group: 'build' }
          ]
        })
      });
      // Guessing one would make Ctrl+Shift+B run the wrong build with nothing on
      // screen to say so.
      expect(runner.list(WORKSPACE).tasks.every((task) => task.isBuildDefault === false)).toBe(true);
    });

    it('discovers exactly the task Configure Tasks… scaffolds', () => {
      // The coupling this test exists for: the renderer writes `TASKS_SCAFFOLD`,
      // and discovery has to accept what it wrote, or Run Task… reports no tasks
      // immediately after the user configured some.
      const { runner } = makeHarness({ [TASKS_PATH]: TASKS_SCAFFOLD });
      const list = runner.list(WORKSPACE);
      expect(list.error).toBeUndefined();
      expect(list.tasks).toEqual([
        {
          id: 'echo',
          label: 'echo',
          command: 'echo Ty-Code task runner is working',
          source: 'tasks.json',
          isBuildDefault: false
        }
      ]);
    });

    it('caps discovery so a pathological file cannot build an unbounded menu', () => {
      const tasks = Array.from({ length: 600 }, (_, index) => ({
        label: `t${index}`,
        command: `echo ${index}`
      }));
      const { runner } = makeHarness({ [TASKS_PATH]: JSON.stringify({ version: '2.0.0', tasks }) });
      expect(runner.list(WORKSPACE).tasks).toHaveLength(500);
    });
  });

  describe('starting a run', () => {
    it('wraps an ad-hoc command with a sentinel and executes it', async () => {
      const harness = makeHarness();
      const result = await harness.runner.run({ command: 'npm run build' }, WORKSPACE);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({ runId: 'run1', terminalId: 'term-1', label: 'npm run build' });
      expect(harness.writes).toEqual([
        { command: `npm run build; echo "${SENT}:$?"`, terminalId: 'term-1', execute: true }
      ]);
      expect(harness.runner.hasRunning()).toBe(true);

      const [tracked] = harness.runner.listRunning();
      expect(tracked.runId).toBe('run1');
      expect(tracked.state).toBe('running');
      expect(tracked.terminalId).toBe('term-1');
      expect(tracked.startedAt).toBe(NOW);
      expect(tracked.definition).toEqual({
        id: expect.stringContaining('ad-hoc:'),
        label: 'npm run build',
        command: 'npm run build',
        source: 'ad-hoc'
      });
    });

    it('wraps for the shell the terminal actually resolved', async () => {
      const harness = makeHarness();
      harness.control.shell = {
        terminalId: 'term-cmd',
        shellId: 'cmd',
        shellPath: 'C:\\Windows\\System32\\cmd.exe'
      };
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      expect(harness.writes[0].command).toBe(`npm run build & echo ${SENT}:%errorlevel%`);
      expect(harness.writes[0].terminalId).toBe('term-cmd');
    });

    it('runs a discovered task by id, keeping its label and its own cwd', async () => {
      const harness = makeHarness({
        [TASKS_PATH]: JSON.stringify({
          version: '2.0.0',
          tasks: [
            { label: 'Build all', command: 'npm run build', options: { cwd: '${workspaceFolder}/app' } }
          ]
        })
      });
      const result = await harness.runner.run({ taskId: 'Build all' }, WORKSPACE);

      expect(result.success).toBe(true);
      expect(result.data?.label).toBe('Build all');
      expect(harness.runner.listRunning()[0].definition.cwd).toBe(`${WORKSPACE}/app`);
      // The task's cwd, not the workspace root: a monorepo build in the wrong
      // directory fails in a way that reads like a broken task.
      expect(harness.resolves).toEqual([{ cwd: `${WORKSPACE}/app` }]);
    });

    it('honours an explicit label for a long ad-hoc command', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'x'.repeat(180), label: 'Run Selected Text' }, WORKSPACE);
      expect(harness.runner.listRunning()[0].definition.label).toBe('Run Selected Text');
    });

    it('summarises a label-less command instead of showing a wall of text', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: `echo ${'y'.repeat(150)}` }, WORKSPACE);
      const label = harness.runner.listRunning()[0].definition.label;
      // 60 characters plus the ellipsis: the row has to fit on one menu line.
      expect(label.length).toBe(61);
      expect(label.endsWith('…')).toBe(true);
    });
  });

  describe('refusals carry a reason', () => {
    it('rejects a payload naming neither a task nor a command', async () => {
      const harness = makeHarness();
      const result = await harness.runner.run({}, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Nothing to run: the request named neither a task nor a command.');
      // A declined run must not touch the terminal at all.
      expect(harness.writes).toEqual([]);
    });

    it('rejects a malformed payload through the schema', async () => {
      const harness = makeHarness();
      const result = await harness.runner.run({ command: 42 }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Run-task request failed validation:');
      expect(harness.writes).toEqual([]);
    });

    it('explains a task id discovery no longer has', async () => {
      const harness = makeHarness({
        [TASKS_PATH]: JSON.stringify({ version: '2.0.0', tasks: [] })
      });
      const result = await harness.runner.run({ taskId: 'gone' }, WORKSPACE);
      expect(result.success).toBe(false);
      // The sentence says what to do, because the submenu the user clicked was
      // built from a file that has since changed.
      expect(result.error).toContain("No task called 'gone' was found");
      expect(result.error).toContain('reopen the submenu');
      expect(harness.writes).toEqual([]);
    });

    it('reports the terminal being unavailable', async () => {
      const harness = makeHarness();
      harness.control.terminalError = 'No terminal profile is configured.';
      const result = await harness.runner.run({ command: 'echo hi' }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toBe('No terminal profile is configured.');
      expect(harness.runner.hasRunning()).toBe(false);
    });

    it('tracks nothing when the dispatcher declines to write', async () => {
      const harness = makeHarness();
      harness.control.dispatch = 'refused';
      const result = await harness.runner.run({ command: 'echo hi' }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toBe('The terminal is still starting.');
      expect(harness.runner.hasRunning()).toBe(false);
      expect(harness.runner.listRunning()).toEqual([]);
    });

    it('surfaces a dispatch envelope failure', async () => {
      const harness = makeHarness();
      harness.control.dispatch = 'error';
      const result = await harness.runner.run({ command: 'echo hi' }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toBe('The terminal bridge is gone.');
      expect(harness.runner.hasRunning()).toBe(false);
    });

    it('enforces the tracked-run bound rather than growing without limit', async () => {
      const harness = makeHarness();
      for (let index = 0; index < MAX_TRACKED_TASK_RUNS; index += 1) {
        const started = await harness.runner.run({ command: `echo ${index}` }, WORKSPACE);
        expect(started.success).toBe(true);
      }
      const overflow = await harness.runner.run({ command: 'echo overflow' }, WORKSPACE);
      expect(overflow.success).toBe(false);
      expect(overflow.error).toBe(
        `${MAX_TRACKED_TASK_RUNS} tasks are already being tracked. Terminate one before starting another.`
      );
      expect(harness.runner.listRunning()).toHaveLength(MAX_TRACKED_TASK_RUNS);
    });
  });

  describe('completion', () => {
    it('drops the row when the sentinel reports success', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      expect(harness.runner.hasRunning()).toBe(true);

      // Echo first, then the task's own output — the order a real PTY delivers.
      harness.emit('term-1', `npm run build; echo "${SENT}:$?"\r\nCompiling 42 files…\r\n`);
      expect(harness.runner.hasRunning()).toBe(true);
      harness.emit('term-1', `${SENT}:0\r\n`);

      expect(harness.runner.hasRunning()).toBe(false);
      expect(harness.runner.listRunning()).toEqual([]);
      expect(logged.join('\n')).toContain("'npm run build' succeeded with exit code 0.");
    });

    it('records a non-zero code as a failure, and says so', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      harness.emit('term-1', `${SENT}:2\r\n`);
      expect(harness.runner.hasRunning()).toBe(false);
      // The log line is the only place the succeeded/failed distinction survives:
      // what crosses the wire about a finished task is the absence of its row.
      expect(logged.join('\n')).toContain("'npm run build' failed with exit code 2.");
    });

    it('completes a cmd run whose echo carries %errorlevel% (regression)', async () => {
      const harness = makeHarness();
      harness.control.shell = {
        terminalId: 'term-cmd',
        shellId: 'cmd',
        shellPath: 'C:\\Windows\\System32\\cmd.exe'
      };
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      harness.emit('term-cmd', `${harness.writes[0].command}\r\n`);
      harness.emit('term-cmd', 'build output\r\n'.repeat(20));
      // 280 characters of output past the echo: the old scan concluded here.
      expect(harness.runner.hasRunning()).toBe(true);
      harness.emit('term-cmd', `${SENT}:0\r\n`);
      expect(harness.runner.hasRunning()).toBe(false);
    });

    it('treats a marker with no code as an unknown-code completion, not a failure', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'Get-Process' }, WORKSPACE);
      harness.emit('term-1', `${SENT}:${'z'.repeat(64)}`);
      expect(harness.runner.hasRunning()).toBe(false);
      expect(logged.join('\n')).toContain("'Get-Process' succeeded with an unknown exit code.");
    });

    it('fails the run when the shell dies without printing a sentinel', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      harness.exitTerminal('term-1', 1);
      expect(harness.runner.hasRunning()).toBe(false);
      // Reporting success would be a guess about a command whose result is
      // unknowable; the shell's own code is attached instead.
      expect(logged.join('\n')).toContain("'npm run build' failed with exit code 1.");
    });

    it('ignores output from a terminal it is not tracking', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      harness.emit('term-other', `${SENT}:0\r\n`);
      harness.exitTerminal('term-other', 0);
      expect(harness.runner.hasRunning()).toBe(true);
    });

    it("ignores another run's sentinel sharing the terminal", async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'one' }, WORKSPACE);
      await harness.runner.run({ command: 'two' }, WORKSPACE);
      harness.emit('term-1', `${SENT}:0\r\n`);
      expect(harness.runner.listRunning().map((task) => task.runId)).toEqual(['run2']);
    });

    it('does not complete on a marker-shaped line the task itself printed', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'grep -rn __TYCODE src' }, WORKSPACE);
      harness.emit('term-1', 'src/main/x.ts: __TYCODE_TASK_DONE_run9__:0\n');
      // Only the marker issued for *this* run counts, which is why the id is random.
      expect(harness.runner.hasRunning()).toBe(true);
    });

    it('still completes after a flood of output', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run build' }, WORKSPACE);
      // 100 KB through a 4 KB tail: the sentinel has to survive truncation.
      harness.emit('term-1', 'x'.repeat(100_000));
      harness.emit('term-1', `${SENT}:0\r\n`);
      expect(harness.runner.hasRunning()).toBe(false);
    });
  });

  describe('change notifications', () => {
    it('pushes the full running list on every change, never a delta', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'one' }, WORKSPACE);
      await harness.runner.run({ command: 'two' }, WORKSPACE);
      harness.emit('term-1', `${SENT}:0\r\n`);
      // The renderer derives `tasksRunning` from this list's length, so a delta
      // would leave group G3 enabled with nothing in it.
      expect(harness.snapshots).toEqual([['run1'], ['run1', 'run2'], ['run2']]);
    });

    it('stops notifying an unsubscribed listener', async () => {
      const harness = makeHarness();
      const seen: number[] = [];
      const off = harness.runner.subscribe((tasks) => seen.push(tasks.length));
      await harness.runner.run({ command: 'one' }, WORKSPACE);
      off();
      await harness.runner.run({ command: 'two' }, WORKSPACE);
      expect(seen).toEqual([1]);
    });

    it('keeps notifying the next listener when one throws', async () => {
      const harness = makeHarness();
      const seen: number[] = [];
      harness.runner.subscribe(() => {
        throw new Error('listener exploded');
      });
      harness.runner.subscribe((tasks) => seen.push(tasks.length));
      await harness.runner.run({ command: 'one' }, WORKSPACE);
      expect(seen).toEqual([1]);
      // A bad subscriber must not take the task system down with it.
      expect(warned.join('\n')).toContain('a change listener failed');
    });
  });

  describe('terminate', () => {
    it('writes a bare Ctrl+C, without executing a line', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.writes.length = 0;

      const result = harness.runner.terminate({ runId: 'run1' });

      expect(result.success).toBe(true);
      expect(result.data?.definition.label).toBe('npm run dev');
      // Snapshotted while it was still running: the row's last honest state.
      expect(result.data?.state).toBe('running');
      expect(harness.writes).toEqual([{ command: '\x03', terminalId: 'term-1', execute: false }]);
      // `execute: false` is the whole point — the dispatcher appends `\r` only
      // when executing, and `\x03\r` would interrupt and then submit whatever was
      // sitting on the prompt line.
      expect(harness.writes[0].command).not.toContain('\r');
      expect(harness.runner.hasRunning()).toBe(false);
    });

    it('ignores a sentinel the interrupted command prints afterwards', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.runner.terminate({ runId: 'run1' });
      const notifications = harness.snapshots.length;
      harness.emit('term-1', `${SENT}:0\r\n`);
      // The user dismissed the row; a late marker must not put it back.
      expect(harness.runner.hasRunning()).toBe(false);
      expect(harness.snapshots.length).toBe(notifications);
      expect(logged.join('\n')).not.toContain('succeeded');
    });

    it('does not log an outcome the user caused', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.runner.terminate({ runId: 'run1' });
      expect(logged).toEqual([]);
    });

    it('reports an unknown run id', () => {
      const harness = makeHarness();
      expect(harness.runner.terminate({ runId: 'nope' })).toEqual({
        success: false,
        error: 'That task is no longer running.'
      });
    });

    it('validates the payload', () => {
      const harness = makeHarness();
      const result = harness.runner.terminate({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Terminate request failed validation:');
    });
  });

  describe('restart', () => {
    it('interrupts, waits, then starts a fresh run of the same definition', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.writes.length = 0;

      const result = await harness.runner.restart({ runId: 'run1' }, WORKSPACE);

      expect(result.success).toBe(true);
      expect(harness.writes.map((write) => (write.execute ? write.command : 'INTERRUPT'))).toEqual([
        'INTERRUPT',
        `npm run dev; echo "${sentinelFor('run2')}:$?"`
      ]);
      // Without the settle the new command can be consumed as stdin by the
      // program still shutting down, which looks like a restart that did nothing.
      expect(harness.delays).toHaveLength(1);
      expect(harness.delays[0]).toBeGreaterThan(0);
      // A restart is a new run, not a resurrection: distinct id, one tracked row.
      expect(result.data?.runId).toBe('run2');
      expect(harness.runner.listRunning().map((task) => task.runId)).toEqual(['run2']);
      expect(harness.runner.listRunning()[0].definition.label).toBe('npm run dev');
    });

    it('interrupts the old terminal and re-resolves the shell for the new one', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.control.shell = {
        terminalId: 'term-2',
        shellId: 'cmd',
        shellPath: 'C:\\Windows\\System32\\cmd.exe'
      };
      harness.writes.length = 0;

      const result = await harness.runner.restart({ runId: 'run1' }, WORKSPACE);

      expect(result.data?.terminalId).toBe('term-2');
      expect(harness.writes[0]).toEqual({ command: '\x03', terminalId: 'term-1', execute: false });
      expect(harness.writes[1].command).toBe(
        `npm run dev & echo ${sentinelFor('run2')}:%errorlevel%`
      );
    });

    it('reports a run that already finished', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.emit('term-1', `${SENT}:0\r\n`);

      const result = await harness.runner.restart({ runId: 'run1' }, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        'That task is no longer running, so there is nothing to restart. Use Run Task… to start it again.'
      );
      // Only the original write: nothing was interrupted, nothing was started.
      expect(harness.writes).toHaveLength(1);
    });

    it('tracks nothing when the restart write is refused', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'npm run dev' }, WORKSPACE);
      harness.control.dispatch = 'refused';

      const result = await harness.runner.restart({ runId: 'run1' }, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('The terminal is still starting.');
      // The old run was terminated and the new one never started; leaving a row
      // behind would claim a task is running when nothing is.
      expect(harness.runner.hasRunning()).toBe(false);
      expect(harness.runner.listRunning()).toEqual([]);
    });

    it('validates the payload', async () => {
      const harness = makeHarness();
      const result = await harness.runner.restart({ runId: 7 }, WORKSPACE);
      expect(result.success).toBe(false);
      expect(result.error).toContain('Restart request failed validation:');
    });
  });

  describe('dispose', () => {
    it('detaches both observers exactly once and clears state', async () => {
      const harness = makeHarness();
      await harness.runner.run({ command: 'one' }, WORKSPACE);

      harness.runner.dispose();
      harness.runner.dispose();

      // Idempotent: on the real PTY a second detach would remove a listener
      // someone else has since re-registered.
      expect(harness.detached).toEqual(['output', 'exit']);
      expect(harness.runner.listRunning()).toEqual([]);
      expect(harness.runner.hasRunning()).toBe(false);

      // The detach really unhooked the listeners, so a sentinel printed by a
      // command that was still running when Ty-Code shut down reaches nothing:
      // no snapshot, no `finish`, no resurrected row. A disposed runner is inert
      // rather than half-listening, which is what keeps a late PTY event from
      // writing to bookkeeping nobody reads any more.
      harness.emit('term-1', `${SENT}:0\r\n`);
      harness.exitTerminal('term-1', 0);
      expect(harness.snapshots).toEqual([['run1']]);
      // `finish` logs every non-terminated outcome, so a silent log is proof the
      // observers never fired — stronger than the empty list above, which a
      // still-attached observer would also produce.
      expect(logged).toEqual([]);
    });

    it('refuses to start anything after shutdown, with a reason', async () => {
      const harness = makeHarness();
      harness.runner.dispose();

      const result = await harness.runner.run({ command: 'echo hi' }, WORKSPACE);

      expect(result.success).toBe(false);
      expect(result.error).toBe('The task runner has shut down, so it cannot start anything new.');
      // Nothing tracked: a run with no observer watching its output can never
      // finish, so its row would sit in the menu until the process died.
      expect(harness.runner.hasRunning()).toBe(false);
      expect(harness.writes).toEqual([]);
    });

    it('stops notifying subscribers after shutdown', async () => {
      const harness = makeHarness();
      const seen: number[] = [];
      harness.runner.subscribe((tasks) => seen.push(tasks.length));
      harness.runner.dispose();
      await harness.runner.run({ command: 'one' }, WORKSPACE);
      expect(seen).toEqual([]);
    });
  });
});
