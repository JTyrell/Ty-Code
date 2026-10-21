import fsp from 'node:fs/promises';
import path from 'node:path';
import type { AnalysisResult, AnalysisSeverity } from '../../windows/debugger-window';

export interface ArchGraphNode {
  id: string;
  loc: number;
  importsOut: number;
  importedBy: number;
  externalImports: number;
  isGodFile: boolean;
}

export interface ArchGraphEdge {
  from: string;
  to: string;
}

export interface ArchCycle {
  nodes: string[];
}

export interface ArchDebtScore {
  value: number;
  label: string;
  godFileCount: number;
  cycleCount: number;
  sourceFileCount: number;
  coupling: number;
}

export interface ArchProjectReport {
  projectRoot: string;
  packageJson: { name: string | null; version: string | null; scripts: string[] } | null;
  tsconfig: { path: string; aliases: Record<string, string[]> } | null;
  graph: { nodes: ArchGraphNode[]; edges: ArchGraphEdge[] };
  cycles: ArchCycle[];
  truncated: boolean;
  debtScore: ArchDebtScore;
  warnings: AnalysisResult[];
}

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts']);

const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'dist-release',
  'release',
  'out',
  'build',
  'coverage',
  '.git',
  '.cache',
  '.next',
  'dist-electron',
  'website-dist',
  '__pycache__',
  'target',
  'vendor'
]);

const MAX_FILES = 2500;
const MAX_FILE_BYTES = 1_000_000;
const MAX_CYCLES = 8;
const MAX_CYCLE_LENGTH = 24;

const GOD_FILE_LINE_THRESHOLD = 500;
const GOD_FILE_IMPORTS_THRESHOLD = 20;
const LARGE_FILE_LINES = 800;

// Match any import-with-bindings form: default, namespace, named, multiline,
// and `import type { ... }`. The {0,1000}? lazy span keeps each match anchored
// to the import keyword and stops at the nearest following `from '...'`.
const STATIC_IMPORT_PATTERN = /\bimport\b[\s\S]{0,1000}?\bfrom\b\s*['"]([^'"]+)['"]/g;
const SIDE_EFFECT_IMPORT_PATTERN = /\bimport\s+['"]([^'"]+)['"]/g;
const REQUIRE_PATTERN = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
const DYNAMIC_IMPORT_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;

function toPosixId(projectRoot: string, absolutePath: string): string {
  return path.relative(projectRoot, absolutePath).split(path.sep).join('/');
}

async function collectSourceFiles(projectRoot: string): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  let truncated = false;

  const walk = async (directory: string): Promise<void> => {
    if (truncated) return;
    if (files.length >= MAX_FILES) {
      truncated = true;
      return;
    }
    const entries = await fsp.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (EXCLUDED_DIR_NAMES.has(entry.name) || entry.name.startsWith('.')) continue;
        await walk(absolute);
        if (truncated) return;
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXTENSIONS.has(ext) || /\.d\.ts$/i.test(entry.name)) continue;
      files.push(absolute);
      if (files.length >= MAX_FILES) {
        truncated = true;
        return;
      }
    }
  };

  await walk(projectRoot);
  return { files, truncated };
}

function stripJsonComments(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(?<=[\s,)\]}])\/\/[^\n]*/g, '');
}

function parseJsonLenient(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    const cleaned = stripJsonComments(raw).replace(/,\s*([}\]])/g, '$1');
    try {
      return JSON.parse(cleaned);
    } catch {
      return null;
    }
  }
}

async function readJson(pathname: string): Promise<{ data: Record<string, unknown> } | { data: null; error: string }> {
  try {
    const raw = await fsp.readFile(pathname, 'utf8');
    const data = parseJsonLenient(raw);
    if (data && typeof data === 'object') return { data: data as Record<string, unknown> };
    return { data: null, error: `${pathname} is not valid JSONC` };
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : String(error) };
  }
}

interface ParsedSourceFile {
  id: string;
  loc: number;
  specifiers: string[];
}

function extractSpecifiers(content: string): string[] {
  const specifiers = new Set<string>();
  for (const pattern of [STATIC_IMPORT_PATTERN, SIDE_EFFECT_IMPORT_PATTERN, REQUIRE_PATTERN, DYNAMIC_IMPORT_PATTERN]) {
    pattern.lastIndex = 0;
    let match = pattern.exec(content);
    while (match) {
      if (match[1]) specifiers.add(match[1]);
      match = pattern.exec(content);
    }
  }
  return [...specifiers];
}

interface AliasMap {
  prefixes: Array<{ testPrefix: string; targets: string[]; wildcard: boolean }>;
}

