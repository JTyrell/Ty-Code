import path from 'node:path';
import type { OpenCodeTool, ToolContext, ToolExecutionResult } from './types';
import { LspManager } from '../../lsp-manager';
import { resolveSafePath } from './view';

interface StoredDiagnostic {
  uri: string;
  filePath: string;
  range: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  severity: number; // 1 = Error, 2 = Warning, 3 = Information, 4 = Hint
  message: string;
  source?: string;
  code?: string | number;
}

// In-memory diagnostics cache updated by LSP publishDiagnostics bridge
const diagnosticsCache = new Map<string, StoredDiagnostic[]>();

export function recordLspDiagnostics(uri: string, filePath: string, diagnostics: any[]): void {
  const norm = filePath.replace(/\\/g, '/').toLowerCase();
  const converted: StoredDiagnostic[] = (diagnostics || []).map((d) => ({
    uri,
    filePath,
    range: d.range || { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
    severity: d.severity || 1,
    message: d.message || 'Diagnostic error',
    source: d.source,
    code: d.code
  }));
  diagnosticsCache.set(norm, converted);
}

export function clearDiagnosticsCache(): void {
  diagnosticsCache.clear();
}

export const diagnosticsTool: OpenCodeTool = {
  name: 'diagnostics',
  description: 'Get LSP diagnostics (errors, warnings, lints) for a specific file or the entire workspace.',
  definition: {
    type: 'function',
    function: {
      name: 'diagnostics',
      description: 'Get LSP diagnostics (errors, warnings, lints) for a specific file or the entire workspace.',
      parameters: {
        type: 'object',
        properties: {
          filePath: {
            type: 'string',
            description: 'Optional file path to filter diagnostics for. If omitted, returns diagnostics across workspace.'
          },
          severity: {
            type: 'string',
            enum: ['error', 'warning', 'all'],
            description: 'Filter by diagnostic severity level (default: "all").'
          }
        }
      }
    }
  },
  async execute(args: Record<string, unknown>, context: ToolContext): Promise<ToolExecutionResult> {
    try {
      const filterPath = args.filePath ? String(args.filePath) : '';
      const filterSeverity = String(args.severity || 'all').toLowerCase();

      let targetAbsolute = '';
      if (filterPath) {
        targetAbsolute = resolveSafePath(context.workspaceRoot, filterPath).replace(/\\/g, '/').toLowerCase();
      }

      let allEntries: StoredDiagnostic[] = [];
      if (targetAbsolute) {
        allEntries = diagnosticsCache.get(targetAbsolute) || [];
      } else {
        for (const list of diagnosticsCache.values()) {
          allEntries.push(...list);
        }
      }

      if (filterSeverity === 'error') {
        allEntries = allEntries.filter((d) => d.severity === 1);
      } else if (filterSeverity === 'warning') {
        allEntries = allEntries.filter((d) => d.severity === 2);
      }

      if (allEntries.length === 0) {
        const scope = filterPath ? `for "${filterPath}"` : 'across workspace';
        return {
          output: `No diagnostics found ${scope} (0 errors, 0 warnings). All checks passing.`,
          metadata: { count: 0 }
        };
      }

      const formatted = allEntries
        .map((d) => {
          const sevLabel = d.severity === 1 ? 'ERROR' : d.severity === 2 ? 'WARNING' : 'INFO';
          const rel = path.relative(context.workspaceRoot, d.filePath).replace(/\\/g, '/');
          const line = (d.range?.start?.line ?? 0) + 1;
          const col = (d.range?.start?.character ?? 0) + 1;
          return `[${sevLabel}] ${rel}:${line}:${col} - ${d.message}${d.code ? ` (${d.code})` : ''}`;
        })
        .join('\n');

      return {
        output: `Found ${allEntries.length} diagnostic(s):\n\n${formatted}`,
        metadata: { count: allEntries.length }
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return { output: `Error getting diagnostics: ${message}`, isError: true };
    }
  }
};
