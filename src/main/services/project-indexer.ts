import fs from 'fs/promises';
import path from 'path';
import type { ProjectContextQuery, ProjectContextResult, ProjectIndexStats, ProjectSymbol } from '../../preload/types';

const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  '.next',
  '.turbo',
  'coverage',
  '.ty-claude',
  '.ty-code',
  '.gemini',
  '.vscode'
]);

const SUPPORTED_CODE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.rs',
  '.go',
  '.java',
  '.cpp',
  '.c',
  '.h',
  '.hpp',
  '.cs',
  '.json',
  '.md',
  '.sql',
  '.sh',
  '.html',
  '.css'
]);

export class ProjectIndexer {
  private workspacePath: string;
  private symbols: ProjectSymbol[] = [];
  private fileList: string[] = [];
  private tokenIndex = new Map<string, Set<number>>(); // token -> set of file indices
  private symbolIndex = new Map<string, ProjectSymbol[]>(); // token -> symbols
  private frameworks: string[] = [];
  private customInstructions: string = '';
  private languageCounts: Record<string, number> = {};
  private exportCount = 0;
  private lastIndexedAt = 0;
  private lastIndexDurationMs = 0;
  private isIndexing = false;

  constructor(workspacePath: string = '') {
    this.workspacePath = workspacePath;
  }

  setWorkspace(workspacePath: string): void {
    this.workspacePath = workspacePath;
  }

  getStats(): ProjectIndexStats {
    return {
      fileCount: this.fileList.length,
      symbolCount: this.symbols.length,
      exportCount: this.exportCount,
      indexedInMs: this.lastIndexDurationMs,
      frameworks: [...this.frameworks],
      languages: { ...this.languageCounts },
      lastIndexedAt: this.lastIndexedAt,
      customInstructions: this.customInstructions || undefined
    };
  }

  getSymbols(): ProjectSymbol[] {
    return this.symbols;
  }

  getInstructions(): string {
    return this.customInstructions;
  }

  async index(): Promise<ProjectIndexStats> {
    if (!this.workspacePath) {
      return this.getStats();
    }
    if (this.isIndexing) {
      return this.getStats();
    }

    this.isIndexing = true;
    const startTime = Date.now();

    try {
      this.symbols = [];
      this.fileList = [];
      this.tokenIndex.clear();
      this.symbolIndex.clear();
      this.frameworks = [];
      this.customInstructions = '';
      this.languageCounts = {};
      this.exportCount = 0;

      // 1. Collect all valid candidate files
      const files = await this.collectFiles(this.workspacePath);
      this.fileList = files;

      // 2. Discover framework & package configuration
      await this.detectFrameworksAndConfig();

      // 3. Discover custom project rules & instructions
      await this.loadProjectInstructions();

      // 4. Batch parse files for symbols and tokens (bounded concurrency)
      const CONCURRENCY = 16;
      for (let i = 0; i < files.length; i += CONCURRENCY) {
        const batch = files.slice(i, i + CONCURRENCY);
        await Promise.all(
          batch.map(async (file, batchOffset) => {
            const fileIndex = i + batchOffset;
            await this.indexSingleFile(file, fileIndex);
          })
        );
        // Yield to event loop every batch to guarantee main thread never blocks >16ms
        await new Promise((resolve) => setImmediate(resolve));
      }

      this.lastIndexDurationMs = Math.max(1, Date.now() - startTime);
      this.lastIndexedAt = Date.now();
      return this.getStats();
    } finally {
      this.isIndexing = false;
    }
  }