function buildAliasMap(tsconfig: { path: string; aliases: Record<string, string[]> } | null): AliasMap {
  if (!tsconfig) return { prefixes: [] };
  const prefixes: AliasMap['prefixes'] = [];
  for (const [specifier, targets] of Object.entries(tsconfig.aliases)) {
    const wildcard = specifier.endsWith('/*');
    const testPrefix = wildcard ? specifier.slice(0, -1) : specifier;
    if (targets.length > 0) prefixes.push({ testPrefix, targets: [...targets], wildcard });
  }
  prefixes.sort((left, right) => right.testPrefix.length - left.testPrefix.length);
  return { prefixes };
}

function resolveSpecifierToInternal(
  specifier: string,
  importerId: string,
  fileIds: Set<string>,
  aliasMap: AliasMap
): string | null {
  const candidates: string[] = [];

  if (specifier.startsWith('.')) {
    const importerDir = importerId.includes('/') ? importerId.slice(0, importerId.lastIndexOf('/')) : '';
    const joined = importerDir ? `${importerDir}/${specifier}` : specifier.replace(/^\.\//, '');
    for (const candidate of candidateIds(joined)) candidates.push(candidate);
  } else {
    for (const aliasPrefix of aliasMap.prefixes) {
      if (!specifier.startsWith(aliasPrefix.testPrefix)) continue;
      const remainder = specifier.slice(aliasPrefix.testPrefix.length);
      for (const target of aliasPrefix.targets) {
        const resolvedTarget = target.endsWith('/*') ? `${target.slice(0, -1)}${remainder}` : target;
        for (const candidate of candidateIds(resolvedTarget.replace(/\\/g, '/'))) candidates.push(candidate);
      }
    }
  }

  for (const candidate of candidates) {
    if (fileIds.has(candidate)) return candidate;
  }
  return null;
}

function normalizeRelPath(input: string): string {
  const segments: string[] = [];
  for (const raw of input.split('/')) {
    if (raw === '' || raw === '.') continue;
    if (raw === '..') {
      segments.pop();
      continue;
    }
    segments.push(raw);
  }
  return segments.join('/');
}

function candidateIds(baseWithoutExt: string): string[] {
  const cleaned = normalizeRelPath(baseWithoutExt);
  const list = [
    cleaned,
    `${cleaned}.ts`,
    `${cleaned}.tsx`,
    `${cleaned}.js`,
    `${cleaned}.jsx`,
    `${cleaned}.mjs`,
    `${cleaned}.cjs`,
    `${cleaned}/index.ts`,
    `${cleaned}/index.tsx`,
    `${cleaned}/index.js`,
    `${cleaned}/index.jsx`
  ];
  if (/\.m?tsx?$/i.test(cleaned) || /\.m?jsx?$/i.test(cleaned)) {
    if (!/\.jsx$/i.test(cleaned) && /\.tsx$/i.test(cleaned)) {
      list.unshift(cleaned.replace(/\.tsx$/i, '.ts'));
    }
  }
  return list;
}

function isExternalSpecifier(specifier: string): boolean {
  return !specifier.startsWith('.') && !specifier.startsWith('/');
}

function detectCycles(adjacency: Map<string, string[]>): ArchCycle[] {
  const state = new Map<string, 0 | 1 | 2>();
  for (const id of adjacency.keys()) state.set(id, 0);

  const stack: string[] = [];
  const cycles: ArchCycle[] = [];
  const cycleKeys = new Set<string>();

  const visit = ( nodeId: string): void => {
    if (cycles.length >= MAX_CYCLES) return;
    state.set(nodeId, 1);
    stack.push(nodeId);
    for (const neighbor of adjacency.get(nodeId) ?? []) {
      const neighborState = state.get(neighbor) ?? 0;
      if (neighborState === 0) {
        visit(neighbor);
        if (cycles.length >= MAX_CYCLES) break;
      } else if (neighborState === 1) {
        const startIndex = stack.indexOf(neighbor);
        const cycleNodes = stack.slice(Math.max(startIndex, 0));
        if (cycleNodes.length >= 2 && cycleNodes.length <= MAX_CYCLE_LENGTH) {
          const key = [...cycleNodes].sort().join('|');
          if (!cycleKeys.has(key)) {
            cycleKeys.add(key);
            cycles.push({ nodes: cycleNodes });
          }
        }
      }
    }
    state.set(nodeId, 2);
    stack.pop();
  };

  for (const id of [...adjacency.keys()]) {
    if ((state.get(id) ?? 0) === 0) visit(id);
    if (cycles.length >= MAX_CYCLES) break;
  }
  return cycles;
}

function buildDebtScore(nodes: ArchGraphNode[], edges: ArchGraphEdge[], cycleCount: number): ArchDebtScore {
  const godFileCount = nodes.filter((node) => node.isGodFile).length;
  const godPenalty = Math.min(40, Math.round((godFileCount / Math.max(nodes.length, 1)) * 500));
  const cyclePenalty = Math.min(30, cycleCount * 7);
  const coupling = nodes.length > 0 ? Number((edges.length / nodes.length).toFixed(2)) : 0;
  const couplingPenalty = Math.min(15, Math.max(0, Math.round((coupling - 1.2) * 20)));
  const largeFiles = nodes.filter((node) => node.loc > LARGE_FILE_LINES).length;
  const largePenalty = Math.min(15, largeFiles * 3);
  const value = Math.max(0, Math.min(100, Math.round(godPenalty + cyclePenalty + couplingPenalty + largePenalty)));
  const label =
    value <= 20
      ? 'healthy'
      : value <= 40
        ? 'acceptable'
        : value <= 60
          ? 'needs attention'
          : value <= 80
            ? 'high debt'
            : 'critical debt';
  return { value, label, godFileCount, cycleCount, sourceFileCount: nodes.length, coupling };
}

function buildWarning(
  ruleId: string,
  severity: AnalysisSeverity,
  message: string,
  filePath: string | undefined,
  suggestedFix?: string
): AnalysisResult {
  return {
    id: `arch:${ruleId}:${filePath ?? 'project'}:${Date.now() % 100000}:0`,
    severity,
    engine: 'arch',
    role: 'dev',
    message,
    line: 1,
    codeSnippet: undefined,
    filePath,
    ruleId,
    suggestedFix,
    timestamp: Date.now()
  };
}

export async function runArchAnalysis(projectRoot: string): Promise<ArchProjectReport> {
  const root = path.resolve(projectRoot);

  const packageJsonResult = await readJson(path.join(root, 'package.json'));
  const packageJson = packageJsonResult.data
    ? {
        name: typeof packageJsonResult.data.name === 'string' ? packageJsonResult.data.name : null,
        version: typeof packageJsonResult.data.version === 'string' ? packageJsonResult.data.version : null,
        scripts: packageJsonResult.data.scripts && typeof packageJsonResult.data.scripts === 'object'
          ? Object.keys(packageJsonResult.data.scripts as Record<string, unknown>)
          : []
      }
    : null;

  const tsconfigAbsolutePath = path.join(root, 'tsconfig.json');
  const tsconfigResult = await readJson(tsconfigAbsolutePath);
  let tsconfig: ArchProjectReport['tsconfig'] = null;
  if (tsconfigResult.data) {
    const compilerOptions = tsconfigResult.data.compilerOptions;
    const aliases: Record<string, string[]> = {};
    if (compilerOptions && typeof compilerOptions === 'object') {
      const paths = (compilerOptions as Record<string, unknown>).paths;
      if (paths && typeof paths === 'object') {
        for (const [specifier, targets] of Object.entries(paths as Record<string, unknown>)) {
          if (Array.isArray(targets)) aliases[specifier] = targets.filter((target): target is string => typeof target === 'string');
        }
      }
    }
    tsconfig = { path: 'tsconfig.json', aliases };
  }

  const collected = await collectSourceFiles(root);
  const fileIds = new Set<string>();
  const parsedFiles: ParsedSourceFile[] = [];
  const oversizedFiles: string[] = [];

  for (const absolute of collected.files) {
    const id = toPosixId(root, absolute);
    fileIds.add(id);
    let raw: string;
    try {
      const stat = await fsp.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) {
        oversizedFiles.push(id);
        parsedFiles.push({ id, loc: 0, specifiers: [] });
        continue;
      }
      raw = await fsp.readFile(absolute, 'utf8');
    } catch {
      parsedFiles.push({ id, loc: 0, specifiers: [] });
      continue;
    }
    parsedFiles.push({ id, loc: raw.split('\n').length, specifiers: extractSpecifiers(raw) });
  }

  const parsedById = new Map(parsedFiles.map((file) => [file.id, file]));
  const aliasMap = buildAliasMap(tsconfig);

  const graphNodes: ArchGraphNode[] = [];
  const graphEdges: ArchGraphEdge[] = [];
  const edgesByFrom = new Map<string, Set<string>>();
  const incomingCount = new Map<string, number>();
  const uniqueEdges = new Set<string>();

  for (const file of parsedFiles) {
    let externalCount = 0;
    let outgoing = 0;
    for (const specifier of file.specifiers) {
      outgoing += 1;
      if (isExternalSpecifier(specifier)) {
        externalCount += 1;
        continue;
      }
      const target = resolveSpecifierToInternal(specifier, file.id, fileIds, aliasMap);
      if (!target || target === file.id) continue;
      const edgeKey = `${file.id}->${target}`;
      if (uniqueEdges.has(edgeKey)) continue;
      uniqueEdges.add(edgeKey);
      graphEdges.push({ from: file.id, to: target });
      if (!edgesByFrom.has(file.id)) edgesByFrom.set(file.id, new Set());
      edgesByFrom.get(file.id)!.add(target);
      incomingCount.set(target, (incomingCount.get(target) ?? 0) + 1);
    }
    graphNodes.push({
      id: file.id,
      loc: file.loc,
      importsOut: outgoing,
      importedBy: incomingCount.get(file.id) ?? 0,
      externalImports: externalCount,
      isGodFile: file.loc > GOD_FILE_LINE_THRESHOLD || outgoing > GOD_FILE_IMPORTS_THRESHOLD
    });
  }

  graphNodes.sort((left, right) => left.id.localeCompare(right.id));
  graphEdges.sort((left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to));

  const adjacency = new Map<string, string[]>();
  for (const node of graphNodes) adjacency.set(node.id, []);
  for (const edge of graphEdges) adjacency.get(edge.from)?.push(edge.to);
  for (const neighbors of adjacency.values()) neighbors.sort((left, right) => left.localeCompare(right));

  const cycles = detectCycles(adjacency);
  const debtScore = buildDebtScore(graphNodes, graphEdges, cycles.length);

  const warnings: AnalysisResult[] = [];

  for (const node of graphNodes) {
    if (node.loc > GOD_FILE_LINE_THRESHOLD) {
      warnings.push(
        buildWarning(
          'arch-god-file',
          'medium',
          `God file detected: ${node.id} has ${node.loc} lines (threshold ${GOD_FILE_LINE_THRESHOLD}).`,
          node.id,
          'Split responsibilities into focused modules to lower cyclomatic complexity and review overhead.'
        )
      );
    }
    if (node.importsOut > GOD_FILE_IMPORTS_THRESHOLD) {
      warnings.push(
        buildWarning(
          'arch-god-file',
          'medium',
          `God file detected: ${node.id} has ${node.importsOut} distinct imports (threshold ${GOD_FILE_IMPORTS_THRESHOLD}).`,
          node.id,
          'Introduce an intermediate facade / domain module so low-level clients do not import this file directly.'
        )
      );
    }
  }

  for (const cycle of cycles) {
    warnings.push(
      buildWarning(
        'arch-circular-dependency',
        cycle.nodes.length > 3 ? 'high' : 'medium',
        `Circular dependency: ${cycle.nodes.join(' -> ')} -> ${cycle.nodes[0]}.`,
        cycle.nodes[0],
        'Extract the shared contract into an independent module to break the import cycle.'
      )
    );
  }

  if (collected.truncated) {
    warnings.push(
      buildWarning(
        'arch-truncated-scan',
        'medium',
        `Project scan exceeded the ${MAX_FILES}-file cap; graph metrics may be incomplete.`,
        undefined,
        'Narrow the analyzed project root or raise MAX_FILES for a full sweep.'
      )
    );
  }

  for (const oversizeId of oversizedFiles.slice(0, 25)) {
    warnings.push(
      buildWarning(
        'arch-oversized-file',
        'medium',
        `File too large to parse (${(MAX_FILE_BYTES / 1_000_000).toFixed(1)}MB cap): ${oversizeId}.`,
        oversizeId,
        'Split the file or exclude it from architectural analysis.'
      )
    );
  }

  if (!packageJson) {
    warnings.push(
      buildWarning(
        'arch-missing-package-json',
        'low',
        `No package.json found at ${root}; module metadata is unavailable.`,
        undefined,
        'Point the analysis at the directory that contains package.json.'
      )
    );
  }

  warnings.push(
    buildWarning(
      'arch-debt-summary',
      'info',
      `Technical Debt Score: ${debtScore.value}/100 (${debtScore.label}) across ${debtScore.sourceFileCount} source files, ${debtScore.godFileCount} god files, ${debtScore.cycleCount} import cycles, coupling ${debtScore.coupling} edges/node.`,
      undefined,
      debtScore.value > 60 ? 'Prioritize decoupling the largest hotspots and breaking the reported cycles.' : undefined
    )
  );

  return {
    projectRoot: root,
    packageJson,
    tsconfig,
    graph: { nodes: graphNodes, edges: graphEdges },
    cycles,
    truncated: collected.truncated,
    debtScore,
    warnings
  };
}
