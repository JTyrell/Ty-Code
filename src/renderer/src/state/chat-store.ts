import { create } from 'zustand';
import type { AgentMode, AgentSessionSummary, AgentStreamChunk, AgentToolApproval, ChatMessage, ProviderSettings, ProviderType, ToolExecutionRecord, ToolExecutionStatus } from '../../../preload/types';
import {
  AgentStreamTokenPayloadSchema,
  AgentReasoningTokenPayloadSchema,
  AgentToolStartPayloadSchema,
  AgentToolResultPayloadSchema,
  AgentDiffProposedPayloadSchema,
  AgentDonePayloadSchema,
  AgentErrorPayloadSchema,
  type ChatErrorCard
} from '../../../shared/types/agent-events';
import { useGitStore } from './git-store';

interface ChatState {
  messages: ChatMessage[];
  isRunning: boolean;
  currentTaskId: string | null;
  pendingApproval: AgentToolApproval | null;
  currentStatus: string;
  currentThought: string;
  streamingText: string;
  activeErrorCard: ChatErrorCard | null;
  dismissErrorCard: () => void;
  setActiveErrorCard: (card: ChatErrorCard | null) => void;
  settings: ProviderSettings | null;
  agentMode: AgentMode;
  contextTokens: number;
  contextLimit: number;
  isSettingsOpen: boolean;
  isTerminalOpen: boolean;
  draftPrompt: string;
  setDraftPrompt: (prompt: string) => void;
  setAgentMode: (mode: AgentMode) => void;
  setContextTokens: (tokens: number) => void;
  initSettings: () => Promise<void>;
  saveSettings: (updates: Partial<ProviderSettings>) => Promise<boolean>;
  sendMessage: (
    prompt: string,
    workspacePath: string,
    activeFilePath?: string,
    activeFileContent?: string,
    appendUserMessage?: boolean,
    traceOptions?: { traceId?: string; providerOverride?: string; modelOverride?: string },
    images?: string[]
  ) => Promise<void>;
  stopTask: () => Promise<void>;
  respondToApproval: (approved: boolean, feedback?: string) => Promise<void>;
  recentSessions: AgentSessionSummary[];
  pendingResume: AgentSessionSummary | null;
  loadRecentSessions: (workspacePath: string) => Promise<void>;
  acceptSessionResume: (session: AgentSessionSummary) => void;
  dismissSessionResume: () => void;
  clearChat: () => void;
  toggleSettings: () => void;
  openSettings: (tab?: string) => void;
  activeSettingsTab?: string;
  toggleTerminal: () => void;
}

let activeStreamUnsubscribe: (() => void) | null = null;
let activeStreamDisposables: Array<() => void> = [];
let settingsChangedUnsubscribe: (() => void) | null = null;
let sketcherPromptUnsubscribe: (() => void) | null = null;
let canvasSyncUnsubscribe: (() => void) | null = null;
let canvasUpdateUnsubscribe: (() => void) | null = null;
function createId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }

// M3E Canvas overhaul: mirror main-window chat messages into the shared
// canvas conversation history so the dedicated Canvas window's chat rail
// stays perfectly in sync with the main IDE chat sidecar (and vice versa).
function syncMessageToCanvas(message: ChatMessage): void {
  if (!window.electronAPI?.canvasSyncMessage) return;
  if ((message.role !== 'user' && message.role !== 'assistant') || !message.content.trim()) return;
  window.electronAPI
    .canvasSyncMessage({
      message: {
        id: message.id,
        role: message.role as 'user' | 'assistant',
        content: message.content,
        timestamp: message.timestamp,
        origin: 'main'
      }
    })
    .catch(() => {});
}

export const FORBIDDEN_FIXTURE_PATTERNS = [
  /fcc\s+proxy\s+response/i,
  /anonymous\s+provider/i,
  /real\s+streaming\s+tokens\s+verified/i
];

export interface AssistantStreamMetadata {
  source: 'provider-stream';
  providerId: string;
  modelId: string;
  streamEventCount: number;
}

export interface ValidationResult {
  valid: boolean;
  violation?: string;
}

let currentTaskStreamEvents = 0;
let currentTaskProviderId = 'default';
let currentTaskModelId = 'default';

