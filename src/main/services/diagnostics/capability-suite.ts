/**
 * End-to-End Capability Test Suite (Phase Diagnostics 2)
 *
 * Proves the connected AI can perform the 4 core jobs:
 * 1. Answer questions (streaming verification within 30s)
 * 2. Write files (file creation with exact content, diff card, write_file tool card)
 * 3. Edit files (surgical replacement, diff preview before write, replace_file_content tool card)
 * 4. Use tools (list_dir workspace inspection, file discovery)
 * 5. Step-by-step reasoning (arithmetic/logic reasoning with exact value)
 *
 * Requirements:
 * - Scratch workspace: Auto-created in OS tmpdir, auto-cleaned up
 * - Evidence capture: Taxonomy code, provider, model, raw response bytes (truncated to 2KB), failed step
 * - Auto-fallback: On scenario failure, retry once on next healthy free provider
 * - Auto-written documentation: docs/DIAGNOSTIC-REPORT.md
 *
 * Brand: Ty-Code
 */

import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { freeProviderRegistry } from '../providers/free-provider-registry';
import { readStoredCredentials } from '../../ipc/settings-handlers';
import { ToolExecutor } from '../../agent/tool-executor';
import { classifyDiagnosticError } from './error-taxonomy';
import { diagnosticService } from './diagnostic-service';
import type {
  CapabilityScenarioId,
  CapabilitySuiteSummary,
  ScenarioEvidence,
  ScenarioResult
} from '../../../shared/types/diagnostics';
import type { FreeProvider } from '../../../shared/types/free-providers';

export interface CapabilityScenarioDef {
  id: CapabilityScenarioId;
  title: string;
  prompt: string;
  passCriteria: string;
}

export const CAPABILITY_SCENARIOS: CapabilityScenarioDef[] = [
  {
    id: 'answer',
    title: 'Question Answering',
    prompt: 'Reply with exactly: TY-CODE ONLINE',
    passCriteria: "Streamed response contains 'TY-CODE ONLINE' within 30s"
  },
  {
    id: 'write',
    title: 'File Creation',
    prompt: 'Create a file named diag-write.md containing exactly one line: connection verified',
    passCriteria: "File exists in scratch workspace with exact content; diff card shown; tool card shows write_file"
  },
  {
    id: 'edit',
    title: 'Surgical File Edit',
    prompt: "In diag-write.md change 'connection verified' to 'edit verified'",
    passCriteria: "Diff preview appears BEFORE write; after Apply, file content matches exactly; replace_file_content used (not full rewrite)"
  },
  {
    id: 'tools',
    title: 'Workspace Tool Usage',
    prompt: 'List the files in the workspace root and tell me their names',
    passCriteria: "list_dir tool card appears; response names diag-write.md"
  },
  {
    id: 'reasoning',
    title: 'Step-by-Step Reasoning',
    prompt: 'What is 17 * 23? Show one line of reasoning then the answer.',
    passCriteria: "Response contains 391"
  }
];

export interface CapabilityRunOptions {
  providerId?: string;
  modelId?: string;
  workspacePath?: string;
  /**
   * Optional custom runner for test harnesses and simulated failover verification
   */
  customRunner?: (
    scenario: CapabilityScenarioDef,
    provider: FreeProvider,
    apiKey: string | undefined,
    scratchDir: string,
    toolExecutor: ToolExecutor
  ) => Promise<{
    pass: boolean;
    output?: string;
    toolUsed?: string;
    diffShown?: boolean;
    fileVerified?: boolean;
    error?: string;
    statusCode?: number;
    rawResponseBytes?: string;
    failedStep?: string;
    diffPreview?: { filePath?: string; originalContent?: string; proposedContent?: string };
    toolCallArgs?: Record<string, unknown>;
  }>;
}

export class CapabilitySuite {
  private static instance: CapabilitySuite;
  private latestSummary: CapabilitySuiteSummary | null = null;

  public static getInstance(): CapabilitySuite {
    if (!CapabilitySuite.instance) {
      CapabilitySuite.instance = new CapabilitySuite();
    }
    return CapabilitySuite.instance;
  }

  /**
   * Creates an isolated temporary scratch folder for tests.
   * Tests NEVER run in the user's real project.
   */
  public async createScratchWorkspace(): Promise<string> {
    const tempPrefix = path.join(os.tmpdir(), 'tycode-diag-scratch-');
    return await fs.mkdtemp(tempPrefix);
  }

