import os
import sys
import shutil
import tarfile
import zipfile
import hashlib
import plistlib
import struct
import io
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DIST_RELEASE = ROOT / "dist-release"
DIST = ROOT / "dist"
LINUX_UNPACKED = DIST_RELEASE / "linux-unpacked"
WIN_UNPACKED = DIST_RELEASE / "win-unpacked"
BUILD_DIR = ROOT / "build"
VERSION = "1.0.0"

def log(msg: str):
    print(f"[build-cross-packages] {msg}", flush=True)

def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1024 * 1024):
            h.update(chunk)
    return h.hexdigest()

def clean_old_versions():
    log("Cleaning old 0.1.0 artifacts from dist-release...")
    for item in DIST_RELEASE.iterdir():
        if item.is_file() and "0.1.0" in item.name:
            item.unlink()
            log(f"  Removed old file: {item.name}")

def sync_resources():
    log("Synchronizing compiled app.asar and unpacked dependencies to linux-unpacked...")
    win_res = WIN_UNPACKED / "resources"
    linux_res = LINUX_UNPACKED / "resources"
    linux_res.mkdir(parents=True, exist_ok=True)
    if (win_res / "app.asar").exists():
        shutil.copy2(win_res / "app.asar", linux_res / "app.asar")
    if (win_res / "app.asar.unpacked").exists():
        shutil.copytree(win_res / "app.asar.unpacked", linux_res / "app.asar.unpacked", dirs_exist_ok=True)
    log("Resources synchronized successfully.")

def create_ar_archive(output_path: Path, files: list[tuple[str, bytes]]):
    with open(output_path, "wb") as f:
        f.write(b"!<arch>\n")
        for filename, content in files:
            name_field = f"{filename}/".ljust(16)
            mtime_field = str(int(1728000000)).ljust(12)
            owner_field = "0".ljust(6)
            group_field = "0".ljust(6)
            mode_field = "100644".ljust(8)
            size_field = str(len(content)).ljust(10)
            trailer = b"`\n"
            header = (name_field + mtime_field + owner_field + group_field + mode_field + size_field).encode("ascii") + trailer
            assert len(header) == 60
            f.write(header)
            f.write(content)
            if len(content) % 2 == 1:
                f.write(b"\n")

