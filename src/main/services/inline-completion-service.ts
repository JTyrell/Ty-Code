import type {
  InlineCompletionItem,
  InlineCompletionRequest,
  InlineCompletionResponse,
  ProviderSettings
} from '../../preload/types';
import type { ProjectIndexer } from './project-indexer';

interface CacheEntry {
  prefix: string;
  items: InlineCompletionItem[];
  timestamp: number;
}

export class InlineCompletionService {
  private cache = new Map<string, CacheEntry>();
  private maxCacheSize = 250;

  constructor(private projectIndexer?: ProjectIndexer) {}

  setProjectIndexer(indexer: ProjectIndexer): void {
    this.projectIndexer = indexer;
  }

  /** Step 4: governor eviction hook — trim the completion cache. */
  public trimCache(maxEntries: number): void {
    if (this.cache.size <= maxEntries) return;
    const keys = Array.from(this.cache.keys());
    const excess = keys.slice(0, Math.max(0, keys.length - maxEntries));
    for (const key of excess) this.cache.delete(key);
  }

  private getCacheKey(req: InlineCompletionRequest): string {
    const lastLines = req.prefix.split('\n').slice(-5).join('\n');
    return `${req.filePath}:${req.language}:${lastLines.trimEnd()}`;
  }

  async getCompletions(
    req: InlineCompletionRequest,
    _settings?: ProviderSettings
  ): Promise<InlineCompletionResponse> {
    const startTime = Date.now();
    const cacheKey = this.getCacheKey(req);

    // 1. Fast Cache Check
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < 30_000) {
      return {
        items: cached.items,
        cached: true,
        latencyMs: Date.now() - startTime
      };
    }

    // 2. Context-Aware Synthesis
    const items: InlineCompletionItem[] = [];
    const prefixLines = req.prefix.split('\n');
    const currentLine = prefixLines[prefixLines.length - 1] || '';
    const trimmedLine = currentLine.trim();

    // Context from surrounding symbols
    const knownSymbols = this.projectIndexer ? this.projectIndexer.getSymbols().slice(0, 30) : [];

    // Synthesize multi-line and single-line candidates
    const candidates = this.generateCandidates(req, trimmedLine, currentLine, knownSymbols);
    items.push(...candidates);

    // Save to cache
    if (this.cache.size >= this.maxCacheSize) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(cacheKey, { prefix: req.prefix, items, timestamp: Date.now() });

