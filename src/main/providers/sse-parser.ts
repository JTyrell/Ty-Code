export interface DeltaToolCall {
  index: number;
  id?: string;
  type?: 'function';
  function?: {
    name?: string;
    arguments?: string;
  };
}

export interface DeltaChunk {
  content?: string;
  reasoning_content?: string; // DeepSeek R1 reasoning tokens
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
}

export function parseSSELines(
  buffer: string,
  onChunk: (payload: StreamPayload) => void
): string {
  const lines = buffer.split('\n');
  // Keep the last incomplete line in the buffer
  const remainder = lines.pop() ?? '';

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) {
      // Keep-alive comments or empty lines
      continue;
    }

    if (trimmed.startsWith('data: ')) {
      const dataStr = trimmed.slice(6).trim();
      if (dataStr === '[DONE]') {
        continue;
      }

      try {
        const json = JSON.parse(dataStr) as StreamPayload;
        onChunk(json);
      } catch {
        // Skip malformed JSON lines
      }
    }
  }

  return remainder;
}
