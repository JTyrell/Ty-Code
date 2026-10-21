import fs from 'node:fs';
import path from 'node:path';

export function resolveWorkerRuntimeFile(fileName: string): string {
  const direct = path.join(__dirname, 'workers', fileName);
  const unpackedCandidate = direct.replace('app.asar', 'app.asar.unpacked');
  if (fs.existsSync(unpackedCandidate)) return unpackedCandidate;
  return direct;
}