export function validateAssistantMessage(
  message: ChatMessage,
  additionalForbiddenStrings: string[] = []
): ValidationResult {
  if (message.role !== 'assistant') {
    return { valid: true };
  }

  // Error cards are diagnostic error records, not model completions
  if (message.errorCard) {
    return { valid: true };
  }

  // Check 1: Forbidden fixture patterns in text
  const content = message.content || '';
  for (const pattern of FORBIDDEN_FIXTURE_PATTERNS) {
    if (pattern.test(content)) {
      return {
        valid: false,
        violation: `RENDER_SOURCE_VIOLATION: Message matches prohibited fixture pattern ${pattern}`
      };
    }
  }

  for (const forbidden of additionalForbiddenStrings) {
    if (content.toLowerCase().includes(forbidden.toLowerCase())) {
      return {
        valid: false,
        violation: `RENDER_SOURCE_VIOLATION: Message contains forbidden fixture string "${forbidden}"`
      };
    }
  }

  // Check 2: Mandatory metadata presence
  const meta = message.metadata;
  if (!meta) {
    return {
      valid: false,
      violation: 'RENDER_SOURCE_VIOLATION: Assistant message missing required metadata {source, providerId, modelId, streamEventCount}'
    };
  }

  if (meta.source !== 'provider-stream') {
    return {
      valid: false,
      violation: `RENDER_SOURCE_VIOLATION: Invalid metadata source "${meta.source}". Expected "provider-stream"`
    };
  }

  if (typeof meta.providerId !== 'string' || !meta.providerId.trim()) {
    return {
      valid: false,
      violation: 'RENDER_SOURCE_VIOLATION: Missing metadata providerId'
    };
  }

  if (typeof meta.modelId !== 'string' || !meta.modelId.trim()) {
    return {
      valid: false,
      violation: 'RENDER_SOURCE_VIOLATION: Missing metadata modelId'
    };
  }

  if (typeof meta.streamEventCount !== 'number' || meta.streamEventCount < 0) {
    return {
      valid: false,
      violation: 'RENDER_SOURCE_VIOLATION: Missing or invalid metadata streamEventCount (must be >= 0)'
    };
  }

  // Dev-mode progressive streaming assertion: warn if reply has < 5 stream events
  if (
    typeof process !== 'undefined' &&
    process.env?.NODE_ENV !== 'production' &&
    meta.streamEventCount < 5 &&
    content.length > 20
  ) {
    console.warn(
      `[TruthGuard] Dev Streaming Warning: Assistant reply had ${meta.streamEventCount} stream events (< 5). Progressive token delivery required.`
    );
  }

  return { valid: true };
}

function finalizePartialMessage(messages: ChatMessage[], text: string, reasoning: string): ChatMessage[] {
  if (!text && !reasoning) return messages;

  const candidateMessage: ChatMessage = {
    id: createId('assistant'),
    role: 'assistant',
    content: text,
    reasoning: reasoning || undefined,
    metadata: {
      source: 'provider-stream',
      providerId: currentTaskProviderId || 'default',
      modelId: currentTaskModelId || 'default',
      streamEventCount: currentTaskStreamEvents
    },
    timestamp: Date.now()
  };

  const validation = validateAssistantMessage(candidateMessage);
  if (!validation.valid) {
    const errorViolation = validation.violation || 'RENDER_SOURCE_VIOLATION';
    console.error(`[TruthGuard] Blocked assistant message: ${errorViolation}`);
    if (typeof window !== 'undefined' && (window as any).electronAPI?.recordTraceHop) {
      try {
        (window as any).electronAPI.recordTraceHop('diagnostics', 'H10', {
          status: 'FAIL',
          error: errorViolation
        });
      } catch {}
    }
    const violationErrorCard: ChatErrorCard = {
      taxonomyCode: 'RENDER_SOURCE_VIOLATION',
      message: 'Render Source Violation: Fake or non-streamed response detected and blocked.',
      remedy: 'All responses must be progressively streamed from a live, authenticated provider.',
      suggestedFallback: 'Configure a valid provider API key in Settings'
    };
    return [
      ...messages,
      {
        id: createId('error'),
        role: 'assistant',
        content: `**[RENDER_SOURCE_VIOLATION]** ${errorViolation}`,
        errorCard: violationErrorCard,
        timestamp: Date.now()
      }
    ];
  }

  return [...messages, candidateMessage];
}
function cancelRunningTools(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => {
    let updated = message;
    if (message.role === 'tool' && message.toolStatus === 'running') {
      updated = { ...updated, toolStatus: 'cancelled' };
    }
    if (message.toolExecutions && message.toolExecutions.some((t) => t.status === 'running')) {
      updated = {
        ...updated,
        toolExecutions: message.toolExecutions.map((t) =>
          t.status === 'running' ? { ...t, status: 'cancelled' } : t
        )
      };
    }
    return updated;
  });
}

