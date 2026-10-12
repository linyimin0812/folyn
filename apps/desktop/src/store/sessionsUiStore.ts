/**
 * sessionsUiStore — UI-state coordination between the Sessions sidebar list
 * (`components/sessions/SessionsPanel`) and the main work-area detail view
 * (`components/sessions/SessionDetailView`, rendered by WorkArea when
 * `activePanel === 'sessions'`).
 *
 * The list and the detail live in different layout regions, so the shared
 * state (open detail, saved-evidence fallback view, locator notices, and the
 * back-to-list refresh signal) must live here. Selection / pending-save /
 * AI-generation state is included because it must reset atomically whenever
 * the detail is (re)opened or replaced — a selection never silently
 * retargets onto new content.
 *
 * This store is UI state ONLY: discovery, reading and saving stay in
 * `services/externalSessions/*`; the async flows live in the two components.
 */

import { create } from 'zustand';
import { registerPersistSlice } from './settingsPersistence';
import type {
  ExternalSessionDetail,
  ExternalSessionMessage,
  TextRangeSelection,
} from '@/services/externalSessions';
import type { EvidenceRecord } from '@/services/externalSessions/captureService';
import type { ProviderModelPair } from '@/store/aiConfigStore';

export interface PendingSave {
  detail: ExternalSessionDetail;
  selected: ExternalSessionMessage[];
  /** Immutable snapshot: text ranges selected at save-request time. */
  textRanges: TextRangeSelection[];
  /** When set, this is an AI-organized note save — the note body is the
   *  user-EDITED draft (snapshot taken at save-request time), not the
   *  verbatim rendering. The evidence bundle semantics are identical. */
  noteMarkdown?: string;
}

/** Generation states — every failure is explicit, never silent. */
export type GenStatus =
  | 'idle'
  | 'generating'
  | 'no-model'
  | 'too-large'
  | 'unsupported-image'
  | 'insufficient'
  | 'error'
  | 'draft';

export interface EvidenceView {
  record: EvidenceRecord;
  path: string;
}

const RESET_SELECTION = {
  selectedIds: new Set<string>(),
  textRanges: [] as TextRangeSelection[],
  rangePickerMsg: null as ExternalSessionMessage | null,
};

const RESET_GEN = {
  genStatus: 'idle' as GenStatus,
  genError: '',
  genDraft: '',
  genTextOnly: false,
  genCtx: null as PendingSave | null,
};

/** Persisted slice keys — ONLY the flow preference survives restarts. */
export const PERSIST_KEYS_SESSIONS = ['notePair'] as const;

/** ProviderModelPair guard for the persisted blob (same style as
 *  aiConfigStore's unexported guard). Malformed values hydrate to null —
 *  the default (global chat pair). */
function isProviderModelPair(v: unknown): v is ProviderModelPair {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.provider === 'string' && typeof r.model === 'string';
}

/** Data-only initial state (actions excluded) — tests reset with it. */
export const INITIAL_SESSIONS_UI = {
  detail: null as ExternalSessionDetail | null,
  detailLoading: false,
  ...RESET_SELECTION,
  pendingSave: null as PendingSave | null,
  evidence: null as EvidenceView | null,
  changedIds: null as string[] | null,
  branchChanged: false,
  ...RESET_GEN,
  /** User's provider/model choice for AI note generation in THIS flow (null =
   *  the app chat pair, the default). Deliberately NOT in RESET_GEN — the
   *  choice survives reopening a session (a flow preference, not selection
   *  state) and never writes aiConfigStore's global chat pair. The ONLY
   *  persisted field: written to the `sessions` storage file on change and
   *  rehydrated at startup via `loadSettings()`. */
  notePair: null as ProviderModelPair | null,
  listRefreshToken: 0,
};

