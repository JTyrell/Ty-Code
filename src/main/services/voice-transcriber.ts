import { app } from 'electron';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import fs from 'fs';
import path from 'path';

export interface VoiceTranscriptionSegment {
  start: number;
  end: number;
  text: string;
}

export interface VoiceTranscriptionResult {
  text: string;
  language: string;
  durationSec: number;
  segments: VoiceTranscriptionSegment[];
}

type SidecarMessage =
  | { type: 'ready' }
  | { type: 'result'; text: string; language: string; durationSec: number; segments: VoiceTranscriptionSegment[] }
  | { type: 'error'; message: string };

const READY_TIMEOUT_MS = 30_000;
const TRANSCRIBE_TIMEOUT_MS = 90_000;
const MAX_AUDIO_BYTES = 16 * 1024 * 1024;
const MODEL_NAME = 'tiny.en';

interface VoiceEngineLayout {
  voiceDir: string;
  scriptPath: string;
  sitePackages: string;
  modelDir: string;
  pythonExecutable: string;
}

/**
 * Resolves the bundled voice-engine layout. Works identically in development
 * (resources/voice-engine inside the repo) and in packaged production builds
 * (process.resourcesPath/voice-engine inside the installed app) on Windows
 * (python-embed), macOS and Linux (python-build-standalone).
 */
function resolveVoiceLayout(): VoiceEngineLayout {
  const isPackaged = app.isPackaged;
  const voiceDir = isPackaged
    ? path.join(process.resourcesPath, 'voice-engine')
    : path.join(process.cwd(), 'resources', 'voice-engine');

  const scriptPath = path.join(voiceDir, 'transcriber.py');
  const sitePackages = path.join(voiceDir, 'site-packages');
  const modelDir = path.join(voiceDir, 'models', MODEL_NAME);

  let pythonExecutable: string;
  if (process.platform === 'win32') {
    pythonExecutable = path.join(voiceDir, 'python', 'python.exe');
  } else {
    pythonExecutable = path.join(voiceDir, 'python', 'bin', 'python3');
  }
  if (fs.existsSync(pythonExecutable)) {
    return { voiceDir, scriptPath, sitePackages, modelDir, pythonExecutable };
  }
  // Development fallback when only the site-packages layer has been prepared:
  // use the host interpreter with PYTHONPATH pointed at the bundled deps.
  pythonExecutable = process.platform === 'win32' ? 'python' : 'python3';
  return { voiceDir, scriptPath, sitePackages, modelDir, pythonExecutable };
}

export class VoiceTranscriber {
  private process: ChildProcessWithoutNullStreams | null = null;
  private stdoutRemainder = '';
  private readyPromise: Promise<void> | null = null;
  private settleReady: (() => void) | null = null;
  private settleReadyError: ((err: Error) => void) | null = null;
  private readyTimer: NodeJS.Timeout | null = null;
  private activeSessionId = '';
  private audioChunks: Buffer[] = [];
  private audioBytes = 0;
  private pendingRequest: {
    resolve: (result: VoiceTranscriptionResult) => void;
    reject: (err: Error) => void;
    timer: NodeJS.Timeout;
  } | null = null;

  /**
   * Spawns the bundled Python sidecar once and resolves when the model is
   * loaded (the sidecar prints {"type":"ready"}). The model then stays
   * resident in memory for instant transcriptions.
   */
  init(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    if (this.process && !this.readyPromise) {
      return Promise.resolve();
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }
    return this.spawnSidecar(timeoutMs);
  }

