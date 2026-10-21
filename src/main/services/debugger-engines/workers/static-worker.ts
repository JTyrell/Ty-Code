import { parentPort } from 'node:worker_threads';
import { runStaticAnalysis } from '../static-engine';

interface StaticJob {
  kind: 'static';
  filePath: string;
}

interface WorkerJobMessage {
  kind: string;
  filePath: string;
  projectRoot: string;
}

interface WorkerResponse<T> {
  ok: true;
  result: T;
}

interface WorkerErrorResponse {
  ok: false;
  error: string;
}

function post(response: WorkerResponse<unknown> | WorkerErrorResponse): void {
  parentPort?.postMessage(response);
}

function isStaticJob(message: unknown): message is StaticJob {
  if (typeof message !== 'object' || message === null) return false;
  const job = message as { kind?: unknown; filePath?: unknown };
  return job.kind === 'static' && typeof job.filePath === 'string';
}

if (parentPort) {
  parentPort.on('message', async (message: unknown) => {
    if (!isStaticJob(message)) return;
    try {
      post({ ok: true, result: await runStaticAnalysis(message.filePath) });
    } catch (error) {
      post({ ok: false, error: error instanceof Error ? error.message : String(error) });
    }
  });
} else if (process.argv[2] === 'selftest') {
  const target = process.argv[3] ?? '';
  if (!target) {
    console.error('usage: node static-worker.js selftest <file>');
    process.exit(2);
  }
  void runStaticAnalysis(target).then(
    (results) => {
      console.log(JSON.stringify(results, null, 2));
      process.exit(0);
    },
    (error) => {
      console.error(`selftest failed: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
}
