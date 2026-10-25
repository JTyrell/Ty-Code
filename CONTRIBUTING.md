# Contributing to Ty-Code

Thank you for your interest in contributing to Ty-Code!

## Development Principles
1. **Local-First & Zero-Telemetry:** Never introduce analytics beacons, unconsented telemetry, or external tracking dependencies.
2. **Safe Credential Handling:** API keys and sensitive tokens must always be sealed via OS-level `safeStorage`.
3. **No Mock Replies:** Real provider gateway execution or strict offline air-gap fallback; zero synthetic mock fixtures in production code.
4. **Attribution Invariant:** Upstream attribution to open-source supply layers (including `free-claude-code (FCC)`) must be preserved permanently.

## Running Tests & Quality Guards
Before submitting a pull request, ensure all local CI verification checks pass:
```bash
npm run typecheck
npm test
npm run guards
```
