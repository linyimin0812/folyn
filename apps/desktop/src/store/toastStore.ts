// ponytail: ephemeral toast queue. No persistence. FIFO, 1 visible at a time.
// Reuses .sw-toast CSS (index.css:1100). Auto-dismiss after 3s unless actioned.

import { create } from 'zustand';

export interface ToastAction {
  label: string;
  run: () => void;
}

export interface ToastEntry {
  id: string;
  message: string;
  action?: ToastAction;
}

export interface ToastState {
  queue: ToastEntry[];
  push: (message: string, action?: ToastAction, durationMs?: number) => string;
  dismiss: (id: string) => void;
}

let counter = 0;

export const useToastStore = create<ToastState>((set, get) => ({
  queue: [],

  push: (message, action, durationMs = 3000) => {
    const id = `toast-${++counter}-${Date.now()}`;
    set((s) => ({ queue: [...s.queue, { id, message, action }] }));
    if (durationMs > 0) {
      setTimeout(() => get().dismiss(id), durationMs);
    }
    return id;
  },

  dismiss: (id) => set((s) => ({ queue: s.queue.filter((t) => t.id !== id) })),
}));
