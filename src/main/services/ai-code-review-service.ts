import fs from 'fs/promises';
import path from 'path';
import { randomUUID } from 'crypto';
import type {
  CodeReviewFinding,
  CodeReviewRequest,
  CodeReviewResult,
  CodeReviewRule
} from '../../preload/types';

export const DEFAULT_REVIEW_RULES: CodeReviewRule[] = [
  {
    id: 'rule-null-dereference',
    name: 'Null/Undefined Dereference Guard',
    category: 'bug',
    severity: 'error',
    description: 'Flag direct property accesses on optional objects without optional chaining or truthiness checks.',
    pattern: '\\b[A-Za-z0-9_]+\\.[A-Za-z0-9_]+\\.[A-Za-z0-9_]+',
    enabled: true
  },
  {
    id: 'rule-unhandled-promise',
    name: 'Missing Await or Unhandled Promise',
    category: 'bug',
    severity: 'error',
    description: 'Ensure promises are awaited or have .catch() handlers attached.',
    pattern: '\\b(?:fetch|fs\\.readFile|fs\\.writeFile|axios|new Promise)\\([^)]*\\)(?!\\s*\\.then|\\s*\\.catch)',
    enabled: true
  },
  {
    id: 'rule-strict-equality',
    name: 'Coercive Equality (== / !=)',
    category: 'style',
    severity: 'warning',
    description: 'Use strict equality (=== and !==) instead of loose equality (== and !=) to prevent type coercion bugs.',
    pattern: '[^!=<>]\\s*(?:==|!=)\\s*[^=]',
    enabled: true
  },
  {
    id: 'rule-security-eval',
    name: 'Unsafe Dynamic Execution (eval / new Function)',
    category: 'security',
    severity: 'error',
    description: 'eval() and Function constructor allow arbitrary code execution vulnerabilities.',
    pattern: '\\b(?:eval|new\\s+Function)\\s*\\(',
    enabled: true
  },
  {
    id: 'rule-security-innerhtml',
    name: 'Unsafe HTML Injection (innerHTML / dangerouslySetInnerHTML)',
    category: 'security',
    severity: 'error',
    description: 'Setting raw HTML directly leads to Cross-Site Scripting (XSS) attacks.',
    pattern: '\\.innerHTML\\s*=|dangerouslySetInnerHTML',
    enabled: true
  },
  {
    id: 'rule-resource-leak',
    name: 'Potential Timer or Listener Leak',
    category: 'performance',
    severity: 'warning',
    description: 'Ensure setInterval or addEventListener in components has matching clearInterval or removeEventListener.',
    pattern: '\\bsetInterval\\s*\\(',
    enabled: true
  },
  {
    id: 'rule-sql-injection',
    name: 'SQL String Concatenation Vulnerability',
    category: 'security',
    severity: 'error',
    description: 'Detect dynamic string concatenation inside SQL statements.',
    pattern: 'SELECT\\s+.*\\s+FROM\\s+.*\\+\\s*[A-Za-z0-9_]+',
    enabled: true
  }
];

export class AiCodeReviewService {
  private workspacePath: string;
  private rules: CodeReviewRule[] = [...DEFAULT_REVIEW_RULES];
  private reviewHistory: CodeReviewResult[] = [];

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  setWorkspace(workspacePath: string): void {
    this.workspacePath = workspacePath;
    this.rules = [...DEFAULT_REVIEW_RULES];
  }

  async loadRules(): Promise<CodeReviewRule[]> {
    try {
      const rulesPath = path.join(this.workspacePath, '.ty-code', 'review-rules.json');
      const raw = await fs.readFile(rulesPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.rules = parsed;
      }
    } catch {
      // Use defaults
    }
    return [...this.rules];
  }

  async saveRules(rules: CodeReviewRule[]): Promise<void> {
    this.rules = rules;
    try {
      const rulesPath = path.join(this.workspacePath, '.ty-code', 'review-rules.json');
      await fs.mkdir(path.dirname(rulesPath), { recursive: true });
      await fs.writeFile(rulesPath, JSON.stringify(rules, null, 2), 'utf8');
    } catch {
      // Gracefully ignore
    }
  }

  getReviewHistory(): CodeReviewResult[] {
    return this.reviewHistory;
  }

  async reviewCode(request: CodeReviewRequest): Promise<CodeReviewResult> {
    return this.review(request);
  }

