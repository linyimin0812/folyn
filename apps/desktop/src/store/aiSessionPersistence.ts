import type { CliMessage, FileChange } from '@mochi/cli-adapter';
import { useVaultStore } from './vaultStore';
import { storageClient } from '@/utils/storageClient';
import { debounce } from '@/utils/debounce';
import { sessionStorage } from '@/utils/sessionStorage';
import { useAiStore, createEmptySession } from './aiStore';
import type { AiSession } from './aiStore';
import { isPetPanelWindow } from '@/utils/platform';

// ── Persistence ──

const AI_LEGACY_KEY = 'ai:session';

interface PersistedAiState {
  sessions: AiSession[];
  activeSessionId: string | null;
}

interface LegacyPersistedState {
  messages?: CliMessage[];
  fileChanges?: FileChange[];
}

/** Save all sessions for a vault to individual files */
export async function saveAllSessions(vaultId: string) {
  const { sessions, activeSessionId } = useAiStore.getState();
  await sessionStorage.saveMeta(vaultId, { activeSessionId });
  for (const session of sessions) {
    const { isStreaming: _, ...data } = session;
    await sessionStorage.saveSession(vaultId, session.id, data);
  }
}

/** Load all sessions for a vault from disk */
export async function loadSessionsFromDisk(vaultId: string) {
  let ids = await sessionStorage.listSessionIds(vaultId);

  // Migrate from storageClient if no files on disk yet
  if (ids.length === 0) {
    const intermediate = await storageClient.get<PersistedAiState>(`ai:sessions:${vaultId}`);
    if (intermediate?.sessions && intermediate.sessions.length > 0) {
      for (const s of intermediate.sessions) {
        const { isStreaming: _, ...data } = s as AiSession & { isStreaming?: boolean };
        await sessionStorage.saveSession(vaultId, s.id, data);
      }
      await sessionStorage.saveMeta(vaultId, { activeSessionId: intermediate.activeSessionId ?? intermediate.sessions[0].id });
      await storageClient.remove(`ai:sessions:${vaultId}`);
      ids = await sessionStorage.listSessionIds(vaultId);
    }
  }

  if (ids.length === 0) {
    const session = createEmptySession();
    useAiStore.setState({ sessions: [session], activeSessionId: session.id, loadedVaultId: vaultId });
    return;
  }

  const sessions: AiSession[] = [];
  for (const id of ids) {
    const data = await sessionStorage.loadSession<Omit<AiSession, 'isStreaming'>>(vaultId, id);
    if (data) {
      sessions.push({ ...data, isStreaming: false });
    }
  }

  if (sessions.length === 0) {
    const session = createEmptySession();
    useAiStore.setState({ sessions: [session], activeSessionId: session.id, loadedVaultId: vaultId });
    return;
  }

  sessions.sort((a, b) => b.createdAt - a.createdAt);

  const meta = await sessionStorage.loadMeta(vaultId);
  const activeId = meta?.activeSessionId && sessions.some((s) => s.id === meta.activeSessionId)
    ? meta.activeSessionId
    : sessions[0].id;
  useAiStore.setState({ sessions, activeSessionId: activeId, loadedVaultId: vaultId });
}

let suppressPersist = false;

export function setSuppressPersist(value: boolean) {
  suppressPersist = value;
}

export function persistAiState() {
  if (suppressPersist) return;
  // ponytail: the pet-panel window lacks the $HOME fs ACL that sessionStorage
  // needs (`~/.mochi/vaults/…`), so its own saveAllSessions would reject.
  // It forwards its session mutations to the MAIN window (see
  // startPetChatMirror), which persists them to a separate pet-chat namespace
  // on the panel's behalf — no local write here. Without this guard every
  // pet-chat token would fire an unhandled fs rejection.
  if (isPetPanelWindow()) return;
  // Read the vault id the in-memory sessions belong to — NOT activeVaultId,
  // which lags the session swap inside vaultStore.switchVault and would
  // leak the new vault's sessions into the old vault's directory when the
  // 500ms trailing debounce lands in that gap.
  const vaultId = useAiStore.getState().loadedVaultId;
  if (!vaultId) return;
  saveAllSessions(vaultId);
}

export const debouncedPersist = debounce(persistAiState, 500);

export function setupPersistSubscription() {
  useAiStore.subscribe((state, prev) => {
    if (state.sessions !== prev.sessions) {
      const anyStreaming = state.sessions.some((s) => s.isStreaming);
      if (!anyStreaming) {
        debouncedPersist();
      } else {
        const prevStreaming = prev.sessions.some((s) => s.isStreaming);
        if (prevStreaming && !anyStreaming) {
          debouncedPersist();
        }
      }
    }
  });
}

/** Load AI sessions for the current vault (called after vault init) */
export async function loadAiSessionsForVault() {
  const vaultId = useVaultStore.getState().activeVaultId;
  if (!vaultId) {
    const session = createEmptySession();
    useAiStore.setState({ sessions: [session], activeSessionId: session.id });
    return;
  }

  // Check if vault dir has sessions already
  const ids = await sessionStorage.listSessionIds(vaultId);
  if (ids.length > 0) {
    await loadSessionsFromDisk(vaultId);
    return;
  }

  // Fallback: migrate from legacy storageClient key
  const legacy = await storageClient.get<PersistedAiState & LegacyPersistedState>(AI_LEGACY_KEY);
  if (legacy?.sessions && legacy.sessions.length > 0) {
    for (const s of legacy.sessions) {
      const { isStreaming: _, ...data } = s as AiSession & { isStreaming?: boolean };
      await sessionStorage.saveSession(vaultId, s.id, data);
    }
    await sessionStorage.saveMeta(vaultId, { activeSessionId: legacy.activeSessionId ?? legacy.sessions[0].id });
    await storageClient.remove(AI_LEGACY_KEY);
    await loadSessionsFromDisk(vaultId);
  } else if (legacy?.messages) {
    const session: AiSession = {
      ...createEmptySession(),
      messages: legacy.messages,
      fileChanges: legacy.fileChanges || [],
    };
    const { isStreaming: _, ...data } = session;
    await sessionStorage.saveSession(vaultId, session.id, data);
    await sessionStorage.saveMeta(vaultId, { activeSessionId: session.id });
    await storageClient.remove(AI_LEGACY_KEY);
    await loadSessionsFromDisk(vaultId);
  } else {
    // Also try the intermediate vault-scoped storageClient key
    const intermediate = await storageClient.get<PersistedAiState>(`ai:sessions:${vaultId}`);
    if (intermediate?.sessions && intermediate.sessions.length > 0) {
      for (const s of intermediate.sessions) {
        const { isStreaming: _, ...data } = s as AiSession & { isStreaming?: boolean };
        await sessionStorage.saveSession(vaultId, s.id, data);
      }
      await sessionStorage.saveMeta(vaultId, { activeSessionId: intermediate.activeSessionId ?? intermediate.sessions[0].id });
      await storageClient.remove(`ai:sessions:${vaultId}`);
      await loadSessionsFromDisk(vaultId);
    } else {
      const session = createEmptySession();
      useAiStore.setState({ sessions: [session], activeSessionId: session.id, loadedVaultId: vaultId });
    }
  }
}
