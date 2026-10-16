/**
 * Extension Security Scanner (ExtensionsFix 5)
 *
 * Scans extension JavaScript and TypeScript code for dangerous runtime patterns:
 *   1. Direct eval() calls
 *   2. Function constructor usage (new Function / Function())
 *   3. Dynamic imports from untrusted remote URLs (import('https://...'))
 *   4. Direct Node process escape attempts (process.mainModule, process.binding)
 *
 * Policy: Warn but do not block (informs the user and logs security advisories).
 *
 * Brand: Ty-Code
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

export interface SecurityFinding {
  file: string;
  line: number;
  column?: number;
  pattern: string;
  severity: 'warning' | 'info';
  description: string;
  snippet: string;
}

export interface SecurityScanReport {
  extensionId: string;
  timestamp: string;
  durationMs: number;
  filesScanned: number;
  hasWarnings: boolean;
  findings: SecurityFinding[];
  summary: {
    evalCount: number;
    functionConstructorCount: number;
    remoteImportCount: number;
    processEscapeCount: number;
  };
}

export interface SecurityPatternRule {
  id: string;
  name: string;
  description: string;
  severity: 'warning' | 'info';
  regex: RegExp;
}

export const DANGEROUS_SECURITY_PATTERNS: SecurityPatternRule[] = [
  {
    id: 'eval-call',
    name: 'Dynamic Code Evaluation (eval)',
    description: 'Direct use of eval() allows arbitrary code execution and bypasses static verification.',
    severity: 'warning',
    regex: /\beval\s*\(/
  },
  {
    id: 'function-constructor',
    name: 'Function Constructor Code Generation',
    description: 'Invoking the Function constructor generates code from string inputs at runtime.',
    severity: 'warning',
    regex: /\b(?:new\s+Function|Function\s*\()/
  },
  {
    id: 'untrusted-remote-import',
    name: 'Remote URL Dynamic Import',
    description: 'Dynamic import from remote HTTP/HTTPS endpoints executes unvetted external code.',
    severity: 'warning',
    regex: /\bimport\s*\(\s*['"`]https?:\/\//i
  },
  {
    id: 'process-escape-binding',
    name: 'Low-Level Process Escape',
    description: 'Access to internal Node.js process bindings or unmediated modules.',
    severity: 'warning',
    regex: /\bprocess\.(?:binding|_linkedBinding|mainModule)\b/
  }
];

export class ExtensionSecurityScanner {
  /**
   * Scans a single string of source code for security findings.
   */
  scanSourceCode(source: string, fileName = 'code.js'): SecurityFinding[] {
    const findings: SecurityFinding[] = [];
    const lines = source.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const lineText = lines[i];
      const trimmed = lineText.trim();

      // Skip comment-only lines
      if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) {
        continue;
      }

      for (const rule of DANGEROUS_SECURITY_PATTERNS) {
        if (rule.regex.test(lineText)) {
          findings.push({
            file: fileName,
            line: i + 1,
            pattern: rule.name,
            severity: rule.severity,
            description: rule.description,
            snippet: trimmed.slice(0, 120)
          });
        }
      }
    }

    return findings;
  }

  /**
   * Recursively scans an extension install directory on disk.
   */
  async scanExtensionDirectory(extensionId: string, directoryPath: string): Promise<SecurityScanReport> {
    const start = Date.now();
    const findings: SecurityFinding[] = [];
    let filesScanned = 0;

    const walk = async (dir: string, depth = 0) => {
      if (depth > 6) return;
      try {
        const entries = await fs.readdir(dir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.name === 'node_modules' || entry.name === '.git') continue;

          const fullPath = path.join(dir, entry.name);
          if (entry.isDirectory()) {
            await walk(fullPath, depth + 1);
          } else if (entry.isFile() && (entry.name.endsWith('.js') || entry.name.endsWith('.mjs') || entry.name.endsWith('.cjs') || entry.name.endsWith('.ts'))) {
            filesScanned++;
            try {
              const stat = await fs.stat(fullPath);
              // Only scan files under 2MB to keep scanning fast
              if (stat.size <= 2 * 1024 * 1024) {
                const content = await fs.readFile(fullPath, 'utf8');
                const relFile = path.relative(directoryPath, fullPath).replace(/\\/g, '/');
                const fileFindings = this.scanSourceCode(content, relFile);
                findings.push(...fileFindings);
              }
            } catch {
              // Ignore unreadable files
            }
          }
        }
      } catch {
        // Ignore unreadable directories
      }
    };

    if (fsSync.existsSync(directoryPath)) {
      await walk(directoryPath);
    }

    const evalCount = findings.filter((f) => f.pattern.includes('eval')).length;
    const functionConstructorCount = findings.filter((f) => f.pattern.includes('Function Constructor')).length;
    const remoteImportCount = findings.filter((f) => f.pattern.includes('Remote URL')).length;
    const processEscapeCount = findings.filter((f) => f.pattern.includes('Process Escape')).length;

    const report: SecurityScanReport = {
      extensionId,
      timestamp: new Date().toISOString(),
      durationMs: Date.now() - start,
      filesScanned,
      hasWarnings: findings.length > 0,
      findings,
      summary: {
        evalCount,
        functionConstructorCount,
        remoteImportCount,
        processEscapeCount
      }
    };

    if (report.hasWarnings) {
      console.warn(`[ExtensionSecurityScanner] Found ${findings.length} security warnings in "${extensionId}":`);
      for (const finding of findings.slice(0, 5)) {
        console.warn(`  - [${finding.severity.toUpperCase()}] ${finding.pattern} in ${finding.file}:${finding.line}: "${finding.snippet}"`);
      }
    }

    return report;
  }
}

export const extensionSecurityScanner = new ExtensionSecurityScanner();
