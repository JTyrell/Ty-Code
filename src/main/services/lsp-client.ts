/**
 * Ty-Claude Language Server Protocol (LSP) Client
 * Handles JSON-RPC 2.0 stdio transport framing, message dispatch,
 * request-response matching, document sync, and language intelligence queries.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import path from 'path';

export interface LspPosition {
  line: number; // 0-based
  character: number; // 0-based
}

export interface LspRange {
  start: LspPosition;
  end: LspPosition;
}

export interface LspLocation {
  uri: string;
  range: LspRange;
}

export interface LspDiagnostic {
  range: LspRange;
  severity?: 1 | 2 | 3 | 4; // 1: Error, 2: Warning, 3: Info, 4: Hint
  code?: number | string;
  source?: string;
  message: string;
}

export interface LspCompletionItem {
  label: string;
  kind?: number;
  detail?: string;
  documentation?: string | { kind: string; value: string };
  insertText?: string;
  insertTextFormat?: number;
  sortText?: string;
  filterText?: string;
}

export interface LspHover {
  contents: string | { language: string; value: string } | Array<string | { language: string; value: string }>;
  range?: LspRange;
}

export interface LspDocumentSymbol {
  name: string;
  detail?: string;
  kind: number;
  range: LspRange;
  selectionRange: LspRange;
  children?: LspDocumentSymbol[];
}

export interface LspTextEdit {
  range: LspRange;
  newText: string;
}

export interface LspWorkspaceEdit {
  changes?: Record<string, LspTextEdit[]>;
  documentChanges?: Array<{
    textDocument: { uri: string; version?: number };
    edits: LspTextEdit[];
  }>;
}

export interface LspClientOptions {
  command: string;
  args?: string[];
  workspacePath: string;
  languageId: string;
  env?: NodeJS.ProcessEnv;
  initializationOptions?: Record<string, unknown>;
}

export interface PendingRequest {
  id: number | string;
  method: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  timer: NodeJS.Timeout;
}

export class LspClient extends EventEmitter {
  public readonly languageId: string;
  public readonly command: string;
  public readonly args: string[];
  public readonly workspacePath: string;

  private process: ChildProcess | null = null;
  private requestId = 0;
  private pendingRequests = new Map<number | string, PendingRequest>();
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private isShuttingDown = false;
  private isInitialized = false;
  public serverCapabilities: Record<string, unknown> = {};

  constructor(options: LspClientOptions) {
    super();
    this.languageId = options.languageId;
    this.command = options.command;
    this.args = options.args || [];
    this.workspacePath = options.workspacePath;
  }

  public get isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }

  public get initialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Static helper to format an LSP JSON-RPC message into Content-Length framed string
   */
  public static formatFrame(payload: unknown): string {
    const json = JSON.stringify(payload);
    const byteLength = Buffer.byteLength(json, 'utf-8');
    return `Content-Length: ${byteLength}\r\n\r\n${json}`;
  }

  /**
   * Static helper to parse framed chunks into array of JSON messages
   */
  public static parseFrames(input: Buffer | string): { messages: any[]; remaining: Buffer } {
    let buf = typeof input === 'string' ? Buffer.from(input, 'utf-8') : input;
    const messages: any[] = [];

    while (buf.length > 0) {
      // Find separator \r\n\r\n or \n\n
      let headerEnd = buf.indexOf('\r\n\r\n');
      let headerLen = 4;
      if (headerEnd === -1) {
        headerEnd = buf.indexOf('\n\n');
        headerLen = 2;
      }
      if (headerEnd === -1) {
        break; // Wait for more data
      }

      const headerText = buf.subarray(0, headerEnd).toString('utf-8');
      const match = headerText.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Corrupt or unrecognized header, skip to headerEnd
        buf = buf.subarray(headerEnd + headerLen);
        continue;
      }

      const contentLength = parseInt(match[1], 10);
      const bodyStart = headerEnd + headerLen;
      const totalLength = bodyStart + contentLength;

      if (buf.length < totalLength) {
        break; // Message body not fully received yet
      }

      const bodyBytes = buf.subarray(bodyStart, totalLength);
      buf = buf.subarray(totalLength);

      try {
        const parsed = JSON.parse(bodyBytes.toString('utf-8'));
        messages.push(parsed);
      } catch (err) {
        // Failed to parse JSON, ignore corrupt packet
      }
    }

    return { messages, remaining: buf };
  }

  /**
   * Spawns the language server subprocess and completes initialize handshake
   */
  public async start(): Promise<Record<string, unknown>> {
    if (this.isRunning) {
      return this.serverCapabilities;
    }

    this.isShuttingDown = false;
    this.buffer = Buffer.alloc(0);

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      try {
        this.process = spawn(this.command, this.args, {
          cwd: this.workspacePath,
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env }
        });

        this.process.stdout?.on('data', (chunk: Buffer) => {
          this.handleIncomingData(chunk);
        });

        this.process.stderr?.on('data', (chunk: Buffer) => {
          this.emit('server-error-log', chunk.toString('utf-8'));
        });

        this.process.on('error', (err) => {
          this.emit('error', err);
          if (!this.isInitialized) {
            reject(err);
          }
        });

        this.process.on('exit', (code, signal) => {
          this.emit('exit', { code, signal });
          this.cleanupPendingRequests(`Language server exited with code ${code}`);
          this.process = null;
          this.isInitialized = false;
        });

        // Send initialize request
        const rootUri = `file://${this.workspacePath.replace(/\\/g, '/')}`;
        const initParams = {
          processId: process.pid,
          clientInfo: { name: 'Ty-Claude', version: '0.1.0' },
          rootPath: this.workspacePath,
          rootUri,
          capabilities: {
            workspace: {
              applyEdit: true,
              workspaceEdit: { documentChanges: true },
              symbol: { dynamicRegistration: true }
            },
            textDocument: {
              synchronization: {
                dynamicRegistration: true,
                willSave: false,
                willSaveWaitUntil: false,
                didSave: true
              },
              completion: {
                dynamicRegistration: true,
                completionItem: {
                  snippetSupport: true,
                  commitCharactersSupport: true,
                  documentationFormat: ['markdown', 'plaintext'],
                  deprecatedSupport: true,
                  preselectSupport: true
                }
              },
              hover: {
                dynamicRegistration: true,
                contentFormat: ['markdown', 'plaintext']
              },
              definition: { dynamicRegistration: true, linkSupport: true },
              typeDefinition: { dynamicRegistration: true, linkSupport: true },
              implementation: { dynamicRegistration: true, linkSupport: true },
              references: { dynamicRegistration: true },
              documentSymbol: {
                dynamicRegistration: true,
                hierarchicalDocumentSymbolSupport: true
              },
              rename: { dynamicRegistration: true, prepareSupport: true }
            }
          },
          initializationOptions: {}
        };

        this.sendRequest<any>('initialize', initParams, 12000)
          .then((result) => {
            this.serverCapabilities = result?.capabilities || {};
            this.sendNotification('initialized', {});
            this.isInitialized = true;
            this.emit('initialized', this.serverCapabilities);
            resolve(this.serverCapabilities);
          })
          .catch((err) => {
            this.stop().catch(() => {});
            reject(err);
          });
      } catch (err) {
        reject(err);
      }
    });
  }

  /**
   * Shuts down the language server cleanly
   */
  public async stop(): Promise<void> {
    if (!this.isRunning || this.isShuttingDown) {
      return;
    }
    this.isShuttingDown = true;

    try {
      await this.sendRequest('shutdown', undefined, 3000);
      this.sendNotification('exit');
    } catch {
      // Ignore shutdown errors
    } finally {
      if (this.process) {
        try {
          this.process.kill();
        } catch {
          // Ignore
        }
        this.process = null;
      }
      this.isInitialized = false;
      this.cleanupPendingRequests('LSP Client stopped');
    }
  }

  /**
   * Sends a JSON-RPC 2.0 request and returns a Promise for the response
   */
  public sendRequest<T = any>(method: string, params?: unknown, timeoutMs = 15000): Promise<T> {
    const id = ++this.requestId;
    const msg = {
      jsonrpc: '2.0',
      id,
      method,
      params: params ?? {}
    };

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error(`LSP Request '${method}' timed out after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      this.pendingRequests.set(id, { id, method, resolve, reject, timer });
      this.writeMessage(msg);
    });
  }

  /**
   * Sends a JSON-RPC 2.0 notification without expecting a response
   */
  public sendNotification(method: string, params?: unknown): void {
    const msg = {
      jsonrpc: '2.0',
      method,
      params: params ?? {}
    };
    this.writeMessage(msg);
  }

  private writeMessage(msg: unknown): void {
    const frame = LspClient.formatFrame(msg);
    if (this.process?.stdin && !this.process.stdin.destroyed) {
      this.process.stdin.write(frame, 'utf-8');
    }
  }

  private handleIncomingData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const { messages, remaining } = LspClient.parseFrames(this.buffer);
    this.buffer = remaining;

    for (const msg of messages) {
      this.dispatchMessage(msg);
    }
  }

  /**
   * Public hook for testing frame processing without subprocesses
   */
  public dispatchMessage(msg: any): void {
    // Response to a request (has id)
    if (msg && msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pendingRequests.get(msg.id);
      if (pending) {
        clearTimeout(pending.timer);
        this.pendingRequests.delete(msg.id);
        if (msg.error) {
          pending.reject(new Error(msg.error.message || `LSP Error ${msg.error.code}`));
        } else {
          pending.resolve(msg.result);
        }
      }
      return;
    }

    // Server request (has id and method)
    if (msg && msg.id !== undefined && msg.method) {
      // Respond with null to server requests like workspace/configuration or client/registerCapability
      const response = {
        jsonrpc: '2.0',
        id: msg.id,
        result: null
      };
      this.writeMessage(response);
      return;
    }

    // Notification (has method, no id)
    if (msg && msg.method) {
      this.emit('notification', msg.method, msg.params);

      if (msg.method === 'textDocument/publishDiagnostics') {
        this.emit('diagnostics', msg.params);
      } else if (msg.method === 'window/showMessage') {
        this.emit('message', msg.params);
      } else if (msg.method === 'window/logMessage') {
        this.emit('log', msg.params);
      }
    }
  }

  private cleanupPendingRequests(reason: string): void {
    for (const [, req] of this.pendingRequests) {
      clearTimeout(req.timer);
      req.reject(new Error(reason));
    }
    this.pendingRequests.clear();
  }

  // --- Document Synchronization Protocol ---

  public didOpen(uri: string, languageId: string, version: number, text: string): void {
    this.sendNotification('textDocument/didOpen', {
      textDocument: {
        uri: this.ensureUri(uri),
        languageId,
        version,
        text
      }
    });
  }

  public didChange(uri: string, version: number, text: string): void {
    this.sendNotification('textDocument/didChange', {
      textDocument: {
        uri: this.ensureUri(uri),
        version
      },
      contentChanges: [{ text }]
    });
  }

  public didSave(uri: string, text?: string): void {
    this.sendNotification('textDocument/didSave', {
      textDocument: { uri: this.ensureUri(uri) },
      text
    });
  }

  public didClose(uri: string): void {
    this.sendNotification('textDocument/didClose', {
      textDocument: { uri: this.ensureUri(uri) }
    });
  }

  // --- Language Features ---

  public async completion(uri: string, position: LspPosition): Promise<any> {
    return this.sendRequest('textDocument/completion', {
      textDocument: { uri: this.ensureUri(uri) },
      position
    });
  }

  public async hover(uri: string, position: LspPosition): Promise<LspHover | null> {
    return this.sendRequest('textDocument/hover', {
      textDocument: { uri: this.ensureUri(uri) },
      position
    });
  }

  public async definition(uri: string, position: LspPosition): Promise<any> {
    return this.sendRequest('textDocument/definition', {
      textDocument: { uri: this.ensureUri(uri) },
      position
    });
  }

  public async typeDefinition(uri: string, position: LspPosition): Promise<any> {
    return this.sendRequest('textDocument/typeDefinition', {
      textDocument: { uri: this.ensureUri(uri) },
      position
    });
  }

  public async implementation(uri: string, position: LspPosition): Promise<any> {
    return this.sendRequest('textDocument/implementation', {
      textDocument: { uri: this.ensureUri(uri) },
      position
    });
  }

  public async references(uri: string, position: LspPosition, includeDeclaration = true): Promise<LspLocation[] | null> {
    return this.sendRequest('textDocument/references', {
      textDocument: { uri: this.ensureUri(uri) },
      position,
      context: { includeDeclaration }
    });
  }

  public async rename(uri: string, position: LspPosition, newName: string): Promise<LspWorkspaceEdit | null> {
    return this.sendRequest('textDocument/rename', {
      textDocument: { uri: this.ensureUri(uri) },
      position,
      newName
    });
  }

  public async documentSymbol(uri: string): Promise<LspDocumentSymbol[] | any[] | null> {
    return this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri: this.ensureUri(uri) }
    });
  }

  public async workspaceSymbol(query: string): Promise<any[] | null> {
    return this.sendRequest('workspace/symbol', { query });
  }

  public async codeAction(uri: string, range: LspRange, context?: any): Promise<any[] | null> {
    return this.sendRequest('textDocument/codeAction', {
      textDocument: { uri: this.ensureUri(uri) },
      range,
      context: context || { diagnostics: [] }
    });
  }

  public async signatureHelp(uri: string, position: LspPosition): Promise<any> {
    return this.sendRequest('textDocument/signatureHelp', {
      textDocument: { uri: this.ensureUri(uri) },
      position
    });
  }

  public ensureUri(filePathOrUri: string): string {
    if (filePathOrUri.startsWith('file://')) {
      return filePathOrUri;
    }
    const normalized = filePathOrUri.replace(/\\/g, '/');
    return normalized.startsWith('/') ? `file://${normalized}` : `file:///${normalized}`;
  }
}
