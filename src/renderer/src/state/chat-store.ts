import { create } from 'zustand';
import type { AgentMode, AgentStreamChunk, AgentToolApproval, ChatMessage, ProviderSettings, ProviderType, ToolExecutionStatus } from '../../../preload/types';
import { useGitStore } from './git-store';

interface ChatState {
  messages: ChatMessage[];
  isRunning: boolean;
  currentTaskId: string | null;
  pendingApproval: AgentToolApproval | null;
  currentStatus: string;
  currentThought: string;
  streamingText: string;
  settings: ProviderSettings | null;
  agentMode: AgentMode;
  contextTokens: number;
  contextLimit: number;
  isSettingsOpen: boolean;
  isTerminalOpen: boolean;
  setAgentMode: (mode: AgentMode) => void;
  setContextTokens: (tokens: number) => void;
  initSettings: () => Promise<void>;
  saveSettings: (updates: Partial<ProviderSettings>) => Promise<boolean>;
  sendMessage: (prompt: string, workspacePath: string, activeFilePath?: string, activeFileContent?: string, appendUserMessage?: boolean) => Promise<void>;
  stopTask: () => Promise<void>;
  respondToApproval: (approved: boolean) => Promise<void>;
  clearChat: () => void;
  toggleSettings: () => void;
  toggleTerminal: () => void;
}

let activeStreamUnsubscribe: (() => void) | null = null;
let settingsChangedUnsubscribe: (() => void) | null = null;
function createId(prefix: string): string { return `${prefix}_${globalThis.crypto.randomUUID()}`; }
function finalizePartialMessage(messages: ChatMessage[], text: string, reasoning: string): ChatMessage[] {
  if (!text && !reasoning) return messages;
  return [...messages, { id: createId('assistant'), role: 'assistant', content: text, reasoning: reasoning || undefined, timestamp: Date.now() }];
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

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [], isRunning: false, currentTaskId: null, pendingApproval: null, currentStatus: '', currentThought: '', streamingText: '',
  settings: null, agentMode: 'build', contextTokens: 1200, contextLimit: 128_000, isSettingsOpen: false, isTerminalOpen: false,

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
    await refreshSettings();
  },

  saveSettings: async (updates) => {
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

  sendMessage: async (prompt, workspacePath, activeFilePath, activeFileContent, appendUserMessage = true) => {
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
    set({
      messages: appendUserMessage ? [...currentMessages, userMessage] : regeneratedMessages,
      isRunning: true,
      currentTaskId: taskId,
      pendingApproval: null,
      currentStatus: 'Starting task…',
      currentThought: '',
      streamingText: ''
    });

    const finishTask = (status = '') => {
      activeStreamUnsubscribe?.();
      activeStreamUnsubscribe = null;
      set({ isRunning: false, currentTaskId: null, pendingApproval: null, currentStatus: status, streamingText: '', currentThought: '' });
    };
    const handleChunk = (chunk: AgentStreamChunk) => {
      if (chunk.taskId !== taskId || get().currentTaskId !== taskId) return;
      switch (chunk.type) {
        case 'token':
          set((state) => ({
            streamingText: state.streamingText + (chunk.content || ''),
            contextTokens: state.contextTokens + Math.ceil((chunk.content?.length || 0) / 4)
          }));
          break;
        case 'thought': set((state) => ({ currentThought: state.currentThought + (chunk.content || '') })); break;
        case 'status':
          set((state) => ({
            currentStatus: chunk.content || '',
            contextTokens: chunk.content?.includes('compacting')
              ? Math.floor(state.contextLimit * 0.35)
              : state.contextTokens
          }));
          break;
        case 'approval_request': {
          if (chunk.approvalRequest) set({ pendingApproval: chunk.approvalRequest, currentStatus: 'Waiting for your approval…' });
          break;
        }
        case 'tool_call': {
          if (!chunk.toolCall) break;
          const state = get();
          const messages = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
          const toolMessage: ChatMessage = { id: createId('tool'), role: 'tool', content: '', toolCall: chunk.toolCall, toolStatus: 'running', timestamp: Date.now() };
          set({ messages: [...messages, toolMessage], streamingText: '', currentThought: '' });
          break;
        }
        case 'tool_result': {
          const result = chunk.toolResult;
          if (result) {
            set((state) => ({
              messages: updateToolStatus(state.messages, result.toolCallId, result.isError ? 'error' : 'success', result.output, result.isError),
              pendingApproval: state.pendingApproval?.toolCall.id === result.toolCallId ? null : state.pendingApproval,
              contextTokens: state.contextTokens + Math.ceil((result.output?.length || 0) / 4)
            }));
            if (result.name.startsWith('git_')) void useGitStore.getState().refreshStatus();
          }
          break;
        }
        case 'diff': {
          if (!chunk.diff) break;
          set((state) => {
            const index = state.messages.length - 1;
            if (index < 0) return { messages: [...state.messages, { id: createId('diff'), role: 'assistant', content: '', proposedDiffs: [chunk.diff as NonNullable<ChatMessage['proposedDiffs']>[number]], timestamp: Date.now() }] };
            const messages = [...state.messages];
            const target = messages[index];
            messages[index] = { ...target, proposedDiffs: [...(target.proposedDiffs || []), chunk.diff as NonNullable<ChatMessage['proposedDiffs']>[number]] };
            return { messages };
          });
          break;
        }
        case 'done': {
          const state = get();
          set({ messages: finalizePartialMessage(state.messages, state.streamingText, state.currentThought) });
          finishTask();
          break;
        }
        case 'cancelled': {
          const state = get();
          const messages = cancelRunningTools(state.messages);
          set({ messages: finalizePartialMessage(messages, state.streamingText, state.currentThought) });
          finishTask('Task stopped.');
          break;
        }
        case 'error': {
          const state = get();
          const partial = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
          set({ messages: [...partial, { id: createId('error'), role: 'assistant', content: `**Agent error:** ${chunk.error || 'The task could not be completed.'}`, timestamp: Date.now() }] });
          finishTask('Task failed.');
          break;
        }
      }
    };

    activeStreamUnsubscribe = window.electronAPI.onAgentStream(handleChunk);
    try {
      const response = await window.electronAPI.startAgentTask({
        taskId,
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
        set({ messages: [...partial, { id: createId('error'), role: 'assistant', content: `**Could not start agent:** ${response.error || 'Unknown error'}`, timestamp: Date.now() }] });
        finishTask('Could not start agent.');
      }
    } catch (err: unknown) {
      if (get().currentTaskId !== taskId) return;
      const state = get();
      const partial = finalizePartialMessage(state.messages, state.streamingText, state.currentThought);
      const message = err instanceof Error ? err.message : String(err);
      set({ messages: [...partial, { id: createId('error'), role: 'assistant', content: `**Could not start agent:** ${message}`, timestamp: Date.now() }] });
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
    set({ messages: [], isRunning: false, currentTaskId: null, pendingApproval: null, streamingText: '', currentThought: '', currentStatus: '', contextTokens: 1200 });
  },
  toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen }))
}));
