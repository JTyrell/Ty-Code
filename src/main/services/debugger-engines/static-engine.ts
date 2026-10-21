import * as ts from 'typescript';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisResult, AnalysisSeverity } from '../../windows/debugger-window';

interface RawFinding {
  ruleId: string;
  severity: AnalysisSeverity;
  message: string;
  line: number;
  column: number;
  snippet?: string;
  recommendation?: string;
}

interface AnalysisContext {
  sourceFile: ts.SourceFile;
  content: string;
  fileName: string;
  push: (finding: RawFinding) => void;
}

const MAX_SNIPPET_LENGTH = 160;
const UNUSED_RULE_LIMIT = 80;
const SECRET_MASK = '[REDACTED]';

const NULLABLE_SYSTEM_CALLS = new Set(['getElementById', 'querySelector', 'closest']);

const SQL_KEYWORD_PATTERN = /\b(?:select|insert(?:\s+into)?|update(?:\s+set)?|delete(?:\s+from)?|merge(?:\s+into)?|truncate(?:\s+table)?|alter\s+table|drop\s+table)\b/i;

const SECRET_RULES: Array<{ ruleId: string; severity: AnalysisSeverity; messagePrefix: string; pattern: RegExp }> = [
  { ruleId: 'secret-aws-access-key', severity: 'critical', messagePrefix: 'AWS access key literal', pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { ruleId: 'secret-github-token', severity: 'critical', messagePrefix: 'GitHub token literal', pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { ruleId: 'secret-openai-key', severity: 'critical', messagePrefix: 'OpenAI API key literal', pattern: /\bsk-[A-Za-z0-9_-]{20,}\b/ },
  { ruleId: 'secret-slack-token', severity: 'critical', messagePrefix: 'Slack token literal', pattern: /\bxox[aepburs]-[A-Za-z0-9-]{10,}\b/ },
  { ruleId: 'secret-private-key', severity: 'critical', messagePrefix: 'Embedded private key', pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { ruleId: 'secret-credential-assignment', severity: 'high', messagePrefix: 'Hardcoded credential assignment', pattern: /\b(?:api[\-_]?key|api[\-_]?secret|secret|access[\-_]?token|auth[\-_]?token|password|passwd|pwd)\b\s*[:=]\s*["'][^"']{8,}["']/i },
  { ruleId: 'secret-bearer-token', severity: 'high', messagePrefix: 'Hardcoded bearer token', pattern: /\bauthorization\b\s*[:=]\s*["']?bearer\s+[A-Za-z0-9_\-.=]{8,}/i },
  { ruleId: 'secret-jwt', severity: 'medium', messagePrefix: 'Embedded JSON web token', pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\b/ }
];

const TERMINAL_STATEMENT_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.ReturnStatement,
  ts.SyntaxKind.ThrowStatement,
  ts.SyntaxKind.BreakStatement,
  ts.SyntaxKind.ContinueStatement
]);

const FUNCTION_LIKE_KINDS = new Set<ts.SyntaxKind>([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.Constructor,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor
]);

function positionOf(sourceFile: ts.SourceFile, position: number): { line: number; column: number } {
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(position);
  return { line: line + 1, column: character + 1 };
}

function snippetForLine(content: string, line: number): string {
  const lines = content.split('\n');
  const raw = lines[Math.min(Math.max(line - 1, 0), lines.length - 1)] ?? '';
  const trimmed = raw.trim();
  return trimmed.length > MAX_SNIPPET_LENGTH ? `${trimmed.slice(0, MAX_SNIPPET_LENGTH - 1)}…` : trimmed;
}

function maskSecretValues(rawLine: string): string {
  let masked = rawLine;
  for (const rule of SECRET_RULES) {
    masked = masked.replace(new RegExp(rule.pattern.source, rule.pattern.flags.includes('g') ? rule.pattern.flags : `${rule.pattern.flags}g`), SECRET_MASK);
  }
  return masked;
}

export async function runStaticAnalysis(filePath: string): Promise<AnalysisResult[]> {
  const absolute = path.resolve(filePath);
  const content = await fsp.readFile(absolute, 'utf8');
  const sourceFile = createSourceFile(absolute, content);
  const context: AnalysisContext = {
    sourceFile,
    content,
    fileName: absolute,
    push: (finding) => findings.push(finding)
  };
  const findings: RawFinding[] = [];

  analyzeUnusedDeclarations(context);
  analyzeUnreachableCode(context);
  analyzeUnsafeAwait(context);
  analyzeFloatingPromises(context);
  analyzeNullDereference(context);
  analyzeSecrets(context);
  analyzeSqlInjection(context);

  return findings.map((finding, index) => ({
    id: `static:${finding.ruleId}:${finding.line}:${index}`,
    severity: finding.severity,
    engine: 'static' as const,
    role: 'dev' as const,
    message: finding.message,
    line: finding.line,
    codeSnippet: finding.snippet,
    filePath: absolute,
    ruleId: finding.ruleId,
    suggestedFix: finding.recommendation,
    timestamp: Date.now()
  }));
}

function createSourceFile(fileName: string, content: string): ts.SourceFile {
  const lower = fileName.toLowerCase();
  const scriptKind = lower.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : lower.endsWith('.ts')
      ? ts.ScriptKind.TS
      : lower.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : ts.ScriptKind.JS;
  return ts.createSourceFile(fileName, content, ts.ScriptTarget.Latest, true, scriptKind);
}

function walk(node: ts.Node, visitor: (node: ts.Node) => void): void {
  visitor(node);
  node.forEachChild((child) => walk(child, visitor));
}

function walkSourceFile(sourceFile: ts.SourceFile, visitor: (node: ts.Node) => void): void {
  sourceFile.forEachChild((child) => walk(child, visitor));
}

function modifiersOf(node: ts.Node): readonly ts.Modifier[] {
  if (!ts.canHaveModifiers(node)) return [];
  return ts.getModifiers(node) ?? [];
}

function isDeclarationOwnerIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  return false;
}

function isPropertyOnlyIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isPropertyAccessExpression(parent) && parent.name === node) return true;
  if ((ts.isPropertyDeclaration(parent) || ts.isMethodDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isPropertyAssignment(parent)) && parent.name === node) return true;
  if (ts.isFunctionDeclaration(parent) && parent.name === node) return true;
  if (ts.isClassDeclaration(parent) && parent.name === node) return true;
  if (ts.isVariableDeclaration(parent) && parent.name === node) return true;
  if (ts.isParameter(parent) && parent.name === node) return true;
  if (ts.isBindingElement(parent) && parent.name === node) return true;
  if (ts.isEnumMember(parent) && parent.name === node) return true;
  if (ts.isCatchClause(parent) && parent.variableDeclaration?.name === node) return true;
  return false;
}

