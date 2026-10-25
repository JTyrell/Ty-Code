# Security Policy

## Zero-Telemetry & Sovereign Security Guarantee
Ty-Code is engineered as a local-first, zero-telemetry development environment. All repository files, ASTs, and terminal sessions stay strictly on your local device. Credentials are cryptographically protected via operating-system secure storage (`safeStorage`).

## Reporting a Vulnerability
We take the security of Ty-Code and its supply chains seriously. If you believe you have discovered a security vulnerability or potential data exfiltration risk, please report it responsibly:

- **Email:** `security@tycode.dev` (or open a confidential security advisory on GitHub).
- **Scope:** Process isolation boundaries (`contextBridge`), safeStorage credential sealing, PTY terminal sandbox environment scrubbing, and IPC schema validation (`zod`).

Please do not report security vulnerabilities through public GitHub issues. We commit to acknowledging receipt within 48 hours and providing a remediation timeline within 5 business days.
