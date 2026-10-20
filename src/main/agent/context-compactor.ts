import type { ChatCompletionMessage } from '../providers/provider-gateway';

export type Message = ChatCompletionMessage;

export const MODEL_CONTEXT_LIMIT = 128_000;
const COMPACTION_THRESHOLD = 0.85;
const KEEP_LAST_EXCHANGES = 3;

const CODE_HINT = /[=;{}()<>]|function|class|const|let|var|import|export|def |=>|\[\]/;

function isVoice(message: Message): boolean {
  return message.role === 'user' || message.role === 'assistant';
}

function hasToolCalls(message: Message): boolean {
  return (message.tool_calls?.length ?? 0) > 0;
}

export function estimateTokenCount(text: string): number {
  if (!text) return 0;
  const chars = text.length;
  const charsPerToken = CODE_HINT.test(text) ? 3 : 4;
  return Math.ceil(chars / charsPerToken);
}

export function estimateContextTokens(messages: Message[]): number {
  let total = 8;
  for (const message of messages) {
    total += estimateTokenCount(message.content || '') + 4;
    for (const call of message.tool_calls || []) {
      total += estimateTokenCount(call.function.name) + estimateTokenCount(call.function.arguments) + 8;
    }
  }
  return total;
}

export function shouldCompact(messages: Message[], modelLimit: number): boolean {
  const limit = modelLimit > 0 ? modelLimit : MODEL_CONTEXT_LIMIT;
  return estimateContextTokens(messages) > limit * COMPACTION_THRESHOLD;
}

function findTransferPoint(body: Message[]): number {
  const voiceIndices: number[] = [];
  for (let i = 0; i < body.length; i++) {
    if (isVoice(body[i])) voiceIndices.push(i);
  }
  if (voiceIndices.length === 0) return 0;
  let boundary = voiceIndices[0];
  let userCount = 0;
  for (let k = voiceIndices.length - 1; k >= 0; k--) {
    if (body[voiceIndices[k]].role === 'user') userCount++;
    if (userCount >= KEEP_LAST_EXCHANGES) {
      boundary = voiceIndices[k];
      break;
    }
    if (k === 0) boundary = voiceIndices[0];
  }
  while (boundary > 0 && body[boundary].role === 'tool') boundary--;
  while (boundary > 0 && hasToolCalls(body[boundary - 1])) boundary--;
  while (boundary > 0 && body[boundary].role === 'tool') boundary--;
  return boundary;
}

export function compactMessages(messages: Message[], summary: string): Message[] {
  if (messages.length === 0) return messages.slice();
  const hasPinned = messages[0].role === 'system';
  const body = hasPinned ? messages.slice(1) : messages.slice();
  const transferStart = findTransferPoint(body);
  const compacted: Message[] = [];
  if (hasPinned) compacted.push(messages[0]);
  if (transferStart > 0) {
    compacted.push({
      role: 'system',
      content: `## Conversation Summary (compacted)\n\n${summary}`
    });
  }
  compacted.push(...body.slice(transferStart));
  return compacted;
}

export const SUMMARY_SYSTEM_PROMPT =
  'Summarize the following conversation in 3-5 sentences, focusing on decisions made, files modified, and tasks completed. Be concise.';

export function buildTranscript(messages: Message[], charLimit = 24_000): string {
  const parts: string[] = [];
  for (const message of messages) {
    let label: string = message.role;
    if (message.role === 'assistant' && hasToolCalls(message)) {
      label = `assistant(${message.tool_calls!.map((c) => c.function.name).join(', ')})`;
    }
    const content = (message.content || '').trim();
    if (!content) continue;
    parts.push(`[${label}] ${content}`);
  }
  let transcript = parts.join('\n\n');
  if (transcript.length > charLimit) transcript = `${transcript.slice(0, charLimit)}\n\n[truncated]`;
  return transcript;
}

export type SummaryChatFn = (messages: Message[]) => Promise<string>;

export async function generateSummary(messages: Message[], send: SummaryChatFn): Promise<string> {
  const transcript = buildTranscript(messages);
  if (!transcript.trim()) return '';
  const response = await send([
    { role: 'system', content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user', content: transcript }
  ]);
  const summary = (response || '').trim();
  return summary.length >= 20 && summary.length <= 4_000 ? summary : '';
}

export function buildFallbackSummary(messages: Message[], stateSummary: string): string {
  let lastUser = '';
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      lastUser = messages[i].content;
      break;
    }
  }
  const toolCallCount = messages.filter((m) => m.role === 'assistant' && hasToolCalls(m)).length;
  const toolResultCount = messages.filter((m) => m.role === 'tool').length;
  const goal = lastUser.trim().slice(0, 400) || 'the user request';
  const lines = [
    `Conversation goal: ${goal}`,
    `Progress so far: ${toolCallCount} assistant tool-call turn(s) and ${toolResultCount} tool result(s) were exchanged.`
  ];
  if (stateSummary.trim()) lines.push(stateSummary.trim());
  return lines.join('\n');
}