  async getRules(): Promise<CodeReviewRule[]> {
    return this.loadRules();
  }

  async saveCustomRule(rule: CodeReviewRule): Promise<void> {
    await this.loadRules();
    const idx = this.rules.findIndex((r) => r.id === rule.id);
    if (idx >= 0) {
      this.rules[idx] = rule;
    } else {
      this.rules.push(rule);
    }
    await this.saveRules(this.rules);
  }

  async review(request: CodeReviewRequest): Promise<CodeReviewResult> {
    await this.loadRules();
    const activeRules = (request.customRules && request.customRules.length > 0 ? request.customRules : this.rules).filter((r) => r.enabled);
    const findings: CodeReviewFinding[] = [];
    const reviewedFiles: string[] = [];

    if (request.filePath && request.content !== undefined) {
      reviewedFiles.push(request.filePath);
      const fileFindings = this.analyzeContent(request.filePath, request.content, activeRules);
      findings.push(...fileFindings);
    } else if (request.filePath) {
      reviewedFiles.push(request.filePath);
      try {
        const fullPath = path.isAbsolute(request.filePath) ? request.filePath : path.join(this.workspacePath, request.filePath);
        const content = await fs.readFile(fullPath, 'utf8');
        findings.push(...this.analyzeContent(request.filePath, content, activeRules));
      } catch {
        // File reading failed
      }
    }

    const summary = {
      total: findings.length,
      bugs: findings.filter((f) => f.category === 'bug').length,
      security: findings.filter((f) => f.category === 'security').length,
      performance: findings.filter((f) => f.category === 'performance').length,
      style: findings.filter((f) => f.category === 'style').length
    };

    const result: CodeReviewResult = {
      findings,
      summary,
      reviewedFiles,
      timestamp: Date.now()
    };

    this.reviewHistory.unshift(result);
    if (this.reviewHistory.length > 50) {
      this.reviewHistory = this.reviewHistory.slice(0, 50);
    }

    return result;
  }

