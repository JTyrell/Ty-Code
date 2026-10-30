/**
 * Shared message repair (Route Truth, Prompt 1).
 *
 * Lives here so BOTH the agent ReAct loop AND the gateway (before every
 * provider send / protocol-error retry) can repair assistant tool_call ->
 * tool_result pairing without an import cycle into the agent engine.
 *
 * Repairs assistant tool_call -> tool_result pairing across provider
 * failovers: a mid-tool failover (remediation-ladder rotation, provider
 * outage, approval interruption) can leave an assistant message carrying
 * tool_calls with no subsequent tool result. Strict providers reject that
 * history with HTTP 400 ("tool_call_id ... was not found") which otherwise
 * kills the loop.
 *
 * Mutates `messages` in place. Idempotent. Returns the count of injected
 * synthetic results so call sites can log the repair.
 *
 * Structural typing means any provider message shape with the pairing fields
 * (agent ChatCompletionMessage, gateway payload messages, handoff copies)
 * can be repaired without casting.
 */

export interface RepairableMessage {
  role: string;
  content?: unknown;
  tool_call_id?: string;
  tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } } | undefined>;
}

const SYNTHETIC_TOOL_RESULT =
  '[SYSTEM] Tool execution interrupted by provider failover; result unavailable.';

export function repairToolPairing<T extends RepairableMessage>(messages: T[]): number {
  // Pass 1: index every tool call id that already has a tool message answer.
  const answered = new Set<string>();
  for (const message of messages) {
    const callId = message?.tool_call_id;
    if (message?.role === 'tool' && callId) answered.add(callId);
  }
  // Pass 2: inject a synthetic result after each unpaired assistant tool_call.
  let injected = 0;
  const repaired: T[] = [];
  for (const message of messages) {
    repaired.push(message);
    if (message?.role !== 'assistant' || !Array.isArray(message.tool_calls)) continue;
    for (const call of message.tool_calls) {
      if (!call?.id || answered.has(call.id)) continue;
      answered.add(call.id); // also guards duplicate ids in malformed streams
      repaired.push({
        ...message,
        role: 'tool',
        name: call.function?.name,
        tool_call_id: call.id,
        content: SYNTHETIC_TOOL_RESULT
      } as unknown as T);
      injected++;
    }
  }
  if (injected > 0) {
    messages.length = 0;
    for (const message of repaired) messages.push(message);
  }
  return injected;
}
