#!/usr/bin/env node
/**
 * Ty-Code voice engine bundler (BUILD-TIME ONLY, never ships run logic).
 *
 * Produces the zero-download layout consumed by src/main/services/voice-transcriber.ts
 * and packaged by electron-builder.yml extraResources:
 *
 *   resources/voice-engine/
 *     python/                  portable CPython (python-embed on Windows,
 *                              python-build-standalone on macOS/Linux)
 *     site-packages/           faster_whisper + ctranslate2 + deps (wheels only)
 *     models/tiny.en/          model.bin, config.json, tokenizer.json, vocabulary.txt
 *
 * Run:  npm run prepare:voice-engine
 * Then: npm run dist (electron-builder picks everything up via extraResources).
 *
 * IMPORTANT: this script runs on the BUILD machine only. The end user's app
 * performs zero downloads: everything above lands inside the installer through
 * the extraResources directives and is resolved via process.resourcesPath.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VOICE_DIR = path.join(REPO_ROOT, 'resources', 'voice-engine');
const PY_DIR = path.join(VOICE_DIR, 'python');
const SITE_DIR = path.join(VOICE_DIR, 'site-packages');
const MODEL_DIR = path.join(VOICE_DIR, 'models', 'tiny.en');

const EMBED_PYTHON_VERSION = '3.11.9';
const EMBED_URL = `https://www.python.org/ftp/python/${EMBED_PYTHON_VERSION}/python-${EMBED_PYTHON_VERSION}-embed-amd64.zip`;

// faster-whisper is a CPU inference lib whose dependency chain pulls ctranslate2;
// `--only-binary=:all:` guarantees clean, portable wheels (no source builds).
const PIP_PACKAGES = ['faster-whisper', 'ctranslate2'];

// The four files that make up a loadable faster-whisper CTranslate2 model dir
// (Systran/faster-whisper-tiny.en on Hugging Face).
const MODEL_FILES = ['model.bin', 'config.json', 'tokenizer.json', 'vocabulary.txt'];
const MODEL_BASE_URL = 'https://huggingface.co/Systran/faster-whisper-tiny.en/resolve/main';

function log(message) {
  console.log(`[voice-engine] ${message}`);
}

function ensureDirs() {
  fs.mkdirSync(PY_DIR, { recursive: true });
  fs.mkdirSync(SITE_DIR, { recursive: true });
  fs.mkdirSync(MODEL_DIR, { recursive: true });
}

function findHostPython() {
  const candidates = process.platform === 'win32'
    ? [['python'], ['py', '-3'], ['python3']]
    : [['python3'], ['python']];
  for (const args of candidates) {
    try {
      // Any host Python 3.x qualifies: wheels are selected by explicit
      // --platform/--python-version ABI tags below, never by the host runtime.
      const out = execFileSync(args[0], [...args.slice(1), '--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      const version = String(out || '').trim();
      if (!/^Python 3\.\d+/.test(version)) {
        log(`skipping ${args[0]}: ${version}`);
        continue;
      }
      // The host interpreter merely drives pip, so it must actually have one.
      try {
        execFileSync(args[0], [...args.slice(1), '-m', 'pip', '--version'], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        log(`skipping ${args[0]} (${version}): no pip module available`);
        continue;
      }
      return { command: args[0], extraArgs: args.slice(1), version };
    } catch {
      continue;
    }
  }
  throw new Error('No host Python 3.x with pip found. Install Python with pip and re-run npm run prepare:voice-engine.');
}

async function downloadTo(url, destPath) {
  log(`downloading ${url}`);
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok || !response.body) {
    throw new Error(`Download failed (${response.status}) ${url}`);
  }
  await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destPath));
}

async function installPythonEmbedForWindows(tmpDir) {
  if (fs.existsSync(path.join(PY_DIR, 'python.exe'))) {
    log('Windows embedded python already present, skipping download');
    return;
  }
  const zipPath = path.join(tmpDir, 'python-embed.zip');
  await downloadTo(EMBED_URL, zipPath);
  fs.rmSync(PY_DIR, { recursive: true, force: true });
  fs.mkdirSync(PY_DIR, { recursive: true });
  if (process.platform === 'win32') {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command',
        `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${PY_DIR}' -Force`],
      { stdio: 'inherit' }
    );
  } else {
    // Cross-platform fallback for CI builders running the pack from macOS/Linux.
    execFileSync('unzip', ['-o', zipPath, '-d', PY_DIR], { stdio: 'inherit' });
  }
  // Rewrite the ._pth so the embedded interpreter looks inside its own tree
  // and into ../site-packages (both bundled next to it by extraResources).
  const pthFile = fs.readdirSync(PY_DIR).find((name) => /^python\d+\._pth$/.test(name));
  if (!pthFile) throw new Error('python embed zip did not contain a ._pth file');
  fs.writeFileSync(
    path.join(PY_DIR, pthFile),
    `python${EMBED_PYTHON_VERSION.split('.').slice(0, 2).join('')}.zip\n.\n..\\site-packages\nimport site\n`,
    'utf-8'
  );
  log('Windows embedded python installed');
}

async function installPortablePythonForUnix(tmpDir) {
  const marker = path.join(PY_DIR, '.ty-voice-python-installed');
  if (fs.existsSync(marker)) {
    log('portable python already present, skipping download');
    return;
  }
  const arch = os.arch() === 'arm64' ? 'aarch64' : 'x86_64';
  const platformTag = process.platform === 'darwin' ? 'apple-darwin' : 'unknown-linux-gnu';
  const response = await fetch(
    'https://api.github.com/repos/astral-sh/python-build-standalone/releases/latest',
    { headers: { 'User-Agent': 'ty-code-voice-engine' } }
  );
  if (!response.ok) throw new Error(`python-build-standalone release lookup failed (${response.status})`);
  const release = await response.json();
  const asset = (release.assets || []).find((candidate) =>
    /^cpython-3\.11\.\d\+(\d{8})-(aarch64|x86_64)-(apple-darwin|unknown-linux-gnu)-install_only\.tar\.gz$/.test(candidate.name || '')
    && candidate.name.includes(arch)
    && candidate.name.includes(platformTag)
  );
  if (!asset) throw new Error(`No portable CPython asset for ${arch}-${platformTag}; run this script on the target OS.`);
  const tarballPath = path.join(tmpDir, asset.name);
  await downloadTo(asset.browser_download_url, tarballPath);
  fs.rmSync(PY_DIR, { recursive: true, force: true });
  fs.mkdirSync(PY_DIR, { recursive: true });
  execFileSync('tar', ['-xzf', tarballPath, '-C', PY_DIR, '--strip-components', '1'], { stdio: 'inherit' });
  fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
  log(`portable python installed (${asset.name})`);
}

async function installSitePackages(hostPython) {
  // Wheels must match the BUNDLED python ABI (3.11), not the host interpreter,
  // so every pip call pins --platform + --python-version explicitly.
  let platformArgs;
  if (process.platform === 'win32') {
    platformArgs = ['--platform', 'win_amd64', '--python-version', '311'];
  } else if (process.platform === 'darwin') {
    platformArgs = os.arch() === 'arm64'
      ? ['--platform', 'macosx_11_0_arm64', '--python-version', '311']
      : ['--platform', 'macosx_11_0_x86_64', '--python-version', '311'];
  } else {
    platformArgs = os.arch() === 'arm64'
      ? ['--platform', 'manylinux2014_aarch64', '--python-version', '311']
      : ['--platform', 'manylinux2014_x86_64', '--python-version', '311'];
  }
  log(`pip installing ${PIP_PACKAGES.join(', ')} -> site-packages (${platformArgs.join(' ')})`);
  execFileSync(
    hostPython.command,
    [
      ...hostPython.extraArgs,
      '-m',
      'pip',
      'install',
      '--upgrade',
      '--only-binary=:all:',
      ...platformArgs,
      '--target',
      SITE_DIR,
      ...PIP_PACKAGES
    ],
    { stdio: 'inherit', env: { ...process.env, PYTHONUTF8: '1' } }
  );
  // faster-whisper pulls onnxruntime for VAD; verify the essentials landed.
  for (const required of ['faster_whisper', 'ctranslate2', 'numpy']) {
    if (!fs.existsSync(path.join(SITE_DIR, required))) {
      throw new Error(`pip did not produce ${required} inside site-packages`);
    }
  }
  log('site-packages ready');
}

async function downloadModel() {
  const marker = path.join(MODEL_DIR, '.ty-model-complete');
  if (fs.existsSync(marker)) {
    log('tiny.en model already present, skipping download');
    return;
  }
  for (const file of MODEL_FILES) {
    await downloadTo(`${MODEL_BASE_URL}/${file}`, path.join(MODEL_DIR, file));
    const stat = fs.statSync(path.join(MODEL_DIR, file));
    if (stat.size === 0) throw new Error(`Downloaded empty file: ${file}`);
  }
  fs.writeFileSync(marker, new Date().toISOString(), 'utf-8');
  log('Systran/faster-whisper-tiny.en model files ready');
}

function installTranscriber() {
  const source = path.join(REPO_ROOT, 'src', 'main', 'services', 'voice-engine', 'transcriber.py');
  if (!fs.existsSync(source)) {
    throw new Error(`transcriber.py source is missing: ${source}`);
  }
  fs.copyFileSync(source, path.join(VOICE_DIR, 'transcriber.py'));
  log('transcriber.py copied into the bundle layout');
}

async function main() {
  ensureDirs();
  const hostPython = findHostPython();
  log(`host python: ${hostPython.command} (${hostPython.version})`);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ty-voice-'));
  try {
    if (process.platform === 'win32') {
      await installPythonEmbedForWindows(tmpDir);
    } else {
      await installPortablePythonForUnix(tmpDir);
    }
    await installSitePackages(hostPython);
    await downloadModel();
    installTranscriber();
    log('voice engine bundle complete. Ready for electron-builder packaging.');
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('[voice-engine] FAILED:', err);
  process.exit(1);
});