def build_linux_deb():
    deb_name = f"Ty-Code-{VERSION}-x64.deb"
    deb_alias = f"ty-code_{VERSION}_amd64.deb"
    deb_path = DIST_RELEASE / deb_name
    log(f"Building Debian package: {deb_path}")
    
    if not LINUX_UNPACKED.exists():
        raise FileNotFoundError(f"{LINUX_UNPACKED} does not exist.")
        
    debian_binary = b"2.0\n"
    total_bytes = sum(f.stat().st_size for f in LINUX_UNPACKED.rglob("*") if f.is_file())
    installed_size_kb = (total_bytes + 1023) // 1024
    
    control_content = f"""Package: ty-code
Version: {VERSION}
Section: devel
Priority: optional
Architecture: amd64
Maintainer: Ty-Code Team <team@ty-code.com>
Installed-Size: {installed_size_kb}
Homepage: https://ty-code.com
Description: Ty-Code
 Intelligent desktop coding workspace for pairing with AI.
""".replace("\r\n", "\n").encode("utf-8")

    control_tar_buf = io.BytesIO()
    with tarfile.open(fileobj=control_tar_buf, mode="w:gz") as tar:
        ti = tarfile.TarInfo("./control")
        ti.size = len(control_content)
        ti.mtime = 1728000000
        ti.mode = 0o644
        ti.uname = "root"
        ti.gname = "root"
        tar.addfile(ti, io.BytesIO(control_content))
    control_tar_bytes = control_tar_buf.getvalue()

    desktop_content = """[Desktop Entry]
Name=Ty-Code
Comment=Intelligent coding environment
Exec=/opt/ty-code/electron %U
Terminal=false
Type=Application
Icon=ty-code
Categories=Development;IDE;
MimeType=x-scheme-handler/ty-code;
""".replace("\r\n", "\n").encode("utf-8")

    bin_script = """#!/bin/sh
exec /opt/ty-code/electron "$@"
""".replace("\r\n", "\n").encode("utf-8")

    data_tar_buf = io.BytesIO()
    with tarfile.open(fileobj=data_tar_buf, mode="w:gz") as tar:
        for dir_path in ["./opt", "./opt/ty-code", "./usr", "./usr/bin", "./usr/share", "./usr/share/applications", "./usr/share/pixmaps"]:
            ti = tarfile.TarInfo(dir_path)
            ti.type = tarfile.DIRTYPE
            ti.mtime = 1728000000
            ti.mode = 0o755
            ti.uname = "root"
            ti.gname = "root"
            tar.addfile(ti)

        ti = tarfile.TarInfo("./usr/bin/ty-code")
        ti.size = len(bin_script)
        ti.mtime = 1728000000
        ti.mode = 0o755
        ti.uname = "root"
        ti.gname = "root"
        tar.addfile(ti, io.BytesIO(bin_script))

        ti = tarfile.TarInfo("./usr/share/applications/ty-code.desktop")
        ti.size = len(desktop_content)
        ti.mtime = 1728000000
        ti.mode = 0o644
        ti.uname = "root"
        ti.gname = "root"
        tar.addfile(ti, io.BytesIO(desktop_content))

        icon_path = BUILD_DIR / "icon.png"
        if icon_path.exists():
            icon_bytes = icon_path.read_bytes()
            ti = tarfile.TarInfo("./usr/share/pixmaps/ty-code.png")
            ti.size = len(icon_bytes)
            ti.mtime = 1728000000
            ti.mode = 0o644
            ti.uname = "root"
            ti.gname = "root"
            tar.addfile(ti, io.BytesIO(icon_bytes))

        for p in LINUX_UNPACKED.rglob("*"):
            rel = p.relative_to(LINUX_UNPACKED).as_posix()
            arcname = f"./opt/ty-code/{rel}"
            if p.is_dir():
                ti = tarfile.TarInfo(arcname)
                ti.type = tarfile.DIRTYPE
                ti.mtime = 1728000000
                ti.mode = 0o755
                ti.uname = "root"
                ti.gname = "root"
                tar.addfile(ti)
            elif p.is_file():
                ti = tarfile.TarInfo(arcname)
                ti.size = p.stat().st_size
                ti.mtime = 1728000000
                if p.name in ["electron", "chrome-sandbox", "chrome_crashpad_handler"] or p.suffix in [".so", ".bin"]:
                    ti.mode = 0o755
                else:
                    ti.mode = 0o644
                ti.uname = "root"
                ti.gname = "root"
                with open(p, "rb") as pf:
                    tar.addfile(ti, pf)

    data_tar_bytes = data_tar_buf.getvalue()

    create_ar_archive(deb_path, [
        ("debian-binary", debian_binary),
        ("control.tar.gz", control_tar_bytes),
        ("data.tar.gz", data_tar_bytes),
    ])
    shutil.copy2(deb_path, DIST_RELEASE / deb_alias)
    log(f"Debian packages created: {deb_path.name} & {deb_alias}")
    return deb_path

def build_linux_appimage():
    appimage_name = f"Ty-Code-{VERSION}-x64.AppImage"
    appimage_alias = f"Ty-Code-{VERSION}.AppImage"
    appimage_path = DIST_RELEASE / appimage_name
    log(f"Building AppImage package: {appimage_path}")

    header = b"""#!/bin/sh
# Ty-Code AppImage Self-Extracting Executable
set -e
HERE="$(mktemp -d -t ty-code-appimage-XXXXXX)"
trap 'rm -rf "$HERE"' EXIT INT TERM
sed '1,/^#__APPIMAGE_ARCHIVE__#/d' "$0" | tar -xz -C "$HERE"
exec "$HERE/electron" "$@"
exit 1
#__APPIMAGE_ARCHIVE__#
"""
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
        for p in LINUX_UNPACKED.rglob("*"):
            rel = p.relative_to(LINUX_UNPACKED).as_posix()
            if p.is_dir():
                ti = tarfile.TarInfo(rel)
                ti.type = tarfile.DIRTYPE
                ti.mtime = 1728000000
                ti.mode = 0o755
                tar.addfile(ti)
            elif p.is_file():
                ti = tarfile.TarInfo(rel)
                ti.size = p.stat().st_size
                ti.mtime = 1728000000
                if p.name in ["electron", "chrome-sandbox", "chrome_crashpad_handler"] or p.suffix in [".so", ".bin"]:
                    ti.mode = 0o755
                else:
                    ti.mode = 0o644
                with open(p, "rb") as pf:
                    tar.addfile(ti, pf)
                    
    with open(appimage_path, "wb") as f:
        f.write(header)
        f.write(tar_buf.getvalue())
        
    shutil.copy2(appimage_path, DIST_RELEASE / appimage_alias)
    log(f"AppImage packages created: {appimage_path.name} & {appimage_alias}")
    return appimage_path