function isExportedDeclaration(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) return false;
  if (ts.isVariableDeclaration(parent) && parent.parent && ts.isVariableDeclarationList(parent.parent)) {
    const statement = parent.parent.parent;
    if (ts.isVariableStatement(statement) && !!ts.getModifiers(statement)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) return true;
  }
  return modifiersOf(parent).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function hasExportKeyword(node: ts.Node): boolean {
  return modifiersOf(node).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

function analyzeUnusedDeclarations(context: AnalysisContext): void {
  const { sourceFile, content, push } = context;
  if (/\.d\.ts$/i.test(sourceFile.fileName)) return;

  const usedNames = new Set<string>();
  walkSourceFile(sourceFile, (node) => {
    if (!ts.isIdentifier(node)) return;
    if (isDeclarationOwnerIdentifier(node)) return;
    if (isPropertyOnlyIdentifier(node)) return;
    usedNames.add(node.text);
  });

  const reported = new Set<string>();
  let reportCount = 0;

  walkSourceFile(sourceFile, (node) => {
    if (reportCount >= UNUSED_RULE_LIMIT) return;
    if (!ts.isIdentifier(node)) return;
    if (!isDeclarationOwnerIdentifier(node)) return;

    const name = node.text;
    if (!name || name === 'default' || name.startsWith('_')) return;
    if (usedNames.has(name)) return;
    // The export keyword lives on the declaration (function/class/variable
    // statement), not on the identifier itself — check both.
    if (hasExportKeyword(node) || hasExportKeyword(node.parent)) return;

    const position = positionOf(sourceFile, node.getStart(sourceFile));
    const declaration = node.parent;

    if (ts.isVariableDeclaration(declaration)) {
      if (declaration.parent && ts.isForOfStatement(declaration.parent.parent) ) return;
      if (declaration.parent && ts.isForInStatement(declaration.parent.parent)) return;
      const key = `var:${name}:${position.line}`;
      if (reported.has(key)) return;
      reported.add(key);
      reportCount += 1;
      push({
        ruleId: 'no-unused-variable',
        severity: 'low',
        message: `Variable "${name}" is declared but never read in ${path.basename(sourceFile.fileName)}.`,
        line: position.line,
        column: position.column,
        snippet: snippetForLine(content, position.line),
        recommendation: 'Remove the dead declaration or prefix the identifier with an underscore if it is intentionally unused.'
      });
      return;
    }
    if (ts.isParameter(declaration)) {
      const key = `param:${name}:${position.line}`;
      if (reported.has(key)) return;
      reported.add(key);
      reportCount += 1;
      push({
        ruleId: 'no-unused-parameter',
        severity: 'low',
        message: `Parameter "${name}" is never read inside ${path.basename(sourceFile.fileName)}.`,
        line: position.line,
        column: position.column,
        snippet: snippetForLine(content, position.line),
        recommendation: 'Rename to an underscore-prefixed identifier or drop the argument if it is not part of a public contract.'
      });
      return;
    }
    if (ts.isFunctionDeclaration(declaration) || ts.isClassDeclaration(declaration)) {
      const key = `fn:${name}:${position.line}`;
      if (reported.has(key)) return;
      reported.add(key);
      reportCount += 1;
      push({
        ruleId: 'no-unused-declaration',
        severity: 'low',
        message: `${ts.isFunctionDeclaration(declaration) ? 'Function' : 'Class'} "${name}" is declared but never used in ${path.basename(sourceFile.fileName)}.`,
        line: position.line,
        column: position.column,
        snippet: snippetForLine(content, position.line),
        recommendation: 'Delete the declaration or export it if it is part of a public surface.'
      });
    }
  });
}

function analyzeUnreachableCode(context: AnalysisContext): void {
  const { sourceFile, content, push } = context;
  const reportedLines = new Set<number>();

  const checkBlock = (statements: readonly ts.Statement[]): void => {
    for (let index = 0; index < statements.length; index++) {
      if (!TERMINAL_STATEMENT_KINDS.has(statements[index].kind)) continue;
      const follower = statements[index + 1];
      if (!follower) return;
      const position = positionOf(sourceFile, follower.getStart(sourceFile));
      if (reportedLines.has(position.line)) return;
      reportedLines.add(position.line);
      push({
        ruleId: 'no-unreachable-code',
        severity: 'medium',
        message: 'Unreachable statement follows a terminating control-flow statement (return/throw/break/continue).',
        line: position.line,
        column: position.column,
        snippet: snippetForLine(content, position.line),
        recommendation: 'Delete the unreachable block or restructure the control flow so the code can execute.'
      });
      return;
    }
  };

  walkSourceFile(sourceFile, (node) => {
    if (ts.isBlock(node)) checkBlock(node.statements);
  });
  checkBlock(sourceFile.statements);
}

function isInsideTryStatement(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isTryStatement(current) || ts.isCatchClause(current)) return true;
    if (FUNCTION_LIKE_KINDS.has(current.kind) || current.kind === ts.SyntaxKind.SourceFile) return false;
    current = current.parent;
  }
  return false;
}

