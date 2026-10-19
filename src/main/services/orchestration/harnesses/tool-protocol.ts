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
