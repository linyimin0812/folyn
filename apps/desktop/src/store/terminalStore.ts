import { create } from 'zustand';
import { isTauri } from '@/utils/platform';

export type TerminalStatus = 'spawning' | 'running' | 'exited';

export interface TerminalSessionInfo {
  id: string;
  title: string;
  status: TerminalStatus;
  createdAt: number;
}

interface TerminalState {
  sessions: TerminalSessionInfo[];
  activeId: string | null;
  /** Add a tab (status "spawning"); TerminalView actually spawns the PTY. */
  addSession: () => string;
  removeSession: (id: string) => void;
  setActive: (id: string) => void;
  setStatus: (id: string, status: TerminalStatus) => void;
  setTitle: (id: string, title: string) => void;
  /** Close a tab and kill its PTY (fire-and-forget; TerminalView cleans up too). */
  closeSession: (id: string) => void;
}

let termCounter = 0;

function nextTerminalId(): string {
  termCounter += 1;
  return `term-${Date.now()}-${termCounter}`;
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: [],
  activeId: null,

  addSession: () => {
    const id = nextTerminalId();
    const title = `终端 ${get().sessions.length + 1}`;
    set((state) => ({
      sessions: [...state.sessions, { id, title, status: 'spawning', createdAt: Date.now() }],
      activeId: id,
    }));
    return id;
  },

  removeSession: (id) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.id !== id);
      return {
        sessions,
        activeId: state.activeId === id ? sessions[sessions.length - 1]?.id ?? null : state.activeId,
      };
    }),

  setActive: (id) => set({ activeId: id }),

  setStatus: (id, status) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, status } : s)),
    })),

  setTitle: (id, title) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.id === id ? { ...s, title } : s)),
    })),

  closeSession: (id) => {
    if (isTauri()) {
      // Best effort — TerminalView also kills on unmount; avoid double-kill
      // harm (killing a missing session is a no-op on the Rust side).
      void import('@tauri-apps/api/core').then(({ invoke }) => {
        invoke('terminal_kill', { id }).catch(() => {});
      });
    }
    get().removeSession(id);
  },
}));