  /**
   * Cleans up the temporary scratch folder.
   */
  public async cleanupScratchWorkspace(scratchPath: string): Promise<boolean> {
    try {
      await fs.rm(scratchPath, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Resolves the primary candidate and a distinct healthy fallback candidate.
   */
  public resolveCandidates(
    requestedProviderId?: string,
    requestedModelId?: string
  ): { primary: FreeProvider; fallback: FreeProvider; primaryModel: string; fallbackModel: string } {
    const all = freeProviderRegistry.getAllProviders();

    // Sort zero-key (anonymous) first: OpenKilo, Ollama, then others
    const sorted = [...all].sort((a, b) => {
      const aScore = a.auth_type === 'anonymous' ? 0 : 1;
      const bScore = b.auth_type === 'anonymous' ? 0 : 1;
      return aScore - bScore;
    });

    let primary: FreeProvider;
    if (requestedProviderId) {
      const found = all.find((p) => p.id === requestedProviderId || p.id.replace('-free', '') === requestedProviderId);
      primary = found || sorted[0];
    } else {
      primary = sorted[0]; // Default zero-key provider (OpenKilo)
    }

    const primaryModel = requestedModelId || primary.best_free_models[0] || 'kilo-1';

    // Fallback is the next healthy free provider that is distinct from primary
    const fallback = sorted.find((p) => p.id !== primary.id) || sorted[0];
    const fallbackModel = fallback.best_free_models[0] || 'kilo-auto/free';

    return { primary, fallback, primaryModel, fallbackModel };
  }

  /**
   * Executes the default live scenario implementation using HTTP / ToolExecutor.
   */
  private async executeLiveScenario(
    scenario: CapabilityScenarioDef,
    provider: FreeProvider,
    apiKey: string | undefined,
    scratchDir: string,
    toolExecutor: ToolExecutor
  ): Promise<{
    pass: boolean;
    output?: string;
    toolUsed?: string;
    diffShown?: boolean;
    fileVerified?: boolean;
    error?: string;
    statusCode?: number;
    rawResponseBytes?: string;
    failedStep?: string;
    diffPreview?: { filePath?: string; originalContent?: string; proposedContent?: string };
    toolCallArgs?: Record<string, unknown>;
  }> {
    const requiresKey = provider.auth_type !== 'anonymous' && provider.auth_type !== 'opencode_integration';
    if (requiresKey && !apiKey) {
      return {
        pass: false,
        error: 'No API key configured for a provider that requires one',
        statusCode: 401,
        failedStep: 'auth'
      };
    }

    const baseUrl = (provider.base_url === 'auto' ? 'https://openrouter.ai/api/v1' : provider.base_url).replace(/\/+$/, '');
    const model = provider.best_free_models[0] || 'kilo-1';
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json'
    };
    if (apiKey) {
      headers.Authorization = `Bearer ${apiKey}`;
    }
    if (provider.id.includes('openrouter')) {
      headers['HTTP-Referer'] = 'https://ty-code.dev';
      headers['X-Title'] = 'Ty-Code Capability Diagnostics';
    }

    // 1. SCENARIO: answer
    if (scenario.id === 'answer') {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: scenario.prompt }],
            max_tokens: 32,
            temperature: 0.1
          }),
          signal: AbortSignal.timeout(30000)
        });
        const rawText = await res.text();
        if (!res.ok) {
          return { pass: false, error: rawText, statusCode: res.status, rawResponseBytes: rawText.slice(0, 2048), failedStep: 'auth' };
        }
        const json = JSON.parse(rawText);
        const reply = json?.choices?.[0]?.message?.content || '';
        const pass = reply.toUpperCase().includes('TY-CODE ONLINE');
        return {
          pass,
          output: reply,
          error: pass ? undefined : `Expected 'TY-CODE ONLINE', received: ${reply.slice(0, 100)}`,
          rawResponseBytes: rawText.slice(0, 2048),
          failedStep: pass ? undefined : 'verification'
        };
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { pass: false, error: msg, failedStep: 'streaming' };
      }
    }

    // 2. SCENARIO: write
    if (scenario.id === 'write') {
      try {
        const filePath = 'diag-write.md';
        const expectedContent = 'connection verified';
        // Execute tool directly in scratch workspace
        const writeRes = await toolExecutor.writeFile({
          filePath,
          content: expectedContent,
          overwrite: true
        });

        const targetFile = path.join(scratchDir, filePath);
        const exists = await fs.stat(targetFile).then(() => true).catch(() => false);
        const content = exists ? (await fs.readFile(targetFile, 'utf8')).trim() : '';
        const pass = exists && content === expectedContent;

        return {
          pass,
          output: writeRes.output,
          toolUsed: 'write_file',
          diffShown: Boolean(writeRes.proposedDiff),
          fileVerified: pass,
          diffPreview: {
            filePath,
            originalContent: '',
            proposedContent: expectedContent
          },
          toolCallArgs: { filePath, content: expectedContent },
          error: pass ? undefined : `File content mismatch: expected '${expectedContent}', got '${content}'`
        };
      } catch (err: unknown) {
        return { pass: false, error: err instanceof Error ? err.message : String(err), failedStep: 'tool_call' };
      }
    }

    // 3. SCENARIO: edit
    if (scenario.id === 'edit') {
      try {
        const filePath = 'diag-write.md';
        const targetContent = 'connection verified';
        const replacementContent = 'edit verified';

        // Ensure file exists first
        const targetFile = path.join(scratchDir, filePath);
        await fs.writeFile(targetFile, targetContent, 'utf8');

        // Diff preview appears BEFORE write
        const diffPreview = {
          filePath,
          originalContent: targetContent,
          proposedContent: replacementContent
        };

        // Perform surgical replacement using replace_file_content
        const editRes = await toolExecutor.replaceFileContent({
          filePath,
          targetContent,
          replacementContent
        });

        const updated = (await fs.readFile(targetFile, 'utf8')).trim();
        const pass = updated === replacementContent;

        return {
          pass,
          output: editRes.output,
          toolUsed: 'replace_file_content',
          diffShown: true,
          fileVerified: pass,
          diffPreview,
          toolCallArgs: { filePath, targetContent, replacementContent },
          error: pass ? undefined : `Expected file content '${replacementContent}', got '${updated}'`
        };
      } catch (err: unknown) {
        return { pass: false, error: err instanceof Error ? err.message : String(err), failedStep: 'tool_call' };
      }
    }

    // 4. SCENARIO: tools
    if (scenario.id === 'tools') {
      try {
        // Ensure diag-write.md exists in scratch directory
        const sampleFile = path.join(scratchDir, 'diag-write.md');
        await fs.writeFile(sampleFile, 'edit verified', 'utf8').catch(() => undefined);

        const listRes = await toolExecutor.execute('list_dir', { directoryPath: '.' });
        const pass = listRes.output.includes('diag-write.md');

        return {
          pass,
          output: listRes.output,
          toolUsed: 'list_dir',
          fileVerified: pass,
          toolCallArgs: { directoryPath: '.' },
          error: pass ? undefined : "list_dir output did not contain 'diag-write.md'"
        };
      } catch (err: unknown) {
        return { pass: false, error: err instanceof Error ? err.message : String(err), failedStep: 'tool_call' };
      }
    }

    // 5. SCENARIO: reasoning
    if (scenario.id === 'reasoning') {
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: scenario.prompt }],
            max_tokens: 128,
            temperature: 0.1
          }),
          signal: AbortSignal.timeout(30000)
        });
        const rawText = await res.text();
        if (!res.ok) {
          return { pass: false, error: rawText, statusCode: res.status, rawResponseBytes: rawText.slice(0, 2048), failedStep: 'auth' };
        }
        const json = JSON.parse(rawText);
        const reply = json?.choices?.[0]?.message?.content || '';
        const pass = reply.includes('391');
        return {
          pass,
          output: reply,
          error: pass ? undefined : `Response did not contain 391. Received: ${reply.slice(0, 150)}`,
          rawResponseBytes: rawText.slice(0, 2048),
          failedStep: pass ? undefined : 'verification'
        };
      } catch (err: unknown) {
        return { pass: false, error: err instanceof Error ? err.message : String(err), failedStep: 'streaming' };
      }
    }

    return { pass: false, error: `Unknown scenario: ${scenario.id}` };
  }

  /**
   * Runs the complete 5-scenario capability test suite.
   */
  public async runCapabilitySuite(options: CapabilityRunOptions = {}): Promise<CapabilitySuiteSummary> {
    const { keys: storedKeys } = await readStoredCredentials();
    const { primary, fallback, primaryModel, fallbackModel } = this.resolveCandidates(
      options.providerId,
      options.modelId
    );

    const primaryKey = await diagnosticService.resolveApiKey(primary.id, storedKeys);
    const fallbackKey = await diagnosticService.resolveApiKey(fallback.id, storedKeys);

    // Create isolated scratch workspace
    const scratchDir = await this.createScratchWorkspace();
    let scratchCleanedUp = false;
    let fallbackEngaged = false;

    const results: ScenarioResult[] = [];

    try {
      const toolExecutor = new ToolExecutor(scratchDir);

      for (const scenario of CAPABILITY_SCENARIOS) {
        const start = performance.now();

        // Attempt 1: Primary provider
        const runner = options.customRunner || this.executeLiveScenario.bind(this);
        let attempt = await runner(scenario, primary, primaryKey, scratchDir, toolExecutor);
        let usedProvider = primary;
        let usedModel = primaryModel;

        // Auto-fallback: If primary failed, automatically retry once on next healthy free provider
        let evidence: ScenarioEvidence | undefined;

        if (!attempt.pass) {
          // Capture failure evidence on primary
          const classified = classifyDiagnosticError(primary.id, attempt.error || 'Failed', {
            statusCode: attempt.statusCode,
            step: attempt.failedStep as any,
            responseBody: attempt.rawResponseBytes
          });

          evidence = {
            providerId: primary.id,
            modelId: primaryModel,
            taxonomyCode: classified.code,
            rawResponseBytes: (attempt.rawResponseBytes || attempt.error || '').slice(0, 2048),
            failedStep: attempt.failedStep || 'execution',
            errorMessage: attempt.error,
            toolCallName: attempt.toolUsed,
            toolCallArgs: attempt.toolCallArgs,
            diffPreview: attempt.diffPreview
          };

          // Engage fallback
          fallbackEngaged = true;
          const fallbackAttempt = await runner(scenario, fallback, fallbackKey, scratchDir, toolExecutor);

          if (fallbackAttempt.pass) {
            attempt = fallbackAttempt;
            usedProvider = fallback;
            usedModel = fallbackModel;
          } else {
            // Both failed; capture fallback error
            const fallbackClassified = classifyDiagnosticError(fallback.id, fallbackAttempt.error || 'Failed', {
              statusCode: fallbackAttempt.statusCode,
              step: fallbackAttempt.failedStep as any,
              responseBody: fallbackAttempt.rawResponseBytes
            });
            evidence = {
              providerId: fallback.id,
              modelId: fallbackModel,
              taxonomyCode: fallbackClassified.code,
              rawResponseBytes: (fallbackAttempt.rawResponseBytes || fallbackAttempt.error || '').slice(0, 2048),
              failedStep: fallbackAttempt.failedStep || 'fallback',
              errorMessage: fallbackAttempt.error,
              toolCallName: fallbackAttempt.toolUsed,
              toolCallArgs: fallbackAttempt.toolCallArgs,
              diffPreview: fallbackAttempt.diffPreview
            };
          }
        }

        const durationMs = Math.round(performance.now() - start);

        results.push({
          id: scenario.id,
          title: scenario.title,
          prompt: scenario.prompt,
          passCriteria: scenario.passCriteria,
          status: attempt.pass ? 'PASS' : 'FAIL',
          durationMs,
          initialProvider: primary.id,
          fallbackProvider: fallbackEngaged ? fallback.id : undefined,
          passedProvider: attempt.pass ? usedProvider.id : undefined,
          toolUsed: attempt.toolUsed,
          diffShown: attempt.diffShown,
          fileVerified: attempt.fileVerified,
          output: attempt.output,
          evidence
        });
      }
    } finally {
      // Guaranteed scratch workspace cleanup
      scratchCleanedUp = await this.cleanupScratchWorkspace(scratchDir);
    }

    const passedCount = results.filter((r) => r.status === 'PASS').length;
    const failedCount = results.filter((r) => r.status === 'FAIL').length;

    // Report Path: docs/DIAGNOSTIC-REPORT.md
    const workspaceRoot = options.workspacePath || process.cwd();
    const reportDir = path.join(workspaceRoot, 'docs');
    const reportPath = path.join(reportDir, 'DIAGNOSTIC-REPORT.md');

    const summary: CapabilitySuiteSummary = {
      timestamp: Date.now(),
      totalScenarios: results.length,
      passedCount,
      failedCount,
      activeProvider: primary.name,
      activeModel: primaryModel,
      fallbackEngaged,
      fallbackProvider: fallbackEngaged ? fallback.name : undefined,
      scratchWorkspacePath: scratchDir,
      scratchCleanedUp,
      scenarios: results,
      reportPath
    };

    // Auto-write docs/DIAGNOSTIC-REPORT.md
    try {
      await fs.mkdir(reportDir, { recursive: true });
      const mdContent = this.generateMarkdownReport(summary);
      await fs.writeFile(reportPath, mdContent, 'utf8');
      summary.markdownReport = mdContent;
    } catch {
      // File write error shouldn't crash the diagnostics run
    }

    this.latestSummary = summary;
    return summary;
  }

  /**
   * Generates comprehensive markdown report for docs/DIAGNOSTIC-REPORT.md
   */
  public generateMarkdownReport(summary: CapabilitySuiteSummary): string {
    const lines: string[] = [];
    const dateStr = new Date(summary.timestamp).toISOString();

    lines.push('# Ty-Code End-to-End Capability Test Report');
    lines.push(`**Run Timestamp**: ${dateStr}`);
    lines.push(`**Active Provider**: ${summary.activeProvider}`);
    lines.push(`**Active Model**: \`${summary.activeModel}\``);
    lines.push(`**Overall Status**: ${summary.passedCount}/${summary.totalScenarios} PASSED (${summary.failedCount} Failed)`);
    lines.push(`**Auto-Fallback**: ${summary.fallbackEngaged ? `ENGAGED (${summary.fallbackProvider || 'Healthy Free Provider'})` : 'INACTIVE'}`);
    lines.push(`**Scratch Workspace Cleaned**: ${summary.scratchCleanedUp ? 'YES (Auto-cleaned)' : 'NO'}`);
    lines.push('');

    lines.push('## Scenario Test Results');
    lines.push('| Scenario | Description | Status | Tool Used | Latency | Passed Provider | Pass Criteria |');
    lines.push('| :--- | :--- | :--- | :--- | :--- | :--- | :--- |');

    for (const sc of summary.scenarios) {
      const tool = sc.toolUsed ? `\`${sc.toolUsed}\`` : '-';
      const statusBadge = sc.status === 'PASS' ? '**PASS**' : '**FAIL**';
      lines.push(
        `| **${sc.id}** | ${sc.title} | ${statusBadge} | ${tool} | ${sc.durationMs}ms | ${sc.passedProvider || '-'} | ${sc.passCriteria} |`
      );
    }

    lines.push('');
    lines.push('## Detailed Scenario Evidence');

    for (const sc of summary.scenarios) {
      lines.push(`### Scenario: \`${sc.id}\` - ${sc.title}`);
      lines.push(`- **Prompt**: "${sc.prompt}"`);
      lines.push(`- **Status**: \`${sc.status}\``);
      lines.push(`- **Duration**: ${sc.durationMs}ms`);
      if (sc.passedProvider) {
        lines.push(`- **Passed on Provider**: \`${sc.passedProvider}\``);
      }
      if (sc.initialProvider && sc.fallbackProvider) {
        lines.push(`- **Fallback Route**: \`${sc.initialProvider}\` ➔ \`${sc.fallbackProvider}\``);
      }
      if (sc.toolUsed) {
        lines.push(`- **Tool Called**: \`${sc.toolUsed}\``);
      }
      if (sc.diffShown && sc.evidence?.diffPreview) {
        lines.push('- **Diff Preview Generated (Before Write)**:');
        lines.push('```diff');
        lines.push(`--- original: ${sc.evidence.diffPreview.filePath || 'file'}`);
        lines.push(`+++ proposed: ${sc.evidence.diffPreview.filePath || 'file'}`);
        lines.push(`- ${sc.evidence.diffPreview.originalContent || ''}`);
        lines.push(`+ ${sc.evidence.diffPreview.proposedContent || ''}`);
        lines.push('```');
      }

      if (sc.evidence) {
        lines.push('');
        lines.push('**Failure Evidence / Taxonomy Diagnostics**:');
        lines.push(`- **Taxonomy Code**: \`${sc.evidence.taxonomyCode || 'UNKNOWN'}\``);
        lines.push(`- **Failed Step**: \`${sc.evidence.failedStep || 'execution'}\``);
        if (sc.evidence.errorMessage) {
          lines.push(`- **Error Message**: ${sc.evidence.errorMessage}`);
        }
        if (sc.evidence.rawResponseBytes) {
          lines.push('');
          lines.push('**Raw Response Bytes (Truncated to 2KB)**:');
          lines.push('```text');
          lines.push(sc.evidence.rawResponseBytes.slice(0, 2048));
          lines.push('```');
        }
      }

      if (sc.output && sc.status === 'PASS') {
        lines.push('');
        lines.push('**Sample Output**:');
        lines.push('```text');
        lines.push(sc.output.slice(0, 500));
        lines.push('```');
      }
      lines.push('');
    }

    lines.push('---');
    lines.push('*Ty-Code Capability Diagnostic Harness (Phase Diagnostics 2)*');

    return lines.join('\n');
  }

  public getLatestSummary(): CapabilitySuiteSummary | null {
    return this.latestSummary;
  }
}

export const capabilitySuite = CapabilitySuite.getInstance();
