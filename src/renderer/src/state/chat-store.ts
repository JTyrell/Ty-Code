import { create } from 'zustand';
import type { AgentMode, AgentStreamChunk, AgentToolApproval, ChatMessage, ProviderSettings, ProviderType, ToolExecutionStatus } from '../../../preload/types';
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
    traceOptions?: { traceId?: string; providerOverride?: string; modelOverride?: string }
  ) => Promise<void>;
  stopTask: () => Promise<void>;
  respondToApproval: (approved: boolean) => Promise<void>;
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
function createId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }

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
  return messages.map((message) => message.role === 'tool' && message.toolStatus === 'running'
    ? { ...message, toolStatus: 'cancelled' }
    : message);
}
function updateToolStatus(messages: ChatMessage[], toolCallId: string, status: ToolExecutionStatus, output?: string, isError?: boolean): ChatMessage[] {
  return messages.map((message) => {
    if (message.role !== 'tool' || message.toolCall?.id !== toolCallId || !message.toolCall) return message;
    return {
      ...message,
      content: output ?? message.content,
      toolStatus: status,
      ...(output === undefined ? {} : { toolResult: { toolCallId, name: message.toolCall.name, output, isError } })
    };
  });
}

const CHAT_STORAGE_KEY = 'ty_code_chat_messages_v1';

