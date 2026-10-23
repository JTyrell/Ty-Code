/**
 * ChatMessage Component & Worker-Driven Markdown Integration
 *
 * Implements extreme rendering optimization by utilizing Web Workers for
 * Markdown parsing (marked) and Syntax Highlighting (highlight.js),
 * ensuring zero main-thread layout thrashing and 60fps streaming.
 *
 * Brand: Ty-Code
 */

export * from '../ChatMessage';
export { ChatMessageItem as default } from '../ChatMessage';
export { MessageRenderer } from './MessageRenderer';
export type { MessageRendererProps } from './MessageRenderer';
