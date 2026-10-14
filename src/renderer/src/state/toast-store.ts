import { create } from 'zustand';

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number; // ms, defaults to 4500
  action?: ToastAction;
  createdAt: number;
}

interface ToastState {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, 'id' | 'createdAt'>) => string;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  addToast: (toast) => {
    const id = `toast_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const newToast: Toast = {
      ...toast,
      id,
      createdAt: Date.now(),
      duration: toast.duration ?? 4500
    };
    set((state) => ({
      toasts: [...state.toasts.slice(-4), newToast] // keep max 5 visible toasts
    }));
    return id;
  },
  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id)
    })),
  clearToasts: () => set({ toasts: [] })
}));

export const toast = {
  info: (title: string, message?: string, action?: ToastAction) =>
    useToastStore.getState().addToast({ type: 'info', title, message, action }),
  success: (title: string, message?: string, action?: ToastAction) =>
    useToastStore.getState().addToast({ type: 'success', title, message, action }),
  warning: (title: string, message?: string, action?: ToastAction) =>
    useToastStore.getState().addToast({ type: 'warning', title, message, action }),
  error: (title: string, message?: string, action?: ToastAction) =>
    useToastStore.getState().addToast({ type: 'error', title, message, action, duration: 6500 })
};
