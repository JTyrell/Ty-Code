/**
 * ChatMessage Component & Worker-Driven Markdown Integration (Phase 2: Offloading the Main Thread)
 *
 * Heavy Markdown parsing and Syntax Highlighting are offloaded to Web Workers
 * (markdown-parser.worker.ts and highlight.worker.ts) inside the shared
 * MessageRenderer, eliminating main-thread layout thrashing and ensuring
 * 60fps streaming. The previous duplicate worker pipeline lived here; it now
 * delegates so typography trees stay unified.
 *
 * Brand: Ty-Code
 */

import React from 'react';
import { MessageRenderer } from './MessageRenderer';
import {
  ChatMessageItem as UpstreamChatMessageItem,
  type ChatMessageProps as UpstreamChatMessageProps
} from '../ChatMessage';

// Re-export upstream types and MessageRenderer
export * from '../ChatMessage';
export { MessageRenderer } from './MessageRenderer';
export type { MessageRendererProps } from './MessageRenderer';

/**
 * WorkerMessageRenderer: backward-compatible name for the shared worker-driven
 * renderer (markdown parser + syntax highlighting offload, matrix decode and
 * UK punctuation via the Typography & Motion settings).
 */
export const WorkerMessageRenderer: React.FC<{ content: string; isStreaming?: boolean }> = (props) => (
  <MessageRenderer {...props} />
);

export interface ChatMessageProps extends UpstreamChatMessageProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * ChatMessage Component: renders a chat message with isolated CSS containment
 * and worker-offloaded markdown and syntax highlighting.
 */
export const ChatMessage: React.FC<ChatMessageProps> = React.memo((props) => {
  return <UpstreamChatMessageItem {...props} />;
});

export const ChatMessageItem: React.FC<ChatMessageProps> = ChatMessage;
export default ChatMessage;
