/**
 * Universal textual tool protocol.
 *
 * Injectable into EVERY harness system prompt so models without native
 * function calling (anonymous free pools, OpenCode Zen, older gateways) can
 * still drive the executor. parseResponse implementations parse the exact
 * `<tool_call>` block emitted here.
 */

export const TEXTUAL_TOOL_PROTOCOL = `TEXTUAL TOOL CALLING PROTOCOL (mandatory for tool use):

To use a tool, if structured function calling is available to you, prefer it. Otherwise emit exactly this block:

<tool_call>
<name>tool_name</name>
<arguments>{"key": "value"}</arguments>
</tool_call>

Rules:
- "arguments" MUST be a single-line JSON object. No comments, no trailing commas, no markdown fences inside <arguments>.
- You may emit MULTIPLE <tool_call> blocks in one reply to chain steps (they run in order).
- Emit a tool call, then STOP. Wait for the tool result before the next step. Do NOT fabricate tool results.
- When the whole task is complete, reply with plain prose only (NO <tool_call> block).

Allowed tools (exact names only):

- read_file: Read a file or a line range from the workspace.
  arguments: {"filePath": "<workspace-relative path>", "startLine": <optional int>, "endLine": <optional int>}
- list_dir: List directory entries.
  arguments: {"dirPath": "<workspace-relative dir>", "maxEntries": <optional int>}
- grep_search: Search file contents with a regex.
  arguments: {"pattern": "<regex>", "include": "<optional glob e.g. *.ts>", "maxResults": <optional int>}
- write_file: Create or fully overwrite a file.
  arguments: {"filePath": "<path>", "content": "<full file content>"}
- replace_file_content: Surgical patch of an existing file.
  arguments: {"filePath": "<path>", "searchText": "<exact text to find>", "replaceText": "<replacement>"}
- run_command: Run a shell command in the workspace (readonly git commands need no approval).
  arguments: {"command": "<shell command>", "cwd": "<optional subdirectory>"}
- git_status / git_diff / git_log: inspect repository state.
  arguments: {}
- git_commit: Create a commit.
  arguments: {"message": "<commit message>", "stageAll": <optional bool>, "filePaths": ["<optional paths>"]}
- git_branch: Branch operations.
  arguments: {"action": "<create|switch|list|delete>", "name": "<branch name>", "fromBranch": "<optional base>"}
- git_merge: Merge a branch.
  arguments: {"branch": "<branch to merge>", "branchType": "<optional local|remote>"}
- generate_presentation: Generate a presentation deck draft.
  arguments: {"topic": "<topic>", "slideCount": <int>, "notes": "<optional guidance>"}

Never invent tool results. Never claim a file was edited unless a write_file or replace_file_content tool result confirmed it.`;

export interface ParsedTextualToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

const TOOL_NAME_ALIASES: Record<string, string> = {
  list_directory: 'list_dir',
  list_files: 'list_dir',
  ls: 'list_dir',
  dir: 'list_dir',
  read: 'read_file',
  view: 'read_file',
  cat: 'read_file',
  open_file: 'read_file',
  write: 'write_file',
  create_file: 'write_file',
  edit: 'replace_file_content',
  edit_file: 'replace_file_content',
  replace: 'replace_file_content',
  patch: 'replace_file_content',
  bash: 'run_command',
  shell: 'run_command',
  exec: 'run_command',
  execute_command: 'run_command',
  terminal: 'run_command',
  grep: 'grep_search',
  search: 'grep_search',
  find_in_files: 'grep_search'
};

