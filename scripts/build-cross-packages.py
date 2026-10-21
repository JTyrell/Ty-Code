#!/usr/bin/env python3
"""Ty-Code staged rebuild orchestrator.

Rebuilds the application bundles, then packages every platform version in
sequential electron-builder stages (Windows, macOS, Linux), regenerates the
release manifests (SHA256SUMS.txt, release.json), and repopulates dist/ with
the most recently built artifacts for ALL platforms - not just the Windows
variants.

Usage:
  python scripts/build-cross-packages.py
  python scripts/build-cross-packages.py --stage bundle --stage windows
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST = ROOT / "dist"
DIST_RELEASE = ROOT / "dist-release"
BUILD_DIR = ROOT / "build"
WIN_UNPACKED = DIST_RELEASE / "win-unpacked"
MAC_UNPACKED = DIST_RELEASE / "mac-unpacked"
LINUX_UNPACKED = DIST_RELEASE / "linux-unpacked"

STAGES = [
    "clean",
    "bundle",
    "windows",
    "macos",
    "linux",
    "aliases",
    "checksums",
    "release-json",
    "dist-sync",
]

VERSIONED_PREFIXES = ("Ty-Code-", "ty-code_", "ty-code-")
STALE_MANIFESTS = ("SHA256SUMS.txt", "release.json")
STALE_UPDATER_YML = ("latest.yml", "latest-mac.yml", "latest-linux.yml")
STALE_UNPACKED_DIRS = (WIN_UNPACKED, MAC_UNPACKED, LINUX_UNPACKED)
STALE_DIST_BUNDLES = (DIST / "main", DIST / "preload", DIST / "renderer")

ALIAS_GROUPS = [
    ("Ty-Code-{v}-mac.dmg", "Ty-Code-{v}.dmg"),
    ("Ty-Code-{v}.AppImage", "Ty-Code-{v}-x64.AppImage"),
    ("ty-code_{v}_amd64.deb", "Ty-Code-{v}-x64.deb"),
    ("ty-code-{v}.x86_64.rpm", "Ty-Code-{v}-x64.rpm"),
]

RELEASE_BINARIES = [
    "Ty-Code-Setup-{v}.exe",
    "Ty-Code-{v}-win.zip",
    "Ty-Code-{v}-portable.exe",
    "Ty-Code-{v}.dmg",
    "Ty-Code-{v}-mac.dmg",
    "Ty-Code-{v}-mac.zip",
    "Ty-Code-{v}.AppImage",
    "Ty-Code-{v}-x64.AppImage",
    "ty-code_{v}_amd64.deb",
    "Ty-Code-{v}-x64.deb",
    "ty-code-{v}.x86_64.rpm",
    "Ty-Code-{v}-x64.rpm",
]

STAGE_RUNNERS = {}


def register_stage(func):
    STAGE_RUNNERS[func.__name__.removeprefix("stage_").replace("_", "-")] = func
    return func


def log(message):
    print(f"[build-cross-packages] {message}", flush=True)


def read_version():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    return package["version"]


def sha256_file(path):
    hasher = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def is_windows():
    return os.name == "nt"


def command(cmdline):
    if is_windows():
        return ["cmd.exe", "/c"] + [str(part) for part in cmdline]
    return [str(part) for part in cmdline]


def looks_versioned(name):
    return name.lower().startswith(VERSIONED_PREFIXES)


def run(cmdline, env=None):
    printable = " ".join(str(part) for part in command(cmdline))
    log(f"Running: {printable}")
    merged = os.environ.copy()
    if env:
        merged.update(env)
    started = time.monotonic()
    completed = subprocess.run(command(cmdline), cwd=ROOT, env=merged)
    elapsed = time.monotonic() - started
    if completed.returncode == 0:
        log(f"Command finished OK ({elapsed:.1f}s).")
        return True
    log(f"Command FAILED with exit code {completed.returncode} ({elapsed:.1f}s).")
    return False


def electron_builder_bin():
    suffix = ".cmd" if is_windows() else ""
    local = ROOT / "node_modules" / ".bin" / f"electron-builder{suffix}"
    if local.exists():
        return local
    return shutil.which("electron-builder")


def bundle_outputs_ok():
    required = [
        DIST / "main" / "index.js",
        DIST / "preload" / "index.js",
        DIST / "renderer" / "index.html",
    ]
    for path in required:
        if not path.exists():
            log(f"Missing bundle output: {path}")
            return False
    workers = DIST / "main" / "workers"
    if not workers.is_dir() or not any(workers.glob("*.js")):
        log("Missing debugger worker bundles under dist/main/workers.")
        return False
    return True


@register_stage
def stage_clean(version):
    if DIST.exists():
        for item in list(DIST.iterdir()):
            if not item.is_file():
                continue
            if looks_versioned(item.name) or item.name in STALE_MANIFESTS or item.name in STALE_UPDATER_YML:
                item.unlink()
                log(f"Removed stale dist file: {item.name}")
    if DIST_RELEASE.exists():
        for item in list(DIST_RELEASE.iterdir()):
            if not item.is_file():
                continue
            if looks_versioned(item.name) or item.name in STALE_MANIFESTS or item.name in STALE_UPDATER_YML:
                item.unlink()
                log(f"Removed stale dist-release file: {item.name}")
    for unpacked in STALE_UNPACKED_DIRS:
        if unpacked.exists():
            shutil.rmtree(unpacked, ignore_errors=True)
            log(f"Removed stale unpacked tree: {unpacked.name}/")
    for bundle_dir in STALE_DIST_BUNDLES:
        if bundle_dir.exists():
            shutil.rmtree(bundle_dir, ignore_errors=True)
            log(f"Removed stale bundle tree: {bundle_dir.name}/")
    return True


@register_stage
def stage_bundle(version):
    npm = shutil.which("npm")
    if npm is None:
        log("npm not found on PATH.")
        return False
    if not run([npm, "run", "build"]):
        return False
    if not bundle_outputs_ok():
        log("Bundle verification failed; dist/ is incomplete.")
        return False
    log("Bundle stage verified: main, workers, preload, renderer are fresh.")
    return True


@register_stage
def stage_windows(version):
    eb = electron_builder_bin()
    if eb is None:
        log("electron-builder binary not found; run `npm install` first.")
        return False
    if not run([eb, "--win", "--publish", "never"]):
        return False
    if not WIN_UNPACKED.is_dir():
        log(f"Windows unpacked tree not produced: {WIN_UNPACKED}")
        return False
    zip_path = DIST_RELEASE / f"Ty-Code-{version}-win.zip"
    log(f"Zipping {WIN_UNPACKED.name}/ into {zip_path.name}...")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for path in sorted(WIN_UNPACKED.rglob("*")):
            zf.write(path, path.relative_to(WIN_UNPACKED).as_posix())
    log(f"Created {zip_path.name} ({zip_path.stat().st_size:,} bytes).")
    return True


@register_stage
def stage_macos(version):
    eb = electron_builder_bin()
    if eb is None:
        log("electron-builder binary not found; run `npm install` first.")
        return False
    env = {"CSC_IDENTITY_AUTO_DISCOVERY": "false"}
    ok = run([eb, "--mac", "--publish", "never"], env=env)
    if not ok:
        log("macOS stage failed. DMG/ZIP targets require a macOS host (codesign + hdiutil); on non-mac hosts these artifacts are skipped.")
    return ok


@register_stage
def stage_linux(version):
    eb = electron_builder_bin()
    if eb is None:
        log("electron-builder binary not found; run `npm install` first.")
        return False
    ok = run([eb, "--linux", "--publish", "never"])
    if not ok:
        log("Linux stage failed. DEB/RPM/AppImage targets require a Linux host (fpm + fuse tooling); on non-Linux hosts these artifacts are skipped.")
    return ok


@register_stage
def stage_aliases(version):
    for group in ALIAS_GROUPS:
        names = [name.format(v=version) for name in group]
        source = next(((DIST_RELEASE / n) for n in names if (DIST_RELEASE / n).exists()), None)
        if source is None:
            log(f"Alias group skipped, no canonical artifact: {names[0]}")
            continue
        for name in names:
            target = DIST_RELEASE / name
            if target.exists():
                continue
            shutil.copy2(source, target)
            log(f"Alias {target.name} -> {source.name}")
    return True


@register_stage
def stage_checksums(version):
    binaries = [name.format(v=version) for name in RELEASE_BINARIES]
    present = [name for name in binaries if (DIST_RELEASE / name).exists()]
    if not present:
        log("No platform artifacts found; cannot write SHA256SUMS.txt.")
        return False
    for name in binaries:
        if name not in present:
            log(f"WARNING: expected release artifact missing: {name}")
    lines = []
    for name in binaries:
        path = DIST_RELEASE / name
        if path.exists():
            digest = sha256_file(path)
            lines.append(f"{digest}  {name}")
            log(f"{name}: {digest}")
    manifest = DIST_RELEASE / "SHA256SUMS.txt"
    manifest.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"SHA256SUMS.txt written with {len(lines)} entries ({len(binaries) - len(present)} of {len(binaries)} platform artifacts unavailable on this host).")
    return True


@register_stage
def stage_release_json(version):
    generator = ROOT / "scripts" / "generate-release-json.py"
    python = shutil.which("python") or shutil.which("python3")
    if python is None:
        log("python not found on PATH.")
        return False
    return run([python, str(generator)])


@register_stage
def stage_dist_sync(version):
    DIST.mkdir(parents=True, exist_ok=True)
    for name in [name.format(v=version) for name in RELEASE_BINARIES] + list(STALE_UPDATER_YML) + list(STALE_MANIFESTS):
        source = DIST_RELEASE / name
        if source.exists():
            shutil.copy2(source, DIST / name)
            log(f"Copied {name} -> dist/")
    return True


def summarize(results):
    log("Stage summary:")
    for stage, ok in results.items():
        log(f"  {'OK  ' if ok else 'FAIL'} {stage}")
    return all(results.values())


def main():
    parser = argparse.ArgumentParser(description="Ty-Code staged cross-platform rebuild (clean + bundle + win/mac/linux stages + manifests + dist sync).")
    parser.add_argument("--stage", action="append", choices=STAGES, help="Run only these stages (repeatable). Defaults to all stages in canonical order.")
    args = parser.parse_args()
    selected = args.stage or STAGES

    version = read_version()
    log(f"Ty-Code v{version} staged rebuild starting (dist/ and dist-release/ will be repopulated).")

    results = {}
    for stage in selected:
        log(f"=== stage: {stage} (Ty-Code {version}) ===")
        results[stage] = STAGE_RUNNERS[stage](version)
        if stage == "bundle" and not results[stage]:
            log("Bundle stage failed; aborting remaining stages (would package stale or missing bundles).")
            break

    ok = summarize(results)
    binaries_root = any((DIST_RELEASE / name.format(v=version)).exists() for name in RELEASE_BINARIES)
    if ok and binaries_root:
        log(f"All requested stages completed. dist/ holds the freshest Ty-Code {version} build for every platform stage that succeeded on this host.")
        return 0
    if ok and not binaries_root:
        log("Stages reported success but no release binaries were produced; check platform stage notes above.")
        return 1
    return 1


if __name__ == "__main__":
    sys.exit(main())
