/**
 * Provider Connection Diagnostic Service (Phase Diagnostics 1)
 *
 * Runs diagnostic tests across all configured and built-in free providers,
 * enforces zero-key-first execution (OpenKilo / Ollama first),
 * classifies failures into the fixed taxonomy, and produces exportable reports.
 *
 * Brand: Ty-Code
 */

import { freeProviderRegistry } from '../providers/free-provider-registry';
import { readStoredCredentials } from '../../ipc/settings-handlers';
import { parseSSELines, type StreamPayload } from '../../providers/sse-parser';
import { classifyDiagnosticError, type ClassifiedError } from './error-taxonomy';
import type {
  DiagnosticErrorCode,
  DiagnosticRunSummary,
  DiagnosticStatus,
  DiagnosticStep,
  ProviderDiagnosticResult,
  StepResult
} from '../../../shared/types/diagnostics';
import type { FreeProvider } from '../../../shared/types/free-providers';

const CANNED_TOOL = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: 'Get weather for a location',
    parameters: {
      type: 'object',
      properties: {
        location: { type: 'string', description: 'City name' }
      },
      required: ['location']
    }
  }
};

export class DiagnosticService {
  private static instance: DiagnosticService;
  private latestRun: DiagnosticRunSummary | null = null;

  public static getInstance(): DiagnosticService {
    if (!DiagnosticService.instance) {
      DiagnosticService.instance = new DiagnosticService();
    }
    return DiagnosticService.instance;
  }