interface SessionsUiState {
  detail: ExternalSessionDetail | null;
  detailLoading: boolean;
  selectedIds: Set<string>;
  textRanges: TextRangeSelection[];
  rangePickerMsg: ExternalSessionMessage | null;
  pendingSave: PendingSave | null;
  /** Saved-evidence fallback view (records.json), when the live source is
   *  missing or unreadable. Frozen copy from capture time — never claimed
   *  to match the live source. */
  evidence: EvidenceView | null;
  /** Set after landing via a locator whose recorded message ids no longer
   *  resolve in the live session — content changed since capture. */
  changedIds: string[] | null;
  /** Set when a locator's recorded branch could not be read (e.g. it
   *  vanished): the default projection opened, which is NOT the recorded
   *  branch — the notice says so instead of implying a match. */
  branchChanged: boolean;
  genStatus: GenStatus;
  genError: string;
  genDraft: string;
  /** True after the user explicitly chose text-only processing for an
   *  image-unsupported model; the images stay in the saved evidence. */
  genTextOnly: boolean;
  /** Selection snapshot the current generation/error/draft belongs to. */
  genCtx: PendingSave | null;
  /** Provider/model pair used by the NEXT AI note generation (null = the app
   *  chat pair). Set from the detail view's pair selector; persisted to the
   *  `sessions` storage file so the choice survives app restarts. */
  notePair: ProviderModelPair | null;
  /** Bumped by "back to list" — the sidebar list re-runs discovery. */
  listRefreshToken: number;

  // ── detail / navigation ──
  /** Any (re)read of a conversation: clears notices + evidence, resets
   *  selection and generation state (in-progress selections never silently
   *  retarget onto new content), marks loading. Callers set `detail` to the
   *  loaded result (or `clearDetail` first when the old detail must go). */
  beginDetailLoad: () => void;
  /** Set the loaded detail; clears loading + resets selection/gen. */
  setDetail: (detail: ExternalSessionDetail) => void;
  /** Clear the detail without closing the flow (locator re-entry). */
  clearDetail: () => void;
  /** Error tail of a load: stop the spinner, keep prior state. */
  finishDetailLoad: () => void;
  /** Back to the list: clears everything and bumps listRefreshToken. */
  closeDetail: () => void;
  showEvidence: (evidence: EvidenceView) => void;
  closeEvidence: () => void;
  setNavNotices: (changedIds: string[] | null, branchChanged: boolean) => void;

  // ── selection ──
  clearSelection: () => void;
  /** Toggle a whole-message selection. Block-selecting a message supersedes
   *  any text range on it. */
  toggleMessageSelect: (id: string) => void;
  /** One range per message: a new range replaces the old one, and supersedes
   *  a whole-message selection of the same message. */
  addTextRange: (range: TextRangeSelection) => void;
  removeTextRange: (messageId: string) => void;
  /** "Select all" means the CURRENT BRANCH only — detail.messages is already
   *  the branch projection (sibling branches never join). Optional `ids`
   *  narrows the selection to the caller's display projection (the detail
   *  view's text-only mode selects only its visible messages). Toggle: when
   *  every target id is already selected, the click instead CLEARS the
   *  whole-message selection (text ranges are a separate selection mode and
   *  survive the toggle-off). */
  selectEntireBranch: (ids?: string[]) => void;
  setRangePickerMsg: (msg: ExternalSessionMessage | null) => void;
  setPendingSave: (pending: PendingSave | null) => void;

  // ── AI note generation ──
  genStart: (ctx: PendingSave, textOnly: boolean) => void;
  genSucceed: (markdown: string) => void;
  genFail: (status: Exclude<GenStatus, 'idle' | 'generating' | 'draft'>, error: string) => void;
  /** Back to idle (cancel / dismiss / cancelled promise). */
  genIdle: () => void;
  setGenTextOnly: (textOnly: boolean) => void;
  setGenDraft: (markdown: string) => void;
  setNotePair: (pair: ProviderModelPair | null) => void;
  /** Load the persisted slice (`notePair`) from the `sessions` storage file.
   *  Called by loadSettings() at startup; malformed values fall through to
   *  null. */
  hydrate: (blob: Record<string, unknown>) => void;
}

