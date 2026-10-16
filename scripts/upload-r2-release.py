import os
import subprocess
import sys
import time
from pathlib import Path

# Force UTF-8 on Windows
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

ROOT = Path(__file__).resolve().parent.parent
DIST_RELEASE = ROOT / "dist-release"
BUCKET = "ty-code-downloads"

FILES_TO_UPLOAD = [
    "SHA256SUMS.txt",
    "release.json",
    "Ty-Code-Setup-1.0.0.exe",
    "Ty-Code-1.0.0-win.zip",
    "Ty-Code-1.0.0-portable.exe",
    "Ty-Code-1.0.0.dmg",
    "Ty-Code-1.0.0-mac.dmg",
    "Ty-Code-1.0.0-mac.zip",
    "Ty-Code-1.0.0.AppImage",
    "Ty-Code-1.0.0-x64.AppImage",
    "ty-code_1.0.0_amd64.deb",
    "Ty-Code-1.0.0-x64.deb",
    "ty-code-1.0.0.x86_64.rpm",
    "Ty-Code-1.0.0-x64.rpm"
]

def log(msg: str):
    print(f"[upload-r2] {msg}", flush=True)

def upload_file(filename: str, remote: bool = True):
    filepath = DIST_RELEASE / filename
    if not filepath.exists():
        log(f"WARNING: File {filepath} does not exist. Skipping.")
        return False

    size_mb = filepath.stat().st_size / (1024 * 1024)
    target_str = "remote Cloudflare R2" if remote else "local Wrangler R2"
    log(f"Uploading {filename} ({size_mb:.1f} MB) to {target_str}...")

    cmd = [
        "npx.cmd" if sys.platform == "win32" else "npx",
        "wrangler",
        "r2",
        "object",
        "put",
        f"{BUCKET}/{filename}",
        "--file",
        str(filepath)
    ]
    if remote:
        cmd.append("--remote")

    for attempt in range(1, 4):
        try:
            start_time = time.time()
            res = subprocess.run(
                cmd,
                cwd=str(ROOT),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=True
            )
            elapsed = time.time() - start_time
            log(f"  [OK] {filename} uploaded in {elapsed:.1f}s")
            return True
        except subprocess.CalledProcessError as e:
            log(f"  Attempt {attempt} failed for {filename}: {e.stderr.strip() or e.stdout.strip()}")
            if attempt < 3:
                time.sleep(3)
            else:
                raise

def main():
    log(f"Starting upload to bucket '{BUCKET}'...")
    
    # First upload manifests to local state for local testing
    log("=== Uploading manifests to local Wrangler R2 store ===")
    for filename in ["SHA256SUMS.txt", "release.json"]:
        upload_file(filename, remote=False)

    # Next upload all files to remote Cloudflare R2 bucket
    log("=== Uploading all release artifacts to remote Cloudflare R2 ===")
    for filename in FILES_TO_UPLOAD:
        upload_file(filename, remote=True)

    log("All release files successfully uploaded to Cloudflare R2 bucket!")

if __name__ == "__main__":
    main()
