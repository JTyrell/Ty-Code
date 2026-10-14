declare module 'cross-spawn' {
  import type { SpawnOptions } from 'node:child_process';
  import type { ChildProcess } from 'node:child_process';

  function crossSpawn(command: string, args?: readonly string[], options?: SpawnOptions): ChildProcess;
  export default crossSpawn;
}
