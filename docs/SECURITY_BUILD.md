# Secure build and code-signing guide

## Reproducible dependency install and security gates

Use Node.js 22.12.0 or newer and npm 10 or newer. The application and toolchain versions in `package.json` are exact; `package-lock.json` records the complete install graph and integrity hashes.

```sh
npm ci
npm audit --audit-level=high
npx --yes depcheck@1.4.7
npm test
npm run build
```

CI runs the same commands in `.github/workflows/security-check.yml`. Do not use `npm install` in CI. To deliberately update dependencies, review package changelogs and the new lockfile, run the audit/tests/build, then commit `package.json` and `package-lock.json` together.

## Windows code signing

The project has electron-builder Windows signing configuration and updater signature verification enabled. A release requires an Authenticode certificate in PFX format and its password. Store the certificate as a GitHub Actions secret, never in the repository:

- `WIN_CSC_LINK`: secure URL or base64-encoded PFX content.
- `WIN_CSC_KEY_PASSWORD`: PFX password.
- `WIN_PUBLISHER_NAME` (optional): exact publisher subject from the certificate, if the standard certificate identity cannot be used by electron-builder.

For local builds, set `CSC_LINK` and `CSC_KEY_PASSWORD` in the build environment or map the `WIN_CSC_*` variables as the CI workflow does. Do not commit certificates, passwords, or `.env` files. Tagged release builds fail before packaging if required signing secrets are missing. Windows update downloads are checked against the publisher identity embedded in the signed package.

## macOS signing and notarization

The build uses Hardened Runtime and the minimum Electron JIT entitlement (`com.apple.security.cs.allow-jit`). The unused `allow-unsigned-executable-memory` and `disable-library-validation` exceptions have been removed. If a future native module demonstrably needs another exception, document and test that specific requirement before adding it.

For Developer ID Application distribution, configure these GitHub Actions secrets:

- `MAC_CSC_LINK`: base64-encoded or secure URL to the Apple signing certificate.
- `MAC_CSC_KEY_PASSWORD`: certificate password.
- `APPLE_ID`: Apple Developer account email.
- `APPLE_APP_SPECIFIC_PASSWORD`: app-specific password for notarization.
- `APPLE_TEAM_ID`: Apple Developer Team ID.

The macOS build sets electron-builder `mac.notarize: true`; it will notarize only when credentials are present. Tagged release workflow jobs reject missing signing/notarization secrets. Validate the CI log for successful signing, notarization, and stapling, then verify the built app with `codesign --verify --deep --strict` and `spctl --assess --type execute --verbose` on a Mac before distributing it.

## Artifacts, updater metadata, and checksums

`npm run package:win`, `npm run package:mac`, and `npm run package:linux` create signed platform packages when the required certificates are configured. Only `node-pty` runtime prebuilds and build-release binaries are explicitly unpacked from ASAR; electron-builder also detects native `.node` modules that require unpacking.

Electron-builder generates updater YAML (for example `latest.yml` and `latest-mac.yml`) with SHA-512 checksums for each updater artifact. `electron-updater` verifies these checksums on download. The tagged release job additionally calculates `SHA256SUMS.txt` over every downloaded release asset, including installers, updater YAML, and blockmaps. This SHA-256 manifest detects accidental or malicious artifact changes when verified against a separately trusted checksum source; it is not itself a digital signature. Obtain it from a trusted release channel and verify it with `sha256sum -c SHA256SUMS.txt` (or a platform equivalent).

Do not publish unsigned binaries as official releases. Signing, notarization, artifact checksums, and full end-to-end install/update tests are required before a public release.
