/**
 * Session detail — the MAIN WORK-AREA view for one external conversation
 * (rendered by WorkArea when `activePanel === 'sessions'` and a session is
 * open in {@link useSessionsUiStore}). Layout mirrors AiPanel: ONE merged
 * header row (back-to-list, title, source pill, branch switcher, the
 * provenance segment "cwd · start time", the quiet show-tools pill and the
 * locator button) whose height matches the SessionsPanel header zone
 * (collinear border lines), notice banners, the shared `ChatMessageList`
 * at full width, and the selection UI as a bottom action bar (like a chat
 * input bar).
 *
 * The sidebar (`SessionsPanel`) is list-only; this view owns the
 * conversation reading, selection, capture and AI-note flows:
 *  - multi-message selection (always on), whole-branch selection, and
 *    per-message text ranges (`TextRangePicker`, a centered dialog);
 *  - verbatim capture ("收录") writes a Markdown note + evidence bundle into
 *    the current vault via the externalSessions service — missing material
 *    is shown BEFORE saving (notice) and recorded in the capture;
 *  - AI-organized notes ("AI 整理") send EXACTLY the selection through the
 *    app model bridge as one isolated request, then show an editable draft
 *    (centered dialog). Every failure is an explicit state; nothing is
 *    written before the user confirms.
 *
 * The save-confirmation flow re-reads the source and verifies the selection
 * snapshot is still fresh; a changed/vanished source requires reselection.
 *
 * The header's "打开来源" button owns slice-6 locator navigation: a saved
 * note's copied locator block is followed to the live session (or the saved
 * evidence bundle when the source is gone) with honest change notices.
 *
 * Shared chat components stay store-free: vault/fileTree/toast coupling
 * lives here (the consumer), not in `components/chat/`.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, AlertTriangle, ListChecks, Locate, Sparkles, Wrench, X } from 'lucide-react';
import type { CliMessage, ToolCallInfo } from '@folyn/cli-adapter';
import { ChatMessageList } from '@/components/chat/ChatMessageList';
import { SaveMessageDialog } from '@/components/ai/SaveMessageDialog';
import {
  discoverExternalSessions,
  readExternalSession,
  saveExternalSessionCapture,
  sanitizeFilename,
  CaptureConflictError,
} from '@/services/externalSessions';
// Real (unmocked) pure module — the rejection stringifier must run for real.
import { errorToMessage } from '@/services/externalSessions/errorToMessage';
// Real (unmocked) module: the locator parser is pure and must run for real.
import { parseSourceLocator } from '@/services/externalSessions/sourceLocator';
import type { SourceLocator } from '@/services/externalSessions/sourceLocator';
// Real (unmocked) module: the format constant must match the real reader.
import { EVIDENCE_FORMAT, type EvidenceRecord } from '@/services/externalSessions/captureService';
// Real (unmocked) module: the confirm-time freshness check must run the
// actual comparison logic, not a service mock.
import { StaleSelectionError, verifySelectionFresh } from '@/services/externalSessions/captureService';
// Slice 5: AI-organized notes. Error classes come from the real module even
// when `generateSessionNote` is stubbed in tests (see the vi.mock below).
import {
  generateSessionNote,
  InsufficientContextError,
  NoModelConfiguredError,
  NoteGenerationCancelledError,
  SelectionTooLargeError,
  UnsupportedImageModelError,
} from '@/services/externalSessions/noteGeneration';
import type {
  ExternalSessionDetail,
  ExternalSessionMessage,
  TextRangeSelection,
} from '@/services/externalSessions';
import { useSessionsUiStore, type PendingSave } from '@/store/sessionsUiStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { useNavStore } from '@/store/navStore';
import { PairSelector, useEnabledPairs } from '@/components/ai/PairSelector';
import { isTauri } from '@/utils/platform';
import { useVaultStore } from '@/store/vaultStore';
import { useToastStore } from '@/store/toastStore';

/** Notice/banner — ONE consistent design: quiet surf surface, thin brd2
 *  frame, 2px left accent bar, icon lead, theme-var based so dark mode
 *  stays correct. Amber = warn; `inset` adds the detail-area margins
 *  (inside the action bar the bar's own px-3 + gap already provide them). */
const noticeCls =
  'flex items-center gap-1.5 px-3 py-[7px] text-[11px] bg-surf border border-brd2 border-l-2 rounded-md shrink-0';
const warnNoticeCls = `${noticeCls} border-l-amber text-amber`;

function WarnNotice({ children, testid, inset = true }: {
  children: React.ReactNode;
  testid?: string;
  inset?: boolean;
}): React.JSX.Element {
  return (
    <div className={`${warnNoticeCls} ${inset ? 'mt-2 mx-3 mb-1.5' : ''}`} data-testid={testid}>
      <AlertTriangle size={12} className="shrink-0" />
      <span className="flex-1 min-w-0">{children}</span>
    </div>
  );
}

/** Action buttons — SaveMessageDialog conventions (primary = solid accent,
 *  secondary = panel bg + border) with press feedback (scale, never below
 *  0.95) and property-specific transitions. */
const btnPrimary =
  'shrink-0 inline-flex items-center justify-center gap-1.5 h-[28px] px-3.5 whitespace-nowrap rounded-md text-[12px] font-ui bg-acc text-white border border-acc hover:opacity-90 active:scale-[0.96] transition-[opacity,transform] duration-[140ms]';
