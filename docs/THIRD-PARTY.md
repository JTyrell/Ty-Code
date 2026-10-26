# Third-Party Licenses & Upstream Notices

This document records the licensing, integration modes, and attribution obligations for external software integrated or embedded into Ty-Code.

---

## 1. Upstream Model Supply Layer: `free-claude-code` (FCC)

- **Upstream Repository**: [https://github.com/Alishahryar1/free-claude-code](https://github.com/Alishahryar1/free-claude-code)
- **Primary Authors**: Ali Shahryar and community contributors
- **Licensing**: AGPL-3.0 (GNU Affero General Public License v3.0) with MIT-licensed subcomponents
- **Upstream Version Pinned**: `v0.9.4`
- **Ty-Code Integration Mode**: Mode (a) Pinned Decoupled Loopback Sidecar with Cryptographic Binary Verification

### Permitted Integration Mode Analysis

Three candidate integration modes were evaluated:

1. **Mode (a) - Pinned Decoupled Loopback Sidecar (Selected)**:
   - *Architecture*: The FCC server runs as an independent OS-level sidecar process communicating strictly over local loopback TCP/HTTP (`http://127.0.0.1:8082`). Ty-Code interacts with it exclusively via standardized, vendor-neutral OpenAI-compatible REST endpoints (`/v1/models`, `/v1/chat/completions`).
   - *Legal Boundary*: Under AGPL-3.0 and standard copyright precedent (mere aggregation / arm's length inter-process communication), running an independent binary as a sidecar without dynamic or static code linking prevents copyleft taint on Ty-Code's core codebase. Ty-Code remains 100% MIT licensed.
   - *Integrity*: The bundled or launched binary is cryptographically verified against pinned SHA-256 digests (`FCC_PINNED_MANIFEST`) at boot Tier 2 before execution. Checksum mismatches immediately disable the layer and yield explicit errors, never silent fallback or mock simulation.

2. **Mode (b) - First-Run Consented Download**:
   - Evaluated as an alternative if distribution constraints required binary retrieval at user runtime. Since FCC permits redistribution under AGPL-3.0 provided source and notices are made available, bundling a checksum-verified executable was selected for zero-latency, zero-friction developer experience.

3. **Mode (c) - In-Process / Dynamic Library Integration (Rejected)**:
   - Rejected because directly importing or linking AGPL-3.0 JavaScript or Go modules in-process would invoke copyleft obligations, necessitating AGPL-3.0 licensing for the entire Ty-Code application.

### Mandatory Verbatim Attribution

In accordance with attribution obligations, the following notice is preserved verbatim across 5 primary surfaces in Ty-Code:

```
Free-model supply layer powered by free-claude-code (FCC), AGPL-3.0 / MIT, https://github.com/Alishahryar1/free-claude-code
```

#### Monitored Attribution Surfaces:
1. **Desktop Help & About Dialog** (`src/renderer/src/components/TitleBar.tsx`): Rendered in the primary desktop About modal accessible from `Help > About Ty-Code`.
2. **Onboarding Wizard** (`src/renderer/src/components/OnboardingWizard.tsx`): Displayed on first-run splash banner: `Connecting your free model supply (powered by free-claude-code)`.
3. **Repository README & Public Download Site** (`README.md`, `website/src/components/SiteFooter.tsx`): Prominent shield badge and footer attribution paragraph.
4. **Settings Providers Header** (`src/renderer/src/components/SettingsModal.tsx`): Persistent banner under AI Providers & Models.
5. **Privacy & About In-App Credits** (`src/renderer/src/components/SettingsModal.tsx`): Dedicated in-app credits section detailing upstream model supply and repository link.

### Verbatim GNU Affero General Public License Notice

```
GNU AFFERO GENERAL PUBLIC LICENSE
Version 3, 19 November 2007

Copyright (C) 2007 Free Software Foundation, Inc. <https://fsf.org/>
Everyone is permitted to copy and distribute verbatim copies
of this license document, but changing it is not allowed.

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>.
```

---

## 2. Other Core Third-Party Components

### Monaco Editor Core
- **Repository**: [https://github.com/microsoft/monaco-editor](https://github.com/microsoft/monaco-editor)
- **License**: MIT
- **Copyright**: (c) Microsoft Corporation. All rights reserved.

### Electron
- **Repository**: [https://github.com/electron/electron](https://github.com/electron/electron)
- **License**: MIT
- **Copyright**: (c) Electron contributors / OpenJS Foundation.

### Lucide React
- **Repository**: [https://github.com/lucide-icons/lucide](https://github.com/lucide-icons/lucide)
- **License**: ISC
- **Copyright**: (c) 2022 Lucide Contributors.
