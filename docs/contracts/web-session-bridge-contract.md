# Web-IDE SessionBridge Implementation Contract

**Status**: Interface Specification & Architectural Contract  
**Phase**: FCC-5  
**Scope**: Contract definition for the future Cloudflare-hosted Web Editor (Zero web code shipped in this phase)  
**Brand**: Ty-Code

---

## 1. Executive Summary

Ty-Code defines the **SessionBridge** seam to allow identical agent capabilities (multi-model failover, RTK/Headroom token optimization, tool execution, and session resumption) to run seamlessly in both:
1. **Local Desktop IDE** (Electron runtime via `LocalSessionBridge`).
2. **Cloudflare-Hosted Web-IDE** (Cloudflare Workers + Durable Objects runtime via `CloudflareSessionBridge`).

This document details the interface contract, wire protocol, state synchronization, authentication, and reconnection guarantees required by the future web-editor implementation.

---

## 2. Core SessionBridge Interface

The canonical TypeScript interface defined in `src/main/services/session/session-bridge.ts`:

```typescript
export interface SessionBridge {
  start(options: SessionBridgeOptions): Promise<SessionBridgeInfo>;
  attach(sessionId: string, onChunk: (chunk: SessionStreamChunk) => void): Promise<() => void>;
  stream(sessionId: string, prompt: string, options?: SessionStreamOptions): AsyncIterable<SessionStreamChunk>;
  pause(sessionId: string): Promise<boolean>;
  resume(sessionId: string): Promise<boolean>;
  dispose(sessionId: string): Promise<boolean>;
  getSession(sessionId: string): SessionBridgeInfo | undefined;
  listSessions(): SessionBridgeInfo[];
}
```

### Key Semantics:
- **`start(options)`**: Initializes or joins an isolated workspace session. Returns current session metadata.
- **`attach(sessionId, onChunk)`**: Attaches a subscriber to receive real-time streaming chunks. Multiple clients (e.g. desktop + web browser) can attach to the same session simultaneously (session multiplexing).
- **`stream(sessionId, prompt, options)`**: Initiates an AI turn. Emits chunks (`token`, `thought`, `tool_call`, `tool_result`, `notice`, `done`) asynchronously.
- **`pause(sessionId)` / `resume(sessionId)`**: Pauses and resumes in-flight token streaming and tool loop execution.
- **`dispose(sessionId)`**: Flushes session state, disconnects subscribers, and reclaims memory.

---

## 3. Cloudflare-Hosted Web-IDE Architecture

In the hosted cloud deployment, each active workspace session is managed by a **Cloudflare Durable Object** providing strong consistency, low-latency edge coordination, and automatic hibernation.

```mermaid
graph TD
    BrowserClient["Web Browser Client (Web-IDE)"] <-->|WSS (WebSocket) / SSE| CFWorker["Cloudflare Worker Router"]
    CFWorker <-->|RPC| SessionDO["Durable Object (SessionBridge Instance)"]
    SessionDO <-->|State Persistence| CFKV["Workers KV / R2 Workspace Cache"]
    SessionDO <-->|FCC Local Supply Proxy| TyCodeFleet["Ty-Code Model Fleet (FCC Catalog)"]
```

### Components:
1. **Cloudflare Worker (Router)**:
   - Terminates TLS at edge.
   - Validates ephemeral HMAC authentication tokens (`cf_session_<token>`).
   - Routes WebSocket upgrades directly to the designated Durable Object ID based on `workspaceId:sessionId`.
2. **Durable Object (`WorkspaceSessionDO`)**:
   - Implements `SessionBridge` in edge V8 runtime.
   - Manages connected WebSocket clients (`attach`).
   - Maintains conversation history, RTK token compression state, and Headroom context pruning cache.
   - Survives browser page refreshes and network drops.
3. **Workers KV / Cloudflare R2**:
   - Persists session snapshots, audit logs, and file tree checkpoints.

---

## 4. Wire Protocol Specification

Communication between the web client and the edge worker occurs over bidirectional **WebSocket (`wss://`)**, with fallback to **Server-Sent Events (`GET /api/session/:id/stream`)** for restricted network environments.

### 4.1 Client-to-Server Messages

All messages are JSON objects containing `type`, `sessionId`, and payload:

#### A. Initialize / Attach to Session
```json
{
  "type": "ATTACH_SESSION",
  "sessionId": "sess_89437a8b",
  "lastChunkIndex": 42
}
```

#### B. Send User Prompt
```json
{
  "type": "SEND_PROMPT",
  "sessionId": "sess_89437a8b",
  "prompt": "Refactor auth-service to use safeStorage.",
  "options": {
    "model": "auto",
    "temperature": 0.2
  }
}
```

#### C. Pause / Resume / Cancel Stream
```json
{
  "type": "PAUSE_STREAM",
  "sessionId": "sess_89437a8b"
}
```

---

### 4.2 Server-to-Client Messages (Stream Chunks)

The server emits `SessionStreamChunk` payloads with monotonically increasing `chunkIndex`:

#### A. Content Token Chunk
```json
{
  "type": "token",
  "sessionId": "sess_89437a8b",
  "chunkIndex": 43,
  "content": "import { safeStorage } from 'electron';",
  "timestamp": 1792205500000
}
```

#### B. Failover / System Notice
```json
{
  "type": "notice",
  "sessionId": "sess_89437a8b",
  "chunkIndex": 44,
  "metadata": {
    "notice": "provider throttled, continued with gemini-2.5-flash"
  },
  "timestamp": 1792205501000
}
```

#### C. Turn Completion
```json
{
  "type": "done",
  "sessionId": "sess_89437a8b",
  "chunkIndex": 45,
  "metadata": {
    "tokensStreamed": 84,
    "turn": 1
  },
  "timestamp": 1792205502000
}
```

---

## 5. Reconnection & State Hydration Contract

To ensure network drops or closing a browser tab does not terminate background agent runs:

1. **Monotonic Chunk Indexing**: Every chunk emitted by `SessionBridge` carries a strictly sequential integer `chunkIndex`.
2. **Ring Buffer Replay**: The Durable Object maintains a 256-chunk circular ring buffer in memory.
3. **Reconnection Handshake (`RECONNECT` protocol)**:
   - Client sends: `RECONNECT { sessionId, lastChunkIndex: 35 }` or `ATTACH_SESSION`.
   - Durable Object immediately replays chunks `36` through `currentChunkIndex` before streaming live tokens.
   - If `lastChunkIndex` is older than the ring buffer, the server sends a full state hydration snapshot (`HYDRATE_SESSION`).

---

## 6. Security & Ephemeral Token Model

- **Session Tokens**: Generated via HMAC-SHA256 with 24-hour expiration (`cf_session_<randomHex>.<timestamp>.<signature>`).
- **Authorization**: Scoped strictly to the specific `workspaceId` and `sessionId`.
- **Zero Raw API Key Leakage**: Upstream model keys (OpenRouter, Google, Groq) are never exposed to the browser client; all requests are authenticated via the edge proxy.

---

## 7. Compliance Checklist for Web-IDE Implementation

When implementing the future Cloudflare Workers hosted editor, the implementation must satisfy:
- [x] Implements all methods of `SessionBridge` interface verbatim.
- [x] Conforms to JSON message schema defined in Section 4.
- [x] Guarantees ring buffer replay for disconnected clients.
- [x] Preserves RTK compression and Headroom pruning parity with Desktop IDE.
- [x] Emits verbatim failover notice `"provider throttled, continued with <model>"`.
