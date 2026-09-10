/**
 * User file-type provider preference (doc §53 — Open With / override
 * persistence).
 *
 * When a user picks a provider via "Open With", the choice is remembered so
 * the same extension opens with that provider next time, overriding the
 * priority-based default (doc §53 resolution order: user preference →
 * priority → install order → fallback File Viewer).
 *
 * Persisted via the shared storageClient (per-vault JSON), matching the
 * editor viewMode persistence path.
 */

import { create } from 'zustand';
import { storageClient } from '@/utils/storageClient';

const PREF_KEY = 'editor:fileTypePreference';

export interface FileTypePreferenceState {
  /** extension (no dot, lowercased) → preferred provider id. */
  preferences: Record<string, string>;
  /** Hydrate from disk on startup. */
  hydrate: () => Promise<void>;
  /** Get the user's preferred provider for an extension, or null. */
  getPreferredProvider: (ext: string) => string | null;
  /** Remember the choice for an extension; persists to disk. */
  setPreference: (ext: string, providerId: string) => void;
  /** Forget the choice for an extension (revert to priority default). */
  clearPreference: (ext: string) => void;
}

function normalizeExt(ext: string): string {
  return ext.toLowerCase().replace(/^\./, '');
}

export const useFileTypePreferenceStore = create<FileTypePreferenceState>((set, get) => ({
  preferences: {},
  async hydrate() {
    const saved = await storageClient.get<Record<string, string>>(PREF_KEY);
    if (saved && typeof saved === 'object') {
      set({ preferences: saved });
    }
  },
  getPreferredProvider(ext) {
    return get().preferences[normalizeExt(ext)] ?? null;
  },
  setPreference(ext, providerId) {
    const key = normalizeExt(ext);
    const next = { ...get().preferences, [key]: providerId };
    set({ preferences: next });
    void storageClient.set(PREF_KEY, next);
  },
  clearPreference(ext) {
    const key = normalizeExt(ext);
    const { [key]: _drop, ...next } = get().preferences;
    set({ preferences: next });
    void storageClient.set(PREF_KEY, next);
  },
}));

// Hydrate on module load (best-effort; resolves before first openFile in most
// cases, and the in-memory map is the source of truth thereafter).
void useFileTypePreferenceStore.getState().hydrate();
