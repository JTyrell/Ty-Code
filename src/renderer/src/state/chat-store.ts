import { create } from 'zustand';
import type {
  ChatMessage,
  ProviderSettings,
  ProviderType,
  ToolCall,
  ToolResult,
  ProposedDiff,
  AgentStreamChunk
} from '../../preload/types';

interface ChatState {
  messages: ChatMessage[];
  isRunning: boolean;
  currentTaskId: string | null;
  currentStatus: string;
  currentThought: string;
  streamingText: string;
  settings: ProviderSettings | null;
  isSettingsOpen: boolean;
  isTerminalOpen: boolean;

  // Actions
  initSettings: () => Promise<void>;
  saveSettings: (updates: Partial<ProviderSettings>) => Promise<void>;
  sendMessage: (prompt: string, workspacePath: string, activeFilePath?: string, activeFileContent?: string) => Promise<void>;
  stopTask: () => Promise<void>;
  clearChat: () => void;
  toggleSettings: () => void;
  toggleTerminal: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  isRunning: false,
  currentTaskId: null,
  currentStatus: '',
  currentThought: '',
  streamingText: '',
  settings: null,
  isSettingsOpen: false,
  isTerminalOpen: false,

  initSettings: async () => {
    try {
      const res = await window.electronAPI.getSettings();
      if (res.success && res.data) {
        set({ settings: res.data });
      }
    } catch (err) {
      console.error('Failed to load settings:', err);
    }
  },

  saveSettings: async (updates: Partial<ProviderSettings>) => {
    try {
      const res = await window.electronAPI.saveSettings(updates);
      if (res.success) {
        const { settings } = get();
        if (settings) {
          set({ settings: { ...settings, ...updates } });
        }
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  },

  sendMessage: async (
    prompt: string,
    workspacePath: string,
    activeFilePath?: string,
    activeFileContent?: string
  ) => {
    const { messages, isRunning } = get();
    if (isRunning || !prompt.trim()) return;

    const userMessage: ChatMessage = {
      id: `msg_${Date.now()}`,
      role: 'user',
      content: prompt,
      timestamp: Date.now()
    };

    set({
      messages: [...messages, userMessage],
      isRunning: true,
      currentStatus: 'Starting task...',
      currentThought: '',
      streamingText: ''
    });

    try {
      // Listen for agent streams
      const unsubscribe = window.electronAPI.onAgentStream((chunk: AgentStreamChunk) => {
        const state = get();

        switch (chunk.type) {
          case 'token':
            set({ streamingText: state.streamingText + (chunk.content || '') });
            break;

          case 'thought':
            set({ currentThought: state.currentThought + (chunk.content || '') });
            break;

          case 'status':
            set({ currentStatus: chunk.content || '' });
            break;

          case 'tool_call': {
            if (chunk.toolCall) {
              const tc = chunk.toolCall;
              // If there was streaming text before the tool call, commit it to history
              const currentMessages = get().messages;
              const lastMsg = currentMessages[currentMessages.length - 1];

              if (lastMsg && lastMsg.role === 'assistant') {
                const updated = {
                  ...lastMsg,
                  toolCalls: [...(lastMsg.toolCalls || []), tc]
                };
                set({
                  messages: [...currentMessages.slice(0, -1), updated]
                });
              } else {
                const assistantMsg: ChatMessage = {
                  id: `asst_${Date.now()}`,
                  role: 'assistant',
                  content: state.streamingText,
                  toolCalls: [tc],
                  timestamp: Date.now()
                };
                set({
                  messages: [...currentMessages, assistantMsg],
                  streamingText: ''
                });
              }
            }
            break;
          }

          case 'tool_result': {
            if (chunk.toolResult) {
              const tr = chunk.toolResult;
              const currentMessages = get().messages;
              const lastMsg = currentMessages[currentMessages.length - 1];

              // Attach result to the assistant message or as a tool message
              const toolMsg: ChatMessage = {
                id: `tool_${Date.now()}`,
                role: 'tool',
                content: tr.output,
                toolResult: tr,
                timestamp: Date.now()
              };
              set({
                messages: [...currentMessages, toolMsg]
              });
            }
            break;
          }

          case 'diff': {
            if (chunk.diff) {
              const diff = chunk.diff;
              const currentMessages = get().messages;
              const lastMsg = currentMessages[currentMessages.length - 1];
              if (lastMsg) {
                const updated = {
                  ...lastMsg,
                  proposedDiffs: [...(lastMsg.proposedDiffs || []), diff]
                };
                set({
                  messages: [...currentMessages.slice(0, -1), updated]
                });
              }
            }
            break;
          }

          case 'done': {
            unsubscribe();
            const currentMessages = get().messages;
            if (get().streamingText) {
              const finalMsg: ChatMessage = {
                id: `asst_${Date.now()}`,
                role: 'assistant',
                content: get().streamingText,
                timestamp: Date.now()
              };
              set({
                messages: [...currentMessages, finalMsg]
              });
            }
            set({
              isRunning: false,
              currentStatus: '',
              streamingText: '',
              currentThought: ''
            });
            break;
          }

          case 'error': {
            unsubscribe();
            const currentMessages = get().messages;
            const errMsg: ChatMessage = {
              id: `err_${Date.now()}`,
              role: 'assistant',
              content: `⚠️ **Agent Error**: ${chunk.error}`,
              timestamp: Date.now()
            };
            set({
              messages: [...currentMessages, errMsg],
              isRunning: false,
              currentStatus: '',
              streamingText: '',
              currentThought: ''
            });
            break;
          }
        }
      });

      const res = await window.electronAPI.startAgentTask({
        prompt,
        workspacePath,
        history: get().messages,
        activeFilePath,
        activeFileContent
      });

      if (res.success && res.data) {
        set({ currentTaskId: res.data });
      } else {
        set({
          isRunning: false,
          currentStatus: '',
          streamingText: ''
        });
        console.error('Failed to start agent task:', res.error);
      }
    } catch (err) {
      set({ isRunning: false, currentStatus: '', streamingText: '' });
      console.error('Exception starting task:', err);
    }
  },

  stopTask: async () => {
    const { currentTaskId } = get();
    if (currentTaskId) {
      await window.electronAPI.stopAgentTask(currentTaskId);
      set({ isRunning: false, currentStatus: 'Task stopped.', currentTaskId: null });
    }
  },

  clearChat: () => {
    set({ messages: [], streamingText: '', currentThought: '', currentStatus: '' });
  },

  toggleSettings: () => set((state) => ({ isSettingsOpen: !state.isSettingsOpen })),
  toggleTerminal: () => set((state) => ({ isTerminalOpen: !state.isTerminalOpen }))
}));