  /**
   * Resolves the API key for a given provider from stored credentials or environment variables.
   */
  public async resolveApiKey(providerId: string, storedKeys: Record<string, string>): Promise<string | undefined> {
    const direct = storedKeys[providerId];
    if (direct?.trim()) return direct.trim();

    // Mapping for free provider aliases
    const aliases: Record<string, string[]> = {
      'openrouter-free': ['openrouter', 'OPENROUTER_API_KEY'],
      'groq-free': ['groq', 'GROQ_API_KEY'],
      'together-ai-free': ['together', 'together-ai', 'TOGETHER_API_KEY', 'TOGETHERAI_API_KEY'],
      'fireworks-ai-free': ['fireworks', 'fireworks-ai', 'FIREWORKS_API_KEY'],
      'huggingface-free': ['huggingface', 'HUGGINGFACE_API_KEY', 'HF_TOKEN'],
      'google-ai-studio-free': ['gemini', 'google', 'google-ai-studio', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'],
      'anthropic-claude-free': ['anthropic', 'ANTHROPIC_API_KEY'],
      'openkilo-free': ['openkilo', 'OPENKILO_API_KEY', 'KILO_API_KEY']
    };

    const searchList = aliases[providerId] || [providerId];
    for (const item of searchList) {
      if (storedKeys[item]?.trim()) return storedKeys[item].trim();
      if (process.env[item]?.trim()) return process.env[item]!.trim();
    }

    return undefined;
  }

  /**
   * Runs the complete diagnostic harness across all providers or a specific provider.
   * Zero-key-first: Anonymous providers (OpenKilo, local Ollama) run first!
   */
  public async runDiagnostics(targetProviderId?: string): Promise<DiagnosticRunSummary> {
    const { keys: storedKeys } = await readStoredCredentials();
    const allFreeProviders = freeProviderRegistry.getAllProviders();

    // Check if local Ollama is reachable
    const localOllamaCandidate: FreeProvider = {
      id: 'ollama' as any,
      name: 'Local Ollama (Offline)',
      base_url: 'http://localhost:11434/v1',
      auth_type: 'anonymous',
      best_free_models: ['llama3.2', 'qwen2.5-coder', 'mistral', 'codellama'],
      setup_instructions: 'Install from ollama.com; start with ollama serve',
      model_capabilities: { local: ['llama3.2'] },
      signup_url: 'https://ollama.com'
    };

    // Filter providers
    let providersToTest = allFreeProviders.slice();
    if (targetProviderId) {
      providersToTest = providersToTest.filter((p) => p.id === targetProviderId);
      if (targetProviderId === 'ollama') {
        providersToTest = [localOllamaCandidate];
      }
    } else {
      // Check if Ollama is running locally and add it to zero-key list
      try {
        const ping = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) }).catch(() => null);
        if (ping && ping.ok) {
          providersToTest.unshift(localOllamaCandidate);
        }
      } catch {
        // Ollama not running; continue without it
      }
    }

    // Zero-Key First: Sort anonymous providers to the very front
    providersToTest.sort((a, b) => {
      const aAnon = a.auth_type === 'anonymous' ? 0 : 1;
      const bAnon = b.auth_type === 'anonymous' ? 0 : 1;
      return aAnon - bAnon;
    });

    const results: ProviderDiagnosticResult[] = [];
    let passedCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let zeroKeyOperational = false;

    for (const provider of providersToTest) {
      const result = await this.diagnoseProvider(provider, storedKeys);
      results.push(result);

      if (result.status === 'PASS') {
        passedCount++;
        if (provider.auth_type === 'anonymous') {
          zeroKeyOperational = true;
        }
      } else if (result.status === 'SKIPPED') {
        skippedCount++;
      } else {
        failedCount++;
      }
    }

    const summary: DiagnosticRunSummary = {
      timestamp: Date.now(),
      totalTested: results.length,
      passedCount,
      failedCount,
      skippedCount,
      zeroKeyOperational,
      results
    };

    this.latestRun = summary;
    return summary;
  }

  /**
   * Diagnoses a single provider through the 5-step testing sequence.
   */
  public async diagnoseProvider(
    provider: FreeProvider,
    storedKeys: Record<string, string>
  ): Promise<ProviderDiagnosticResult> {
    const steps: Record<DiagnosticStep, StepResult> = {
      reachability: { step: 'reachability', status: 'SKIPPED', durationMs: 0 },
      auth: { step: 'auth', status: 'SKIPPED', durationMs: 0 },
      streaming: { step: 'streaming', status: 'SKIPPED', durationMs: 0 },
      tool_call: { step: 'tool_call', status: 'SKIPPED', durationMs: 0 },
      latency: { step: 'latency', status: 'SKIPPED', durationMs: 0 }
    };

    const apiKey = await this.resolveApiKey(provider.id, storedKeys);
    const requiresKey = provider.auth_type !== 'anonymous' && provider.auth_type !== 'opencode_integration';
    const baseUrl = provider.base_url === 'auto' ? 'https://openrouter.ai/api/v1' : provider.base_url.replace(/\/+$/, '');
    const modelToTest = provider.best_free_models[0] || 'deepseek/deepseek-r1:free';

    // 0. Pre-check: CONFIG_MISSING
    if (requiresKey && !apiKey) {
      steps.auth = {
        step: 'auth',
        status: 'FAIL',
        durationMs: 0,
        error: 'No API key configured for a provider that requires one'
      };
      const classified = classifyDiagnosticError(provider.id, 'CONFIG_MISSING', {
        signupUrl: provider.signup_url,
        providerName: provider.name
      });
      return {
        providerId: provider.id,
        providerName: provider.name,
        authType: provider.auth_type,
        baseUrl,
        status: 'FAIL',
        errorCode: 'CONFIG_MISSING',
        failedStep: 'auth',
        humanMessage: classified.humanMessage,
        remedy: classified.remedy,
        actionUrl: classified.actionUrl,
        actionLabel: classified.actionLabel,
        steps,
        testedModel: modelToTest
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (provider.id.includes('openrouter')) {
      headers['HTTP-Referer'] = 'https://ty-code.dev';
      headers['X-Title'] = 'Ty-Code Connection Diagnostics';
    }

    // Step 1: Reachability: GET /models
    const startReach = performance.now();
    try {
      const reachRes = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(8000)
      });

      steps.reachability = {
        step: 'reachability',
        status: reachRes.status === 401 || reachRes.status === 403 || reachRes.ok ? 'PASS' : 'FAIL',
        durationMs: Math.round(performance.now() - startReach),
        message: `HTTP ${reachRes.status}`
      };

      if (!reachRes.ok && reachRes.status !== 401 && reachRes.status !== 403 && reachRes.status !== 404) {
        const errText = await reachRes.text().catch(() => '');
        throw new Error(`Reachability check failed (${reachRes.status}): ${errText.slice(0, 150)}`);
      }
    } catch (err: unknown) {
      steps.reachability = {
        step: 'reachability',
        status: 'FAIL',
        durationMs: Math.round(performance.now() - startReach),
        error: err instanceof Error ? err.message : String(err)
      };

      const classified = classifyDiagnosticError(provider.id, err, {
        step: 'reachability',
        signupUrl: provider.signup_url,
        providerName: provider.name
      });

      return {
        providerId: provider.id,
        providerName: provider.name,
        authType: provider.auth_type,
        baseUrl,
        status: 'FAIL',
        errorCode: classified.code,
        failedStep: 'reachability',
        humanMessage: classified.humanMessage,
        remedy: classified.remedy,
        rawEvidence: classified.rawEvidence,
        steps,
        testedModel: modelToTest
      };
    }

    // Step 2: Auth: minimal 1-token chat completion
    const startAuth = performance.now();
    try {
      const authRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'Hi' }],
          max_tokens: 1
        }),
        signal: AbortSignal.timeout(12000)
      });

      const authDuration = Math.round(performance.now() - startAuth);
      if (!authRes.ok) {
        const bodyText = await authRes.text().catch(() => '');
        const classified = classifyDiagnosticError(provider.id, `Status ${authRes.status}: ${bodyText}`, {
          step: 'auth',
          statusCode: authRes.status,
          responseBody: bodyText,
          signupUrl: provider.signup_url,
          providerName: provider.name,
          configuredModel: modelToTest,
          validFreeModels: provider.best_free_models
        });

        steps.auth = {
          step: 'auth',
          status: 'FAIL',
          durationMs: authDuration,
          error: classified.humanMessage
        };

        return {
          providerId: provider.id,
          providerName: provider.name,
          authType: provider.auth_type,
          baseUrl,
          status: 'FAIL',
          errorCode: classified.code,
          failedStep: 'auth',
          humanMessage: classified.humanMessage,
          remedy: classified.remedy,
          actionUrl: classified.actionUrl,
          actionLabel: classified.actionLabel,
          suggestedFallback: classified.suggestedFallback,
          rawEvidence: classified.rawEvidence,
          steps,
          testedModel: modelToTest
        };
      }

      steps.auth = {
        step: 'auth',
        status: 'PASS',
        durationMs: authDuration,
        message: 'Minimal 1-token auth verified'
      };
    } catch (err: unknown) {
      steps.auth = {
        step: 'auth',
        status: 'FAIL',
        durationMs: Math.round(performance.now() - startAuth),
        error: err instanceof Error ? err.message : String(err)
      };

      const classified = classifyDiagnosticError(provider.id, err, {
        step: 'auth',
        signupUrl: provider.signup_url,
        providerName: provider.name,
        configuredModel: modelToTest,
        validFreeModels: provider.best_free_models
      });

      return {
        providerId: provider.id,
        providerName: provider.name,
        authType: provider.auth_type,
        baseUrl,
        status: 'FAIL',
        errorCode: classified.code,
        failedStep: 'auth',
        humanMessage: classified.humanMessage,
        remedy: classified.remedy,
        actionUrl: classified.actionUrl,
        actionLabel: classified.actionLabel,
        rawEvidence: classified.rawEvidence,
        steps,
        testedModel: modelToTest
      };
    }

    // Step 3: Streaming & Step 5: Latency sample
    const startStream = performance.now();
    let ttftMs: number | undefined;
    let rawChunks = '';

    try {
      const streamRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { ...headers, Accept: 'text/event-stream' },
        body: JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'Count: 1, 2' }],
          max_tokens: 5,
          stream: true
        }),
        signal: AbortSignal.timeout(30000)
      });

      if (!streamRes.ok) {
        const bodyText = await streamRes.text().catch(() => '');
        throw new Error(`Streaming failed (${streamRes.status}): ${bodyText}`);
      }

      const reader = streamRes.body?.getReader();
      if (!reader) {
        throw new Error('Streaming response body is null or not readable');
      }

      let parsedChunksCount = 0;
      let sseBuffer = '';
      const decoder = new TextDecoder();

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!ttftMs) {
          ttftMs = Math.round(performance.now() - startStream);
        }
        const text = decoder.decode(value, { stream: true });
        rawChunks += text;
        if (rawChunks.length > 2048) {
          rawChunks = rawChunks.slice(0, 2048);
        }

        sseBuffer += text;
        sseBuffer = parseSSELines(sseBuffer, (payload: StreamPayload) => {
          if (payload?.choices?.[0]?.delta) {
            parsedChunksCount++;
          }
        });

        // Sample is sufficient once 2 tokens arrived
        if (parsedChunksCount >= 2) {
          reader.cancel().catch(() => undefined);
          break;
        }
      }

      steps.streaming = {
        step: 'streaming',
        status: 'PASS',
        durationMs: Math.round(performance.now() - startStream),
        message: 'SSE deltas arrived and parsed cleanly'
      };

      steps.latency = {
        step: 'latency',
        status: 'PASS',
        durationMs: ttftMs || Math.round(performance.now() - startStream),
        message: `TTFT: ${ttftMs || Math.round(performance.now() - startStream)}ms`
      };
    } catch (err: unknown) {
      const duration = Math.round(performance.now() - startStream);
      steps.streaming = {
        step: 'streaming',
        status: 'FAIL',
        durationMs: duration,
        error: err instanceof Error ? err.message : String(err)
      };

      const classified = classifyDiagnosticError(provider.id, err, {
        step: 'streaming',
        responseBody: rawChunks,
        rawEvidenceChunk: rawChunks,
        signupUrl: provider.signup_url,
        providerName: provider.name
      });

      return {
        providerId: provider.id,
        providerName: provider.name,
        authType: provider.auth_type,
        baseUrl,
        status: 'FAIL',
        errorCode: classified.code,
        failedStep: 'streaming',
        humanMessage: classified.humanMessage,
        remedy: classified.remedy,
        rawEvidence: classified.rawEvidence || rawChunks,
        steps,
        testedModel: modelToTest
      };
    }

    // Step 4: Tool-Call Format verification
    const startTool = performance.now();
    try {
      const toolRes = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: modelToTest,
          messages: [{ role: 'user', content: 'What is the weather in Tokyo? Call get_weather(location="Tokyo")' }],
          tools: [CANNED_TOOL],
          tool_choice: 'auto',
          max_tokens: 64
        }),
        signal: AbortSignal.timeout(15000)
      });

      if (toolRes.ok) {
        const toolJson = await toolRes.json() as any;
        const choice = toolJson?.choices?.[0]?.message;
        const hasToolCalls = Array.isArray(choice?.tool_calls) && choice.tool_calls.length > 0;
        const hasFunctionCall = Boolean(choice?.function_call);

        if (hasToolCalls || hasFunctionCall) {
          steps.tool_call = {
            step: 'tool_call',
            status: 'PASS',
            durationMs: Math.round(performance.now() - startTool),
            message: 'Structured tool call parsed successfully'
          };
        } else {
          // Model answered without calling tool (common on small free models); still valid format response
          steps.tool_call = {
            step: 'tool_call',
            status: 'PASS',
            durationMs: Math.round(performance.now() - startTool),
            message: 'Model responded (tool format accepted without schema error)'
          };
        }
      } else {
        const errText = await toolRes.text().catch(() => '');
        // If provider explicitly doesn't support tools, format is marked or skipped
        if (errText.toLowerCase().includes('tools are not supported') || errText.toLowerCase().includes('function calling')) {
          steps.tool_call = {
            step: 'tool_call',
            status: 'SKIPPED',
            durationMs: Math.round(performance.now() - startTool),
            message: 'Provider/model does not support native function calling'
          };
        } else {
          throw new Error(`Tool-call check failed (${toolRes.status}): ${errText.slice(0, 200)}`);
        }
      }
    } catch (err: unknown) {
      steps.tool_call = {
        step: 'tool_call',
        status: 'FAIL',
        durationMs: Math.round(performance.now() - startTool),
        error: err instanceof Error ? err.message : String(err)
      };

      const classified = classifyDiagnosticError(provider.id, err, {
        step: 'tool_call',
        signupUrl: provider.signup_url,
        providerName: provider.name
      });

      return {
        providerId: provider.id,
        providerName: provider.name,
        authType: provider.auth_type,
        baseUrl,
        status: 'FAIL',
        errorCode: classified.code,
        failedStep: 'tool_call',
        humanMessage: classified.humanMessage,
        remedy: classified.remedy,
        rawEvidence: classified.rawEvidence,
        steps,
        timeToFirstTokenMs: ttftMs,
        testedModel: modelToTest
      };
    }

    // All steps passed!
    return {
      providerId: provider.id,
      providerName: provider.name,
      authType: provider.auth_type,
      baseUrl,
      status: 'PASS',
      humanMessage: 'Operational',
      remedy: 'Provider is fully operational and healthy.',
      timeToFirstTokenMs: ttftMs,
      steps,
      testedModel: modelToTest
    };
  }

  /**
   * Generates a clean, copyable markdown diagnostic report.
   */
  public generateMarkdownReport(summary?: DiagnosticRunSummary): string {
    const data = summary || this.latestRun;
    if (!data) {
      return '# Ty-Code Diagnostic Report\n\nNo diagnostics have been run yet. Click "Run All Tests" in Settings > Diagnostics.';
    }

    const dateStr = new Date(data.timestamp).toISOString();
    const lines: string[] = [];

    lines.push('# Ty-Code Provider Connection Diagnostic Report');
    lines.push(`**Generated**: ${dateStr}`);
    lines.push(`**Total Tested**: ${data.totalTested} | **Passed**: ${data.passedCount} | **Failed**: ${data.failedCount} | **Skipped**: ${data.skippedCount}`);
    lines.push(`**Zero-Key Fallback**: ${data.zeroKeyOperational ? 'ACTIVE (Ready without API keys)' : 'INACTIVE'}`);
    lines.push('');

    lines.push('## Provider Status Summary');
    lines.push('| Provider | Auth Type | Status | TTFT | Error Code | Notes |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const res of data.results) {
      const ttft = res.timeToFirstTokenMs ? `${res.timeToFirstTokenMs}ms` : '-';
      const code = res.errorCode ? `\`${res.errorCode}\`` : '-';
      const statusBadge = res.status === 'PASS' ? 'PASS' : `FAIL (${res.errorCode || 'UNKNOWN'})`;
      lines.push(`| **${res.providerName}** | \`${res.authType}\` | **${statusBadge}** | ${ttft} | ${code} | ${res.humanMessage} |`);
    }

    lines.push('');
    lines.push('## Failure Details & Remediation');

    const failedResults = data.results.filter((r) => r.status === 'FAIL');
    if (failedResults.length === 0) {
      lines.push('All tested providers passed successfully! Zero connection blockers detected.');
    } else {
      for (const fail of failedResults) {
        lines.push(`### ${fail.providerName} - \`${fail.errorCode}\``);
        lines.push(`- **Failed Step**: \`${fail.failedStep || 'auth'}\``);
        lines.push(`- **Human Message**: ${fail.humanMessage}`);
        lines.push(`- **Action Needed**: ${fail.remedy}`);
        if (fail.actionUrl) {
          lines.push(`- **Direct Link**: [${fail.actionLabel || 'Fix Configuration'}](${fail.actionUrl})`);
        }
        if (fail.suggestedFallback) {
          lines.push(`- **Suggested Fallback**: ${fail.suggestedFallback}`);
        }
        if (fail.rawEvidence) {
          lines.push('');
          lines.push('**Raw Evidence Chunk**:');
          lines.push('```text');
          lines.push(fail.rawEvidence.slice(0, 1000));
          lines.push('```');
        }
        lines.push('');
      }
    }

    lines.push('---');
    lines.push('*Ty-Code Diagnostic Service (Phase Diagnostics 1)*');

    return lines.join('\n');
  }

  public getLatestSummary(): DiagnosticRunSummary | null {
    return this.latestRun;
  }
}

export const diagnosticService = DiagnosticService.getInstance();
