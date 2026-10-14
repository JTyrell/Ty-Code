import type { ModelConfig, ProviderSettings, ProviderType } from '../../preload/types';
import { parseSSELines, type StreamPayload } from './sse-parser';

export const DEFAULT_PRESET_MODELS: ModelConfig[] = [
  // OpenRouter Free & Low Cost
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3 (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Top coding capabilities at ultra-low price' },
  { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1 Reasoning (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Advanced mathematical & architectural reasoning' },
  { id: 'qwen/qwen-2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder 32B (OpenRouter)', provider: 'openrouter', isFree: false, description: 'Specialized competitive coding model' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'Free tier Llama 3.3 70B' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free OpenRouter)', provider: 'openrouter', isFree: true, description: 'High-speed free multimodal model' },

  // Groq Fast Inference
  { id: 'llama-3.3-70b-versatile', name: 'Llama 3.3 70B (Groq)', provider: 'groq', isFree: false, description: 'Ultra-fast token streaming (~300 tokens/sec)' },
  { id: 'qwen-2.5-coder-32b', name: 'Qwen 2.5 Coder 32B (Groq)', provider: 'groq', isFree: false, description: 'Blazing fast dedicated coder' },

  // DeepSeek Direct
  { id: 'deepseek-chat', name: 'DeepSeek V3 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek endpoint' },
  { id: 'deepseek-reasoner', name: 'DeepSeek R1 (Direct)', provider: 'deepseek', isFree: false, description: 'Direct official DeepSeek reasoning model' },

  // Ollama Offline Local
  { id: 'qwen2.5-coder:latest', name: 'Qwen 2.5 Coder (Local Ollama)', provider: 'ollama', isFree: true, description: '100% private offline local inference' },
  { id: 'deepseek-r1:latest', name: 'DeepSeek R1 (Local Ollama)', provider: 'ollama', isFree: true, description: 'Private offline reasoning model' },

  // Free-Claude-Code Proxy / Custom
  { id: 'claude-3-5-sonnet-20241022', name: 'FCC Proxy Claude 3.5 Sonnet', provider: 'fcc-proxy', isFree: true, description: 'Proxied through local free-claude-code instance' }
];

export interface ChatCompletionMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: 'function';
    function: {
      name: string;
      arguments: string;
    };
  }>;
}

export interface StreamEventCallbacks {
  onToken?: (token: string) => void;
  onThought?: (thought: string) => void;
  onToolCallDelta?: (toolCalls: Array<{ id: string; name: string; arguments: string }>) => void;
}

export class ProviderGateway {
  static getEndpoint(provider: ProviderType, customEndpoints: Partial<Record<ProviderType, string>>): string {
    if (customEndpoints[provider]) {
      return customEndpoints[provider]!;
    }

    switch (provider) {
      case 'openrouter':
        return 'https://openrouter.ai/api/v1';
      case 'groq':
        return 'https://api.groq.com/openai/v1';
      case 'deepseek':
        return 'https://api.deepseek.com';
      case 'ollama':
        return 'http://localhost:11434/v1';
      case 'fcc-proxy':
        return 'http://localhost:8082/v1';
      default:
        return 'https://openrouter.ai/api/v1';
    }
  }

  static async streamChat(
    settings: ProviderSettings,
    messages: ChatCompletionMessage[],
    tools: unknown[],
    callbacks: StreamEventCallbacks,
    abortSignal?: AbortSignal
  ): Promise<{
    fullText: string;
    fullThought: string;
    toolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }>;
  }> {
    const provider = settings.activeProvider;
    const baseUrl = this.getEndpoint(provider, settings.customEndpoints || {});
    const apiKey = settings.apiKeys[provider] || '';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json'
    };

    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    if (provider === 'openrouter') {
      headers['HTTP-Referer'] = 'https://github.com/Alishahryar1/free-claude-code';
      headers['X-Title'] = 'Ty-Claude Desktop';
    }

    const body: Record<string, unknown> = {
      model: settings.activeModel,
      messages,
      stream: true,
      temperature: settings.temperature ?? 0.2,
      max_tokens: settings.maxTokens ?? 4096
    };

    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const endpointUrl = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;

    const response = await fetch(endpointUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: abortSignal
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = errorText;
      try {
        const errorJson = JSON.parse(errorText);
        parsedError = errorJson.error?.message || errorJson.message || errorText;
      } catch {
        // use raw text
      }
      throw new Error(`[${provider}] API Error (${response.status}): ${parsedError}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty');
    }

    let fullText = '';
    let fullThought = '';
    const accumulatedToolCalls: Map<number, { id: string; name: string; args: string }> = new Map();

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      buffer = parseSSELines(buffer, (payload: StreamPayload) => {
        const choice = payload.choices?.[0];
        if (!choice) return;

        const delta = choice.delta;

        // Content streaming
        if (delta.content) {
          fullText += delta.content;
          callbacks.onToken?.(delta.content);
        }

        // DeepSeek reasoning content streaming
        if (delta.reasoning_content) {
          fullThought += delta.reasoning_content;
          callbacks.onThought?.(delta.reasoning_content);
        }

        // Tool calls streaming
        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const index = tc.index ?? 0;
            const existing = accumulatedToolCalls.get(index) || { id: '', name: '', args: '' };

            if (tc.id) existing.id += tc.id;
            if (tc.function?.name) existing.name += tc.function.name;
            if (tc.function?.arguments) existing.args += tc.function.arguments;

            accumulatedToolCalls.set(index, existing);
          }

          callbacks.onToolCallDelta?.(
            Array.from(accumulatedToolCalls.values()).map((tc) => ({
              id: tc.id,
              name: tc.name,
              arguments: tc.args
            }))
          );
        }
      });
    }

    // Convert accumulated tool calls
    const parsedToolCalls: Array<{ id: string; name: string; arguments: Record<string, unknown> }> = [];
    for (const [_, tc] of accumulatedToolCalls.entries()) {
      let argsObj: Record<string, unknown> = {};
      try {
        argsObj = JSON.parse(tc.args);
      } catch {
        console.warn(`[Gateway] Malformed JSON in tool call arguments for ${tc.name}:`, tc.args);
      }

      parsedToolCalls.push({
        id: tc.id || `call_${Date.now()}`,
        name: tc.name,
        arguments: argsObj
      });
    }

    return {
      fullText,
      fullThought,
      toolCalls: parsedToolCalls
    };
  }
}
