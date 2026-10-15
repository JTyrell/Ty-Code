# Ty-Code Privacy Policy

**Effective date:** October 15, 2026

Ty-Code is a desktop coding assistant. This policy explains what it keeps on this device and what can leave it during actions you choose.

## Local data

Application preferences, workspace settings, chat sessions, conversation memory, and project-index data are stored on your device. Codebase indexing, local search, and history extraction operate on the local filesystem. History exports are written only after you choose a destination. Project embeddings are not uploaded by default; Ty-Code does not currently provide a cloud embedding service.

Local chat and project files are not encrypted by Ty-Code. Protect your device account and filesystem with your operating system's security controls.

## Credentials

API keys are encrypted with Electron `safeStorage` and stored in Ty-Code's application data directory. On Windows this uses the operating-system credential protection; on macOS it uses Keychain; on Linux Ty-Code accepts GNOME Secret Service or supported KWallet backends. Linux `basic_text`, unknown, or unavailable backends are not considered secure. In those states Ty-Code will not save new credentials or use credentials it cannot decrypt. Install and configure `libsecret` / GNOME Secret Service or a supported KWallet service, then restart Ty-Code. Older base64-only credential values are migrated to `safeStorage` when a secure backend is available.

## Telemetry

Telemetry is **off by default**. If you explicitly turn on “Record anonymized diagnostic events on this device,” Ty-Code stores an allowlisted event name, an approved feature label where relevant, and an event timestamp locally. Events contain no prompts, source code, chat content, filenames, workspace paths, API keys, or user identifiers. The Privacy & About settings panel shows the actual recorded event data.

The current Ty-Code build has **no telemetry server or transmission path**. Enabling local event recording does not send telemetry; telemetry events are not transmitted. Events are encrypted on this device, kept for no more than 30 days within a 5 MiB queue, and removed oldest-first when the queue reaches that limit. You can copy or delete individual event payloads, clear the queue, or turn telemetry off to purge it. You can change this choice in Settings > Privacy & About; Save Settings applies it and Cancel discards an unsaved change.

## Model providers and other connections

If you choose to use a remote AI model, the prompt and context needed for that request are sent to the provider you configured, under that provider's privacy terms. This is separate from telemetry. Model discovery contacts a provider only after you use its Refresh action. Update checks are initiated only when you choose Check for Updates. Opening external links or using explicitly requested integrations can also contact the selected service. Local Ollama requests stay on your device when configured to use its local endpoint.

## Changes and contact

Ty-Code may update this policy as its data flows change. The in-app Privacy & About section states the current behavior. For questions, contact the Ty-Code maintainers through the project's official support channels.