function updateToolStatus(messages: ChatMessage[], toolCallId: string, status: ToolExecutionStatus, output?: string, isError?: boolean): ChatMessage[] {
  return messages.map((message) => {
    if (message.role === 'tool' && message.toolCall?.id === toolCallId) {
      return {
        ...message,
        content: output ?? message.content,
        toolStatus: status,
        ...(output === undefined ? {} : { toolResult: { toolCallId, name: message.toolCall.name, output, isError } })
      };
    }
    if (message.toolExecutions && message.toolExecutions.some((t) => t.id === toolCallId)) {
      return {
        ...message,
        toolExecutions: message.toolExecutions.map((t) =>
          t.id === toolCallId
            ? { ...t, status, output: output ?? t.output, isError }
            : t
        )
      };
    }
    return message;
  });
}

export function groupMessagesByTask(messages: ChatMessage[]): ChatMessage[] {
  const result: ChatMessage[] = [];
  let pendingTools: ToolExecutionRecord[] = [];

  for (const message of messages) {
    if (message.role === 'tool' && message.toolCall) {
      const toolRecord: ToolExecutionRecord = {
        id: message.toolCall.id,
        name: message.toolCall.name,
        arguments: message.toolCall.arguments,
        status: message.toolStatus || (message.toolResult?.isError ? 'error' : 'success'),
        output: message.toolResult?.output || message.content,
        isError: message.toolResult?.isError
      };

      const prev = result.length > 0 ? result[result.length - 1] : null;
      if (prev && prev.role === 'assistant' && (!message.taskId || !prev.taskId || prev.taskId === message.taskId)) {
        prev.toolExecutions = [...(prev.toolExecutions || []), toolRecord];
        continue;
      }

      pendingTools.push(toolRecord);
      continue;
    }

    if (message.role === 'assistant') {
      const prev = result.length > 0 ? result[result.length - 1] : null;
      // If previous message is an assistant turn for the same task, merge into it
      if (
        prev &&
        prev.role === 'assistant' &&
        prev.taskId &&
        message.taskId &&
        prev.taskId === message.taskId
      ) {
        if (message.content) {
          prev.content = prev.content ? `${prev.content}\n\n${message.content}` : message.content;
        }
        if (message.reasoning) {
          prev.reasoning = prev.reasoning ? `${prev.reasoning}\n\n${message.reasoning}` : message.reasoning;
        }
        if (message.statusText !== undefined) {
          prev.statusText = message.statusText;
        }
        const combinedTools = [
          ...(prev.toolExecutions || []),
          ...pendingTools,
          ...(message.toolExecutions || [])
        ];
        if (combinedTools.length > 0) {
          prev.toolExecutions = combinedTools;
        }
        pendingTools = [];
        if (message.proposedDiffs && message.proposedDiffs.length > 0) {
          prev.proposedDiffs = [...(prev.proposedDiffs || []), ...message.proposedDiffs];
        }
        if (message.errorCard) {
          prev.errorCard = message.errorCard;
        }
        if (message.metadata) {
          prev.metadata = { ...prev.metadata, ...message.metadata };
        }
        continue;
      }

      if (pendingTools.length > 0) {
        result.push({
          ...message,
          toolExecutions: [...pendingTools, ...(message.toolExecutions || [])]
        });
        pendingTools = [];
      } else {
        result.push(message);
      }
      continue;
    }

    if (pendingTools.length > 0) {
      result.push({
        id: `unified_tools_${Date.now()}`,
        role: 'assistant',
        content: '',
        toolExecutions: pendingTools,
        timestamp: message.timestamp - 1,
        metadata: {
          source: 'provider-stream',
          providerId: 'default',
          modelId: 'default',
          streamEventCount: 1
        }
      });
      pendingTools = [];
    }

    result.push(message);
  }

  if (pendingTools.length > 0) {
    result.push({
      id: `unified_tools_${Date.now()}`,
      role: 'assistant',
      content: '',
      toolExecutions: pendingTools,
      timestamp: Date.now(),
      metadata: {
        source: 'provider-stream',
        providerId: 'default',
        modelId: 'default',
        streamEventCount: 1
      }
    });
  }

  return result;
}

const CHAT_STORAGE_KEY = 'ty_code_chat_messages_v1';