export function normalizeToolCallAlias(
  rawName: string,
  rawArgs: Record<string, unknown>
): { name: string; arguments: Record<string, unknown> } {
  const cleanedName = rawName.trim().replace(/^["'<]+|["'>]+$/g, '');
  const canonicalName = TOOL_NAME_ALIASES[cleanedName.toLowerCase()] || cleanedName;
  const args: Record<string, unknown> = { ...rawArgs };

  if (canonicalName === 'list_dir') {
    if (args.dirPath === undefined) {
      const candidate = args.path ?? args.directory ?? args.dir ?? args.folder ?? args.target;
      if (candidate !== undefined) {
        args.dirPath = candidate;
      }
    }
  } else if (canonicalName === 'read_file' || canonicalName === 'write_file' || canonicalName === 'replace_file_content') {
    if (args.filePath === undefined) {
      const candidate = args.path ?? args.file ?? args.filename ?? args.target;
      if (candidate !== undefined) {
        args.filePath = candidate;
      }
    }
    if (canonicalName === 'replace_file_content') {
      // Canonical executor fields are targetContent / replacementContent. Fold
      // every documented alias — including the catalog's searchText/replaceText
      // and the common old_str/new_str family — onto the canonical names so the
      // patch is never silently dropped by an argument-name mismatch (Stage 1c).
      if (args.targetContent === undefined) {
        const searchCandidate = args.searchText ?? args.old_str ?? args.oldString ?? args.oldContent ?? args.search;
        if (searchCandidate !== undefined) args.targetContent = searchCandidate;
      }
      if (args.replacementContent === undefined) {
        const replaceCandidate = args.replaceText ?? args.new_str ?? args.newString ?? args.newContent ?? args.replace;
        if (replaceCandidate !== undefined) args.replacementContent = replaceCandidate;
      }
    }
  } else if (canonicalName === 'run_command') {
    if (args.command === undefined) {
      const candidate = args.cmd ?? args.script ?? args.shell;
      if (candidate !== undefined) {
        args.command = candidate;
      }
    }
  } else if (canonicalName === 'grep_search') {
    if (args.pattern === undefined) {
      const candidate = args.query ?? args.regex ?? args.search;
      if (candidate !== undefined) {
        args.pattern = candidate;
      }
    }
  }

  return { name: canonicalName, arguments: args };
}

function makeCallId(): string {
  return `call_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function parseInvokeParameters(body: string): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  const trimmed = body.trim();
  if (!trimmed) return args;

  // Try direct JSON first
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      return JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      // Continue to XML / line parameter extraction
    }
  }

  // Standard <parameter name="key">value</parameter> or <arg name="key">value</arg>
  const paramXmlRegex = /<(?:parameter|arg|param)\s+(?:name|key)\s*[=<]\s*["']?([^"'>\s]+)["'>]?\s*>([\s\S]*?)<\/(?:parameter|arg|param)>/gi;
  let match: RegExpExecArray | null;
  while ((match = paramXmlRegex.exec(trimmed)) !== null) {
    const key = match[1].trim();
    const val = match[2].trim();
    args[key] = val;
  }
  if (Object.keys(args).length > 0) {
    return args;
  }

  // Malformed XML/key-value lines emitted by free models (e.g. `path>C:\Users\...` or `<parameter name<path>value` or `path: value`)
  const lines = trimmed
    .replace(/<\/?(?:invoke|parameter|param|arg|function_call|dots_function_call)[^>]*>/gi, '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  for (const line of lines) {
    const angleMatch = line.match(/^(?:<(?:parameter|param|arg)\s+name[=<])?([a-zA-Z_][\w-]*)\s*[>:=]\s*(.+)$/);
    if (angleMatch) {
      const key = angleMatch[1].trim();
      const val = angleMatch[2].replace(/<\/(?:parameter|param|arg)>$/i, '').trim().replace(/^["']|["']$/g, '');
      if (key && val) {
        args[key] = val;
      }
    }
  }

  return args;
}

/**
 * Strips all known raw XML / model-specific textual tool call blocks from prose
 * so they never leak into the user-facing chat transcript.
 */
export function stripTextualToolMarkup(rawText: string): string {
  if (!rawText) return '';
  return rawText
    .replace(/```(?:xml|json|tool_call)?\s*<(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)\b[\s\S]*?<\/(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)>\s*```/gi, '')
    .replace(/<(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)\b[^>]*>[\s\S]*?<\/(?:tool_call|dots_function_call|function_calls|function_call|antml:function_calls)>/gi, '')
    .replace(/<invoke\b[^>]*>[\s\S]*?<\/invoke>/gi, '')
    // Strip unclosed / trailing tool call blocks at the end of a stream
    .replace(/<(?:tool_call|dots_function_call|function_calls|antml:function_calls)\b[\s\S]*$/gi, '')
    .replace(/<｜tool▁calls▁begin｜>[\s\S]*?(?:<｜tool▁calls▁end｜>|$)/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Universal parser for textual tool calls across all harnesses and model families
 * (standard `<tool_call>`, Anthropic/Dots `<dots_function_call>` / `<function_calls>` / `<invoke>`,
 * JSON `<tool_call>{...}</tool_call>`, and DeepSeek tool tags).
 */
export function parseTextualToolCalls<T extends ParsedTextualToolCall>(
  fullText: string,
  existingCalls: T[] = []
): { text: string; toolCalls: T[] } {
  const finalCalls: T[] = [...existingCalls];
  if (!fullText) {
    return { text: '', toolCalls: finalCalls };
  }

  const pushNormalizedCall = (rawName: string, rawArgs: Record<string, unknown>): void => {
    if (!rawName || !rawName.trim()) return;
    const normalized = normalizeToolCallAlias(rawName, rawArgs);
    finalCalls.push({
      id: makeCallId(),
      name: normalized.name,
      arguments: normalized.arguments
    } as T);
  };

  // 1. Standard <tool_call><name>...</name><arguments>...</arguments></tool_call>
  const xmlRegex = /<tool_call>\s*<name>([\s\S]+?)<\/name>\s*<arguments>([\s\S]*?)<\/arguments>\s*<\/tool_call>/gi;
  let match: RegExpExecArray | null;
  while ((match = xmlRegex.exec(fullText)) !== null) {
    try {
      const name = match[1].trim();
      const rawArgStr = match[2].trim();
      const args = rawArgStr ? (JSON.parse(rawArgStr) as Record<string, unknown>) : {};
      pushNormalizedCall(name, args);
    } catch {
      // Skip malformed JSON inside <arguments>
    }
  }

  // 2. JSON-style <tool_call>{"name": "...", "arguments": {...}}</tool_call>
  const jsonToolCallRegex = /<tool_call>\s*(\{[\s\S]*?\})\s*<\/tool_call>/gi;
  while ((match = jsonToolCallRegex.exec(fullText)) !== null) {
    try {
      const parsed = JSON.parse(match[1].trim()) as { name?: string; tool?: string; arguments?: Record<string, unknown>; parameters?: Record<string, unknown> };
      const name = parsed.name || parsed.tool;
      const args = parsed.arguments || parsed.parameters || {};
      if (name) {
        pushNormalizedCall(name, typeof args === 'object' && args !== null ? args : {});
      }
    } catch {
      // Skip malformed JSON block
    }
  }

  // 3. <dots_function_call>, <function_calls>, <function_call>, <antml:function_calls> or standalone <invoke>
  // Supports both well-formed `<invoke name="list_directory">` and malformed `<invoke name<list_directory>`
  const invokeRegex = /<invoke\s+name\s*[=<]\s*["']?([a-zA-Z0-9_.-]+)["'>]?\s*>?([\s\S]*?)(?:<\/invoke>|<\/dots_function_call>|<\/function_calls>|<\/function_call>|<\/antml:function_calls>)/gi;
  while ((match = invokeRegex.exec(fullText)) !== null) {
    const rawName = match[1].trim();
    const paramBody = match[2] || '';
    const args = parseInvokeParameters(paramBody);
    pushNormalizedCall(rawName, args);
  }

  const cleanText = stripTextualToolMarkup(fullText);
  return { text: finalCalls.length > 0 ? cleanText : (cleanText || fullText), toolCalls: finalCalls };
}

/**
 * Coerce an Anthropic `<antml:parameter>` value into the most faithful JS type.
 * Free/pooled models emit numbers and booleans as bare text inside antml params,
 * so a numeric-looking value becomes a number and JSON objects/arrays are parsed.
 * Anything ambiguous stays a string — this parser never invents structure.
 */
function coerceAntmlValue(raw: string): unknown {
  const value = raw.trim();
  if (!value) return '';
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if ((value.startsWith('{') && value.endsWith('}')) || (value.startsWith('[') && value.endsWith(']'))) {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return value;
    }
  }
  return value;
}

/**
 * Stage 4a-1: real Claude harness parser for Anthropic's namespaced
 * `<antml:function_calls>` / `<antml:invoke name="...">` /
 * `<antml:parameter name="...">` blocks. The generic textual parser handles the
 * un-namespaced `<invoke>` shape but not `antml:` tags, so this is the
 * harness-specific path. When no antml block is present it falls through to the
 * universal parser rather than guessing.
 */
export function parseClaudeAntmlToolCalls<T extends ParsedTextualToolCall>(
  fullText: string,
  existingCalls: T[] = []
): { text: string; toolCalls: T[] } {
  const finalCalls: T[] = [...existingCalls];
  if (!fullText || !fullText.includes('<antml:')) {
    return parseTextualToolCalls(fullText, existingCalls);
  }

  const blockRegex = /<antml:function_calls>[\s\S]*?<\/antml:function_calls>/gi;
  const invokeRegex = /<antml:invoke\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/antml:invoke>/gi;
  const paramRegex = /<antml:parameter\s+name\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/antml:parameter>/gi;

  let blockMatch: RegExpExecArray | null;
  let matchedAny = false;
  while ((blockMatch = blockRegex.exec(fullText)) !== null) {
    let invoke: RegExpExecArray | null;
    invokeRegex.lastIndex = 0;
    while ((invoke = invokeRegex.exec(blockMatch[0])) !== null) {
      matchedAny = true;
      const rawName = invoke[1];
      const body = invoke[2] || '';
      const args: Record<string, unknown> = {};
      let param: RegExpExecArray | null;
      paramRegex.lastIndex = 0;
      while ((param = paramRegex.exec(body)) !== null) {
        args[param[1].trim()] = coerceAntmlValue(param[2]);
      }
      const normalized = normalizeToolCallAlias(rawName, args);
      finalCalls.push({ id: makeCallId(), name: normalized.name, arguments: normalized.arguments } as T);
    }
  }

  if (!matchedAny) return parseTextualToolCalls(fullText, existingCalls);
  const cleanText = fullText.replace(blockRegex, '').replace(/<antml:[^>]*>[\s\S]*$/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleanText, toolCalls: finalCalls };
}

/**
 * Stage 4a-1: conservative Codex markdown-patch parser. Codex emits an
 * `*** Begin Patch` block using `*** Add File:` / `*** Update File:` / `*** Delete File:`
 * markers. Only `Add File` carries complete, unambiguous new content, so it maps
 * reliably onto `write_file`. `Update`/`Delete` hunks depend on exact on-disk
 * context we cannot validate here, so they are intentionally left in the visible
 * text rather than fabricated into tool calls ("no speculative parsers"). Any
 * standard `<tool_call>` blocks are still parsed via the universal path.
 */
export function parseCodexMarkdownPatch<T extends ParsedTextualToolCall>(
  fullText: string,
  existingCalls: T[] = []
): { text: string; toolCalls: T[] } {
  if (!fullText || !/\*\*\*\s*Begin Patch|\*\*\*\s*Add File:/i.test(fullText)) {
    return parseTextualToolCalls(fullText, existingCalls);
  }

  const generic = parseTextualToolCalls(fullText, existingCalls);
  const finalCalls: T[] = [...generic.toolCalls];

  const lines = fullText.split(/\r?\n/);
  const consumed: boolean[] = new Array(lines.length).fill(false);
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i].match(/^\s*\*\*\*\s*Add File:\s*(.+?)\s*$/i);
    if (!header) continue;
    const filePath = header[1].trim();
    const contentLines: string[] = [];
    consumed[i] = true;
    for (let j = i + 1; j < lines.length; j++) {
      if (/^\s*\*\*\*\s/.test(lines[j])) break; // next patch directive ends this file
      contentLines.push(lines[j].replace(/^\+/, ''));
      consumed[j] = true;
    }
    const normalized = normalizeToolCallAlias('write_file', { filePath, content: contentLines.join('\n') });
    finalCalls.push({ id: makeCallId(), name: normalized.name, arguments: normalized.arguments } as T);
  }

  // Strip only the Add File blocks we converted; Update/Delete hunks remain visible.
  const remaining = lines.filter((_, idx) => !consumed[idx]).join('\n');
  const cleanText = remaining.replace(/\n{3,}/g, '\n\n').trim();
  return { text: cleanText, toolCalls: finalCalls };
}