const btnSecondary =
  'shrink-0 inline-flex items-center justify-center gap-1.5 h-[28px] px-3.5 whitespace-nowrap rounded-md text-[12px] font-ui bg-panel text-t2 border border-brd hover:bg-hov hover:text-t1 active:scale-[0.96] transition-[color,background-color,transform] duration-[140ms] disabled:opacity-40 disabled:cursor-not-allowed';

/** Quiet in-banner action button — MultiSelectToolbar conventions
 *  (transparent, hov feedback, no border). */
const bannerBtn =
  'shrink-0 py-[2px] px-2 rounded-md text-[11px] font-ui bg-transparent border-none cursor-pointer hover:bg-hov transition-colors duration-[120ms]';

/** Centered dialog shell (SaveMessageDialog conventions: fixed backdrop,
 *  panel card, soft large shadow) — these render over the whole work area,
 *  not inside a 224px sidebar column. */
const modalBackdrop = 'fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center p-4';
const modalCard = 'w-full bg-panel border border-brd rounded-[10px] py-5 px-6 shadow-[0_8px_32px_rgba(0,0,0,0.18)] flex flex-col gap-2.5';

function parseToolInput(raw: string): Record<string, unknown> | undefined {
  if (raw === '') return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // not JSON — show as a raw input string
  }
  return { input: raw };
}

function toCliMessage(m: ExternalSessionMessage): CliMessage {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    timestamp: m.timestamp ?? 0,
    toolCalls: m.toolCalls.map<ToolCallInfo>((tc) => ({
      id: tc.callId,
      name: tc.name,
      status: 'done',
      input: parseToolInput(tc.input),
      output: tc.output ?? undefined,
    })),
    attachments: m.images.map((img, i) => ({
      name: `image-${i + 1}.png`,
      path: '',
      type: 'image' as const,
      previewUrl: img.dataUrl,
    })),
  };
}

/** Text-only reading projection (the DEFAULT display mode): hides tool-only
 *  carrier messages (assistant records with no text and no images) and strips
 *  tool records — plus tool-output missing entries — from kept messages, so a
 *  selection in this mode captures exactly the visible conversation text and
 *  the tool-evidence preview stays honest. Thinking never reaches `content`
 *  (all three adapters mark it display-hidden), so text stays text.
 *  ponytail: display-level projection, not a service concern — the capture
 *  service already tolerates empty rawToolRecords. */
function projectTextOnly(messages: ExternalSessionMessage[]): ExternalSessionMessage[] {
  return messages
    .filter((m) => m.role === 'user' || m.content !== '' || m.images.length > 0)
    .map((m) =>
      m.toolCalls.length === 0 && !m.missing.some((x) => x.kind === 'tool-output')
        ? m
        : {
            ...m,
            toolCalls: [],
            rawToolRecords: [],
            missing: m.missing.filter((x) => x.kind === 'image'),
          },
    );
}

function formatTime(ts: number | null): string {
  if (ts == null) return '';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

function defaultFilename(detail: { summary: { title: string; sessionId: string } }): string {
  const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 13); // YYYYMMDDTHHMM
  return `${sanitizeFilename(detail.summary.title || detail.summary.sessionId)}-${ts}.md`;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!isTauri() || !text) return false;
  try {
    const mod = await import('@tauri-apps/plugin-clipboard-manager');
    await mod.writeText(text);
    return true;
  } catch (err) {
    console.warn('[sessions] clipboard writeText failed:', err);
    return false;
  }
}

/** Slice 6: read a copied source-locator block from the clipboard. */
async function readTextFromClipboard(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const mod = await import('@tauri-apps/plugin-clipboard-manager');
    return await mod.readText();
  } catch (err) {
    console.warn('[sessions] clipboard readText failed:', err);
    return null;
  }
}

