import { createAdapter, type CliAdapter } from '@quill/cli-adapter';
import { useAiConfigStore } from '@/store/aiConfigStore';

export const sessionAdapters = new Map<string, CliAdapter>();

export function getAdapterForSession(sessionId: string): CliAdapter {
  const cliAdapter = useAiConfigStore.getState().cliAdapter;
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === cliAdapter) return existing;
  const adapter = createAdapter(cliAdapter);
  sessionAdapters.set(sessionId, adapter);
  return adapter;
}
