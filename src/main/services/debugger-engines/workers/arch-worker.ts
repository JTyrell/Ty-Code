import { parentPort } from 'node:worker_threads';
import { runArchAnalysis } from '../arch-engine';

import type { WorkspaceProfile } from '../../context-engine/types';

interface ArchJob {
  kind: 'arch';
  projectRoot: string;
  profile?: WorkspaceProfile | null;
}

function post(response: unknown): void {
  parentPort?.postMessage(response);
}

function isArchJob(message: unknown): message is ArchJob {
  if (typeof message !== 'object' || message === null) return false;
  const job = message as { kind?: unknown; projectRoot?: unknown };
  return job.kind === 'arch' && typeof job.projectRoot === 'string';
}

if (parentPort) {
  parentPort.on('message', async (message: unknown) => {
    if (!isArchJob(message)) return;
    try {
      post({ ok: true, result: await runArchAnalysis(message.projectRoot, { profile: message.profile }) });
    } catch (error) {
      post({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
} else if (process.argv[2] === 'selftest') {
  const target = process.argv[3] ?? '';
  if (!target) {
    console.error('usage: node arch-worker.js selftest <projectRoot>');
    process.exit(2);
  }
  void runArchAnalysis(target).then(
    (report) => {
      console.log(JSON.stringify(report, null, 2));
      process.exit(0);
    },
    (error) => {
      console.error(`selftest failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
}