  private analyzeContent(filePath: string, content: string, rules: CodeReviewRule[]): CodeReviewFinding[] {
    const findings: CodeReviewFinding[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) continue;

      // Rule 1: Loose Equality
      if (rules.some((r) => r.id === 'rule-strict-equality') && /([^!=<>]|^)\s*(==|!=)\s*([^=]|$)/.test(line) && !line.includes('typeof')) {
        const fixedLine = line.replace(/([^!=<>]|^)\s*==\s*([^=]|$)/g, '$1 === $3').replace(/([^!=<>]|^)\s*!=\s*([^=]|$)/g, '$1 !== $3');
        findings.push({
          id: `cr_${randomUUID().slice(0, 8)}`,
          ruleId: 'rule-strict-equality',
          filePath,
          line: lineNum,
          category: 'style',
          severity: 'warning',
          title: 'Coercive loose equality operator',
          description: 'Use strict equality `===` or `!==` to prevent unintended JavaScript type coercion quirks.',
          codeSnippet: trimmed,
          suggestedFix: {
            originalText: line,
            replacementText: fixedLine
          }
        });
      }

      // Rule 2: Unsafe eval()
      if (rules.some((r) => r.id === 'rule-security-eval') && /\beval\s*\(/.test(line)) {
        findings.push({
          id: `cr_${randomUUID().slice(0, 8)}`,
          ruleId: 'rule-security-eval',
          filePath,
          line: lineNum,
          category: 'security',
          severity: 'error',
          title: 'Dangerous use of `eval()`',
          description: 'Executing arbitrary code with `eval()` exposes the application to severe remote code execution vulnerabilities.',
          codeSnippet: trimmed
        });
      }

      // Rule 3: innerHTML XSS
      if (rules.some((r) => r.id === 'rule-security-innerhtml') && (/\.innerHTML\s*=/.test(line) || /dangerouslySetInnerHTML/.test(line))) {
        findings.push({
          id: `cr_${randomUUID().slice(0, 8)}`,
          ruleId: 'rule-security-innerhtml',
          filePath,
          line: lineNum,
          category: 'security',
          severity: 'error',
          title: 'Unsanitized HTML injection (XSS risk)',
          description: 'Directly assigning unescaped strings to `innerHTML` or `dangerouslySetInnerHTML` allows Cross-Site Scripting.',
          codeSnippet: trimmed,
          suggestedFix: {
            originalText: line,
            replacementText: line.replace('.innerHTML', '.textContent')
          }
        });
      }

      // Rule 4: SQL string concatenation
      if (rules.some((r) => r.id === 'rule-sql-injection') && /(?:SELECT|INSERT|UPDATE|DELETE)\s+.*(?:\+|`.*\$\{)/i.test(line)) {
        findings.push({
          id: `cr_${randomUUID().slice(0, 8)}`,
          ruleId: 'rule-sql-injection',
          filePath,
          line: lineNum,
          category: 'security',
          severity: 'error',
          title: 'Potential SQL Injection Vulnerability',
          description: 'Query constructed via string concatenation or template literal. Use parameterized queries or prepared statements.',
          codeSnippet: trimmed
        });
      }

      // Rule 5: Unhandled async Promise without await or catch
      if (rules.some((r) => r.id === 'rule-unhandled-promise')) {
        if (/\b(?:fetch|fs\.readFile|fs\.writeFile)\s*\(/.test(line) && !line.includes('await') && !line.includes('.then') && !line.includes('.catch') && !line.includes('return')) {
          findings.push({
            id: `cr_${randomUUID().slice(0, 8)}`,
            ruleId: 'rule-unhandled-promise',
            filePath,
            line: lineNum,
            category: 'bug',
            severity: 'error',
            title: 'Floating unhandled Promise',
            description: 'Asynchronous call is neither awaited nor has rejection handlers attached. Rejection will be unhandled.',
            codeSnippet: trimmed,
            suggestedFix: {
              originalText: line,
              replacementText: line.replace(/(\b(?:fetch|fs\.readFile|fs\.writeFile)\s*\()/, 'await $1')
            }
          });
        }
      }

      // Rule 6: Null / Undefined dereference (e.g. data.user.id without ?.)
      if (rules.some((r) => r.id === 'rule-null-dereference')) {
        const derefMatch = line.match(/\b([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\.([A-Za-z0-9_$]+)\b/);
        if (derefMatch && !line.includes('?.') && !line.includes('&&') && !line.includes('if') && !line.includes('import') && !line.includes('export') && !line.includes('from')) {
          const originalChain = `${derefMatch[1]}.${derefMatch[2]}.${derefMatch[3]}`;
          const safeChain = `${derefMatch[1]}?.${derefMatch[2]}?.${derefMatch[3]}`;
          findings.push({
            id: `cr_${randomUUID().slice(0, 8)}`,
            ruleId: 'rule-null-dereference',
            filePath,
            line: lineNum,
            category: 'bug',
            severity: 'error',
            title: 'Unchecked deep property dereference',
            description: `Accessing \`${originalChain}\` without optional chaining or null checking risks runtime TypeError if intermediate values are undefined.`,
            codeSnippet: trimmed,
            suggestedFix: {
              originalText: originalChain,
              replacementText: safeChain
            }
          });
        }
      }

      // Rule 7: Resource leak / setInterval
      if (rules.some((r) => r.id === 'rule-resource-leak') && /\bsetInterval\s*\(/.test(line) && !content.includes('clearInterval')) {
        findings.push({
          id: `cr_${randomUUID().slice(0, 8)}`,
          ruleId: 'rule-resource-leak',
          filePath,
          line: lineNum,
          category: 'performance',
          severity: 'warning',
          title: 'Unbounded interval timer (memory leak risk)',
          description: 'A `setInterval` is created without any corresponding `clearInterval` call in this file.',
          codeSnippet: trimmed
        });
      }

      // Custom Rules evaluation
      for (const customRule of rules) {
        if (!DEFAULT_REVIEW_RULES.some((r) => r.id === customRule.id) && customRule.enabled) {
          try {
            if (!customRule.pattern) continue;
            const re = new RegExp(customRule.pattern);
            if (re.test(line)) {
              findings.push({
                id: `cr_${randomUUID().slice(0, 8)}`,
                ruleId: customRule.id,
                filePath,
                line: lineNum,
                category: customRule.category,
                severity: customRule.severity,
                title: customRule.name,
                description: customRule.description,
                codeSnippet: trimmed,
                suggestedFix: customRule.fixTemplate
                  ? {
                      originalText: line,
                      replacementText: line.replace(re, customRule.fixTemplate)
                    }
                  : undefined
              });
            }
          } catch {
            // ignore regex pattern parsing issues
          }
        }
      }
    }

    return findings;
  }
}
