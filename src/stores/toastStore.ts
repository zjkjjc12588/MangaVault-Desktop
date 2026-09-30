import { create } from "zustand";

export type ToastTone = "info" | "success" | "error";

export interface AppToast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
}

interface ToastState {
  toasts: AppToast[];
  push: (toast: Omit<AppToast, "id">) => void;
  dismiss: (id: string) => void;
}

export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],
  push(toast) {
    const id = crypto.randomUUID();
    set({ toasts: [...get().toasts, { id, ...toast }].slice(-5) });
  },
  dismiss(id) {
    set({ toasts: get().toasts.filter((toast) => toast.id !== id) });
  },
}));
