/**
 * Re-export ModelSelector from the canonical chat component path (Prompt 1).
 *
 * Preserves backward compatibility for existing imports in ChatSidecar.
 *
 * Free-model supply layer powered by free-claude-code (FCC) — AGPL-3.0 / MIT — https://github.com/Alishahryar1/free-claude-code
 * Brand: Ty-Code
 */

export * from '../chat/ModelSelector';
export { ModelSelector as default } from '../chat/ModelSelector';
