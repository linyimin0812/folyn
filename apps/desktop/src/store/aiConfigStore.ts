import { create } from 'zustand';
import { registerPersistSlice, schedulePersist } from './settingsPersistence';
import { PROVIDER_IDS, type ChatProviderId } from '@/services/providers/catalog';

// ponytail: ChatProvider is a string literal union of the 20 catalog ids.
// The 3 old ids ('anthropic' | 'openai' | 'openai-compatible') are kept
// verbatim — old persisted blobs hydrate without migration.
export type ChatProvider = ChatProviderId;

export const PERSIST_KEYS_AI_CONFIG = [
  'cliAdapter',
  'cliPath',
  'chatProvider',
  'chatModel',
  'chatApiKey',
  'chatBaseUrl',
  'chatAzureDeploymentId',
  'chatAzureApiVersion',
] as const;

export interface AiConfigState {
  cliAdapter: string;
  cliPath: string;
  chatProvider: ChatProvider;
  chatModel: string;
  chatApiKey: string;
  chatBaseUrl: string;
  chatAzureDeploymentId: string;
  chatAzureApiVersion: string;

  setCliAdapter: (v: string) => void;
  setCliPath: (v: string) => void;
  setChatProvider: (v: ChatProvider) => void;
  setChatModel: (v: string) => void;
  setChatApiKey: (v: string) => void;
  setChatBaseUrl: (v: string) => void;
  setChatAzureDeploymentId: (v: string) => void;
  setChatAzureApiVersion: (v: string) => void;

  /** Load this store's slice from the persisted `settings:all` blob. */
  hydrate: (blob: Record<string, unknown>) => void;
}

const PROVIDER_ID_SET = new Set<string>(PROVIDER_IDS);
function isChatProvider(v: unknown): v is ChatProvider {
  return typeof v === 'string' && PROVIDER_ID_SET.has(v);
}

export const useAiConfigStore = create<AiConfigState>((set) => ({
  cliAdapter: 'claude',
  cliPath: 'claude',
  chatProvider: 'anthropic',
  chatModel: 'claude-sonnet-4-6',
  chatApiKey: '',
  chatBaseUrl: '',
  chatAzureDeploymentId: '',
  chatAzureApiVersion: '',

  setCliAdapter: (v) => { set({ cliAdapter: v }); schedulePersist(); },
  setCliPath: (v) => { set({ cliPath: v }); schedulePersist(); },
  setChatProvider: (v) => { set({ chatProvider: v }); schedulePersist(); },
  setChatModel: (v) => { set({ chatModel: v }); schedulePersist(); },
  setChatApiKey: (v) => { set({ chatApiKey: v }); schedulePersist(); },
  setChatBaseUrl: (v) => { set({ chatBaseUrl: v }); schedulePersist(); },
  setChatAzureDeploymentId: (v) => { set({ chatAzureDeploymentId: v }); schedulePersist(); },
  setChatAzureApiVersion: (v) => { set({ chatAzureApiVersion: v }); schedulePersist(); },

  hydrate: (blob) => {
    const patch: Partial<AiConfigState> = {};
    if (blob.cliAdapter !== undefined) patch.cliAdapter = blob.cliAdapter as string;
    if (blob.cliPath !== undefined) patch.cliPath = blob.cliPath as string;
    if (isChatProvider(blob.chatProvider)) patch.chatProvider = blob.chatProvider;
    if (blob.chatModel !== undefined) patch.chatModel = blob.chatModel as string;
    if (blob.chatApiKey !== undefined) patch.chatApiKey = blob.chatApiKey as string;
    if (blob.chatBaseUrl !== undefined) patch.chatBaseUrl = blob.chatBaseUrl as string;
    if (blob.chatAzureDeploymentId !== undefined) patch.chatAzureDeploymentId = blob.chatAzureDeploymentId as string;
    if (blob.chatAzureApiVersion !== undefined) patch.chatAzureApiVersion = blob.chatAzureApiVersion as string;
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

registerPersistSlice({
  keys: PERSIST_KEYS_AI_CONFIG,
  getState: () => useAiConfigStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useAiConfigStore.getState().hydrate(blob),
});