export function SessionDetailView(): React.JSX.Element | null {
  const { t } = useTranslation();
  const fileTree = useVaultStore((s) => s.fileTree);
  const toast = useToastStore((s) => s.push);

  const detail = useSessionsUiStore((s) => s.detail);
  const detailLoading = useSessionsUiStore((s) => s.detailLoading);
  const selectedIds = useSessionsUiStore((s) => s.selectedIds);
  const textRanges = useSessionsUiStore((s) => s.textRanges);
  const rangePickerMsg = useSessionsUiStore((s) => s.rangePickerMsg);
  const pendingSave = useSessionsUiStore((s) => s.pendingSave);
  const changedIds = useSessionsUiStore((s) => s.changedIds);
  const branchChanged = useSessionsUiStore((s) => s.branchChanged);
  const genStatus = useSessionsUiStore((s) => s.genStatus);
  const genError = useSessionsUiStore((s) => s.genError);
  const genCtx = useSessionsUiStore((s) => s.genCtx);
  const notePair = useSessionsUiStore((s) => s.notePair);
  const setNotePair = useSessionsUiStore((s) => s.setNotePair);
  const ui = useSessionsUiStore.getState;
  const chatProvider = useAiConfigStore((s) => s.chatProvider);
  const chatModel = useAiConfigStore((s) => s.chatModel);

  // Stale persisted pair (its provider/model was since disabled or removed
  // from aiConfigStore): render and use the default instead of a broken
  // "raw id | raw model" label, and clear the persisted choice so it does
  // not come back on the next launch. Safe against the pre-hydration window:
  // this view only mounts after the user opens a session, long after
  // loadSettings() has hydrated providerSettings.
  const { pairs: enabledPairs } = useEnabledPairs();
  const knownNotePair =
    notePair &&
    enabledPairs.some((p) => p.provider === notePair.provider && p.model === notePair.model)
      ? notePair
      : null;
  useEffect(() => {
    if (notePair && !knownNotePair) setNotePair(null);
  }, [notePair, knownNotePair, setNotePair]);

  /** Cancel flag owned by the in-flight generation request; a retry replaces
   *  it, and the cancelled closure keeps reading ITS flag. Guards against a
   *  stale generation promise clobbering a newer request's state. */
  const genCancelRef = useRef({ cancelled: false });
  const genSeqRef = useRef(0);
  /** Draft-edit textarea value while the draft dialog is open (edited content
   *  is snapshotted at save-request time, not on every keystroke). */
  const [draftValue, setDraftValue] = useState('');

  /** Display filter (default OFF = text-only reading): tool executions stay
   *  browsable/selectable for capture, but the reading view defaults to the
   *  clean conversation — user prompts + assistant text only. */
  const [showTools, setShowTools] = useState(false);

  /** Messages the current mode shows AND lets a selection capture. In
   *  text-only mode this is the stripped projection, so display, selection
   *  preview, AI input and the capture snapshot all share one truth. */
  const visibleMessages = useMemo(
    () => (detail ? (showTools ? detail.messages : projectTextOnly(detail.messages)) : []),
    [detail, showTools],
  );

  // Branch switch (pi): explicit user action, fresh read projected onto the
  // chosen branch. setDetail clears the selection — the other branch's
  // messages never silently join a capture.
  const switchBranch = useCallback(async (branchId: string) => {
    const current = ui().detail;
    if (!current || current.branch.currentId === branchId) return;
    ui().beginDetailLoad();
    try {
      const loaded = await readExternalSession(current.summary, undefined, branchId);
      ui().setDetail(loaded);
    } catch (err) {
      // e.g. the branch vanished after a source refresh — user re-opens
      ui().finishDetailLoad();
      toast(t('sessions:save.readFailed', { error: errorToMessage(err) }));
    }
  }, [ui, toast, t]);

  const handleBack = useCallback(() => {
    // Back to the list: bumps listRefreshToken → the sidebar re-runs
    // discovery (returning to the list = re-entering the list).
    ui().closeDetail();
  }, [ui]);

  // ── Slice 6: source navigation from a saved note's locator ──

  /** Open the saved evidence bundle (records.json) from the current vault.
   *  Read fresh from the vault on EVERY open — no caching — so a restart
   *  or a changed bundle is always reflected. */
  const openSavedEvidence = useCallback(async (evidencePath: string | null, notice?: string) => {
    const { manager, currentVault } = useVaultStore.getState();
    if (!currentVault) {
      toast(t('sessions:save.noVault'));
      return;
    }
    if (!evidencePath) {
      toast(t('sessions:nav.evidenceUnavailable', { error: t('sessions:nav.noEvidencePath') }));
      return;
    }
    try {
      const raw = await manager.readFile(`${evidencePath.replace(/\/+$/, '')}/records.json`);
      const parsed = JSON.parse(raw) as EvidenceRecord;
      if (parsed.format !== EVIDENCE_FORMAT) {
        toast(t('sessions:evidence.unsupported', { format: String(parsed.format) }));
        return;
      }
      ui().showEvidence({ record: parsed, path: evidencePath });
      if (notice) toast(notice);
    } catch (err) {
      toast(
        t('sessions:nav.evidenceUnavailable', {
          error: errorToMessage(err),
        }),
      );
    }
  }, [ui, toast, t]);

  /** Follow a parsed locator: fresh discovery, land on the live session and
   *  the recorded branch; report changed content honestly; fall back to the
   *  saved evidence when the source is gone. */
  const openByLocator = useCallback(async (locator: SourceLocator) => {
    ui().beginDetailLoad();
    ui().clearDetail();
    try {
      const { sessions: live } = await discoverExternalSessions();
      const match =
        live.find((s) => s.source === locator.source && s.sessionId === locator.sessionId) ??
        (locator.filePath != null
          ? live.find((s) => s.filePath === locator.filePath) ?? null
          : null);
      if (!match) {
        // Live source gone → the frozen capture is the basis, never a
        // claimed match with the (nonexistent) live record.
        await openSavedEvidence(locator.evidencePath, t('sessions:nav.sourceMissing'));
        return;
      }
      let loaded: ExternalSessionDetail;
      let branchFallback = false;
      try {
        loaded = await readExternalSession(match, undefined, locator.branchId ?? undefined);
      } catch {
        // e.g. the recorded branch vanished — read the default projection.
        // The ids check below reports vanished messages, but ids that still
        // resolve on the default projection would hide that the DISPLAYED
        // branch is not the recorded one — the branchChanged notice says it.
        branchFallback = true;
        loaded = await readExternalSession(match);
      }
      ui().setDetail(loaded);
      const liveIds = new Set(loaded.messages.map((m) => m.id));
      const wanted = [...locator.messageIds, ...locator.ranges.map((r) => r.messageId)];
      const gone = wanted.filter((id) => !liveIds.has(id));
      ui().setNavNotices(gone.length > 0 ? gone : null, branchFallback && locator.branchId != null);
    } catch (err) {
      toast(t('sessions:save.readFailed', { error: errorToMessage(err) }));
    } finally {
      ui().finishDetailLoad();
    }
  }, [ui, openSavedEvidence, toast, t]);

  /** "打开来源": read the clipboard, parse the note's locator block, go. */
  const handleOpenSource = useCallback(async () => {
    const text = await readTextFromClipboard();
    if (text == null) {
      toast(t('sessions:nav.clipboardNoLocator'));
      return;
    }
    const locator = parseSourceLocator(text);
    if (!locator) {
      toast(t('sessions:nav.clipboardNoLocator'));
      return;
    }
    await openByLocator(locator);
  }, [openByLocator, toast, t]);

  const handleBatchCopy = useCallback(async () => {
    const s = ui();
    if (!detail) return;
    const parts = visibleMessages
      .filter((m) => s.selectedIds.has(m.id))
      .map((m) => m.content);
    for (const r of s.textRanges) {
      const m = detail.messages.find((msg) => msg.id === r.messageId);
      if (m) parts.push(m.content.slice(r.start, r.end));
    }
    await copyTextToClipboard(parts.join('\n\n'));
  }, [ui, detail, visibleMessages]);

  const selectedMessages = useMemo(
    () => visibleMessages.filter((m) => selectedIds.has(m.id)),
    [visibleMessages, selectedIds],
  );

  const missingCount = useMemo(
    () => selectedMessages.reduce((n, m) => n + m.missing.length, 0),
    [selectedMessages],
  );

  // Preview BEFORE saving: tool records that the selection automatically
  // associates (correlated to a selected message) are listed explicitly.
  const toolEvidence = useMemo(() => {
    const items: string[] = [];
    for (const m of selectedMessages) {
      for (const call of m.toolCalls) items.push(`${m.id} · ${call.name}`);
    }
    return items;
  }, [selectedMessages]);

  const excerptOf = useCallback(
    (range: TextRangeSelection): string => {
      const m = detail?.messages.find((msg) => msg.id === range.messageId);
      return m ? m.content.slice(range.start, range.end) : '';
    },
    [detail],
  );

  const handleBatchSave = useCallback(() => {
    const s = ui();
    if (!s.detail || (s.selectedIds.size === 0 && s.textRanges.length === 0)) return;
    // Snapshot the messages the CURRENT mode shows: in text-only mode the
    // stripped projection means no tool records ride along with a selection.
    const selected = visibleMessages.filter((m) => s.selectedIds.has(m.id));
    ui().setPendingSave({ detail: s.detail, selected, textRanges: s.textRanges });
  }, [ui, visibleMessages]);

  // ── Slice 5: AI-organized note from exactly the current selection ──
  // `ctxOverride` lets the retry re-run the STORED snapshot (the selection
  // may have changed while an error was showing); `textOnly` is the explicit
  // user choice after UnsupportedImageModelError.
  const handleGenerateNote = useCallback(
    async (ctxOverride?: PendingSave, textOnly?: boolean) => {
      const s = ui();
      // The generation input is the SAME mode-aware snapshot the verbatim
      // capture uses — text-only selection never feeds tool records to the AI.
      const selected = visibleMessages.filter((m) => s.selectedIds.has(m.id));
      const ctx = ctxOverride ??
        (s.detail && (selected.length > 0 || s.textRanges.length > 0)
          ? { detail: s.detail, selected, textRanges: s.textRanges }
          : null);
      if (!ctx) return;
      // A fresh generation (from the selection bar) starts with images
      // enabled — a previous text-only choice never silently persists to a
      // new selection. A retry keeps the choice the failed attempt used.
      const effectiveTextOnly = ctxOverride ? (textOnly ?? s.genTextOnly) : false;
      const cancelFlag = { cancelled: false };
      genCancelRef.current = cancelFlag;
      s.genStart(ctx, effectiveTextOnly);
      const seq = ++genSeqRef.current;
      try {
        const md = await generateSessionNote(
          { detail: ctx.detail, selectedMessages: ctx.selected, textRanges: ctx.textRanges },
          {
            ...(effectiveTextOnly ? { includeImages: false } : {}),
            // Read at REQUEST time (s = the ui() snapshot above): a retry
            // after the user switches providers uses the new choice; absent
            // → the service's default (global chat pair) is unchanged.
            ...(s.notePair ? { pair: s.notePair } : {}),
            cancelled: () => cancelFlag.cancelled,
          },
        );
        if (seq !== genSeqRef.current) return; // a newer request owns the UI
        useSessionsUiStore.getState().genSucceed(md);
        setDraftValue(md);
      } catch (err) {
        if (seq !== genSeqRef.current) return;
        const store = useSessionsUiStore.getState();
        if (err instanceof NoteGenerationCancelledError) {
          store.genIdle();
        } else if (err instanceof NoModelConfiguredError) {
          store.genFail('no-model', t('sessions:gen.noModel'));
        } else if (err instanceof SelectionTooLargeError) {
          store.genFail('too-large', t('sessions:gen.tooLarge', { actual: err.actualChars, limit: err.limit }));
        } else if (err instanceof UnsupportedImageModelError) {
          store.genFail('unsupported-image', t('sessions:gen.unsupportedImage', { model: err.model, count: err.imageCount }));
        } else if (err instanceof InsufficientContextError) {
          store.genFail('insufficient', t('sessions:gen.insufficient'));
        } else {
          store.genFail('error', t('sessions:gen.failed', { error: errorToMessage(err) }));
        }
      }
    },
    [ui, t, visibleMessages],
  );

  const handleSaveConfirm = useCallback(async (path: string) => {
    const ctx = useSessionsUiStore.getState().pendingSave;
    if (!ctx) return;
    if (!useVaultStore.getState().currentVault) {
      toast(t('sessions:save.noVault'));
      return;
    }
    const dir = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
    const filename = path.slice(path.lastIndexOf('/') + 1);
    try {
      // Staleness check: re-read the source. If the selection's messages
      // changed or vanished since the snapshot, saving would silently
      // capture different content — require reselection instead.
      // The check compares the ORIGINAL records from the snapshot's detail:
      // a text-only snapshot has rawToolRecords stripped (a display choice),
      // which must never masquerade as a source change.
      const fresh = await readExternalSession(
        ctx.detail.summary,
        undefined,
        ctx.detail.branch.currentId,
      ).catch(() => null);
      const originalSelected = ctx.detail.messages.filter((m) =>
        ctx.selected.some((s) => s.id === m.id),
      );
      verifySelectionFresh(
        { detail: ctx.detail, selectedMessages: originalSelected, textRanges: ctx.textRanges },
        fresh,
      );
      const result = await saveExternalSessionCapture(dir, filename, {
        detail: ctx.detail,
        selectedMessages: ctx.selected,
        textRanges: ctx.textRanges,
        ...(ctx.noteMarkdown != null ? { noteBody: ctx.noteMarkdown } : {}),
      });
      await useVaultStore.getState().refreshFileTree();
      toast(
        result.complete
          ? t('sessions:save.success', { path: result.notePath })
          : t('sessions:save.incomplete', { count: result.missing.length, path: result.notePath }),
      );
      useSessionsUiStore.getState().setPendingSave(null);
    } catch (err) {
      if (err instanceof StaleSelectionError) {
        toast(t('sessions:save.stale', { ids: err.changedMessageIds.join(', ') }));
        useSessionsUiStore.getState().setPendingSave(null); // snapshot is dead — reselect
      } else if (err instanceof CaptureConflictError) {
        toast(t('sessions:save.exists'));
      } else {
        toast(t('sessions:save.failed', { error: errorToMessage(err) }));
      }
    }
  }, [toast, t]);

  const cliMessages = useMemo(
    () => visibleMessages.map(toCliMessage),
    [visibleMessages],
  );

  if (!detail && !detailLoading) return null;

  if (!detail) {
    // Load-in-progress with nothing to show yet (e.g. locator re-entry).
    return (
      <div className="flex-1 flex items-center justify-center gap-2 text-t3 text-[13px] select-none">
        <span className="ft-spinner" />
        {t('sessions:list.loading')}
      </div>
    );
  }

  const hasSelection = selectedMessages.length > 0 || textRanges.length > 0;
  /** Whole visible branch selected → the 全选分支 button is "on" and its next
   *  click toggles the message selection off. In showTools mode
   *  visibleMessages IS detail.messages, so this matches both modes. */
  const branchFullySelected =
    visibleMessages.length > 0 && visibleMessages.every((m) => selectedIds.has(m.id));

  return (
    <div className="relative flex-1 flex flex-col min-h-0 overflow-hidden bg-panel">
      {/* Header — ONE merged row (AiPanel controls + provenance + show-tools),
          fixed 34px per the AiPanel header convention. The row content is
          26–28px controls, so 34px fits without height math. border-b stays
          as the visual separator.
          Priority: title flex-[2] vs provenance flex-1 — the provenance
          segment truncates FIRST when narrow; controls stay shrink-0. */}
      <div className="flex items-center gap-2 h-[34px] pl-2 pr-3 border-b border-brd shrink-0">
        <button
          type="button"
          className="w-[26px] h-[26px] flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 border-none bg-transparent"
          title={t('sessions:detail.back')}
          aria-label={t('sessions:detail.back')}
          onClick={handleBack}
        >
          <ArrowLeft size={14} />
        </button>
        <span className="flex-[2] min-w-0 truncate text-[13px] font-semibold text-t1">
          {detail.summary.title}
        </span>
        <span
          className="shrink-0 px-2 py-[1px] rounded-full bg-accdim text-acc text-[11px] font-medium"
          title={t(`sessions:source.${detail.summary.source}`)}
        >
          {t(`sessions:source.${detail.summary.source}`)}
        </span>
        {detail.branch.all.length > 1 && (
          <select
            className="w-[170px] shrink-0 py-[4px] px-1.5 bg-inp border border-brd rounded-md text-t1 text-[11px] outline-none font-ui cursor-pointer transition-[border-color] duration-[140ms] hover:border-brd2 focus:border-acc"
            value={detail.branch.currentId}
            onChange={(e) => void switchBranch(e.target.value)}
            aria-label={t('sessions:detail.branch')}
            title={t('sessions:detail.branch')}
          >
            {detail.branch.all.map((b) => (
              <option key={b.id} value={b.id}>{b.label || b.id}</option>
            ))}
          </select>
        )}
        {/* Provenance segment (project + start time) — compact text-t3,
            truncates first when narrow; full values live in the title. */}
        <span
          className="flex-1 min-w-0 truncate text-[11px] text-t3"
          title={`${detail.summary.cwd ?? t('sessions:note.unknown')} · ${formatTime(detail.summary.startedAt)}`}
        >
          {detail.summary.cwd ?? t('sessions:note.unknown')} · {formatTime(detail.summary.startedAt)}
        </span>
        {/* Quiet "show tools" pill — OFF by default: the reading view shows
            the clean conversation (user prompts + assistant text); ON
            restores tool rows and tool capture for the selection. */}
        <button
          type="button"
          className={`shrink-0 inline-flex items-center gap-1 py-[2px] px-2 rounded-full border cursor-pointer font-ui text-[11px] transition-colors duration-[120ms] ${
            showTools
              ? 'text-acc border-acc/40 bg-accdim'
              : 'text-t3 border-brd2 bg-transparent hover:text-t2 hover:border-brd'
          }`}
          aria-pressed={showTools}
          aria-label={t('sessions:detail.showTools')}
          title={t('sessions:detail.showTools')}
          data-testid="show-tools-toggle"
          onClick={() => setShowTools((v) => !v)}
        >
          <Wrench size={11} />
          {t('sessions:detail.showTools')}
        </button>
        {/* "打开来源": follow a saved note's copied locator block (fresh
            discovery, honest changed-content notices, evidence fallback). */}
        <button
          type="button"
          className="shrink-0 w-[26px] h-[26px] flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 border-none bg-transparent"
          onClick={() => void handleOpenSource()}
          title={t('sessions:nav.openSource')}
          aria-label={t('sessions:nav.openSource')}
        >
          <Locate size={14} />
        </button>
      </div>

      {/* Notice banners (where AiPanel puts status banners) — one shared
          design (WarnNotice): icon + left accent bar on a quiet surface. */}
      {branchChanged && (
        <WarnNotice testid="branch-changed-notice">
          {t('sessions:nav.branchChanged')}
        </WarnNotice>
      )}
      {changedIds && changedIds.length > 0 && (
        <WarnNotice testid="source-changed-notice">
          {t('sessions:nav.changedNotice', { ids: changedIds.join(', ') })}
        </WarnNotice>
      )}
      {detail.warnings.length > 0 && (
        <WarnNotice>
          {t('sessions:detail.warnings', { warnings: detail.warnings.join('；') })}
        </WarnNotice>
      )}
      {detailLoading && (
        <div className="mx-3 mb-1.5 flex items-center gap-2 px-3 py-[7px] text-[11px] text-t2 bg-surf border border-brd2 rounded-md shrink-0">
          <span className="ft-spinner shrink-0" />
          <span className="flex-1 min-w-0 truncate">{t('sessions:list.loading')}</span>
        </div>
      )}

      {/* Conversation — full width, AiPanel message conventions (bubbles +
          markdown + tool blocks), centered to a readable measure with a
          symmetric gutter and a touch more breathing room than the docked
          AI panel affords. */}
      <ChatMessageList
        messages={cliMessages}
        streaming={false}
        streamingIndicator="none"
        multiSelectMode
        selectedIds={selectedIds}
        onToggleSelect={(id) => ui().toggleMessageSelect(id)}
        onEnterTextSelect={(cliMsg) => {
          const m = detail.messages.find((x) => x.id === cliMsg.id);
          if (m && m.content !== '') ui().setRangePickerMsg(m);
        }}
        onBatchCopy={() => void handleBatchCopy()}
        onBatchSave={handleBatchSave}
        onExitMultiSelect={() => ui().clearSelection()}
        className="p-4 gap-3 mx-auto w-full max-w-[860px]"
      />

      {/* Bottom action bar (chat-input-bar position, ChatInputBox dock
          rhythm): a stable two-row dock — row 1: selection hint +
          whole-branch button (+ selection notices); row 2 (when a selection
          is active): summary + capture actions; range chips wrap below;
          generation states last. Buttons are fixed-height, single-line
          (whitespace-nowrap) so nothing misaligns regardless of label
          length or chip count. */}
      <div
        className={`shrink-0 border-t border-brd bg-surf2/40 px-3 flex flex-col gap-1.5 ${
          hasSelection ? 'py-2.5' : 'py-0'
        }`}
      >
        {/* -mx-3/px-3: pull the divider out past the dock's px-3 so the
            border runs edge-to-edge, pixel-identical to the dock's own
            border-t and the SessionsPanel refresh-footer border-t (all
            three span the full column width — the negative margin exactly
            cancels the dock's 12px px-3, no end gaps).
            With a selection: pb-1.5 stays constant (no height jump) and the
            border-b divider shows. Without one: the row sits at the
            refresh-footer height (1.5·fs + 9px) plus 4px breathing room
            (1.5·fs + 13px) so the 28px controls aren't cramped; items-center
            keeps them vertically centered.
            Alignment: 1.5*var(--ui-font-size)+13px — the same formula as
            the SessionsPanel refresh-footer row, so both border-t lines
            sit at the same height at every font size. */}
        <div
          className={`flex items-center gap-2 min-w-0 -mx-3 px-3 ${
            hasSelection
              ? 'pb-1.5 border-b border-brd'
              : 'h-[calc(1.5*var(--ui-font-size)+13px)]'
          }`}
        >
          {/* leading-[28px] = the control height: the hint's line box spans
              the full 28px row so it never depends on the inherited
              line-height — the text, button and selector share one line. */}
          <span className="flex-1 min-w-0 text-[11px] leading-[28px] text-t3 truncate">
            {t('sessions:detail.selectHint')}
          </span>
          <button
            type="button"
            // btnSecondary decomposed: the pressed state swaps in the same
            // quiet accent treatment as the showTools pill (aria-pressed).
            className={`shrink-0 inline-flex items-center justify-center gap-1.5 h-[28px] px-3.5 whitespace-nowrap rounded-md text-[12px] font-ui border cursor-pointer active:scale-[0.96] transition-[color,background-color,transform] duration-[140ms] ${
              branchFullySelected
                ? 'text-acc border-acc/40 bg-accdim'
                : 'bg-panel text-t2 border-brd hover:bg-hov hover:text-t1'
            }`}
            // "Entire branch" = what the current mode shows: in text-only
            // mode only the visible text messages join the selection — a
            // hidden tool-only record is never silently captured.
            onClick={() => ui().selectEntireBranch(showTools ? undefined : visibleMessages.map((m) => m.id))}
            aria-pressed={branchFullySelected}
            aria-label={t('sessions:detail.selectAllBranchHint')}
            title={t('sessions:detail.selectAllBranchHint')}
            data-testid="select-all-branch"
          >
            <ListChecks size={12} className="shrink-0" />
            {t('sessions:detail.selectAllBranch')}
          </button>
          {/* Provider/model for AI note generation — the same quiet icon
              trigger idiom as ChatInput's model picker; drops UP over the
              message list. Lives in row 1 (always rendered) so users can
              switch providers before/without a selection. Value = the flow's
              chosen pair (a stale persisted id falls back to the default),
              else the app chat pair (the default); clearing picks the default
              back. The choice is local to the sessions flow (sessionsUiStore,
              persisted across restarts) — the global chat pair is never
              rewritten. */}
          <PairSelector
            trigger="icon"
            dropDirection="up"
            value={knownNotePair ?? (chatProvider && chatModel ? { provider: chatProvider, model: chatModel } : null)}
            onChange={setNotePair}
            onOpenSettings={() => {
              useNavStore.getState().setCurrentPage('settings');
              useNavStore.getState().setSettingsTab('models');
            }}
            className="shrink-0"
            disabled={genStatus === 'generating'}
          />
        </div>
        {hasSelection && missingCount > 0 && (
          <WarnNotice inset={false}>
            {t('sessions:detail.missingNotice', { count: missingCount })}
          </WarnNotice>
        )}
        {hasSelection && toolEvidence.length > 0 && (
          <div className="flex items-center gap-1.5 min-w-0 text-[11px] text-t3">
            <Wrench size={11} className="shrink-0" />
            <span className="flex-1 min-w-0 truncate">
              {t('sessions:detail.toolEvidence', { items: toolEvidence.join('、') })}
            </span>
          </div>
        )}
        {hasSelection && (
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex-1 min-w-0 truncate text-[12px] leading-[28px] font-medium text-t1">
              {t('sessions:detail.selectionSummary', {
                messages: selectedMessages.length,
                ranges: textRanges.length,
              })}
            </span>
            <button
              type="button"
              className={btnPrimary}
              onClick={handleBatchSave}
              aria-label={t('sessions:detail.saveSelected')}
              title={t('sessions:detail.saveSelected')}
            >
              {t('sessions:detail.saveSelected')}
            </button>
            <button
              type="button"
              className={btnSecondary}
              onClick={() => void handleGenerateNote()}
              aria-label={t('sessions:gen.generate')}
              title={t('sessions:gen.generate')}
            >
              <Sparkles size={12} className="shrink-0" />
              {t('sessions:gen.generate')}
            </button>
          </div>
        )}
        {textRanges.length > 0 && (
          <div className="flex flex-wrap gap-1.5 min-w-0">
            {textRanges.map((r) => (
              <span
                key={r.messageId}
                className="max-w-full min-w-0 inline-flex items-center gap-1 h-[26px] px-1 bg-inp border border-brd rounded-md text-[11px] text-t2"
              >
                <span className="min-w-0 truncate px-1.5 leading-[26px]" title={excerptOf(r)}>
                  {r.messageId}: “{excerptOf(r)}”
                </span>
                <button
                  type="button"
                  className="shrink-0 w-[22px] h-[22px] inline-flex items-center justify-center rounded-md text-t3 hover:bg-hov hover:text-t1 border-none bg-transparent transition-colors cursor-pointer"
                  onClick={() => ui().removeTextRange(r.messageId)}
                  aria-label={t('sessions:range.remove')}
                  title={t('sessions:range.remove')}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        {genStatus === 'generating' && (
          <div
            className="flex items-center gap-2 px-3 py-[7px] text-[11px] text-t2 bg-surf border border-brd2 rounded-md"
            data-testid="gen-status-banner"
          >
            <span className="ft-spinner shrink-0" />
            <span className="flex-1 min-w-0 truncate">{t('sessions:gen.generating')}</span>
            <button
              type="button"
              className={`${bannerBtn} text-t3 hover:text-t1`}
              onClick={() => {
                // The service polls this flag and rejects with a
                // cancellation error; nothing has been written either way.
                genCancelRef.current.cancelled = true;
                ui().genIdle();
              }}
              aria-label={t('sessions:gen.cancelGenerate')}
              title={t('sessions:gen.cancelGenerate')}
            >
              {t('sessions:gen.cancelGenerate')}
            </button>
          </div>
        )}
        {genStatus !== 'idle' && genStatus !== 'generating' && genStatus !== 'draft' && (
          <div className={warnNoticeCls} data-testid="gen-status-banner">
            <AlertTriangle size={12} className="shrink-0" />
            <span className="flex-1 min-w-0">{genError}</span>
            {genStatus === 'error' && (
              <button
                type="button"
                className={`${bannerBtn} text-acc`}
                onClick={() => void handleGenerateNote(genCtx ?? undefined)}
                aria-label={t('sessions:gen.retry')}
                title={t('sessions:gen.retry')}
              >
                {t('sessions:gen.retry')}
              </button>
            )}
            {genStatus === 'unsupported-image' && (
              <button
                type="button"
                className={`${bannerBtn} text-acc`}
                onClick={() => {
                  ui().setGenTextOnly(true);
                  void handleGenerateNote(genCtx ?? undefined, true);
                }}
                aria-label={t('sessions:gen.textOnly')}
                title={t('sessions:gen.textOnly')}
              >
                {t('sessions:gen.textOnly')}
              </button>
            )}
            <button
              type="button"
              className={`${bannerBtn} text-t3 hover:text-t1`}
              onClick={() => ui().genIdle()}
              aria-label={t('sessions:gen.dismiss')}
              title={t('sessions:gen.dismiss')}
            >
              {t('sessions:gen.dismiss')}
            </button>
          </div>
        )}
      </div>

      {/* Text-range picker (slice 4) — a centered dialog over the work area.
          The minimal honest range-selection model: a read-only textarea holds
          the message's CANONICAL text verbatim, and a native textarea
          selection yields exact [start, end) coordinates against it. */}
      {rangePickerMsg && (
        <TextRangePicker
          message={rangePickerMsg}
          initialRange={textRanges.find((r) => r.messageId === rangePickerMsg.id) ?? null}
          onConfirm={(range) => ui().addTextRange(range)}
          onCancel={() => ui().setRangePickerMsg(null)}
        />
      )}

      {/* AI draft (slice 5) — editable draft dialog; the snapshot of the
          EDITED content is taken at save-request time. */}
      {genStatus === 'draft' && genCtx && (
        <div className={modalBackdrop}>
          <div className={`${modalCard} max-w-[560px]`}>
            <div className="text-[14px] font-semibold text-t1">{t('sessions:gen.draftTitle')}</div>
            <div className="text-[11px] text-t3">{t('sessions:gen.draftHint')}</div>
            <textarea
              rows={16}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              aria-label={t('sessions:gen.draftBody')}
              title={t('sessions:gen.draftBody')}
              className="w-full flex-1 min-h-[200px] py-1.5 px-2.5 bg-inp border border-brd rounded-md text-[12px] text-t1 font-mono outline-none resize-none transition-[border-color,box-shadow] duration-150 focus:border-acc focus:shadow-[0_0_0_3px_var(--accglow)]"
            />
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                className={btnSecondary}
                onClick={() => ui().genIdle()}
              >
                {t('sessions:gen.cancelDraft')}
              </button>
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  // Snapshot the EDITED draft at save-request time — the
                  // saved note is what the user confirmed, not the raw
                  // generation output.
                  ui().setPendingSave({ ...genCtx, noteMarkdown: draftValue });
                  ui().genIdle();
                }}
                aria-label={t('sessions:gen.saveDraft')}
                title={t('sessions:gen.saveDraft')}
              >
                {t('sessions:gen.saveDraft')}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingSave && (
        <SaveMessageDialog
          fileTree={fileTree}
          defaultFilename={defaultFilename(pendingSave.detail)}
          onCancel={() => ui().setPendingSave(null)}
          onConfirmVault={handleSaveConfirm}
          // Vault-only per spec — external save is not offered for captures.
          onConfirmExternal={async () => {
            toast(t('sessions:save.vaultOnly'));
          }}
        />
      )}
    </div>
  );
}

function TextRangePicker({
  message,
  initialRange,
  onConfirm,
  onCancel,
}: {
  message: ExternalSessionMessage;
  initialRange: TextRangeSelection | null;
  onConfirm: (range: TextRangeSelection) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [range, setRange] = useState<{ start: number; end: number }>(() =>
    initialRange ? { start: initialRange.start, end: initialRange.end } : { start: 0, end: 0 },
  );

  // Pre-select the existing range (editing a message's excerpt).
  useEffect(() => {
    if (initialRange) {
      textareaRef.current?.setSelectionRange(initialRange.start, initialRange.end);
    }
  }, [initialRange]);

  const excerpt = message.content.slice(range.start, range.end);
  const hasSelection = range.end > range.start;

  return (
    <div className={modalBackdrop} onClick={onCancel}>
      <div className={`${modalCard} max-w-[560px]`} onClick={(e) => e.stopPropagation()}>
        <div className="text-[14px] font-semibold text-t1">{t('sessions:range.title')}</div>
        <div className="text-[11px] text-t3">{t('sessions:range.hint')}</div>
        <textarea
          ref={textareaRef}
          readOnly
          value={message.content}
          rows={10}
          aria-label={t('sessions:range.source')}
          className="w-full flex-1 min-h-[120px] py-1.5 px-2.5 bg-inp border border-brd rounded-md text-[12px] text-t1 font-mono outline-none resize-none transition-[border-color,box-shadow] duration-150 focus:border-acc focus:shadow-[0_0_0_3px_var(--accglow)]"
          onSelect={(e) => {
            const ta = e.currentTarget;
            setRange({ start: ta.selectionStart, end: ta.selectionEnd });
          }}
        />
        <div className="min-h-[16px] text-[11px] text-t2 truncate" data-testid="range-excerpt-preview">
          {hasSelection ? `“${excerpt}”` : t('sessions:range.empty')}
        </div>
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            className={btnSecondary}
            onClick={onCancel}
          >
            {t('sessions:range.cancel')}
          </button>
          <button
            type="button"
            className={`${btnPrimary} disabled:opacity-40 disabled:cursor-not-allowed`}
            disabled={!hasSelection}
            onClick={() => onConfirm({ messageId: message.id, start: range.start, end: range.end })}
          >
            {t('sessions:range.confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}