    return {
      items,
      cached: false,
      latencyMs: Date.now() - startTime
    };
  }

  private generateCandidates(
    req: InlineCompletionRequest,
    trimmedLine: string,
    currentLine: string,
    symbols: Array<{ name: string; kind: string; signature?: string }>
  ): InlineCompletionItem[] {
    const results: InlineCompletionItem[] = [];
    const indent = currentLine.match(/^\s*/)?.[0] || '';
    const lang = req.language.toLowerCase();

    const prefixLines = req.prefix.split('\n');
    const prevNonEmptyLine = [...prefixLines].slice(0, -1).reverse().find((l) => l.trim().length > 0)?.trim() || '';

    // Case 1: Try/catch or error handling block
    if (trimmedLine.startsWith('try') || trimmedLine === 'try {' || prevNonEmptyLine === 'try {' || prevNonEmptyLine.endsWith('try {')) {
      const openBrace = trimmedLine.endsWith('{') ? '' : trimmedLine.startsWith('try') ? ' {' : '';
      results.push({
        text: `${openBrace}\n${indent}  const response = await fetch('/api/data');\n${indent}  return await response.json();\n${indent}} catch (error) {\n${indent}  console.error('Operation failed:', error);\n${indent}  throw error;\n${indent}}`,
        source: 'heuristic'
      });
      results.push({
        text: `${openBrace}\n${indent}  return await execute();\n${indent}} catch (err) {\n${indent}  throw new Error(\`Failed to execute: \${err}\`);\n${indent}}`,
        source: 'heuristic'
      });
      return results;
    }

    // Case 2: Async function definition
    const asyncFnMatch = trimmedLine.match(/(?:export\s+)?async\s+function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)/);
    if (asyncFnMatch) {
      const fnName = asyncFnMatch[1];
      results.push({
        text: `: Promise<void> {\n${indent}  try {\n${indent}    // TODO: implement ${fnName}\n${indent}  } catch (error) {\n${indent}    console.error('Error in ${fnName}:', error);\n${indent}  }\n${indent}}`,
        source: 'heuristic'
      });
      results.push({
        text: `: Promise<boolean> {\n${indent}  return true;\n${indent}}`,
        source: 'heuristic'
      });
      return results;
    }

    // Case 3: Interface or Type definition in TS
    const interfaceMatch = trimmedLine.match(/interface\s+([A-Za-z0-9_$]+)/);
    if (interfaceMatch) {
      results.push({
        text: ` {\n${indent}  id: string;\n${indent}  name: string;\n${indent}  createdAt: number;\n${indent}}`,
        source: 'heuristic'
      });
      return results;
    }

    // Case 4: React Hook (useState / useEffect)
    const hookStateMatch = trimmedLine.match(/^const\s*\[\s*([A-Za-z0-9_$]+)\s*,\s*set[A-Za-z0-9_$]*\s*\]\s*=/);
    if (hookStateMatch) {
      const varName = hookStateMatch[1].toLowerCase();
      let defaultVal = 'null';
      if (varName.includes('count') || varName.includes('index') || varName.includes('total') || varName.includes('num')) defaultVal = '0';
      else if (varName.includes('name') || varName.includes('text') || varName.includes('query') || varName.includes('str')) defaultVal = "''";
      else if (varName.includes('items') || varName.includes('list') || varName.includes('data')) defaultVal = '[]';
      else if (varName.includes('is') || varName.includes('has') || varName.includes('enabled') || varName.includes('loading') || varName.includes('open')) defaultVal = 'false';

      results.push({
        text: ` useState(${defaultVal});`,
        source: 'heuristic'
      });
      results.push({
        text: ` useState<any>(null);`,
        source: 'heuristic'
      });
      return results;
    }
    if (trimmedLine.startsWith('const [') && trimmedLine.includes('] = useState')) {
      if (!trimmedLine.endsWith(');') && !trimmedLine.endsWith(')')) {
        results.push({ text: `(null);`, source: 'heuristic' });
        results.push({ text: `(false);`, source: 'heuristic' });
        return results;
      }
    }
    if (trimmedLine.startsWith('useEffect(')) {
      results.push({
        text: `() => {\n${indent}  // effect logic\n${indent}  return () => {\n${indent}    // cleanup\n${indent}  };\n${indent}}, []);`,
        source: 'heuristic'
      });
      return results;
    }

    // Case 5: Promise / Array methods (.map, .filter, .find, .forEach)
    if (trimmedLine.endsWith('.map(') || trimmedLine.endsWith('.filter(') || trimmedLine.endsWith('.find(')) {
      results.push({
        text: `(item) => item.id)`,
        source: 'heuristic'
      });
      results.push({
        text: `(item, index) => {\n${indent}  return item;\n${indent}})`,
        source: 'heuristic'
      });
      return results;
    }

    // Case 6: Matching symbol invocation if line ends with a known function
    const lastWord = trimmedLine.split(/[^A-Za-z0-9_$]/).filter(Boolean).pop();
    if (lastWord) {
      const matching = symbols.filter((s) => s.name.startsWith(lastWord) && s.name !== lastWord);
      for (const m of matching.slice(0, 3)) {
        const remaining = m.name.slice(lastWord.length);
        results.push({
          text: `${remaining}()`,
          source: 'heuristic'
        });
      }
    }

    // Default multi-line completion fallback based on language
    if (results.length === 0) {
      if (lang.includes('python')) {
        results.push({
          text: `\n${indent}    pass`,
          source: 'heuristic'
        });
      } else {
        results.push({
          text: `;\n${indent}`,
          source: 'heuristic'
        });
      }
    }

    return results;
  }
}