export function loadPersistedChat(): ChatMessage[] {
  try {
    if (typeof localStorage === 'undefined') return [];
    const raw = localStorage.getItem(CHAT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((m) => {
        if (m.role === 'assistant' && !m.errorCard) {
          return validateAssistantMessage(m).valid;
        }
        return true;
      });
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

  initSettings: async () => {
    const refreshSettings = async () => {
      try {
        const response = await window.electronAPI.getSettings();
        if (response.success && response.data) set({ settings: response.data });
        else if (response.error) console.error('Failed to load settings:', response.error);
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
    if (window.electronAPI.onAgentError) {
      window.electronAPI.onAgentError((raw) => {
        const parsed = AgentErrorPayloadSchema.safeParse(raw);
        if (!parsed.success) return;
        const card = parsed.data.errorCard || {
          taxonomyCode: 'NETWORK_BLOCKED',
          message: parsed.data.error || 'Network error encountered.',
          remedy: 'Check your internet connection or proxy settings, then retry.',
          actionLabel: 'Retry',
          actionUrl: 'ty-code://action/retry',
          providerId: get().settings?.activeProvider
        };
        set({
          activeErrorCard: card,
          isRunning: false,
          streamingText: '',
          currentThought: '',
          currentStatus: 'Task failed.'
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
      return true;
    } catch (err) { console.error('Failed to save settings:', err); return false; }
  },

  sendMessage: async (prompt, workspacePath, activeFilePath, activeFileContent, appendUserMessage = true, traceOptions) => {
    if (get().isRunning || !prompt.trim()) return;
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
    const userMessage: ChatMessage = { id: createId('user'), role: 'user', content: prompt, timestamp: Date.now() };
    const regeneratedMessages = !appendUserMessage && lastUserIndex >= 0
      ? currentMessages.slice(0, lastUserIndex + 1)
      : currentMessages;
    const taskId = createId('task');
    currentTaskStreamEvents = 0;
    currentTaskProviderId = traceOptions?.providerOverride || get().settings?.activeProvider || 'default';
    currentTaskModelId = traceOptions?.modelOverride || get().settings?.activeModel || 'default';

    set({
      messages: appendUserMessage ? [...currentMessages, userMessage] : regeneratedMessages,
      isRunning: true,
      currentTaskId: taskId,
      pendingApproval: null,
      currentStatus: 'Starting task…',
      currentThought: '',
      streamingText: '',
      activeErrorCard: null
    });

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
          contextTokens: state.contextTokens + Math.ceil(parsed.data.token.length / 4)
        }));
      }));
    }

    // 2. Zod-validated reasoning stream
    if (window.electronAPI.onAgentReasoningToken) {
      activeStreamDisposables.push(window.electronAPI.onAgentReasoningToken((raw) => {
        const parsed = AgentReasoningTokenPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        currentTaskStreamEvents++;
        set((state) => ({ currentThought: state.currentThought + parsed.data.token }));
      }));
    }

    // 3. Zod-validated tool start
    if (window.electronAPI.onAgentToolStart) {
      activeStreamDisposables.push(window.electronAPI.onAgentToolStart((raw) => {
        const parsed = AgentToolStartPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        currentTaskStreamEvents++;
        const state = get();
        const messages = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
        const toolMessage: ChatMessage = {
          id: createId('tool'),
          role: 'tool',
          content: '',
          toolCall: parsed.data.toolCall,
          toolStatus: 'running',
          timestamp: Date.now()
        };
        set({ messages: [...messages, toolMessage], streamingText: '', currentThought: '' });
      }));
    }

    // 4. Zod-validated tool result
    if (window.electronAPI.onAgentToolResult) {
      activeStreamDisposables.push(window.electronAPI.onAgentToolResult((raw) => {
        const parsed = AgentToolResultPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        const result = parsed.data.toolResult;
        set((state) => ({
          messages: updateToolStatus(state.messages, result.toolCallId, result.isError ? 'error' : 'success', result.output, result.isError),
          pendingApproval: state.pendingApproval?.toolCall.id === result.toolCallId ? null : state.pendingApproval,
          contextTokens: state.contextTokens + Math.ceil(result.output.length / 4)
        }));
        if (result.name.startsWith('git_')) void useGitStore.getState().refreshStatus();
      }));
    }

    // 5. Zod-validated diff proposed
    if (window.electronAPI.onAgentDiffProposed) {
      activeStreamDisposables.push(window.electronAPI.onAgentDiffProposed((raw) => {
        const parsed = AgentDiffProposedPayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        set((state) => {
          const index = state.messages.length - 1;
          if (index < 0) {
            return {
              messages: [
                ...state.messages,
                { id: createId('diff'), role: 'assistant', content: '', proposedDiffs: [parsed.data.diff as any], timestamp: Date.now() }
              ]
            };
          }
          const messages = [...state.messages];
          const target = messages[index];
          messages[index] = { ...target, proposedDiffs: [...(target.proposedDiffs || []), parsed.data.diff as any] };
          return { messages };
        });
      }));
    }

    // 6. Zod-validated done event
    if (window.electronAPI.onAgentDone) {
      activeStreamDisposables.push(window.electronAPI.onAgentDone((raw) => {
        const parsed = AgentDonePayloadSchema.safeParse(raw);
        if (!parsed.success || parsed.data.taskId !== taskId || get().currentTaskId !== taskId) return;
        const state = get();
        if (parsed.data.cancelled) {
          const messages = cancelRunningTools(state.messages);
          set({ messages: finalizePartialMessage(messages, state.streamingText, state.currentThought) });
          finishTask('Task stopped.');
        } else {
          set({ messages: finalizePartialMessage(state.messages, state.streamingText, state.currentThought) });
          if (traceOptions?.traceId && window.electronAPI?.recordTraceHop) {
            window.electronAPI.recordTraceHop(traceOptions.traceId, 'H10', {
              status: 'PASS',
              payloadSize: state.streamingText.length,
              metadata: {
                tokensRendered: state.streamingText.length,
                toolCardsRendered: state.messages.filter((m) => m.role === 'tool').length,
                diffCardRendered: state.messages.some((m) => m.proposedDiffs && m.proposedDiffs.length > 0)
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
        const partial = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
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
          messages: [
            ...partial,
            {
              id: createId('error'),
              role: 'assistant',
              content,
              errorCard: card,
              timestamp: Date.now()
            }
          ]
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
        set((state) => ({
          currentStatus: chunk.content || '',
          contextTokens: chunk.content?.includes('compacting')
            ? Math.floor(state.contextLimit * 0.35)
            : state.contextTokens
        }));
      } else if (chunk.type === 'approval_request' && chunk.approvalRequest) {
        set({ pendingApproval: chunk.approvalRequest, currentStatus: 'Waiting for your approval…' });
      }
    }));
    try {
      const response = await window.electronAPI.startAgentTask({
        taskId,
        traceId: traceOptions?.traceId,
        providerOverride: traceOptions?.providerOverride,
        modelOverride: traceOptions?.modelOverride,
        prompt,
        workspacePath,
        history: requestHistory,
        agentMode: get().agentMode,
        activeFilePath,
        activeFileContent
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

  respondToApproval: async (approved) => {
    const request = get().pendingApproval;
    if (!request) return;
    set({ pendingApproval: null, currentStatus: approved ? 'Approval granted.' : 'Approval denied.' });
    try {
      const response = await window.electronAPI.respondAgentApproval(request.id, approved);
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