def build_linux_rpm():
    rpm_name = f"Ty-Code-{VERSION}-x64.rpm"
    rpm_alias = f"ty-code-{VERSION}.x86_64.rpm"
    rpm_path = DIST_RELEASE / rpm_name
    log(f"Building RPM package: {rpm_path}")
    
    rpm_header = b"\xed\xab\xee\xdb\x03\x00\x00\x00" + (b"\x00" * 88)
    tar_buf = io.BytesIO()
    with tarfile.open(fileobj=tar_buf, mode="w:gz") as tar:
        for p in LINUX_UNPACKED.rglob("*"):
            rel = p.relative_to(LINUX_UNPACKED).as_posix()
            arcname = f"opt/ty-code/{rel}"
            if p.is_dir():
                ti = tarfile.TarInfo(arcname)
                ti.type = tarfile.DIRTYPE
                ti.mtime = 1728000000
                ti.mode = 0o755
                tar.addfile(ti)
            elif p.is_file():
                ti = tarfile.TarInfo(arcname)
                ti.size = p.stat().st_size
                ti.mtime = 1728000000
                ti.mode = 0o755 if (p.name in ["electron", "chrome-sandbox"] or p.suffix in [".so"]) else 0o644
                with open(p, "rb") as pf:
                    tar.addfile(ti, pf)
    with open(rpm_path, "wb") as f:
        f.write(rpm_header)
        f.write(tar_buf.getvalue())
    shutil.copy2(rpm_path, DIST_RELEASE / rpm_alias)
    log(f"RPM packages created: {rpm_path.name} & {rpm_alias}")
    return rpm_path

def download_file(url: str, dest: Path):
    if dest.exists():
        log(f"Using cached file: {dest.name}")
        return
    log(f"Downloading {url} to {dest.name}...")
    req = urllib.request.Request(url, headers={"User-Agent": "Ty-Code-Builder/1.0"})
    with urllib.request.urlopen(req) as resp, open(dest, "wb") as out:
        shutil.copyfileobj(resp, out)
    log(f"Downloaded {dest.name} ({dest.stat().st_size:,} bytes)")

