import type { ModelConfig, ProviderSettings, ProviderType } from '../../preload/types';
import { parseSSELines, type StreamPayload } from './sse-parser';
import {
  OmniRouteRouter,
  omniRouteRouter
} from '../services/orchestration/router';
import { connectionPool } from '../services/orchestration/connection-pool';
import { providerRegistry } from '../services/orchestration/provider-registry';
import { fccManager } from '../services/orchestration/fcc-manager';
import type { ProviderCandidate } from '../services/orchestration/strategies/types';

import { DEFAULT_PRESET_MODELS } from '../../preload/preset-models';
export { DEFAULT_PRESET_MODELS };

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
}

export interface StreamEventCallbacks {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onToolCallDelta?: (toolCalls: Array<{ id: string; name: string; arguments: string }>) => void;
  onFailoverNotice?: (notice: { attempt: number; failedProvider: string; nextProvider?: string; error: string }) => void;
}

interface AccumulatedToolCall { id: string; name: string; args: string; }

function appendDelta(existing: string, incoming: string | undefined): string {
  if (!incoming || incoming === existing || existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;
  return existing + incoming;
}

export class ProviderGateway {
  public static router: OmniRouteRouter = omniRouteRouter;

  static getEndpoint(provider: ProviderType, customEndpoints: Partial<Record<ProviderType, string>>): string {
    if (customEndpoints[provider]) return customEndpoints[provider]!;
    const registered = providerRegistry.getProvider(provider);
    if (registered?.defaultEndpoint) return registered.defaultEndpoint;
    switch (provider) {
      case 'openrouter': return 'https://openrouter.ai/api/v1';
      case 'groq': return 'https://api.groq.com/openai/v1';
      case 'deepseek': return 'https://api.deepseek.com';
      case 'ollama': return 'http://localhost:11434/v1';
      case 'fcc-proxy': return 'http://localhost:8082/v1';
      default: return 'https://openrouter.ai/api/v1';
    }
  }

  static async streamChat(
    settings: ProviderSettings,
    messages: ChatCompletionMessage[],
    tools: unknown[],
    callbacks: StreamEventCallbacks,
    abortSignal?: AbortSignal
  ): Promise<{ fullText: string; fullThought: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
    // Determine primary task based on tools or message signals
    const hasTools = tools && tools.length > 0;
    const taskType = hasTools ? 'coding' : 'general';

    const executionResult = await this.router.executeWithFailover({
      context: {
        taskType,
        requiredCapabilities: { tools: hasTools },
        manualSelection: {
          providerId: settings.activeProvider,
          modelId: settings.activeModel
        }
      },
      settings,
      messages,
      onFailover: (event) => {
        callbacks.onFailoverNotice?.({
          attempt: event.attempt,
          failedProvider: event.failedProvider,
          nextProvider: event.nextProvider,
          error: event.error
        });
      },
      execute: async (candidate: ProviderCandidate, reconciledMessages: ChatCompletionMessage[]) => {
        return this.streamWithCandidate(candidate, settings, reconciledMessages, tools, callbacks, abortSignal);
      }
    });

    return executionResult.result;
  }

  private static async streamWithCandidate(
    candidate: ProviderCandidate,
    settings: ProviderSettings,
    messages: ChatCompletionMessage[],
    tools: unknown[],
    callbacks: StreamEventCallbacks,
    abortSignal?: AbortSignal
  ): Promise<{ fullText: string; fullThought: string; toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> }> {
    const providerId = candidate.provider.id as ProviderType;
    const modelId = candidate.model.id;
    const baseUrl = candidate.customEndpoint || this.getEndpoint(providerId, settings.customEndpoints || {});
    const apiKey = candidate.apiKey || settings.apiKeys[providerId] || '';

    if (providerId === 'fcc-proxy' && !fccManager.getStatus().running) {
      await fccManager.start();
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (candidate.provider.headersFactory) {
      Object.assign(headers, candidate.provider.headersFactory({ apiKey }));
    } else if (providerId === 'fcc-proxy' || providerId === 'openrouter') {
      headers['User-Agent'] = 'free-claude-code/0.9.4 (Ty-Code Desktop Sidecar)';
      headers['HTTP-Referer'] = 'https://github.com/Alishahryar1/free-claude-code';
      headers['X-Title'] = 'Ty-Code Desktop';
      if (providerId === 'fcc-proxy') {
        headers['X-FCC-Client'] = 'ty-code';
      }
    }

    const body: Record<string, unknown> = {
      model: modelId,
      messages,
      stream: true,
      temperature: settings.temperature ?? 0.2,
      max_tokens: Math.min(settings.maxTokens ?? 4096, candidate.model.maxOutputTokens || 4096)
    };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = errorText;
      try {
        const errorJson = JSON.parse(errorText) as { error?: { message?: string }; message?: string };
        parsedError = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        // Use provider's raw error response
      }
      throw new Error(`[${providerId}] API Error (${response.status}): ${parsedError}`);
    }

    if (!response.body) throw new Error(`[${providerId}] Response body is empty`);

    let fullText = '';
    let fullThought = '';
    const toolCalls = new Map<number, AccumulatedToolCall>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const consume = (payload: StreamPayload) => {
      const delta = payload.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) {
        fullText += delta.content;
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

    const parsedToolCalls = Array.from(toolCalls.values()).map((toolCall) => {
      if (!toolCall.name || !toolCall.args) throw new Error('The model returned an incomplete tool call. Try again.');
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.args) as Record<string, unknown>;
      } catch {
        throw new Error(`Malformed JSON in tool call arguments for ${toolCall.name}.`);
      }
      return { id: toolCall.id || `call_${crypto.randomUUID()}`, name: toolCall.name, arguments: args };
    });

    if (providerId === 'fcc-proxy') {
      fccManager.recordTokenUsage(Math.max(10, Math.ceil(fullText.length / 4)));
    }

    return { fullText, fullThought, toolCalls: parsedToolCalls };
  }
}

export { omniRouteRouter, connectionPool, providerRegistry };
