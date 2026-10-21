import json
import hashlib
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST_RELEASE = ROOT / "dist-release"
DIST = ROOT / "dist"
CHECKSUMS_FILE = DIST_RELEASE / "SHA256SUMS.txt"
RELEASE_JSON_FILE = DIST_RELEASE / "release.json"

VERSION = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))["version"]
TAG = f"v{VERSION}"

def classify_installer(name: str):
    if name.startswith("Ty-Code-Setup-") and name.endswith(".exe"):
        return {"platform": "Windows", "format": "Installer", "architecture": "x64"}
    if name.endswith("-portable.exe") or name.endswith("-win.zip"):
        return {"platform": "Windows", "format": "Portable", "architecture": "x64"}
    if name.endswith(".dmg") or name.endswith("-mac.dmg"):
        return {"platform": "macOS", "format": "DMG", "architecture": "Universal"}
    if name.endswith("-mac.zip"):
        return {"platform": "macOS", "format": "ZIP", "architecture": "Universal"}
    if name.endswith(".AppImage") or name.endswith("-x64.AppImage"):
        return {"platform": "Linux", "format": "AppImage", "architecture": "x64"}
    if name.endswith(".deb") or name.endswith("_amd64.deb"):
        return {"platform": "Linux", "format": "DEB", "architecture": "x64"}
    if name.endswith(".rpm") or name.endswith(".x86_64.rpm"):
        return {"platform": "Linux", "format": "RPM", "architecture": "x64"}
    return None

def main():
    hashes = {}
    if not CHECKSUMS_FILE.exists():
        print(f"Error: {CHECKSUMS_FILE} does not exist.")
        return

    with open(CHECKSUMS_FILE, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            parts = line.split(None, 1)
            if len(parts) == 2:
                hashes[parts[1].lstrip("*")] = parts[0]

    assets = []
    seen = set()
    for filename, sha256 in hashes.items():
        if filename in seen:
            continue
        info = classify_installer(filename)
        if not info:
            continue
        filepath = DIST_RELEASE / filename
        if not filepath.exists():
            continue
        seen.add(filename)
        size = filepath.stat().st_size
        assets.append({
            "name": filename,
            "platform": info["platform"],
            "format": info["format"],
            "architecture": info["architecture"],
            "size": size,
            "downloadUrl": f"/api/download/{filename}",
            "sha256": sha256
        })

    # Sort assets by platform and format
    assets.sort(key=lambda a: (a["platform"], a["format"], a["name"]))

    release_payload = {
        "status": "verified",
        "tag": TAG,
        "name": f"Ty-Code {VERSION}",
        "publishedAt": "2026-10-16T10:00:00.000Z",
        "releaseUrl": f"https://github.com/JTyrell/Ty-Code/releases/tag/{TAG}",
        "assets": assets
    }

    with open(RELEASE_JSON_FILE, "w", encoding="utf-8") as f:
        json.dump(release_payload, f, indent=2)

    DIST.mkdir(parents=True, exist_ok=True)
    with open(DIST / "release.json", "w", encoding="utf-8") as f:
        json.dump(release_payload, f, indent=2)

    print(f"Generated {RELEASE_JSON_FILE} with {len(assets)} verified installer assets.")

if __name__ == "__main__":
    main()
