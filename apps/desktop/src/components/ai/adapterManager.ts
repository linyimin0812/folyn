import { createAdapter, type CliAdapter } from '@quill/cli-adapter';
import { useSettingsStore } from '@/store/settingsStore';

export const sessionAdapters = new Map<string, CliAdapter>();

export function getAdapterForSession(sessionId: string): CliAdapter {
  const settings = useSettingsStore.getState();
  const existing = sessionAdapters.get(sessionId);
  if (existing && existing.id === settings.cliAdapter) return existing;
  const adapter = createAdapter(settings.cliAdapter);
  sessionAdapters.set(sessionId, adapter);
  return adapter;
}