  private async collectFiles(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const name = entry.name;
        if (IGNORED_DIRECTORIES.has(name) || name.startsWith('.')) continue;

        const fullPath = path.join(dir, name);
        if (entry.isDirectory()) {
          const sub = await this.collectFiles(fullPath);
          results.push(...sub);
        } else if (entry.isFile()) {
          const ext = path.extname(name).toLowerCase();
          if (SUPPORTED_CODE_EXTENSIONS.has(ext)) {
            const relative = path.relative(this.workspacePath, fullPath).replace(/\\/g, '/');
            results.push(relative);
          }
        }
      }
    } catch {
      // Graceful fallback if directory cannot be read
    }
    return results;
  }

  private async detectFrameworksAndConfig(): Promise<void> {
    const frameworks = new Set<string>();

    // Node / JS / TS ecosystem
    try {
      const pkgPath = path.join(this.workspacePath, 'package.json');
      const pkgRaw = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(pkgRaw) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
      const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

      if (allDeps.electron) frameworks.add('Electron');
      if (allDeps.react) frameworks.add('React');
      if (allDeps.next) frameworks.add('Next.js');
      if (allDeps.vite) frameworks.add('Vite');
      if (allDeps.vue) frameworks.add('Vue');
      if (allDeps.svelte) frameworks.add('Svelte');
      if (allDeps.typescript) frameworks.add('TypeScript');
      if (allDeps.express) frameworks.add('Express');
      if (allDeps.fastify) frameworks.add('Fastify');
      if (allDeps.tailwindcss) frameworks.add('TailwindCSS');
      if (allDeps['@monaco-editor/react'] || allDeps['monaco-editor']) frameworks.add('Monaco');
    } catch {
      // No package.json
    }

    // Python ecosystem
    try {
      const pyproject = path.join(this.workspacePath, 'pyproject.toml');
      await fs.access(pyproject);
      frameworks.add('Python (pyproject)');
    } catch {
      try {
        const reqs = path.join(this.workspacePath, 'requirements.txt');
        await fs.access(reqs);
        frameworks.add('Python');
      } catch {
        // No python files
      }
    }

    // Rust ecosystem
    try {
      const cargo = path.join(this.workspacePath, 'Cargo.toml');
      await fs.access(cargo);
      frameworks.add('Rust (Cargo)');
    } catch {
      // No cargo
    }

    // Go ecosystem
    try {
      const gopkg = path.join(this.workspacePath, 'go.mod');
      await fs.access(gopkg);
      frameworks.add('Go');
    } catch {
      // No go.mod
    }

    this.frameworks = Array.from(frameworks);
  }

  private async loadProjectInstructions(): Promise<void> {
    const candidatePaths = [
      path.join(this.workspacePath, '.ty-code', 'instructions.md'),
      path.join(this.workspacePath, '.ty-code', 'rules.md'),
      path.join(this.workspacePath, '.cursorrules'),
      path.join(this.workspacePath, 'context', 'ai-workflow-rules.md'),
      path.join(this.workspacePath, 'context', 'code-standards.md')
    ];

    const instructionParts: string[] = [];
    for (const filePath of candidatePaths) {
      try {
        const content = await fs.readFile(filePath, 'utf8');
        instructionParts.push(`--- Instruction from ${path.basename(filePath)} ---\n${content.trim()}`);
      } catch {
        // File does not exist, ignore
      }
    }

    this.customInstructions = instructionParts.join('\n\n');
  }

  private async indexSingleFile(relativePath: string, fileIndex: number): Promise<void> {
    const ext = path.extname(relativePath).toLowerCase();
    this.languageCounts[ext] = (this.languageCounts[ext] || 0) + 1;

    try {
      const fullPath = path.join(this.workspacePath, relativePath);
      const stat = await fs.stat(fullPath);
      if (stat.size > 500_000) return; // Skip files > 500KB for indexing speed

      const content = await fs.readFile(fullPath, 'utf8');
      const lines = content.split('\n');

      // Index tokens for fast text retrieval
      const words = content.match(/[A-Za-z0-9_$]{3,}/g) || [];
      const uniqueWords = new Set(words.map((w) => w.toLowerCase()));
      for (const word of uniqueWords) {
        let set = this.tokenIndex.get(word);
        if (!set) {
          set = new Set();
          this.tokenIndex.set(word, set);
        }
        set.add(fileIndex);
      }

      // Fast symbol extraction
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('//') || trimmed.startsWith('#') || trimmed.startsWith('/*')) continue;

        if (trimmed.startsWith('export ')) {
          this.exportCount++;
        }

        // Functions
        const fnMatch = trimmed.match(/(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/);
        if (fnMatch) {
          this.addSymbol({
            name: fnMatch[1],
            kind: 'function',
            filePath: relativePath,
            line: i + 1,
            signature: `function ${fnMatch[1]}(${fnMatch[2]})`
          });
          continue;
        }

        // Arrow / Variable function exports
        const arrowMatch = trimmed.match(/(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?\(([^)]*)\)\s*(?::\s*[^=]+)?\s*=>/);
        if (arrowMatch) {
          this.addSymbol({
            name: arrowMatch[1],
            kind: 'function',
            filePath: relativePath,
            line: i + 1,
            signature: `const ${arrowMatch[1]} = (${arrowMatch[2]}) =>`
          });
          continue;
        }

        // Classes
        const classMatch = trimmed.match(/(?:export\s+)?class\s+([A-Za-z0-9_$]+)(?:\s+extends\s+([A-Za-z0-9_$]+))?/);
        if (classMatch) {
          this.addSymbol({
            name: classMatch[1],
            kind: 'class',
            filePath: relativePath,
            line: i + 1,
            signature: `class ${classMatch[1]}`
          });
          continue;
        }

        // Interfaces
        const interfaceMatch = trimmed.match(/(?:export\s+)?interface\s+([A-Za-z0-9_$]+)/);
        if (interfaceMatch) {
          this.addSymbol({
            name: interfaceMatch[1],
            kind: 'interface',
            filePath: relativePath,
            line: i + 1,
            signature: `interface ${interfaceMatch[1]}`
          });
          continue;
        }

        // Types
        const typeMatch = trimmed.match(/(?:export\s+)?type\s+([A-Za-z0-9_$]+)\s*=/);
        if (typeMatch) {
          this.addSymbol({
            name: typeMatch[1],
            kind: 'type',
            filePath: relativePath,
            line: i + 1,
            signature: `type ${typeMatch[1]}`
          });
          continue;
        }

        // Python def / class
        if (ext === '.py') {
          const pyFn = trimmed.match(/^def\s+([A-Za-z0-9_]+)\s*\(([^)]*)\)/);
          if (pyFn) {
            this.addSymbol({
              name: pyFn[1],
              kind: 'function',
              filePath: relativePath,
              line: i + 1,
              signature: `def ${pyFn[1]}(${pyFn[2]})`
            });
            continue;
          }
          const pyClass = trimmed.match(/^class\s+([A-Za-z0-9_]+)/);
          if (pyClass) {
            this.addSymbol({
              name: pyClass[1],
              kind: 'class',
              filePath: relativePath,
              line: i + 1,
              signature: `class ${pyClass[1]}`
            });
            continue;
          }
        }
      }
    } catch {
      // Ignore file reading errors
    }
  }

  private addSymbol(symbol: ProjectSymbol): void {
    this.symbols.push(symbol);
    const lower = symbol.name.toLowerCase();
    const existing = this.symbolIndex.get(lower) || [];
    existing.push(symbol);
    this.symbolIndex.set(lower, existing);
  }

  queryContext(queryReq: ProjectContextQuery): ProjectContextResult {
    const rawTokens = (queryReq.query.match(/[A-Za-z0-9_$]{2,}/g) || []).map((t) => t.toLowerCase());
    const matchedFileScores = new Map<string, number>();
    const matchedSymbols: ProjectSymbol[] = [];

    for (const token of rawTokens) {
      const fileIndices = this.tokenIndex.get(token);
      if (fileIndices) {
        for (const idx of fileIndices) {
          const file = this.fileList[idx];
          if (file) {
            matchedFileScores.set(file, (matchedFileScores.get(file) || 0) + 1);
          }
        }
      }

      const syms = this.symbolIndex.get(token);
      if (syms) {
        matchedSymbols.push(...syms);
      }
    }

    // Also fuzzy search symbols by prefix/substring
    for (const [symName, symList] of this.symbolIndex) {
      if (rawTokens.some((t) => symName.includes(t) || t.includes(symName))) {
        for (const sym of symList) {
          if (!matchedSymbols.includes(sym)) {
            matchedSymbols.push(sym);
          }
        }
      }
    }

    const limit = queryReq.limit || 8;
    const sortedFiles = Array.from(matchedFileScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([f]) => f)
      .slice(0, limit);

    // If query returned few files, include active file or top files
    if (queryReq.activeFilePath && !sortedFiles.includes(queryReq.activeFilePath)) {
      sortedFiles.unshift(queryReq.activeFilePath);
    }

    const relevantSnippets: Array<{ filePath: string; lineStart: number; content: string }> = [];
    for (const sym of matchedSymbols.slice(0, limit)) {
      relevantSnippets.push({
        filePath: sym.filePath,
        lineStart: sym.line,
        content: sym.signature || sym.name
      });
    }

    const summary = `Project has ${this.fileList.length} files across ${Object.keys(this.languageCounts).length} languages. Frameworks: ${this.frameworks.join(', ') || 'Standard'}. Found ${sortedFiles.length} matching files and ${matchedSymbols.length} relevant symbols.`;

    return {
      files: sortedFiles,
      symbols: matchedSymbols.slice(0, limit * 2),
      instructions: this.customInstructions || undefined,
      summary,
      frameworks: [...this.frameworks],
      relevantSnippets
    };
  }

  async indexWorkspace(workspacePath: string): Promise<ProjectIndexStats> {
    this.workspacePath = workspacePath;
    return this.index();
  }

  searchSymbols(query: string): ProjectSymbol[] {
    const q = query.toLowerCase();
    return this.symbols.filter((s) => s.name.toLowerCase().includes(q));
  }

  queryCodebase(prompt: string): string {
    const res = this.queryContext({ query: prompt });
    return `${res.summary} Frameworks detected: ${res.frameworks.join(', ')}. Instructions: ${res.instructions || 'none'}`;
  }
}

export const ProjectIndexerService = ProjectIndexer;