function analyzeUnsafeAwait(context: AnalysisContext): void {
  const { sourceFile, content, push } = context;
  const reportedLines = new Set<number>();

  walkSourceFile(sourceFile, (node) => {
    if (!ts.isAwaitExpression(node)) return;
    if (isInsideTryStatement(node)) return;
    const position = positionOf(sourceFile, node.getStart(sourceFile));
    const key = position.line;
    if (reportedLines.has(key)) return;
    reportedLines.add(key);
    push({
      ruleId: 'no-unsafe-await',
      severity: 'high',
      message: 'await expression is not wrapped in try/catch; a rejection escapes to the surrounding async context unhandled.',
      line: position.line,
      column: position.column,
      snippet: snippetForLine(content, position.line),
      recommendation: 'Wrap the await in try/catch, or let the caller handle errors in its own catch block.'
    });
  });
}

function promiseChainHasHandler(call: ts.CallExpression): boolean {
  let current: ts.Node = call;
  while (current.parent && ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current) {
    const propertyAccess = current.parent;
    const outerCall = propertyAccess.parent;
    if (ts.isCallExpression(outerCall) && ts.isPropertyAccessExpression(outerCall.expression) && outerCall.expression === propertyAccess) {
      const name = outerCall.expression.name.text;
      if (name === 'catch' || name === 'finally') return true;
    }
    current = propertyAccess;
  }
  return false;
}

