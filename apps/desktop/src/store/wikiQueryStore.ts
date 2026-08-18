// ponytail: per-vault wiki query session (mirror aiStore.switchVaultSessions
// pattern). One entry per vault in storageClient: 'wikiQuery:<vaultId>'.
// Each vault has its own sessionId + turns list. Vault switch swaps them.

import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';
import { useVaultStore } from './vaultStore';
import { debounce } from '@/utils/debounce';

export interface QueryTurn {
  id: string;
  query: string;
  answer: string;
  hits: { path: string; score: number; isNeighbor: boolean }[];
}

interface VaultSession {
  sessionId: string | null;
  turns: QueryTurn[];
}

const MAX_TURNS = 50;

function keyFor(vaultId: string): string {
  return `wikiQuery:${vaultId}`;
}

async function loadVaultSession(vaultId: string): Promise<VaultSession> {
  const data = await storageClient.get<VaultSession>(keyFor(vaultId));
  return data ?? { sessionId: null, turns: [] };
}

async function saveVaultSession(vaultId: string, session: VaultSession): Promise<void> {
  await storageClient.set(keyFor(vaultId), session);
}

const debouncedSave = debounce(async (vaultId: string, session: VaultSession) => {
  await saveVaultSession(vaultId, session);
}, 500);

export interface WikiQueryState {
  vaultId: string | null;
  sessionId: string | null;
  turns: QueryTurn[];
  isRunning: boolean;

  setRunning: (v: boolean) => void;
  addTurn: (turn: QueryTurn) => void;
  newSession: () => void;
  clearHistory: () => void;
  setSessionId: (id: string) => void;
  switchVaultSessions: (newVaultId: string) => Promise<void>;
  loadForCurrentVault: () => Promise<void>;
}

export const useWikiQueryStore = create<WikiQueryState>((set, get) => ({
  vaultId: null,
  sessionId: null,
  turns: [],
  isRunning: false,

  setRunning: (v) => set({ isRunning: v }),

  addTurn: (turn) => {
    const { vaultId, turns } = get();
    if (!vaultId) return;
    const next = [...turns, turn].slice(-MAX_TURNS);
    set({ turns: next });
    void debouncedSave(vaultId, { sessionId: get().sessionId, turns: next });
  },

  newSession: () => {
    const { vaultId } = get();
    set({ sessionId: null, turns: [] });
    if (vaultId) void debouncedSave(vaultId, { sessionId: null, turns: [] });
  },

  clearHistory: () => {
    const { vaultId } = get();
    set({ turns: [] });
    if (vaultId) void debouncedSave(vaultId, { sessionId: get().sessionId, turns: [] });
  },

  setSessionId: (id) => {
    const { vaultId, turns } = get();
    set({ sessionId: id });
    if (vaultId) void debouncedSave(vaultId, { sessionId: id, turns });
  },

  switchVaultSessions: async (newVaultId) => {
    // Save current vault's session first
    const { vaultId: curVaultId, sessionId: curSid, turns: curTurns } = get();
    if (curVaultId && curVaultId !== newVaultId) {
      await saveVaultSession(curVaultId, { sessionId: curSid, turns: curTurns });
    }
    // Load target vault's session
    const next = await loadVaultSession(newVaultId);
    set({ vaultId: newVaultId, sessionId: next.sessionId, turns: next.turns });
  },

  loadForCurrentVault: async () => {
    const vaultId = useVaultStore.getState().activeVaultId;
    if (!vaultId) return;
    const session = await loadVaultSession(vaultId);
    set({ vaultId, sessionId: session.sessionId, turns: session.turns });
  },
}));
