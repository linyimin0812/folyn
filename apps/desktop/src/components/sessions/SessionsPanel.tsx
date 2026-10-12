/**
 * Sessions panel — the built-in "sessions" SIDEBAR panel (Codex, Claude Code,
 * pi). List-only by design: the sidebar is ~224px wide, so it renders exactly
 * what FilesPanel renders at that width — source segment chips, a search row
 * (live filtering: typing applies a case-insensitive title/cwd substring
 * filter over the discovered list as the user types; ✕ clears text + filter;
 * the footer refresh re-runs discovery) and a project-grouped session
 * tree. The group headers ARE the project browser (chevron + project basename
 * + source-dots cluster + count, all scoped to the current source+search
 * filters); session rows live indented under their project group (secondary
 * line carries just the time). Null-cwd sessions group under an 未知项目
 * group. Opening a row writes the detail into {@link useSessionsUiStore};
 * WorkArea then renders `SessionDetailView` in the main work area (that view
 * also owns the saved-note locator navigation). Bumping the store's
 * `listRefreshToken` (back-to-list) re-runs discovery here.
 *
 * Mounting the panel (re-entering the list) refreshes discovery; a manual
 * refresh button sits in the panel footer. No background watcher.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, X } from 'lucide-react';
import { discoverExternalSessions, readExternalSession } from '@/services/externalSessions';
import { errorToMessage } from '@/services/externalSessions/errorToMessage';
import type { ExternalSessionSource, ExternalSessionSummary } from '@/services/externalSessions';
import { useSessionsUiStore } from '@/store/sessionsUiStore';
import { isTauri } from '@/utils/platform';
import { useToastStore } from '@/store/toastStore';

type SourceFilter = 'all' | 'codex' | 'claude' | 'pi';

/** Quiet per-source glyph — a 5px dot before the row title, existing color
 *  tokens only (no icon-set mixing with the header's lucide buttons). */
const sourceDotCls: Record<string, string> = {
  codex: 'bg-acc',
  claude: 'bg-purple',
  pi: 'bg-green',
};

/** Deterministic dot order for the per-project source cluster. */
const SOURCE_ORDER: ExternalSessionSource[] = ['codex', 'claude', 'pi'];

/** Stable empty array for the sessions-not-loaded-yet path. */
const EMPTY_SUMMARIES: ExternalSessionSummary[] = [];

/** Group key for sessions with no recorded cwd (must not collide with a real
 *  path — a leading NUL is impossible in a discovered cwd string). */
const UNKNOWN_CWD_KEY = '\u0000';