  /** Returns the pending ready promise when a sidecar is currently loading. */
  private waitForReady(timeoutMs: number): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    if (this.process && !this.readyPromise) return Promise.resolve();
    return Promise.reject(new Error('Voice engine is not initialized.'));
  }

  private spawnSidecar(timeoutMs = READY_TIMEOUT_MS): Promise<void> {
    const layout = resolveVoiceLayout();
    if (!fs.existsSync(layout.scriptPath)) {
      return Promise.reject(new Error('Voice engine transcriber is missing from the application bundle.'));
    }
    if (!fs.existsSync(layout.modelDir)) {
      return Promise.reject(new Error('Whisper model weights are missing from the application bundle.'));
    }
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(
        layout.pythonExecutable,
        ['-X', 'utf8', layout.scriptPath, layout.modelDir],
        {
          cwd: layout.voiceDir,
          env: {
            ...process.env,
            PYTHONPATH: layout.sitePackages,
            PYTHONUTF8: '1',
            PYTHONDONTWRITEBYTECODE: '1'
          },
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true
        }
      );
    } catch (err: any) {
      return Promise.reject(new Error(`Failed to spawn the voice engine: ${err?.message || err}`));
    }
    this.process = child;

    const readyPromise = new Promise<void>((resolve, reject) => {
      this.settleReady = resolve;
      this.settleReadyError = reject;
      this.readyTimer = setTimeout(() => {
        reject(new Error('Voice engine did not become ready in time.'));
      }, timeoutMs);
    });
    readyPromise.finally(() => {
      if (this.readyTimer) {
        clearTimeout(this.readyTimer);
        this.readyTimer = null;
      }
      this.settleReady = null;
      this.settleReadyError = null;
    });
    // Swallow late rejections when nobody is awaiting readiness anymore.
    readyPromise.catch(() => undefined);
    this.readyPromise = readyPromise;

    child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutRemainder += chunk.toString('utf-8');
      let newlineIndex = this.stdoutRemainder.indexOf('\n');
      while (newlineIndex !== -1) {
        const line = this.stdoutRemainder.slice(0, newlineIndex).trim();
        this.stdoutRemainder = this.stdoutRemainder.slice(newlineIndex + 1);
        if (line) this.handleSidecarLine(line);
        newlineIndex = this.stdoutRemainder.indexOf('\n');
      }
    });

    child.stderr.on('data', (chunk: Buffer) => {
      console.warn('[VOICE-SIDECAR]', chunk.toString('utf-8').trim());
    });

    child.on('error', (err: Error) => {
      console.error('[VOICE] Sidecar spawn error:', err.message);
      this.settleReadyError?.(new Error(`Voice engine process error: ${err.message}`));
      this.failRequest(new Error(`Voice engine process error: ${err.message}`));
      this.process = null;
    });

    child.on('exit', (code) => {
      console.warn(`[VOICE] Sidecar exited (code ${code}).`);
      this.settleReadyError?.(new Error('Voice engine exited before the model was ready.'));
      this.failRequest(new Error('Voice engine exited during transcription.'));
      this.process = null;
      this.readyPromise = null;
    });

    return readyPromise;
  }

  private handleSidecarLine(line: string): void {
    let message: SidecarMessage;
    try {
      message = JSON.parse(line) as SidecarMessage;
    } catch {
      return;
    }
    if (message.type === 'ready') {
      this.settleReady?.();
      this.settleReady = null;
      this.settleReadyError = null;
      return;
    }
    if (message.type === 'result') {
      if (this.pendingRequest) {
        clearTimeout(this.pendingRequest.timer);
        const done = this.pendingRequest.resolve;
        this.pendingRequest = null;
        done({
          text: message.text,
          language: message.language,
          durationSec: message.durationSec,
          segments: message.segments
        });
      }
      return;
    }
    if (message.type === 'error') {
      this.failRequest(new Error(message.message));
    }
  }

  private failRequest(err: Error): void {
    if (this.pendingRequest) {
      clearTimeout(this.pendingRequest.timer);
      const reject = this.pendingRequest.reject;
      this.pendingRequest = null;
      reject(err);
    }
  }

  /** CRITICAL privacy step: zero out and drop every captured PCM chunk. */
  private releaseAudio(clearSession: boolean): void {
    for (const buffer of this.audioChunks) {
      buffer.fill(0);
    }
    this.audioChunks = [];
    this.audioBytes = 0;
    if (clearSession) {
      this.activeSessionId = '';
    }
  }

  /** Marks a fresh recording session; returns true when accepted. */
  startRecording(sessionId: string): boolean {
    if (!sessionId || !this.process) return false;
    this.activeSessionId = sessionId;
    this.releaseAudio(false);
    return true;
  }

  /** Appends one base64 PCM16LE chunk from the renderer capture pipeline. */
  appendAudioChunk(sessionId: string, audioBase64: string): boolean {
    if (!sessionId || sessionId !== this.activeSessionId) return false;
    if (!audioBase64) return true;
    const chunk = Buffer.from(audioBase64, 'base64');
    if (chunk.length === 0) return true;
    if (this.audioBytes + chunk.length > MAX_AUDIO_BYTES) return false;
    this.audioChunks.push(chunk);
    this.audioBytes += chunk.length;
    return true;
  }

  /** Pipes the captured PCM to the sidecar and resolves with the transcript. */
  async stopAndTranscribe(sessionId: string, timeoutMs = TRANSCRIBE_TIMEOUT_MS): Promise<VoiceTranscriptionResult> {
    if (!sessionId || sessionId !== this.activeSessionId) {
      throw new Error('No active voice recording session.');
    }
    const pcm = Buffer.concat(this.audioChunks);
    // The raw audio buffer is discarded immediately after the frame is queued;
    // nothing is persisted anywhere.
    this.releaseAudio(true);
    if (pcm.length === 0) {
      return { text: '', language: 'en', durationSec: 0, segments: [] };
    }
    await this.init();
    const sidecar = this.process;
    if (!sidecar) {
      throw new Error('Voice engine is not running.');
    }
    const header = Buffer.alloc(4);
    header.writeUInt32LE(pcm.length, 0);
    sidecar.stdin.write(Buffer.concat([header, pcm]));
    return new Promise<VoiceTranscriptionResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.failRequest(new Error('Transcription timed out.'));
        reject(new Error('Transcription timed out.'));
      }, timeoutMs);
      this.pendingRequest = { resolve, reject, timer };
    });
  }

  /** Kills the sidecar process. Called from cleanupAllResources. */
  release(): void {
    this.releaseAudio(true);
    if (this.process) {
      try {
        this.process.stdin.destroy();
      } catch {
        // Ignore destroy race
      }
      try {
        this.process.kill();
      } catch {
        // Ignore kill race
      }
      this.process = null;
    }
    this.readyPromise = null;
    this.settleReady = null;
    this.settleReadyError = null;
    if (this.readyTimer) {
      clearTimeout(this.readyTimer);
      this.readyTimer = null;
    }
    this.failRequest(new Error('Voice engine released.'));
  }
}

export const voiceTranscriber = new VoiceTranscriber();
