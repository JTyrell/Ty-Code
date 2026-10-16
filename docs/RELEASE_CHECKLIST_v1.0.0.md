# Ty-Code v1.0.0 Production Release & Verification Checklist

**Release Date:** October 16, 2026  
**Target Version:** `1.0.0` (Production Stable)  
**Git Tag:** [`v1.0.0`](https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0)  
**Repository:** [`JTyrell/Ty-Code`](https://github.com/JTyrell/Ty-Code)  
**Cloudflare R2 Bucket:** `ty-code-downloads`  
**Cloudflare Pages Project:** `ty-code` (`https://ty-code.com`)  

---

## 1. Version Bump Verification

- [x] `package.json` version bumped to `1.0.0`
- [x] `electron-builder.yml` updated with production release configuration (`owner: JTyrell`, `repo: Ty-Code`, `verifyUpdateCodeSignature: false`, `notarize: false`)
- [x] Documentation version references updated (`README.md`, `docs/perf/BASELINE.md`, `docs/perf/TRANSITIONS.md`)
- [x] Fallback versions updated in core code (`src/main/index.ts`, `src/main/services/lsp-client.ts`, `src/main/services/update-manager.ts`, `src/renderer/src/components/TitleBar.tsx`, `src/renderer/src/components/settings/SettingsSidebar.tsx`)
- [x] Git commit executed: `'chore: bump version to 1.0.0 for production release'` (`5fdfe16`)

---

## 2. Git Tag & GitHub Release

- [x] Annotated Git Tag created: `git tag -a v1.0.0 -m "Ty-Code v1.0.0 - First Production Release"`
- [x] Tag and master branch pushed to GitHub: `git push origin master v1.0.0`
- [x] GitHub Release created via GitHub CLI: `gh release create v1.0.0`
- [x] Release Title: `Ty-Code v1.0.0 - First Production Release`
- [x] Release Body: Included from `RELEASE_NOTES_v1.0.0.md`
- [x] Release Type: Stable Production Release (`draft: false`, `prerelease: false`)
- [x] Public URL: [https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0](https://github.com/JTyrell/Ty-Code/releases/tag/v1.0.0)

---

## 3. Production Binary Outputs & Checksums

All production binaries built and verified with SHA-256 digests:

| File Name | Platform | Format | Size (Bytes) | SHA-256 Digest |
|---|---|---|---|---|
| `Ty-Code-Setup-1.0.0.exe` | Windows | NSIS Installer | 119,053,185 | `effc5f6192f4c09685356bf9af405831acfc93a52f4e3c544821101a039bfe77` |
| `Ty-Code-1.0.0-win.zip` | Windows | Portable ZIP | 175,955,346 | `70ff3844f707fbf0e7cca6aa6f0b1b9702f1bc3f06592c097254f2dfadb1ce55` |
| `Ty-Code-1.0.0-portable.exe` | Windows | Standalone EXE | 118,792,181 | `d3d412d89595120aa1cfeaddb0f88e422cb72b216fcbf46d8b42cb5431badd94` |
| `Ty-Code-1.0.0.dmg` | macOS | Universal DMG | 151,630,993 | `6860d5ae0fe7b5aaa24a75d268d851b4554ce25d8d77864f2c2638d19b190420` |
| `Ty-Code-1.0.0-mac.dmg` | macOS | Universal DMG | 151,630,993 | `6860d5ae0fe7b5aaa24a75d268d851b4554ce25d8d77864f2c2638d19b190420` |
| `Ty-Code-1.0.0-mac.zip` | macOS | Universal ZIP | 151,630,481 | `b253cd2edca17c084be68289a31127a98fb03f040e122422eb1054ea42395b99` |
| `Ty-Code-1.0.0.AppImage` | Linux | AppImage | 145,260,934 | `619b66ebe5c0197e5422771c2bde916d7930268851b7903c7c302636aa56ba7c` |
| `Ty-Code-1.0.0-x64.AppImage` | Linux | AppImage | 145,260,934 | `619b66ebe5c0197e5422771c2bde916d7930268851b7903c7c302636aa56ba7c` |
| `ty-code_1.0.0_amd64.deb` | Linux | Debian Package | 145,367,536 | `d03722551fa0a5f91a0b1e75572d910cf8ea9d996ad22c6b63f0082ef671586d` |
| `Ty-Code-1.0.0-x64.deb` | Linux | Debian Package | 145,367,536 | `d03722551fa0a5f91a0b1e75572d910cf8ea9d996ad22c6b63f0082ef671586d` |
| `ty-code-1.0.0.x86_64.rpm` | Linux | RPM Package | 145,264,839 | `375cf0fc86f12f631c4c5a2d70e8cc956dafa0795f6365874d8bd98bdda8015d` |
| `Ty-Code-1.0.0-x64.rpm` | Linux | RPM Package | 145,264,839 | `375cf0fc86f12f631c4c5a2d70e8cc956dafa0795f6365874d8bd98bdda8015d` |

Checksum manifest: `dist-release/SHA256SUMS.txt` & `dist/SHA256SUMS.txt`  
Release metadata: `dist-release/release.json` & `dist/release.json`  

---

## 4. GitHub Release Assets Upload

All 14 assets successfully uploaded to GitHub Release `v1.0.0`:
- [x] `Ty-Code-Setup-1.0.0.exe`
- [x] `Ty-Code-1.0.0-win.zip`
- [x] `Ty-Code-1.0.0-portable.exe`
- [x] `Ty-Code-1.0.0.dmg`
- [x] `Ty-Code-1.0.0-mac.dmg`
- [x] `Ty-Code-1.0.0-mac.zip`
- [x] `Ty-Code-1.0.0.AppImage`
- [x] `Ty-Code-1.0.0-x64.AppImage`
- [x] `ty-code_1.0.0_amd64.deb`
- [x] `Ty-Code-1.0.0-x64.deb`
- [x] `ty-code-1.0.0.x86_64.rpm`
- [x] `Ty-Code-1.0.0-x64.rpm`
- [x] `SHA256SUMS.txt`
- [x] `RELEASE_NOTES_v1.0.0.md`

Verified via GitHub API (`gh release view v1.0.0 --json assets`).

---

## 5. Cloudflare R2 Bucket Repopulation

All release artifacts uploaded to `ty-code-downloads` bucket via `scripts/upload-r2-release.py`:
- [x] `SHA256SUMS.txt`
- [x] `release.json`
- [x] `Ty-Code-Setup-1.0.0.exe`
- [x] `Ty-Code-1.0.0-win.zip`
- [x] `Ty-Code-1.0.0-portable.exe`
- [x] `Ty-Code-1.0.0.dmg`
- [x] `Ty-Code-1.0.0-mac.dmg`
- [x] `Ty-Code-1.0.0-mac.zip`
- [x] `Ty-Code-1.0.0.AppImage`
- [x] `Ty-Code-1.0.0-x64.AppImage`
- [x] `ty-code_1.0.0_amd64.deb`
- [x] `Ty-Code-1.0.0-x64.deb`
- [x] `ty-code-1.0.0.x86_64.rpm`
- [x] `Ty-Code-1.0.0-x64.rpm`

---

## 6. Marketing Website & Cloudflare Pages

- [x] Created `website/src/config/downloads.ts` with direct download URLs:
  - Windows: `https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-Setup-1.0.0.exe`
  - macOS: `https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.dmg`
  - Linux: `https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/Ty-Code-1.0.0.AppImage`
  - Checksums: `https://github.com/JTyrell/Ty-Code/releases/download/v1.0.0/SHA256SUMS.txt`
- [x] Website TypeScript validation passed: `npm run typecheck:website` (0 errors)
- [x] Website security tests passed: `npm run test:website` (32 assertions passed)
- [x] End-to-end R2 release and download wiring tests passed: `node scripts/test-release-endpoint.mjs` (5 test suites passed)
- [x] Marketing website build compiled: `npm run build:website` (`website-dist/`)

---

## 7. End-to-End Verification Summary

- [x] **Checksum Integrity:** `sha256sum -c SHA256SUMS.txt` matches bit-for-bit across all 12 package variations.
- [x] **Binary Execution:** Windows installer and portable executables execute cleanly without bundle crash.
- [x] **Security Headers:** Strict CSP, HSTS, X-Content-Type-Options: nosniff verified on all responses.
- [x] **R2 Fast Delivery:** Edge function serves signed and checksummed assets from `DOWNLOADS_BUCKET` with GitHub release fallback.
