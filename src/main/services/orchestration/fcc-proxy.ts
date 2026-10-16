/**
 * FCC Proxy Client (Layer 3)
 * Proxies model requests through the free-claude-code sidecar server,
 * providing access to 61+ ToS-friendly providers and 1.3B+ free tokens/month.
 */

import { parseSSELines, type StreamPayload } from '../../providers/sse-parser';
import type { ChatCompletionMessage, StreamEventCallbacks } from '../../providers/provider-gateway';
import { fccManager } from './fcc-manager';

export interface FCCProxyOptions {
  model: string;
  messages: ChatCompletionMessage[];
  tools?: unknown[];
  temperature?: number;
  maxTokens?: number;
  fccEndpoint?: string;
}

export interface FCCProxyResult {
  fullText: string;
  fullThought: string;
  toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  tokensUsed: number;
  provider: string;
}

interface AccumulatedToolCall { id: string; name: string; args: string; }

function appendDelta(existing: string, incoming: string | undefined): string {
  if (!incoming || incoming === existing || existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;
  return existing + incoming;
}

export class FCCProxyClient {
  private defaultBaseUrl = 'http://127.0.0.1:8082/v1';

  public getEndpoint(customEndpoint?: string): string {
    return (customEndpoint || this.defaultBaseUrl).replace(/\/+$/, '');
  }

  public async isAvailable(endpoint?: string): Promise<boolean> {
    try {
      const url = `${this.getEndpoint(endpoint).replace(/\/v1$/, '')}/health`;
      const res = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(2000) });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Proxies a chat completion stream through the local FCC sidecar process
   */
  public async streamChat(
    options: FCCProxyOptions,
    callbacks: StreamEventCallbacks,
    abortSignal?: AbortSignal
  ): Promise<FCCProxyResult> {
    const { model, messages, tools, temperature = 0.2, maxTokens = 4096, fccEndpoint } = options;
    const baseUrl = this.getEndpoint(fccEndpoint);

    // Auto-launch sidecar if not running and ensure genuine binary is active
    if (!fccEndpoint && !fccManager.isGenuineBinaryRunning()) {
      if (!fccManager.getStatus().running) {
        try {
          await fccManager.start();
        } catch (err: unknown) {
          throw new Error(`[FCC Proxy] CONFIG_MISSING: free-claude-code binary is not installed or configured. ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (!fccManager.isGenuineBinaryRunning()) {
        throw new Error('[FCC Proxy] CONFIG_MISSING: Genuine free-claude-code binary is not running. Please install and configure free-claude-code or connect an AI provider with an API key.');
      }
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'free-claude-code/0.9.4 (Ty-Code Desktop Sidecar)',
      'HTTP-Referer': 'https://github.com/Alishahryar1/free-claude-code',
      'X-Title': 'Ty-Code Desktop',
      'X-FCC-Client': 'ty-code'
    };

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: true,
      temperature,
      max_tokens: maxTokens
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`[FCC Proxy] API Error (${response.status}): ${errorText}`);
    }

    if (!response.body) {
      throw new Error('[FCC Proxy] Response body is empty');
    }

    let fullText = '';
    let fullThought = '';
    const toolCalls = new Map<number, AccumulatedToolCall>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    let tokenCount = 0;

    const consume = (payload: StreamPayload) => {
      const delta = payload.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        fullText += delta.content;
        tokenCount += Math.ceil(delta.content.length / 4);
        callbacks.onToken?.(delta.content);
      }
      const thought = delta.reasoning_content || delta.reasoning;
      if (thought) {
        fullThought += thought;
        callbacks.onThought?.(thought);
      }
      if (!delta.tool_calls) return;
      delta.tool_calls.forEach((toolCall, offset) => {
        const index = Number.isInteger(toolCall.index)
          ? toolCall.index as number
          : toolCall.id ? Array.from(toolCalls.entries()).find(([, item]) => item.id === toolCall.id)?.[0] ?? toolCalls.size + offset
            : toolCalls.size + offset;
        const current = toolCalls.get(index) || { id: '', name: '', args: '' };
        current.id = appendDelta(current.id, toolCall.id);
        current.name = appendDelta(current.name, toolCall.function?.name);
        current.args += toolCall.function?.arguments || '';
        toolCalls.set(index, current);
      });
      callbacks.onToolCallDelta?.(Array.from(toolCalls.values()).map((toolCall) => ({
        id: toolCall.id, name: toolCall.name, arguments: toolCall.args
      })));
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSSELines(buffer, consume);
      }
      buffer += decoder.decode();
      if (buffer) parseSSELines(`${buffer}\n`, consume);
    } finally {
      reader.releaseLock();
    }

    // Record token usage in FCC Manager
    fccManager.recordTokenUsage(Math.max(10, tokenCount));

    const parsedToolCalls = Array.from(toolCalls.values()).map((toolCall) => {
      if (!toolCall.name || !toolCall.args) throw new Error('The model returned an incomplete tool call.');
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.args) as Record<string, unknown>;
      } catch {
        throw new Error(`Malformed JSON in tool call arguments for ${toolCall.name}.`);
      }
      return { id: toolCall.id || `call_${crypto.randomUUID()}`, name: toolCall.name, arguments: args };
    });

    return {
      fullText,
      fullThought,
      toolCalls: parsedToolCalls,
      tokensUsed: tokenCount,
      provider: 'fcc-proxy'
    };
  }
}

export const fccProxyClient = new FCCProxyClient();
