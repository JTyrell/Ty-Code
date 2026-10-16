export interface DeltaToolCall {
  index?: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface DeltaChunk {
  content?: string;
  reasoning_content?: string;
  reasoning?: string;
  tool_calls?: DeltaToolCall[];
}

export interface StreamResponseChoice {
  index: number;
  delta: DeltaChunk;
  finish_reason: string | null;
}

export interface StreamPayload {
  id?: string;
  choices?: StreamResponseChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

export function parseSSELines(buffer: string, onChunk: (payload: StreamPayload) => void): string {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':') || !trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trimStart();
    if (!data || data === '[DONE]') continue;
    try {
      onChunk(JSON.parse(data) as StreamPayload);
    } catch {
      // Ignore non-JSON messages and keep-alive payloads.
    }
  }
  return remainder;
}
