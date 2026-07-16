import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';

export type ChatProvider = 'anthropic' | 'openai' | 'openai-compatible';

export const PERSIST_KEYS_AI_CONFIG = [
  'cliAdapter',
  'cliPath',
  'chatProvider',
  'chatModel',
  'chatApiKey',
  'chatBaseUrl',
] as const;

export interface AiConfigState {
  cliAdapter: string;
  cliPath: string;
  chatProvider: ChatProvider;
  chatModel: string;
  chatApiKey: string;
  chatBaseUrl: string;

  setCliAdapter: (v: string) => void;
  setCliPath: (v: string) => void;
  setChatProvider: (v: ChatProvider) => void;
  setChatModel: (v: string) => void;
  setChatApiKey: (v: string) => void;
  setChatBaseUrl: (v: string) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

function isChatProvider(v: unknown): v is ChatProvider {
  return v === 'anthropic' || v === 'openai' || v === 'openai-compatible';
}

export const useAiConfigStore = create<AiConfigState>((set) => ({
  cliAdapter: 'claude',
  cliPath: 'claude',
  chatProvider: 'anthropic',
  chatModel: 'claude-sonnet-4-6',
  chatApiKey: '',
  chatBaseUrl: '',

  setCliAdapter: (v) => { set({ cliAdapter: v }); schedulePersist(); },
  setCliPath: (v) => { set({ cliPath: v }); schedulePersist(); },
  setChatProvider: (v) => { set({ chatProvider: v }); schedulePersist(); },
  setChatModel: (v) => { set({ chatModel: v }); schedulePersist(); },
  setChatApiKey: (v) => { set({ chatApiKey: v }); schedulePersist(); },
  setChatBaseUrl: (v) => { set({ chatBaseUrl: v }); schedulePersist(); },

  hydrate: (blob) => {
    const patch: Partial<AiConfigState> = {};
    if (blob.cliAdapter !== undefined) patch.cliAdapter = blob.cliAdapter as string;
    if (blob.cliPath !== undefined) patch.cliPath = blob.cliPath as string;
    if (isChatProvider(blob.chatProvider)) patch.chatProvider = blob.chatProvider;
    if (blob.chatModel !== undefined) patch.chatModel = blob.chatModel as string;
    if (blob.chatApiKey !== undefined) patch.chatApiKey = blob.chatApiKey as string;
    if (blob.chatBaseUrl !== undefined) patch.chatBaseUrl = blob.chatBaseUrl as string;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_AI_CONFIG,
  getState: () => useAiConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useAiConfigStore.getState().hydrate(blob),
});
