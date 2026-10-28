/**
 * Unit tests for the FCC sidecar line classifier (Prompt: Stream Hygiene).
 *
 * The classifier is the gate between sidecar output and the agent stream:
 * a line enters the pipeline ONLY as a protocol frame (JSON-RPC, OpenAI
 * chat chunk, SSE `data:` carrier, or `[DONE]`); every other line is log
 * output and must be routed to the sidecarLogLedger instead.
 */

import { describe, expect, it } from 'vitest';
import {
  classifySidecarLine,
  isHarnessLogContent,
  FAILOVER_RESUME_INSTRUCTION,
  SidecarChatChunkFrameSchema,
  SidecarJsonRpcFrameSchema
} from './sidecar-line-classifier';

describe('classifySidecarLine — protocol frames', () => {
  it('classifies a JSON-RPC result frame as protocol', () => {
    const line = '{"jsonrpc":"2.0","id":1,"result":{"ok":true}}';
    const result = classifySidecarLine(line);
    expect(result.kind).toBe('protocol');
  });

  it('classifies an OpenAI chat chunk frame as protocol', () => {
    const line = '{"choices":[{"delta":{"content":"hello"}}]}';
    const result = classifySidecarLine(line);
    expect(result.kind).toBe('protocol');
  });

  it('classifies an SSE data-carried chunk as protocol', () => {
    const result = classifySidecarLine('data: {"choices":[{"delta":{"content":"hi"}}]}');
    expect(result.kind).toBe('protocol');
  });

  it('classifies [DONE] and data: [DONE] as protocol', () => {
    expect(classifySidecarLine('[DONE]').kind).toBe('protocol');
    expect(classifySidecarLine('data: [DONE]').kind).toBe('protocol');
  });

  it('classifies a generic JSON object emitted by the genuine binary as protocol', () => {
    const result = classifySidecarLine('{"kind":"ndjson-scaffolding","seq":3}');
    expect(result.kind).toBe('protocol');
  });

  it('classifies blank lines as log (never streamable)', () => {
    expect(classifySidecarLine('   ').kind).toBe('log');
    expect(classifySidecarLine('').kind).toBe('log');
  });
});

describe('classifySidecarLine — log lines', () => {
  it('classifies the FCC harness announce as a log line', () => {
    expect(classifySidecarLine('Processed request via FCC claude-code harness.').kind).toBe('log');
    expect(classifySidecarLine('Processed request via FCC codex harness.').kind).toBe('log');
  });

  it('classifies arbitrary prose as a log line', () => {
    expect(classifySidecarLine('everything looks fine, starting up...').kind).toBe('log');
  });

  it('classifies broken JSON fragments as log lines', () => {
    expect(classifySidecarLine('{"choices":[{"delta":{"content":"trunc').kind).toBe('log');
  });

  it('classifies malformed SSE payloads as log lines', () => {
    expect(classifySidecarLine('data: this is not json').kind).toBe('log');
  });
});

describe('isHarnessLogContent — content-level gate', () => {
  it('matches the exact harness announce observed in the chat stream', () => {
    expect(isHarnessLogContent('Processed request via FCC claude-code harness.')).toBe(true);
  });

  it('matches the non-stream harness response trailer', () => {
    expect(isHarnessLogContent('Response routed via FCC harness: some provider detail')).toBe(true);
  });

  it('rejects genuine completion content', () => {
    expect(isHarnessLogContent('Here is how to fix the failing test:')).toBe(false);
    expect(isHarnessLogContent('')).toBe(false);
    expect(isHarnessLogContent(null)).toBe(false);
    expect(isHarnessLogContent(undefined)).toBe(false);
  });

  it('rejects content that merely mentions FCC mid-sentence', () => {
    expect(isHarnessLogContent('The FCC harness is used by Ty-Code for free supply.')).toBe(false);
  });
});

describe('shared Zod schemas', () => {
  it('accepts the sidecar JSON-RPC ack shape', () => {
    const parsed = SidecarJsonRpcFrameSchema.safeParse({ jsonrpc: '2.0', id: 7, result: {} });
    expect(parsed.success).toBe(true);
  });

  it('accepts the streaming chunk shape and preserves delta content', () => {
    const parsed = SidecarChatChunkFrameSchema.safeParse({ choices: [{ delta: { content: 'x' } }] });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.choices?.[0]?.delta?.content).toBe('x');
    }
  });

  it('rejects non-object frames', () => {
    expect(SidecarJsonRpcFrameSchema.safeParse('plain text').success).toBe(false);
    expect(SidecarChatChunkFrameSchema.safeParse([1, 2, 3]).success).toBe(false);
  });
});

describe('FAILOVER_RESUME_INSTRUCTION', () => {
  it('is a resume sentinel that forbids repeating content', () => {
    expect(FAILOVER_RESUME_INSTRUCTION).toContain('EXACTLY');
    expect(FAILOVER_RESUME_INSTRUCTION).toContain('never repeat');
  });
});