export function loadPersistedChat(): ChatMessage[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const validated = parsed.filter((m) => {
        if (m.role === 'assistant' && !m.errorCard) {
          return validateAssistantMessage(m).valid;
        }
        return true;
      });
      return groupMessagesByTask(validated);
    }
  } catch {
    // Graceful fallback
  }
  return [];
}

export function savePersistedChat(messages: ChatMessage[]): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-200)));
  } catch {
    // Graceful fallback
  }
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: loadPersistedChat(), isRunning: false, currentTaskId: null, pendingApproval: null, currentStatus: '', currentThought: '', streamingText: '',
  activeErrorCard: null,
  dismissErrorCard: () => set({ activeErrorCard: null }),
  setActiveErrorCard: (card: ChatErrorCard | null) => set({ activeErrorCard: card }),
  settings: null, agentMode: 'build', contextTokens: 1200, contextLimit: 128_000, isSettingsOpen: false, isTerminalOpen: false,
  draftPrompt: '',

  setDraftPrompt: (prompt: string) => set({ draftPrompt: prompt }),
  setAgentMode: (mode: AgentMode) => set({ agentMode: mode }),
  setContextTokens: (tokens: number) => set({ contextTokens: tokens }),

  recentSessions: [],
  pendingResume: null,
  loadRecentSessions: async (workspacePath: string) => {
    try {
      const response = await window.electronAPI.getRecentSessions?.(workspacePath);
      if (response?.success && response.data) {
        const pending = get().pendingResume;
        set({ recentSessions: response.data, pendingResume: pending ?? response.data[0] ?? null });
      }
    } catch {
      // sessions unavailable; resume offer simply stays hidden
    }
  },
  acceptSessionResume: (session: AgentSessionSummary) => set({ pendingResume: session }),
  dismissSessionResume: () => set({ pendingResume: null, recentSessions: [] }),

  initSettings: async () => {
    const refreshSettings = async () => {
      try {
        const response = await window.electronAPI.getSettings();
        if (response.success && response.data) set({ settings: response.data });
        else if (response.error) console.error('Failed to load settings:', response.error);
        // Keep the unified settings store in step (boot + settings:changed).
        try {
          const { useSettingsStore } = await import('./settings-store');
          await useSettingsStore.getState().hydrate();
        } catch {
          // Unified store not loaded yet; chat settings remain authoritative.
        }
      } catch (err) { console.error('Failed to load settings:', err); }
    };
    if (!settingsChangedUnsubscribe) {
      settingsChangedUnsubscribe = window.electronAPI.onSettingsChanged(() => { void refreshSettings(); });
    }
    if (!sketcherPromptUnsubscribe && window.electronAPI?.onSketcherPrompt) {
      sketcherPromptUnsubscribe = window.electronAPI.onSketcherPrompt((prompt: string) => {
        set({ draftPrompt: prompt });
      });
    }
    if (!canvasSyncUnsubscribe && window.electronAPI?.onCanvasMessageSynced) {
      canvasSyncUnsubscribe = window.electronAPI.onCanvasMessageSynced((incoming) => {
        const message = (incoming as { id?: string; role?: string; content?: string; timestamp?: number; origin?: string }) || {};
        // Ignore echoes of messages that originated in THIS (main) window:
        // only canvas-originated messages are appended into the sidecar.
        if (message.origin !== 'canvas') return;
        if ((message.role !== 'user' && message.role !== 'assistant') || !message.content) return;
        const messageId = message.id || `canvas_external_${message.timestamp || Date.now()}`;
        if (get().messages.some((existing) => existing.id === messageId)) return;
        set({
          messages: [
            ...get().messages,
            {
              id: messageId,
              role: message.role as 'user' | 'assistant',
              content: message.content,
              timestamp: typeof message.timestamp === 'number' ? message.timestamp : Date.now()
            }
          ]
        });
      });
    }
    if (!canvasUpdateUnsubscribe && window.electronAPI?.onCanvasUpdate) {
      canvasUpdateUnsubscribe = window.electronAPI.onCanvasUpdate((update) => {
        const action = (update as { action?: string } | null)?.action || 'updated_ui';
        const snippet = (update as { codeSnippet?: string } | null)?.codeSnippet || '';
        const content =
          `🎨 M3E Canvas updated: ${action}. [View in Canvas]` +
          (snippet ? `\n\`\`\`\n${snippet.slice(0, 4000)}\n\`\`\`` : '');
        const messageId = `canvas_update_${Date.now()}`;
        set({
          messages: [...get().messages, { id: messageId, role: 'system', content, timestamp: Date.now() }]
        });
      });
    }
    await refreshSettings();
  },

  saveSettings: async (updates: Partial<ProviderSettings>) => {
    try {
      const response = await window.electronAPI.saveSettings(updates);
      if (!response.success) { console.error('Failed to save settings:', response.error); return false; }
      const current = get().settings;
      if (current) {
        const apiKeysConfigured = { ...current.apiKeysConfigured };
        for (const [provider, value] of Object.entries(updates.apiKeys || {})) {
          if (typeof value === 'string' && value.trim()) apiKeysConfigured[provider as ProviderType] = true;
        }
        set({ settings: { ...current, ...updates, apiKeys: {}, apiKeysConfigured, customEndpoints: { ...current.customEndpoints, ...updates.customEndpoints } } });
      }
      // Funnel persisted selections through the unified store: its sync
      // watcher updates the main-process active agent config + gateway.
      try {
        const { useSettingsStore } = await import('./settings-store');
        await useSettingsStore.getState().hydrate();
      } catch {
        // Unified store unavailable; settings still persisted and broadcast.
      }
      return true;
    } catch (err) { console.error('Failed to save settings:', err); return false; }
  },

  sendMessage: async (prompt, workspacePath, activeFilePath, activeFileContent, appendUserMessage = true, traceOptions, images) => {
    if (get().isRunning || (!prompt.trim() && !(images && images.length > 0))) return;
    activeStreamUnsubscribe?.();
    activeStreamUnsubscribe = null;
    const currentMessages = get().messages;
    let lastUserIndex = -1;
    for (let index = currentMessages.length - 1; index >= 0; index--) {
      if (currentMessages[index].role === 'user') { lastUserIndex = index; break; }
    }
    const requestHistory = !appendUserMessage && lastUserIndex >= 0
      ? currentMessages.slice(0, lastUserIndex)
      : currentMessages;
    const userMessage: ChatMessage = {
      id: createId('user'),
      role: 'user',
      content: prompt,
      ...(images && images.length > 0 ? { images } : {}),
      timestamp: Date.now()
    };
    const regeneratedMessages = !appendUserMessage && lastUserIndex >= 0
      ? currentMessages.slice(0, lastUserIndex + 1)
      : currentMessages;
    const taskId = createId('task');
    currentTaskStreamEvents = 0;
    currentTaskProviderId = traceOptions?.providerOverride || get().settings?.activeProvider || 'default';
    currentTaskModelId = traceOptions?.modelOverride || get().settings?.activeModel || 'default';

    const assistantId = createId('assistant');
    const initialAssistantMessage: ChatMessage = {
      id: assistantId,
      taskId,
      role: 'assistant',
      content: '',
      toolExecutions: [],
      proposedDiffs: [],
      statusText: 'Analyzing workspace…',
      metadata: {
        source: 'provider-stream',
        providerId: currentTaskProviderId,
        modelId: currentTaskModelId,
        streamEventCount: 0
      },
      timestamp: Date.now()
    };

    set({
      messages: appendUserMessage
        ? [...currentMessages, userMessage, initialAssistantMessage]
        : [...regeneratedMessages, initialAssistantMessage],
      isRunning: true,
      currentTaskId: taskId,
      pendingApproval: null,
      currentStatus: 'Analyzing workspace…',
      currentThought: '',
      streamingText: '',
      activeErrorCard: null
    });
    // M3E Canvas sync: mirror the user's message into the shared canvas history
    if (appendUserMessage) syncMessageToCanvas(userMessage);

    // H1: Renderer chat send handler invoked
    if (traceOptions?.traceId && window.electronAPI?.recordTraceHop) {
      window.electronAPI.recordTraceHop(traceOptions.traceId, 'H1', {
        status: 'PASS',
        payloadSize: prompt.length,
        metadata: {
          promptSize: prompt.length,
          modelSelected: traceOptions.modelOverride || get().settings?.activeModel || 'default',
          providerSelected: traceOptions.providerOverride || get().settings?.activeProvider || 'default'
        }
      });
    }

    const finishTask = (status = '') => {
      activeStreamDisposables.forEach((dispose) => {
        try { dispose(); } catch {}
      });
      activeStreamDisposables = [];
      set({ isRunning: false, currentTaskId: null, pendingApproval: null, currentStatus: status, streamingText: '', currentThought: '' });
    };

    activeStreamDisposables.forEach((dispose) => {
      try { dispose(); } catch {}
    });
    activeStreamDisposables = [];

    // 1. Zod-validated token stream
    if (window.electronAPI.onAgentStreamToken) {
      activeStreamDisposables.push(window.electronAPI.onAgentStreamToken((raw) => {
        const parsed = AgentStreamTokenPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        currentTaskStreamEvents++;
        set((state) => ({
          streamingText: state.streamingText + parsed.data.token,
          contextTokens: state.contextTokens + Math.ceil(parsed.data.token.length / 4),
          messages: state.messages.map((m) =>
            m.taskId === taskId
              ? {
                  ...m,
                  content: m.content + parsed.data.token,
                  statusText: '',
                  metadata: m.metadata
                    ? { ...m.metadata, streamEventCount: currentTaskStreamEvents }
                    : {
                        source: 'provider-stream',
                        providerId: currentTaskProviderId,
                        modelId: currentTaskModelId,
                        streamEventCount: currentTaskStreamEvents
                      }
                }
              : m
          )
        }));
      }));
    }

    // 2. Zod-validated reasoning stream
    if (window.electronAPI.onAgentReasoningToken) {
      activeStreamDisposables.push(window.electronAPI.onAgentReasoningToken((raw) => {
        const parsed = AgentReasoningTokenPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        currentTaskStreamEvents++;
        set((state) => ({
          currentThought: state.currentThought + parsed.data.token,
          messages: state.messages.map((m) =>
            m.taskId === taskId
              ? { ...m, reasoning: (m.reasoning || '') + parsed.data.token }
              : m
          )
        }));
      }));
    }

    // 3. Zod-validated tool start
    if (window.electronAPI.onAgentToolStart) {
      activeStreamDisposables.push(window.electronAPI.onAgentToolStart((raw) => {
        const parsed = AgentToolStartPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        currentTaskStreamEvents++;
        const toolCall = parsed.data.toolCall;
        const newTool: ToolExecutionRecord = {
          id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
          status: 'running'
        };
        set((state) => ({
          currentStatus: `Running ${newTool.name}…`,
          messages: state.messages.map((m) =>
            m.taskId === taskId
              ? {
                  ...m,
                  toolExecutions: [...(m.toolExecutions || []), newTool],
                  statusText: `Running ${newTool.name}…`
                }
              : m
          )
        }));
      }));
    }

    // 4. Zod-validated tool result
    if (window.electronAPI.onAgentToolResult) {
      activeStreamDisposables.push(window.electronAPI.onAgentToolResult((raw) => {
        const parsed = AgentToolResultPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        const result = parsed.data.toolResult;
        set((state) => ({
          currentStatus: '',
          pendingApproval: state.pendingApproval?.toolCall.id === result.toolCallId ? null : state.pendingApproval,
          contextTokens: state.contextTokens + Math.ceil(result.output.length / 4),
          messages: state.messages.map((m) => {
            if (m.taskId !== taskId) return m;
            const updatedTools = (m.toolExecutions || []).map((t) =>
              t.id === result.toolCallId
                ? {
                    ...t,
                    status: result.isError ? ('error' as const) : ('success' as const),
                    output: result.output,
                    isError: result.isError
                  }
                : t
            );
            return {
              ...m,
              toolExecutions: updatedTools,
              statusText: ''
            };
          })
        }));
        if (result.name.startsWith('git_')) void useGitStore.getState().refreshStatus();
      }));
    }

    // 5. Zod-validated diff proposed
    if (window.electronAPI.onAgentDiffProposed) {
      activeStreamDisposables.push(window.electronAPI.onAgentDiffProposed((raw) => {
        const parsed = AgentDiffProposedPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        set((state) => ({
          messages: state.messages.map((m) =>
            m.taskId === taskId
              ? {
                  ...m,
                  proposedDiffs: [...(m.proposedDiffs || []), parsed.data.diff as any]
                }
              : m
          )
        }));
      }));
    }

    // 6. Zod-validated done event
    if (window.electronAPI.onAgentDone) {
      activeStreamDisposables.push(window.electronAPI.onAgentDone((raw) => {
        const parsed = AgentDonePayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        const state = get();
        if (parsed.data.cancelled) {
          const cancelledMessages = cancelRunningTools(state.messages);
          set({
            messages: cancelledMessages.map((m) =>
              m.taskId === taskId ? { ...m, statusText: '' } : m
            )
          });
          finishTask('Task stopped.');
        } else {
          const streamCount = Math.max(1, currentTaskStreamEvents);
          const messages = state.messages.map((m) => {
            if (m.taskId !== taskId) return m;
            return {
              ...m,
              statusText: '',
              metadata: {
                source: 'provider-stream' as const,
                providerId: currentTaskProviderId,
                modelId: currentTaskModelId,
                streamEventCount: streamCount
              }
            };
          });
          set({ messages });
          const lastMessage = messages.find((m) => m.taskId === taskId);
          if (lastMessage && lastMessage.role === 'assistant') syncMessageToCanvas(lastMessage);
          if (traceOptions?.traceId && window.electronAPI?.recordTraceHop) {
            window.electronAPI.recordTraceHop(traceOptions.traceId, 'H10', {
              status: 'PASS',
              payloadSize: (lastMessage?.content || '').length,
              metadata: {
                tokensRendered: (lastMessage?.content || '').length,
                toolCardsRendered: (lastMessage?.toolExecutions || []).length,
                diffCardRendered: Boolean(lastMessage?.proposedDiffs && lastMessage.proposedDiffs.length > 0)
              }
            });
          }
          finishTask();
        }
      }));
    }

    // 7. Zod-validated error event
    if (window.electronAPI.onAgentError) {
      activeStreamDisposables.push(window.electronAPI.onAgentError((raw) => {
        const parsed = AgentErrorPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        const state = get();
        const card = parsed.data.errorCard || {
          taxonomyCode: 'NETWORK_BLOCKED',
          message: parsed.data.error || 'Connection failed or network blocked.',
          remedy: 'Check your internet connection or proxy settings, then retry.',
          actionLabel: 'Retry',
          actionUrl: 'ty-code://action/retry',
          providerId: get().settings?.activeProvider
        };
        const content = card
          ? `**[${card.taxonomyCode}]** ${card.message}\n\n*Remediation:* ${card.remedy}`
          : `**Agent error:** ${parsed.data.error || 'The task could not be completed.'}`;
        set({
          activeErrorCard: card,
          messages: state.messages.map((m) =>
            m.taskId === taskId
              ? {
                  ...m,
                  errorCard: card,
                  content: m.content || content,
                  statusText: ''
                }
              : m
          )
        });
        if (traceOptions?.traceId && window.electronAPI?.recordTraceHop) {
          window.electronAPI.recordTraceHop(traceOptions.traceId, 'H10', {
            status: 'FAIL',
            error: parsed.data.error || 'The task could not be completed.'
          });
        }
        finishTask('Task failed.');
      }));
    }

    // Backup listener for approvals and status
    activeStreamDisposables.push(window.electronAPI.onAgentStream((chunk: AgentStreamChunk) => {
      if (chunk.taskId !== taskId || get().currentTaskId !== taskId) return;
      if (chunk.type === 'status') {
        let statusText = chunk.content || '';
        if (/thinking/i.test(statusText)) {
          statusText = 'Thinking…';
        }
        set((state) => ({
          currentStatus: statusText,
          contextTokens: statusText.includes('compacting')
            ? Math.floor(state.contextLimit * 0.35)
            : state.contextTokens,
          messages: state.messages.map((m) =>
            m.taskId === taskId ? { ...m, statusText } : m
          )
        }));
      } else if (chunk.type === 'approval_request' && chunk.approvalRequest) {
        set({ pendingApproval: chunk.approvalRequest, currentStatus: 'Waiting for your approval…' });
      }
    }));
    try {
      const pendingResume = get().pendingResume;
      if (pendingResume) set({ pendingResume: null });
      const response = await window.electronAPI.startAgentTask({
        taskId,
        traceId: traceOptions?.traceId,
        providerOverride: traceOptions?.providerOverride,
        modelOverride: traceOptions?.modelOverride,
        prompt,
        ...(images && images.length > 0 ? { images } : {}),
        workspacePath,
        history: requestHistory,
        agentMode: get().agentMode,
        activeFilePath,
        activeFileContent,
        ...(pendingResume ? { resumeSessionId: pendingResume.sessionId } : {})
      });
      if (get().currentTaskId !== taskId) return;
      if (!response.success || !response.data) {
        const state = get();
        const partial = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
        const errorText = response.error || 'Unknown error';
        const isNetwork = /network|offline|econnrefused|fetch|connect|timeout|enotfound|dns/i.test(errorText);
        const fallbackCard: ChatErrorCard = {
          taxonomyCode: isNetwork ? 'NETWORK_BLOCKED' : 'CONFIG_MISSING',
          message: errorText,
          remedy: isNetwork ? 'Check your internet connection or proxy settings, then retry.' : 'Verify provider configuration in Settings.',
          actionLabel: isNetwork ? 'Retry' : 'Connect Provider',
          actionUrl: isNetwork ? 'ty-code://action/retry' : 'ty-code://settings/providers',
          providerId: get().settings?.activeProvider
        };
        set({
          activeErrorCard: fallbackCard,
          messages: [...partial, { id: createId('error'), role: 'assistant', content: `**Could not start agent:** ${errorText}`, errorCard: fallbackCard, timestamp: Date.now() }]
        });
        if (traceOptions?.traceId && window.electronAPI?.recordTraceHop) {
          window.electronAPI.recordTraceHop(traceOptions.traceId, 'H2', {
            status: 'FAIL',
            error: response.error || 'Failed to start agent task via IPC'
          });
        }
        finishTask('Could not start agent.');
      }
    } catch (err: unknown) {
      if (get().currentTaskId !== taskId) return;
      const state = get();
      const partial = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
      const message = err instanceof Error ? err.message : String(err);
      const isNetwork = /network|offline|econnrefused|fetch|connect|timeout|enotfound|dns/i.test(message);
      const fallbackCard: ChatErrorCard = {
        taxonomyCode: isNetwork ? 'NETWORK_BLOCKED' : 'CONFIG_MISSING',
        message,
        remedy: isNetwork ? 'Check your internet connection or proxy settings, then retry.' : 'Verify provider configuration in Settings.',
        actionLabel: isNetwork ? 'Retry' : 'Connect Provider',
        actionUrl: isNetwork ? 'ty-code://action/retry' : 'ty-code://settings/providers',
        providerId: get().settings?.activeProvider
      };
      set({
        activeErrorCard: fallbackCard,
        messages: [...partial, { id: createId('error'), role: 'assistant', content: `**Could not start agent:** ${message}`, errorCard: fallbackCard, timestamp: Date.now() }]
      });
      if (traceOptions?.traceId && window.electronAPI?.recordTraceHop) {
        window.electronAPI.recordTraceHop(traceOptions.traceId, 'H2', {
          status: 'FAIL',
          error: message
        });
      }
      finishTask('Could not start agent.');
    }
  },

  respondToApproval: async (approved, feedback) => {
    const request = get().pendingApproval;
    if (!request) return;
    set({
      pendingApproval: null,
      currentStatus: approved ? 'Approval granted.' : feedback ? 'Plan revision feedback sent.' : 'Approval denied.'
    });
    try {
      const response = await window.electronAPI.sendApprovalResponse(request.id, approved ? 'APPROVED' : 'REVISED', feedback);
      if (!response.success) set({ currentStatus: response.error || 'Approval request expired.' });
    } catch (err: unknown) {
      set({ currentStatus: err instanceof Error ? err.message : String(err) });
    }
  },

  stopTask: async () => {
    const taskId = get().currentTaskId;
    if (!taskId) return;
    const state = get();
    const messages = finalizePartialMessage(cancelRunningTools(state.messages), state.streamingText, state.currentThought);
    activeStreamUnsubscribe?.();
    activeStreamUnsubscribe = null;
    set({ messages, isRunning: false, currentTaskId: null, pendingApproval: null, currentStatus: 'Stopping task…', streamingText: '', currentThought: '' });
    try { await window.electronAPI.stopAgentTask(taskId); }
    catch (err) { console.error('Failed to stop agent task:', err); }
    finally { set({ currentStatus: 'Task stopped.' }); }
  },

  clearChat: () => {
    const taskId = get().currentTaskId;
    activeStreamUnsubscribe?.();
    activeStreamUnsubscribe = null;
    if (taskId) void window.electronAPI.stopAgentTask(taskId);
    set({ messages: [], isRunning: false, currentTaskId: null, pendingApproval: null, streamingText: '', currentThought: '', currentStatus: '', contextTokens: 1200, activeErrorCard: null });
  },
  toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen, activeSettingsTab: undefined })),
  openSettings: (tab?: string) => set({ isSettingsOpen: true, activeSettingsTab: tab }),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen }))
}));

let prevPersistedMessages = useChatStore.getState().messages;
useChatStore.subscribe((state) => {
  if (state.messages !== prevPersistedMessages) {
    prevPersistedMessages = state.messages;
    savePersistedChat(state.messages);
  }
});
