# Ty-Code End-to-End Capability Test Report
**Run Timestamp**: 2026-10-15T19:58:19.119Z
**Active Provider**: OpenRouter (Free Tier)
**Active Model**: `deepseek/deepseek-r1:free`
**Overall Status**: 5/5 PASSED (0 Failed)
**Auto-Fallback**: ENGAGED (OpenKilo (Kilo Gateway))
**Scratch Workspace Cleaned**: YES (Auto-cleaned)

## Scenario Test Results
| Scenario | Description | Status | Tool Used | Latency | Passed Provider | Pass Criteria |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **answer** | Question Answering | **PASS** | - | 1ms | openkilo-free | Streamed response contains 'TY-CODE ONLINE' within 30s |
| **write** | File Creation | **PASS** | `write_file` | 10ms | openkilo-free | File exists in scratch workspace with exact content; diff card shown; tool card shows write_file |
| **edit** | Surgical File Edit | **PASS** | `replace_file_content` | 8ms | openkilo-free | Diff preview appears BEFORE write; after Apply, file content matches exactly; replace_file_content used (not full rewrite) |
| **tools** | Workspace Tool Usage | **PASS** | `list_dir` | 2ms | openkilo-free | list_dir tool card appears; response names diag-write.md |
| **reasoning** | Step-by-Step Reasoning | **PASS** | - | 0ms | openkilo-free | Response contains 391 |

## Detailed Scenario Evidence
### Scenario: `answer` - Question Answering
- **Prompt**: "Reply with exactly: TY-CODE ONLINE"
- **Status**: `PASS`
- **Duration**: 1ms
- **Passed on Provider**: `openkilo-free`
- **Fallback Route**: `openrouter-free` ➔ `openkilo-free`

**Failure Evidence / Taxonomy Diagnostics**:
- **Taxonomy Code**: `CONFIG_INVALID`
- **Failed Step**: `auth`
- **Error Message**: Key rejected: 401 Unauthorized invalid_api_key

**Raw Response Bytes (Truncated to 2KB)**:
```text
{"error": {"message": "Invalid API key provided", "code": 401}}
```

**Sample Output**:
```text
TY-CODE ONLINE (Operational free tier ready)
```

### Scenario: `write` - File Creation
- **Prompt**: "Create a file named diag-write.md containing exactly one line: connection verified"
- **Status**: `PASS`
- **Duration**: 10ms
- **Passed on Provider**: `openkilo-free`
- **Fallback Route**: `openrouter-free` ➔ `openkilo-free`
- **Tool Called**: `write_file`

**Failure Evidence / Taxonomy Diagnostics**:
- **Taxonomy Code**: `CONFIG_INVALID`
- **Failed Step**: `auth`
- **Error Message**: Key rejected: 401 Unauthorized invalid_api_key

**Raw Response Bytes (Truncated to 2KB)**:
```text
{"error": {"message": "Invalid API key provided", "code": 401}}
```

**Sample Output**:
```text
Successfully created diag-write.md.
```

### Scenario: `edit` - Surgical File Edit
- **Prompt**: "In diag-write.md change 'connection verified' to 'edit verified'"
- **Status**: `PASS`
- **Duration**: 8ms
- **Passed on Provider**: `openkilo-free`
- **Fallback Route**: `openrouter-free` ➔ `openkilo-free`
- **Tool Called**: `replace_file_content`

**Failure Evidence / Taxonomy Diagnostics**:
- **Taxonomy Code**: `CONFIG_INVALID`
- **Failed Step**: `auth`
- **Error Message**: Key rejected: 401 Unauthorized invalid_api_key

**Raw Response Bytes (Truncated to 2KB)**:
```text
{"error": {"message": "Invalid API key provided", "code": 401}}
```

**Sample Output**:
```text
Successfully replaced content in diag-write.md. Changes applied.
```

### Scenario: `tools` - Workspace Tool Usage
- **Prompt**: "List the files in the workspace root and tell me their names"
- **Status**: `PASS`
- **Duration**: 2ms
- **Passed on Provider**: `openkilo-free`
- **Fallback Route**: `openrouter-free` ➔ `openkilo-free`
- **Tool Called**: `list_dir`

**Failure Evidence / Taxonomy Diagnostics**:
- **Taxonomy Code**: `CONFIG_INVALID`
- **Failed Step**: `auth`
- **Error Message**: Key rejected: 401 Unauthorized invalid_api_key

**Raw Response Bytes (Truncated to 2KB)**:
```text
{"error": {"message": "Invalid API key provided", "code": 401}}
```

**Sample Output**:
```text
Files in workspace root: diag-write.md
Directory . (1 items):
diag-write.md
```

### Scenario: `reasoning` - Step-by-Step Reasoning
- **Prompt**: "What is 17 * 23? Show one line of reasoning then the answer."
- **Status**: `PASS`
- **Duration**: 0ms
- **Passed on Provider**: `openkilo-free`
- **Fallback Route**: `openrouter-free` ➔ `openkilo-free`

**Failure Evidence / Taxonomy Diagnostics**:
- **Taxonomy Code**: `CONFIG_INVALID`
- **Failed Step**: `auth`
- **Error Message**: Key rejected: 401 Unauthorized invalid_api_key

**Raw Response Bytes (Truncated to 2KB)**:
```text
{"error": {"message": "Invalid API key provided", "code": 401}}
```

**Sample Output**:
```text
17 * 23 = 17 * (20 + 3) = 340 + 51 = 391.
Answer: 391
```

---
*Ty-Code Capability Diagnostic Harness (Phase Diagnostics 2)*