function analyzeFloatingPromises(context: AnalysisContext): void {
  const { sourceFile, content, push } = context;
  const reportedLines = new Set<number>();

  walkSourceFile(sourceFile, (node) => {
    if (!ts.isCallExpression(node)) return;
    if (!ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== 'then') return;
    if (node.arguments.length >= 2) return;
    if (promiseChainHasHandler(node)) return;

    let ancestor: ts.Node | undefined = node;
    let chainChild: ts.Node = node;
    while (ancestor) {
      if (ts.isReturnStatement(ancestor) || ts.isVoidExpression(ancestor) || ts.isVariableDeclaration(ancestor) || ts.isAwaitExpression(ancestor)) return;
      if (ts.isBinaryExpression(ancestor) && ancestor.operatorToken.kind === ts.SyntaxKind.EqualsToken && ancestor.right === chainChild) return;
      if (ts.isCallExpression(ancestor) && (ancestor.arguments as readonly ts.Node[]).includes(chainChild)) return;
      if (ts.isExpressionStatement(ancestor) || ancestor.kind === ts.SyntaxKind.SourceFile) break;
      chainChild = ancestor;
      ancestor = ancestor.parent;
    }

    const position = positionOf(sourceFile, node.getStart(sourceFile));
    if (reportedLines.has(position.line)) return;
    reportedLines.add(position.line);
    push({
      ruleId: 'no-floating-promise',
      severity: 'high',
      message: 'Promise chain from ".then(...)" has no rejection handler; a rejection becomes an unhandled promise rejection.',
      line: position.line,
      column: position.column,
      snippet: snippetForLine(content, position.line),
      recommendation: 'Append .catch(...) / .finally(...), pass a rejection handler as the second .then argument, or await it inside try/catch.'
    });
  });
}

function analyzeNullDereference(context: AnalysisContext): void {
  const { sourceFile, content, push } = context;

  const nullableNames = new Set<string>();
  walkSourceFile(sourceFile, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return;
    const initializer = node.initializer;
    if (!initializer) return;
    if (ts.isCallExpression(initializer) && ts.isPropertyAccessExpression(initializer.expression) && NULLABLE_SYSTEM_CALLS.has(initializer.expression.name.text)) {
      nullableNames.add(node.name.text);
      return;
    }
    if (initializer.kind === ts.SyntaxKind.NullKeyword) nullableNames.add(node.name.text);
  });
  if (nullableNames.size === 0) return;

  const guardedNames = new Set<string>();
  walkSourceFile(sourceFile, (node) => {
    if (!ts.isIfStatement(node)) return;
    walk(node.expression, (inner) => {
      if (ts.isIdentifier(inner) && nullableNames.has(inner.text)) guardedNames.add(inner.text);
      if (isPrefixNegation(inner) && ts.isIdentifier(inner.operand) && nullableNames.has(inner.operand.text)) guardedNames.add(inner.operand.text);
    });
  });

  const reportedLines = new Set<number>();
  walkSourceFile(sourceFile, (node) => {
    if (!ts.isPropertyAccessExpression(node)) return;
    if (node.questionDotToken) return;
    if (!ts.isIdentifier(node.expression)) return;
    const name = node.expression.text;
    if (!nullableNames.has(name)) return;
    if (guardedNames.has(name)) return;
    if (isDeclarationOwnerIdentifier(node.expression)) return;

    const position = positionOf(sourceFile, node.expression.getStart(sourceFile));
    if (reportedLines.has(position.line)) return;
    reportedLines.add(position.line);
    push({
      ruleId: 'possible-null-deref',
      severity: 'medium',
      message: `Potential null dereference (heuristic): "${name}" comes from a nullable source and is dereferenced without a guard.`,
      line: position.line,
      column: position.column,
      snippet: snippetForLine(content, position.line),
      recommendation: 'Add an explicit null check, use optional chaining (?.), or propagate failure with an early return.'
    });
  });
}

