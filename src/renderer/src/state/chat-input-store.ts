import { create } from 'zustand';

export interface Attachment {
  id: string;
  type: 'media' | 'file' | 'mention';
  name: string;
  content: string;
  mimeType?: string;
}

export const MAX_ATTACHMENTS = 7;

interface ChatInputState {
  attachments: Attachment[];
  addAttachment: (attachment: Attachment) => void;
  removeAttachment: (id: string) => void;
  clearAttachments: () => void;
}

function makeAttachmentId(): string {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export const useChatInputStore = create<ChatInputState>((set, get) => ({
  attachments: [],
  addAttachment: (attachment) => {
    if (!attachment || !attachment.name) return;
    const current = get().attachments;
    if (current.length >= MAX_ATTACHMENTS) {
      set({ attachments: [...current.slice(1), { ...attachment, id: makeAttachmentId() }] });
      return;
    }
    const exists = current.some((item) => item.type === attachment.type && item.name === attachment.name);
    if (exists) return;
    set({ attachments: [...current, { ...attachment, id: attachment.id || makeAttachmentId() }] });
  },
  removeAttachment: (id) => {
    set({ attachments: get().attachments.filter((attachment) => attachment.id !== id) });
  },
  clearAttachments: () => {
    set({ attachments: [] });
  }
}));