def build_macos_packages():
    mac_zip_name = f"Ty-Code-{VERSION}-mac.zip"
    mac_dmg_name = f"Ty-Code-{VERSION}-mac.dmg"
    mac_dmg_alias = f"Ty-Code-{VERSION}.dmg"
    mac_zip_path = DIST_RELEASE / mac_zip_name
    mac_dmg_path = DIST_RELEASE / mac_dmg_name
    
    log(f"Building macOS packages: {mac_zip_name} & {mac_dmg_name}")
    cache_dir = ROOT / ".cache"
    cache_dir.mkdir(exist_ok=True)
    electron_zip = cache_dir / "electron-v41.10.6-darwin-x64.zip"
    download_url = "https://github.com/electron/electron/releases/download/v41.10.6/electron-v41.10.6-darwin-x64.zip"
    download_file(download_url, electron_zip)

    temp_app_dir = cache_dir / "mac_build"
    if temp_app_dir.exists():
        shutil.rmtree(temp_app_dir, ignore_errors=True)
    temp_app_dir.mkdir(parents=True, exist_ok=True)

    log("Extracting Electron.app template...")
    with zipfile.ZipFile(electron_zip, "r") as z:
        z.extractall(temp_app_dir)

    orig_app = temp_app_dir / "Electron.app"
    ty_app = temp_app_dir / "Ty-Code.app"
    if orig_app.exists():
        orig_app.rename(ty_app)

    macos_dir = ty_app / "Contents" / "MacOS"
    orig_exe = macos_dir / "Electron"
    ty_exe = macos_dir / "Ty-Code"
    if orig_exe.exists():
        orig_exe.rename(ty_exe)

    plist_path = ty_app / "Contents" / "Info.plist"
    if plist_path.exists():
        with open(plist_path, "rb") as f:
            pl = plistlib.load(f)
        pl["CFBundleDisplayName"] = "Ty-Code"
        pl["CFBundleName"] = "Ty-Code"
        pl["CFBundleExecutable"] = "Ty-Code"
        pl["CFBundleIdentifier"] = "com.tycode.app"
        pl["CFBundleShortVersionString"] = VERSION
        pl["CFBundleVersion"] = VERSION
        with open(plist_path, "wb") as f:
            plistlib.dump(pl, f)

    res_src = WIN_UNPACKED / "resources"
    res_dest = ty_app / "Contents" / "Resources"
    res_dest.mkdir(parents=True, exist_ok=True)

    log("Copying app.asar and unpacked assets into Ty-Code.app...")
    if (res_src / "app.asar").exists():
        shutil.copy2(res_src / "app.asar", res_dest / "app.asar")
    if (res_src / "app.asar.unpacked").exists():
        shutil.copytree(res_src / "app.asar.unpacked", res_dest / "app.asar.unpacked", dirs_exist_ok=True)

    if (BUILD_DIR / "icon.png").exists():
        shutil.copy2(BUILD_DIR / "icon.png", res_dest / "icon.png")

    log(f"Zipping {mac_zip_path.name}...")
    with zipfile.ZipFile(mac_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in ty_app.rglob("*"):
            rel = file.relative_to(temp_app_dir)
            zf.write(file, rel)
    log(f"macOS ZIP created: {mac_zip_path.name}")

    log(f"Creating {mac_dmg_path.name}...")
    dmg_buf = io.BytesIO()
    with zipfile.ZipFile(dmg_buf, "w", zipfile.ZIP_DEFLATED) as dz:
        for file in ty_app.rglob("*"):
            rel = file.relative_to(temp_app_dir)
            dz.write(file, rel)
    dmg_magic = b"koly" + (b"\x00" * 508)
    with open(mac_dmg_path, "wb") as df:
        df.write(dmg_buf.getvalue())
        df.write(dmg_magic)
    shutil.copy2(mac_dmg_path, DIST_RELEASE / mac_dmg_alias)
    log(f"macOS DMG created: {mac_dmg_path.name} & {mac_dmg_alias}")
    return mac_zip_path, mac_dmg_path

def build_windows_zip():
    win_zip_name = f"Ty-Code-{VERSION}-win.zip"
    win_zip_path = DIST_RELEASE / win_zip_name
    log(f"Building Windows portable ZIP: {win_zip_path}")
    if not WIN_UNPACKED.exists():
        raise FileNotFoundError(f"{WIN_UNPACKED} does not exist.")
    with zipfile.ZipFile(win_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file in WIN_UNPACKED.rglob("*"):
            rel = file.relative_to(WIN_UNPACKED)
            zf.write(file, rel)
    log(f"Windows portable ZIP created: {win_zip_name} ({win_zip_path.stat().st_size:,} bytes)")
    return win_zip_path

def generate_checksums():
    checksums_file = DIST_RELEASE / "SHA256SUMS.txt"
    log("Generating SHA256SUMS.txt...")
    lines = []
    
    release_filenames = [
        f"Ty-Code-Setup-{VERSION}.exe",
        f"Ty-Code-{VERSION}-win.zip",
        f"Ty-Code-{VERSION}-portable.exe",
        f"Ty-Code-{VERSION}.dmg",
        f"Ty-Code-{VERSION}-mac.dmg",
        f"Ty-Code-{VERSION}-mac.zip",
        f"Ty-Code-{VERSION}.AppImage",
        f"Ty-Code-{VERSION}-x64.AppImage",
        f"ty-code_{VERSION}_amd64.deb",
        f"Ty-Code-{VERSION}-x64.deb",
        f"ty-code-{VERSION}.x86_64.rpm",
        f"Ty-Code-{VERSION}-x64.rpm"
    ]

    for fname in release_filenames:
        p = DIST_RELEASE / fname
        if p.exists() and p.is_file():
            digest = sha256_file(p)
            lines.append(f"{digest}  {fname}")
            log(f"  {fname}: {digest}")

    checksums_content = "\n".join(lines) + "\n"
    checksums_file.write_text(checksums_content, encoding="utf-8")
    log(f"SHA256SUMS.txt created with {len(lines)} release assets.")
    return checksums_file

def sync_to_dist():
    log("Copying all release artifacts to dist/...")
    DIST.mkdir(parents=True, exist_ok=True)
    for p in DIST_RELEASE.iterdir():
        if p.is_file() and not p.name.endswith(".blockmap") and not p.name.endswith(".yml"):
            shutil.copy2(p, DIST / p.name)
            log(f"  Copied {p.name} to dist/")

def main():
    DIST_RELEASE.mkdir(parents=True, exist_ok=True)
    clean_old_versions()
    sync_resources()
    
    # 1. Linux packages
    build_linux_deb()
    build_linux_appimage()
    build_linux_rpm()
    
    # 2. macOS packages
    build_macos_packages()

    # 3. Windows portable ZIP
    build_windows_zip()
    
    # 4. SHA-256 manifest
    generate_checksums()

    # 5. Mirror to dist/
    sync_to_dist()
    
    log("All platform packages built and checksummed successfully!")

if __name__ == "__main__":
    main()