function formatTime(ts: number | null): string {
  if (ts == null) return '';
  return new Date(ts).toLocaleString(undefined, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

interface SessionGroup {
  key: string;
  cwd: string | null;
  sessions: ExternalSessionSummary[];
  sources: ExternalSessionSource[];
  latest: number;
}

export function SessionsPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const toast = useToastStore((s) => s.push);

  // Detail/selection state lives in sessionsUiStore (shared with WorkArea's
  // SessionDetailView); this list only reads the open-session id for the
  // active-row accent and calls the store's load/navigation actions.
  const openDetail = useSessionsUiStore((s) => s.detail);
  const listRefreshToken = useSessionsUiStore((s) => s.listRefreshToken);
  const ui = useSessionsUiStore.getState;

  // ── list state (sidebar-local) ──
  const [sessions, setSessions] = useState<ExternalSessionSummary[] | null>(null);
  const [listErrors, setListErrors] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  // Search — live: the input text IS the filter (trimmed, case-insensitive;
  // empty = no filter). Typing re-filters immediately; refresh stays the only
  // re-discovery action.
  const [searchInput, setSearchInput] = useState('');
  // Collapsed project groups (Set of cwd keys). Keyed by cwd so the state is
  // stable across refreshes; default = empty set = all groups expanded.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const refreshList = useCallback(async () => {
    if (!isTauri()) {
      setSessions([]);
      setListErrors([]);
      return;
    }
    setLoading(true);
    try {
      const { sessions: found, errors } = await discoverExternalSessions();
      setSessions(found);
      setListErrors(errors);
    } catch (err) {
      setSessions([]);
      setListErrors([errorToMessage(err)]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Entering the panel (mount) refreshes discovery — no background watcher.
  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  // Back-to-list from the detail view bumps the token — re-run discovery
  // (returning to the list = re-entering the list). Skipped on mount: the
  // mount effect above already refreshed.
  const tokenRef = useRef(listRefreshToken);
  useEffect(() => {
    if (tokenRef.current === listRefreshToken) return;
    tokenRef.current = listRefreshToken;
    void refreshList();
  }, [listRefreshToken, refreshList]);

  // Source filter first — the group headers, their source dots and their
  // counts all describe the source-filtered scope, so switching a segment
  // chip visibly changes the project tree too.
  const sourceFiltered = useMemo(() => {
    if (sourceFilter === 'all') return sessions ?? EMPTY_SUMMARIES;
    return (sessions ?? EMPTY_SUMMARIES).filter((s) => s.source === sourceFilter);
  }, [sessions, sourceFilter]);

  // Live search term — trimmed + lowercased once, applied while typing.
  const appliedSearch = searchInput.trim().toLowerCase();

  // Project-grouped tree, scoped to source + search. A session matches the
  // search when its title OR its group's cwd matches — a cwd match keeps the
  // group with ALL its sessions. Groups whose sessions all filtered out are
  // absent entirely. Sorted by latest session time desc; sessions within a
  // group newest first.
  const groups = useMemo<SessionGroup[]>(() => {
    const byKey = new Map<string, ExternalSessionSummary[]>();
    for (const s of sourceFiltered) {
      const matches = appliedSearch === ''
        || s.title.toLowerCase().includes(appliedSearch)
        || (s.cwd ?? '').toLowerCase().includes(appliedSearch);
      if (!matches) continue;
      const key = s.cwd ?? UNKNOWN_CWD_KEY;
      const arr = byKey.get(key);
      if (arr) arr.push(s);
      else byKey.set(key, [s]);
    }
    const timeOf = (s: ExternalSessionSummary) => s.updatedAt ?? s.startedAt ?? 0;
    const out: SessionGroup[] = [];
    for (const [key, list] of byKey) {
      list.sort((a, b) => timeOf(b) - timeOf(a));
      out.push({
        key,
        cwd: key === UNKNOWN_CWD_KEY ? null : key,
        sessions: list,
        sources: SOURCE_ORDER.filter((src) => list.some((s) => s.source === src)),
        latest: timeOf(list[0]!),
      });
    }
    out.sort((a, b) => b.latest - a.latest);
    return out;
  }, [sourceFiltered, appliedSearch]);

  // allowClear ✕ — clears the text, which clears the live filter too (antd
  // Search semantics: clearing clears, not just the text).
  const clearSearch = useCallback(() => {
    setSearchInput('');
  }, []);

  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const openSession = useCallback(async (summary: ExternalSessionSummary) => {
    ui().beginDetailLoad();
    try {
      const loaded = await readExternalSession(summary);
      ui().setDetail(loaded);
    } catch (err) {
      ui().finishDetailLoad();
      toast(t('sessions:save.readFailed', { error: errorToMessage(err) }));
    }
  }, [ui, toast, t]);

  const openKey = openDetail
    ? `${openDetail.summary.source}:${openDetail.summary.sessionId}`
    : null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* Source chips + search — FilesPanel header-zone conventions.
          ponytail: px literals, NOT pt-3/mt-1.5/pb-2 (rem) — rem paddings
          scale with --ui-font-size (html font-size), silently shifting the
          header-zone layout at every fs ≠ 16 (measured: pt-3 renders 10.5px
          at fs 14, not 12). */}
      <div className="pt-[12px] px-2.5 pb-[8px] shrink-0">
        {/* Source filter — segmented chips (ImagePasteDialog's format-switcher
            idiom): equal segments, selected bg-acc, quiet otherwise. Full
            labels stay reachable via the title tooltip. */}
        <div
          className="flex border border-brd2 rounded-md overflow-hidden"
          role="group"
          aria-label={t('sessions:list.source')}
        >
          {(['all', 'codex', 'claude', 'pi'] as const).map((src) => {
            const selected = sourceFilter === src;
            const short = src === 'all'
              ? t('sessions:list.all')
              : src === 'claude'
                ? t('sessions:source.claudeShort')
                : t(`sessions:source.${src}`);
            const full = src === 'all'
              ? t('sessions:list.allSources')
              : t(`sessions:source.${src}`);
            return (
              <button
                key={src}
                type="button"
                aria-pressed={selected}
                title={full}
                className={`flex-1 min-w-0 py-[5px] px-1 text-[11px] font-medium text-center truncate cursor-pointer border-r border-r-brd2 last:border-r-0 border-none transition-colors duration-[120ms] ${
                  selected ? 'bg-acc text-white' : 'bg-surf text-t2 hover:bg-hov hover:text-t1'
                }`}
                onClick={() => setSourceFilter(src)}
              >
                {short}
              </button>
            );
          })}
        </div>
        {/* Search row — input + allowClear ✕ as one merged-border group
            filling the row (outer rounding only, focus-within highlights the
            whole group). Filtering is live on typing; the refresh control
            lives in the panel footer below. */}
        <div className="mt-[6px] flex items-center gap-1">
          <div className="flex-1 min-w-0 flex items-stretch rounded-md border border-brd bg-inp transition-[border-color] duration-[140ms] focus-within:border-acc overflow-hidden">
            <div className="relative flex-1 min-w-0 flex items-center">
              <input
                className="w-full py-[4px] pr-6 pl-2 bg-transparent text-t1 text-[calc(var(--ui-font-size)-3px)] outline-none font-ui placeholder:text-t3 border-none rounded-none"
                placeholder={t('sessions:list.searchPlaceholder')}
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                autoCapitalize="off"
              />
              {searchInput !== '' && (
                <button
                  type="button"
                  className="absolute right-1 inline-flex items-center justify-center w-5 h-5 rounded text-t3 hover:text-t1 hover:bg-hov cursor-pointer border-none bg-transparent p-0"
                  onClick={clearSearch}
                  title={t('sessions:list.searchClear')}
                  aria-label={t('sessions:list.searchClear')}
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
        </div>
        {listErrors.length > 0 && (
          <div className="mt-1.5 flex items-start gap-1.5 px-3 py-[6px] text-[11px] text-red bg-surf border border-brd2 border-l-2 border-l-red rounded-md">
            {t('sessions:list.sourceError', { errors: listErrors.join('；') })}
          </div>
        )}
      </div>

      {/* Body — the project-grouped session tree. Group headers are
          FileTreeItem-style rows (chevron + project basename + source dots +
          count, full cwd in the row title); session rows indent one depth
          under their group and carry only the time on the secondary line. */}
      <div className="sb-body flex-1 overflow-y-auto py-1 border-t border-brd">
        {loading && (
          <div className="py-4 px-3 flex items-center justify-center gap-1.5 text-xs text-t3">
            <span className="ft-spinner" />
            {t('sessions:list.loading')}
          </div>
        )}
        {!loading && groups.length === 0 && (
          <div className="py-4 px-3 text-center text-xs text-t3">{t('sessions:list.empty')}</div>
        )}
        {!loading && groups.map((group) => {
          const isCollapsed = collapsed.has(group.key);
          const label = group.cwd
            ? (group.cwd.split('/').pop() ?? group.cwd)
            : t('sessions:list.unknownProject');
          return (
            <div key={group.key}>
              <button
                type="button"
                title={group.cwd ?? undefined}
                aria-expanded={!isCollapsed}
                className="w-full text-left py-1 pl-3 pr-2 rounded-none border-none bg-transparent text-t2 hover:bg-hov hover:text-t1 cursor-pointer flex items-center gap-1.5 transition-colors duration-[120ms]"
                onClick={() => toggleGroup(group.key)}
              >
                <ChevronDown
                  size={12}
                  className={`shrink-0 text-t3 transition-transform duration-[120ms] ${isCollapsed ? '-rotate-90' : ''}`}
                />
                <span className="flex-1 min-w-0 truncate font-medium text-[calc(var(--ui-font-size)-2px)]">
                  {label}
                </span>
                {group.sources.length > 0 && (
                  <span
                    className="shrink-0 flex items-center gap-[3px]"
                    title={group.sources.map((src) => t(`sessions:source.${src}`)).join(' · ')}
                  >
                    {group.sources.map((src) => (
                      <span
                        key={src}
                        className={`w-[5px] h-[5px] rounded-full ${sourceDotCls[src]}`}
                      />
                    ))}
                  </span>
                )}
                <span className="shrink-0 text-[calc(var(--ui-font-size)-4px)] text-t3">
                  {group.sessions.length}
                </span>
              </button>
              {!isCollapsed && group.sessions.map((s) => {
                const isActive = openKey === `${s.source}:${s.sessionId}`;
                return (
                  <button
                    key={`${s.source}:${s.sessionId}`}
                    type="button"
                    title={s.cwd ?? undefined}
                    className={`w-full text-left py-1 pl-7 pr-3 rounded-none cursor-pointer border-none bg-transparent transition-colors duration-[120ms] ${
                      isActive ? 'bg-accdim text-acc' : 'text-t2 hover:bg-hov hover:text-t1'
                    }`}
                    onClick={() => void openSession(s)}
                  >
                    <div className="flex items-center gap-[6px]">
                      <span className={`shrink-0 w-[5px] h-[5px] rounded-full ${sourceDotCls[s.source] ?? 'bg-t3'}`} />
                      <span className={`truncate font-medium text-[calc(var(--ui-font-size)-2px)] ${isActive ? 'text-acc' : 'text-t1'}`}>
                        {s.title || s.sessionId.slice(0, 8)}
                      </span>
                    </div>
                    <div className="pl-[11px] text-[calc(var(--ui-font-size)-4px)] text-t3 truncate">
                      {formatTime(s.updatedAt ?? s.startedAt)}
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* Footer — the manual refresh control. No sidebar-footer convention
          exists in the app yet, so this is the quiet-footer shape:
          border-t separator, full-row click target with a centered label
          (no icon); accent while discovery is running.
          Alignment: row height 1.5*var(--ui-font-size)+13px — the same
          formula as the detail dock's unselected hint row in
          SessionDetailView.tsx, so both border-t lines sit at the same
          height at every font size. */}
      <div className="shrink-0 border-t border-brd">
        <button
          type="button"
          className={`w-full h-[calc(1.5*var(--ui-font-size)+13px)] flex items-center justify-center bg-transparent border-none cursor-pointer text-[calc(var(--ui-font-size)-2px)] transition-colors duration-[120ms] ${
            loading ? 'text-acc' : 'text-t2 hover:bg-hov hover:text-t1'
          }`}
          onClick={() => void refreshList()}
          title={t('sessions:list.refresh')}
          aria-label={t('sessions:list.refresh')}
        >
          <span>{t('sessions:list.refresh')}</span>
        </button>
      </div>
    </div>
  );
}