export const useSessionsUiStore = create<SessionsUiState>((set, get) => ({
  ...INITIAL_SESSIONS_UI,

  beginDetailLoad: () =>
    set({ ...RESET_SELECTION, ...RESET_GEN, evidence: null, changedIds: null, branchChanged: false, detailLoading: true }),
  setDetail: (detail) =>
    set({ ...RESET_SELECTION, ...RESET_GEN, detail, detailLoading: false }),
  clearDetail: () => set({ detail: null }),
  finishDetailLoad: () => set({ detailLoading: false }),
  closeDetail: () =>
    set((s) => ({
      ...RESET_SELECTION,
      ...RESET_GEN,
      detail: null,
      detailLoading: false,
      evidence: null,
      changedIds: null,
      branchChanged: false,
      pendingSave: null,
      listRefreshToken: s.listRefreshToken + 1,
    })),
  showEvidence: (evidence) => set({ evidence, detailLoading: false }),
  closeEvidence: () => set({ evidence: null }),
  setNavNotices: (changedIds, branchChanged) => set({ changedIds, branchChanged }),

  clearSelection: () => set(RESET_SELECTION),
  toggleMessageSelect: (id) =>
    set((s) => {
      const next = new Set(s.selectedIds);
      const wasSelected = next.has(id);
      if (wasSelected) next.delete(id);
      else next.add(id);
      return {
        selectedIds: next,
        textRanges: wasSelected ? s.textRanges : s.textRanges.filter((r) => r.messageId !== id),
      };
    }),
  addTextRange: (range) =>
    set((s) => {
      const selectedIds = new Set(s.selectedIds);
      selectedIds.delete(range.messageId);
      return {
        textRanges: [...s.textRanges.filter((r) => r.messageId !== range.messageId), range],
        selectedIds,
      };
    }),
  removeTextRange: (messageId) =>
    set((s) => ({ textRanges: s.textRanges.filter((r) => r.messageId !== messageId) })),
  selectEntireBranch: (ids) => {
    const { detail, selectedIds } = get();
    if (!detail) return;
    const target = ids ?? detail.messages.map((m) => m.id);
    // Toggle-off: whole branch already selected → clear ONLY the message
    // selection; text ranges are a separate mode and stay untouched.
    if (target.length > 0 && target.every((id) => selectedIds.has(id))) {
      const next = new Set(selectedIds);
      for (const id of target) next.delete(id);
      set({ selectedIds: next });
      return;
    }
    set({ selectedIds: new Set(target), textRanges: [] });
  },
  setRangePickerMsg: (msg) => set({ rangePickerMsg: msg }),
  setPendingSave: (pending) => set({ pendingSave: pending }),

  genStart: (ctx, textOnly) => set({ genCtx: ctx, genStatus: 'generating', genTextOnly: textOnly, genError: '' }),
  genSucceed: (markdown) => set({ genDraft: markdown, genStatus: 'draft' }),
  genFail: (status, error) => set({ genStatus: status, genError: error }),
  genIdle: () => set({ genStatus: 'idle' }),
  setGenTextOnly: (textOnly) => set({ genTextOnly: textOnly }),
  setGenDraft: (markdown) => set({ genDraft: markdown }),
  setNotePair: (pair) => { set({ notePair: pair }); persist(); },
  hydrate: (blob) => {
    const patch: Partial<SessionsUiState> = {};
    if (blob.notePair !== undefined) {
      patch.notePair = isProviderModelPair(blob.notePair) ? blob.notePair : null;
    }
    if (Object.keys(patch).length > 0) set(patch);
  },
}));

const persist = registerPersistSlice({
  name: 'sessions',
  keys: PERSIST_KEYS_SESSIONS,
  getState: () => useSessionsUiStore.getState() as unknown as Record<string, unknown>,
  hydrate: (blob) => useSessionsUiStore.getState().hydrate(blob),
});
