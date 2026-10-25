/**
 * Live E2E Test Server Helper
 *
 * Spins up a real local HTTP server delivering standard OpenAI SSE streams
 * over loopback TCP to test real network and progressive chunk delivery.
 *
 * Brand: Ty-Code
 */

import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ProviderSettings } from '../../src/preload/types';

export interface TestServerInstance {
  server: http.Server;
  port: number;
  baseUrl: string;
  settings: ProviderSettings;
  close: () => Promise<void>;
}

export async function startLiveTestServer(): Promise<TestServerInstance> {
  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: 100 }));
      return;
    }

    if (req.url === '/v1/models' || req.url === '/models') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          object: 'list',
          data: [
            { id: 'llama-3.3-70b-versatile', object: 'model', isFree: true },
            { id: 'qwen2.5-coder', object: 'model', isFree: true },
            { id: 'claude-3-5-sonnet-20241022', object: 'model', isFree: true }
          ]
        })
      );
      return;
    }

    if (req.url === '/v1/chat/completions' || req.url === '/chat/completions') {
      let body = '';
      req.on('data', (c) => {
        body += c;
      });
      req.on('end', () => {
        let parsed: any = {};
        try {
          parsed = JSON.parse(body || '{}');
        } catch {
          // ignore
        }

        const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
        const lastMsgObj = messages[messages.length - 1];
        const lastMsg = typeof lastMsgObj?.content === 'string' ? lastMsgObj.content : '';
        const hasTools = Array.isArray(parsed.tools) && parsed.tools.length > 0;

        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive'
        });

        // 1. Tool Call: Create file live-check.md
        const isToolCreationRequest =
          hasTools &&
          (/create\s+file\s+live-check\.md/i.test(lastMsg) ||
            /live-check\.md/i.test(lastMsg)) &&
          lastMsgObj?.role !== 'tool';

        if (isToolCreationRequest) {
          // Two-phase protocol-faithful replay: the agent engine locks mutating
          // tools until a Task Scoping Report is approved via request_approval,
          // so the scripted model must submit the plan first and only then
          // emit the write_file call (after the approval tool result lands).
          const hadPlanApproval = Array.isArray(messages) && messages.some(
            (m: any) => {
              if (m?.role === 'tool' && String(m?.name || '') === 'request_approval') return true;
              if (m?.role === 'user' && typeof m?.content === 'string') {
                return /\[Tool Result for request_approval\]:/.test(m.content);
              }
              return false;
            }
          );
          const hadWriteResult = Array.isArray(messages) && messages.some(
            (m: any) => m?.role === 'user' && typeof m?.content === 'string' && /\[Tool Result for write_file\]/.test(m.content)
          );
          const hadReadBack = Array.isArray(messages) && messages.some(
            (m: any) => m?.role === 'user' && typeof m?.content === 'string' && /\[Tool Result for read_file\]/.test(m.content)
          );
          if (hadWriteResult && hadReadBack) {
            const summaryChunk = {
              id: `chatcmpl-${Date.now()}-final`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'llama-3.3-70b-versatile',
              choices: [
                {
                  index: 0,
                  delta: {
                    content: 'live-check.md was created and verified on disk. Phase 1 checkpoint reached.'
                  },
                  finish_reason: 'stop'
                }
              ]
            };
            res.write(`data: ${JSON.stringify(summaryChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          if (hadWriteResult) {
            const readBackChunk = {
              id: `chatcmpl-${Date.now()}-read`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'llama-3.3-70b-versatile',
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call_read_${Date.now()}`,
                        type: 'function',
                        function: {
                          name: 'read_file',
                          arguments: JSON.stringify({
                            filePath: 'live-check.md'
                          })
                        }
                      }
                    ]
                  },
                  finish_reason: null
                }
              ]
            };
            res.write(`data: ${JSON.stringify(readBackChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          if (!hadPlanApproval) {
            const planToolCallChunk = {
              id: `chatcmpl-${Date.now()}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'llama-3.3-70b-versatile',
              choices: [
                {
                  index: 0,
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: `call_plan_${Date.now()}`,
                        type: 'function',
                        function: {
                          name: 'request_approval',
                          arguments: JSON.stringify({
                            summary: 'Create live-check.md via write_file; single-step plan awaiting approval.',
                            report: [
                              '## Ty-Code Task Scoping Report',
                              '### Complexity & Resource Gauge',
                              'Simple: one planned task, one write_file invocation, no terminal commands.',
                              '### Execution Plan (Phased)',
                              '- **Phase 1 — Implementation**: Create live-check.md containing the single line verified.',
                              '- **Phase 2 — Verification**: Read the file content back and confirm it matches exactly.',
                              '### Failure Risks & Mitigations',
                              'If the write fails, retry once with the same relative path before escalating.',
                              '### Checkpoint Proposal',
                              'Checkpoint after Phase 1: verify file content on disk.'
                            ].join('\n'),
                            checkpoint: 'after Phase 1 content verification'
                          })
                        }
                      }
                    ]
                  },
                  finish_reason: null
                }
              ]
            };
            res.write(`data: ${JSON.stringify(planToolCallChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
            return;
          }
          const toolCallChunk = {
            id: `chatcmpl-${Date.now()}`,
            object: 'chat.completion.chunk',
            created: Math.floor(Date.now() / 1000),
            model: 'llama-3.3-70b-versatile',
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: `call_write_${Date.now()}`,
                      type: 'function',
                      function: {
                        name: 'write_file',
                        arguments: JSON.stringify({
                          filePath: 'live-check.md',
                          content: 'verified\n'
                        })
                      }
                    }
                  ]
                },
                finish_reason: null
              }
            ]
          };
          res.write(`data: ${JSON.stringify(toolCallChunk)}\n\n`);
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }

        // 2. Nonce Echo: "Repeat this code exactly: 7Q4X9"
        const nonceMatch = lastMsg.match(/Repeat this code exactly:\s*([^\s]+)/i);
        let tokens: string[] = [];

        if (nonceMatch) {
          const nonce = nonceMatch[1];
          tokens = ['Code:', ' ', nonce, ' ', 'echoed', ' ', 'faithfully.'];
        } else if (lastMsg.trim() === 'Hi') {
          tokens = ['Hello!', ' ', 'How', ' ', 'can', ' ', 'I', ' ', 'assist', ' ', 'you', ' ', 'today?'];
        } else if (/explain\s+hashes/i.test(lastMsg)) {
          tokens = [
            'A', ' ', 'cryptographic', ' ', 'hash', ' ', 'function', ' ',
            'deterministically', ' ', 'maps', ' ', 'arbitrary', ' ', 'data', ' ',
            'to', ' ', 'a', ' ', 'fixed-size', ' ', 'hash', ' ', 'digest.'
          ];
        } else if (/17\s*\*\s*23/i.test(lastMsg)) {
          tokens = ['17', ' ', 'multiplied', ' ', 'by', ' ', '23', ' ', 'is', ' ', '391.'];
        } else if (lastMsgObj?.role === 'tool') {
          tokens = ['File', ' ', 'live-check.md', ' ', 'created', ' ', 'with', ' ', 'verified.'];
        } else {
          tokens = ['Response:', ' ', 'processed', ' ', 'live', ' ', 'from', ' ', 'real', ' ', 'provider.'];
        }

        // Stream tokens with small delays
        let idx = 0;
        const sendNext = () => {
          if (idx < tokens.length) {
            const token = tokens[idx++];
            const chunk = {
              id: `chatcmpl-${Date.now()}-${idx}`,
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: 'llama-3.3-70b-versatile',
              choices: [
                {
                  index: 0,
                  delta: { content: token },
                  finish_reason: null
                }
              ]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            setImmediate(sendNext);
          } else {
            res.write('data: [DONE]\n\n');
            res.end();
          }
        };

        sendNext();
      });
      return;
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => resolve());
    server.on('error', reject);
  });

  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}/v1`;

  const settings: ProviderSettings = {
    activeProvider: 'fcc-proxy' as any,
    activeModel: 'llama-3.3-70b-versatile',
    routingStrategy: 'manual',
    enableFailover: false,
    apiKeys: {},
    customEndpoints: {
      'fcc-proxy': baseUrl
    },
    temperature: 0.2,
    maxTokens: 512,
    offlineDemoMode: false
  };

  return {
    server,
    port,
    baseUrl,
    settings,
    close: async () => {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  };
}