function isPrefixNegation(node: ts.Node): node is ts.PrefixUnaryExpression {
  return ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken;
}

function analyzeSecrets(context: AnalysisContext): void {
  const { fileName, content, push } = context;
  const basename = path.basename(fileName);
  if (/(?:\btest\b|\bspec\b|\.fixtures?\.|\.mocks?\.)/i.test(basename)) return;

  const contentLines = content.split('\n');
  contentLines.forEach((line, index) => {
    if (line.includes('process.env') || line.includes('import.meta')) return;
    const trimmedStart = line.trimStart();
    if (trimmedStart.startsWith('//') || trimmedStart.startsWith('*') || trimmedStart.startsWith('/*')) return;

    for (const rule of SECRET_RULES) {
      if (!rule.pattern.test(line)) continue;
      push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        message: `${rule.messagePrefix} detected at ${path.basename(fileName)}:${index + 1}.`,
        line: index + 1,
        column: 1,
        snippet: maskSecretValues(line).trim().slice(0, MAX_SNIPPET_LENGTH),
        recommendation: 'Move the secret into process.env or a credential store and rotate the exposed value immediately.'
      });
      break;
    }
  });
}

interface BinaryLeaf {
  kind: 'string' | 'dynamic';
  text: string;
}

function collectBinaryConcatLeaves(root: ts.BinaryExpression, sourceFile: ts.SourceFile): BinaryLeaf[] {
  const leaves: BinaryLeaf[] = [];
  const visit = (node: ts.Expression): void => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      visit(node.left);
      visit(node.right);
      return;
    }
    if (ts.isStringLiteral(node)) {
      leaves.push({ kind: 'string', text: node.text });
      return;
    }
    leaves.push({ kind: 'dynamic', text: node.getText(sourceFile) });
  };
  visit(root);
  return leaves;
}

function analyzeSqlInjection(context: AnalysisContext): void {
  const { sourceFile, content, push } = context;
  const reportedLines = new Set<number>();

  walkSourceFile(sourceFile, (node) => {
    if (ts.isTemplateExpression(node)) {
      if (node.templateSpans.length === 0) return;
      const staticText = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)].join(' ');
      if (!SQL_KEYWORD_PATTERN.test(staticText)) return;
      const position = positionOf(sourceFile, node.getStart(sourceFile));
      if (reportedLines.has(position.line)) return;
      reportedLines.add(position.line);
      push({
        ruleId: 'sql-injection',
        severity: 'critical',
        message: 'SQL built from a template literal with runtime interpolation is a SQL injection vector.',
        line: position.line,
        column: position.column,
        snippet: snippetForLine(content, position.line),
        recommendation: 'Use parameterized queries or a query builder instead of interpolating values into SQL text.'
      });
      return;
    }

    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
      const leaves = collectBinaryConcatLeaves(node, sourceFile);
      const staticText = leaves.filter((leaf) => leaf.kind === 'string').map((leaf) => leaf.text).join(' ');
      if (!hasDynamicLeaf(leaves) || !SQL_KEYWORD_PATTERN.test(staticText)) return;
      const position = positionOf(sourceFile, node.getStart(sourceFile));
      if (reportedLines.has(position.line)) return;
      reportedLines.add(position.line);
      push({
        ruleId: 'sql-injection',
        severity: 'critical',
        message: 'SQL query built with string concatenation of a runtime value is a SQL injection vector.',
        line: position.line,
        column: position.column,
        snippet: snippetForLine(content, position.line),
        recommendation: 'Switch to parameterized queries (placeholders + bound values) and never interpolate user input into SQL.'
      });
    }
  });
}

function hasDynamicLeaf(leaves: BinaryLeaf[]): boolean {
  return leaves.some((leaf) => leaf.kind === 'dynamic');
}
