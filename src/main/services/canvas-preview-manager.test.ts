import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
import { CanvasPreviewManager, CanvasPreviewSession } from './canvas-preview-manager';

describe('CanvasPreviewSession.detect (Prompt 4: Isolated Preview Host)', () => {
  let workspaceRoot: string;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'ty-canvas-detect-'));
  });

  afterEach(async () => {
    await fs.rm(workspaceRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('prefers the dev/start/serve script from package.json (dev strategy)', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), JSON.stringify({ scripts: { dev: 'vite' } }), 'utf8');
    const detection = await CanvasPreviewSession.detect(workspaceRoot);
    expect(detection.adapterMode).toBe('dev');
    expect(detection.devScript).toBe('dev');
    expect(detection.buildDir).toBeNull();
  });

  it('falls back to the first existing static build directory', async () => {
    const distDir = path.join(workspaceRoot, 'dist');
    await fs.mkdir(distDir);
    const detection = await CanvasPreviewSession.detect(workspaceRoot);
    expect(detection.adapterMode).toBe('static');
    expect(detection.buildDir).toBe(distDir);
  });

  it('reports adapterMode none when no dev script and no build dir exist', async () => {
    const detection = await CanvasPreviewSession.detect(workspaceRoot);
    expect(detection.adapterMode).toBe('none');
    expect(detection.devScript).toBeNull();
  });

  it('gracefully handles unreadable package.json (falls through to static)', async () => {
    await fs.writeFile(path.join(workspaceRoot, 'package.json'), '{not json', 'utf8');
    const detection = await CanvasPreviewSession.detect(workspaceRoot);
    expect(detection.adapterMode).toBe('none');
  });
});

describe('CanvasPreviewManager lifecycle (Prompt 2/Prompt 4 rules)', () => {
  it('stopAll terminates every live session and clears snapshots', async () => {
    const broadcasts: string[] = [];
    const manager = new CanvasPreviewManager((snapshot) => { broadcasts.push(snapshot.workspacePath); });
    await manager.stopAll();
    const snapshot = await manager.statusForCurrent(null);
    expect(snapshot.status.state).toBe('idle');
    expect(snapshot.status.url).toBeNull();
    expect(broadcasts.length).toBe(0);
  });

  it('statusForCurrent returns the idle placeholder for fresh workspaces', async () => {
    const manager = new CanvasPreviewManager(() => undefined);
    const snapshot = await manager.statusForCurrent('C:/somewhere/not-started');
    expect(snapshot.workspacePath).toBe('C:/somewhere/not-started');
    expect(snapshot.status.adapter).toBe('not started');
  });
});
