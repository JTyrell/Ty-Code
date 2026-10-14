import type { ModelConfig, ProviderSettings, ProviderType } from '../../preload/types';
import { parseSSELines, type StreamPayload } from './sse-parser';

export const DEFAULT_PRESET_MODELS: ModelConfig[] = [
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Top coding capabilities at ultra-low price' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 Reasoning (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Advanced mathematical & architectural reasoning' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Specialized competitive coding model' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'Free tier Llama 3.3 70B' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'High-speed free multimodal model' },
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', isFree: false, description: 'Ultra-fast token streaming (~300 tokens/sec)' },
  { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B (Groq)', provider: 'groq', isFree: false, description: 'Blazing fast dedicated coder' },
  { id: 'deepseek-chat', name: 'DeepSeek V3 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek endpoint' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek reasoning model' },
  { id: 'qwen2.5-coder:latest', name: 'Qwen 2.5 Coder (Local Ollama)', provider: 'ollama', isFree: true, description: '100% private offline local inference' },
  { id: 'deepseek-r1:latest', name: 'DeepSeek R1 (Local Ollama)', provider: 'ollama', isFree: true, description: 'Private offline reasoning model' },
  { id: 'claude-3-5-sonnet-20241022', name: 'FCC Proxy Claude 3.5 Sonnet', provider: 'fcc-proxy', isFree: true, description: 'Proxied through local free-claude-code instance' }
];

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
}

interface AccumulatedToolCall { id: string; name: string; args: string; }

function appendDelta(existing: string, incoming: string | undefined): string {
  if (!incoming || incoming === existing || existing.endsWith(incoming)) return existing;
  if (incoming.startsWith(existing)) return incoming;
  return existing + incoming;
}

export class ProviderGateway {
  static getEndpoint(provider: ProviderType, customEndpoints: Partial<Record<ProviderType, string>>): string {
    if (customEndpoints[provider]) return customEndpoints[provider]!;
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
    const provider = settings.activeProvider;
    const baseUrl = this.getEndpoint(provider, settings.customEndpoints || {});
    const apiKey = settings.apiKeys[provider] || '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/Alishahryar1/free-claude-code';
      headers['X-Title'] = 'Ty-Code Desktop';
    }
    const body: Record<string, unknown> = {
      model: settings.activeModel,
      messages,
      stream: true,
      temperature: settings.temperature ?? 0.2,
      max_tokens: settings.maxTokens ?? 4096
    };
    if (tools.length > 0) { body.tools = tools; body.tool_choice = 'auto'; }
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST', headers, body: JSON.stringify(body), signal: abortSignal
    });
    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = errorText;
      try {
        const errorJson = JSON.parse(errorText) as { error?: { message?: string }; message?: string };
        parsedError = errorJson.error?.message || errorJson.message || errorText;
      } catch { /* Use provider's raw error response. */ }
      throw new Error(`[${provider}] API Error (${response.status}): ${parsedError}`);
    }
    if (!response.body) throw new Error('Response body is empty');

    let fullText = '';
    let fullThought = '';
    const toolCalls = new Map<number, AccumulatedToolCall>();
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const consume = (payload: StreamPayload) => {
      const delta = payload.choices?.[0]?.delta;
      if (!delta) return;
      if (delta.content) { fullText += delta.content; callbacks.onToken?.(delta.content); }
      const thought = delta.reasoning_content || delta.reasoning;
      if (thought) { fullThought += thought; callbacks.onThought?.(thought); }
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
    return { fullText, fullThought, toolCalls: parsedToolCalls };
  }
}
