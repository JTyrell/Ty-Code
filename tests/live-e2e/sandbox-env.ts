import fsSync from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const sandboxDir = path.join(os.tmpdir(), `tycode-e2e-userdata-${process.pid}`);
fsSync.mkdirSync(sandboxDir, { recursive: true });
process.env.TYCODE_USER_DATA_OVERRIDE = sandboxDir;
