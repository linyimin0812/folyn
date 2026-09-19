// Pet-panel unified search results — the panel search box (above the tabs)
// searches three sources: vault files, registered commands, and extensions
// (on-disk third-party + built-in panels like translation/wiki).
// Rendered in the panel body while the query is non-empty.
//
// Cross-window routing (the panel is a separate JS realm):
//  - File → `pet://bubble-action { type:'navigate', target:{ kind:'file' } }`
//    (the main window's existing jump router opens it — same as PetInbox).
//  - Command → `pet://menu-action { action:'run-command', commandId }` — the
//    main window's routePetMenuAction runs it via the command registry.
//  - Extension (third-party) → `pet://menu-action { action:'open-extension-tool',
//    extensionId }` — the main window opens the extension's tool window (popup).
//  - Extension (built-in translation) → TWO rows instead of one: "main app"
//    emits `run-command: panel.translation` (ActivityBar page + focus),
//    "popup" emits `open-extension-tool: builtin:translation` (the main window
//    invokes `open_extension_tool_window` directly — see petHostRouter).
//    Gated on `enableTranslationPanel`, same as the ActivityBar icon.
//  - Extension (other built-in panel) → `run-command: panel.<name>` if such
//    a command is registered; built-ins without one fall back to
//    open-extension-tool (Extensions settings tab).

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { getCommands } from '@/services/commandRegistry';
import { useExtensionStore, type ExtensionRow } from '@/store/extensionStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { ExtensionIcon } from '@/components/settings/ExtensionsSettings';
import { FileIcon } from '@/components/icons/FileIcon';
import { isTauri } from '@/utils/platform';
import { flattenFileTree } from '@/utils/treeUtils';

/** Max results per group — bounds DOM size for large vaults. */
const MAX_PER_GROUP = 20;

/** Case-insensitive substring match against a list of candidate strings. */
function matches(query: string, ...candidates: (string | undefined)[]): boolean {
  const q = query.toLowerCase();
  return candidates.some((c) => (c ?? '').toLowerCase().includes(q));
}

interface PetPanelSearchResultsProps {
  query: string;
  /** Called after a result is picked (the caller hides the panel). */
  onDone: () => void;
}

/** Imperative keyboard controls driven by the panel's search input. */
export interface PetPanelSearchResultsHandle {
  /** Highlight the next result (clamped; stays on the last one). */
  moveNext(): void;
  /** Highlight the previous result (clamped; stays on the first one). */
  movePrev(): void;
  /** Open the currently highlighted result (same as clicking it). */
  activate(): void;
}

/** One flattened search hit, in render order (extensions → commands → files).
 *  index maps 1:1 onto the DOM buttons (`data-search-index`), so
 *  ArrowUp/ArrowDown/Enter can drive the UI. */
type SearchItem =
  | { kind: 'file'; path: string }
  | { kind: 'command'; commandId: string }
  | { kind: 'extension'; extensionId: string; builtin: boolean }
  | { kind: 'builtin-translation'; mode: 'main' | 'popup' };

/** A visual row in the extensions group. The `builtin:translation` hit
 *  expands into two rows (main-app page / floating popup) so the flattened
 *  `items` array and the rendered buttons stay 1:1 — every other hit renders
 *  exactly one row. */
type ExtensionVisualRow =
  | { kind: 'extension'; row: ExtensionRow }
  | { kind: 'translation-main'; row: ExtensionRow }
  | { kind: 'translation-popup'; row: ExtensionRow };

export const PetPanelSearchResults = forwardRef<
  PetPanelSearchResultsHandle,
  PetPanelSearchResultsProps
>(function PetPanelSearchResults({ query, onDone }, ref) {
  const { t } = useTranslation();
  const fileTree = useVaultStore((s) => s.fileTree);
  // ponytail: read extension rows from the store (includes built-in panels
  // like translation/wiki/analyze) instead of invoking
  // `list_extensions` directly — that command returns only on-disk third-party
  // extensions and skips BUILTIN_PANEL_DEFS, so searches for "翻译" never hit
  // the translation panel.
  const rows = useExtensionStore((s) => s.rows);
  const refreshRows = useExtensionStore((s) => s.refresh);
  // Same gate as the ActivityBar translation icon + `panel.translation`
  // command: a disabled translation panel must not surface in search
  // (neither of its two rows).
  const enableTranslationPanel = useAppearanceStore((s) => s.enableTranslationPanel);
  const [activeIndex, setActiveIndex] = useState(0);

  // Vault files, ALL types (PRD 09-19-pet-search-all-files) — the tree the
  // panel mirrors via `pet://file-tree-updated` contains every file; the
  // previous `.md`-only filter (flattenMarkdownFiles) was inherited from
  // fileCommands.ts, not a panel decision. Picking any file routes through
  // the main window's editorIoService.openFile, which handles every type
  // (handler registry / file viewers; unknown extensions open as
  // unsupported/text views). Mirrors the all-files flatten the AiPanel's
  // @-mention uses.
  const files = useMemo(() => flattenFileTree(fileTree), [fileTree]);
  // Registered commands (static registry is available in this realm too).
  const commands = useMemo(
    () => getCommands().filter((c) => !c.enabled || c.enabled()),
    [],
  );

  // Installed + built-in extensions — refreshed once on mount (the panel window
  // lives as long as the app, and installs happen in the main window's
  // settings; `extension://installed` listeners in App.tsx call refresh too).
  useEffect(() => {
    void refreshRows();
  }, [refreshRows]);

  const q = query.trim();
  // `/` prefix = extension browse mode for the EXTENSIONS group only (user
  // convention 2026-09-19): a bare `/` lists EVERY extension; `/xyz`
  // filters extensions by `xyz`. Files / commands keep their NORMAL
  // whole-query substring matching (a bare `/` still matches every file in
  // a directory — its path contains `/` — so the scrollable mixed
  // extensions+files list stays; that's the behavior the user asked to
  // keep). `matches('')` is true for any candidate, so the bare-`/` case
  // falls out of the same filter.
  const isExtMode = q.startsWith('/');
  const extQ = isExtMode ? q.slice(1).trim() : q;
  const fileHits = q
    ? files
        .filter((f) => matches(q, f.name, f.path))
        .slice(0, MAX_PER_GROUP)
    : [];
  const commandHits = q
    ? commands
        .filter((c) => matches(q, c.title, ...(c.keywords ?? [])))
        .slice(0, MAX_PER_GROUP)
    : [];
  const extensionHits = q
    ? rows
        .filter((r) => {
          // The builtin:translation row is gated on the appearance flag
          // (above); other built-ins keep current behavior.
          if (
            r.builtin &&
            r.entry.id === 'builtin:translation' &&
            !enableTranslationPanel
          ) {
            return false;
          }
          // Built-in rows carry nameKey/descKey (i18n labels); third-party
          // rows use entry.name + manifest description. Match both so
          // searching "翻译" hits the translation panel via its zh label.
          const name = r.nameKey ? t(r.nameKey) : r.entry.name;
          const desc = r.descKey ? t(r.descKey) : (r.description ?? '');
          return matches(isExtMode ? extQ : q, name, r.entry.id, r.entry.name, desc);
        })
        .slice(0, MAX_PER_GROUP)
    : [];
  // The builtin:translation hit renders TWO rows — "popup" (open the
  // floating translation popup) first, then "main app" (run-command
  // panel.translation) — so a single search surfaces both destinations, with
  // the popup on top (user preference 2026-09-19). Every other hit renders
  // one row; the flattened `items` array below maps 1:1 onto these buttons.
  const extensionVisualRows: ExtensionVisualRow[] = extensionHits.flatMap(
    (row): ExtensionVisualRow[] =>
      row.builtin && row.entry.id === 'builtin:translation'
        ? [
            { kind: 'translation-popup', row },
            { kind: 'translation-main', row },
          ]
        : [{ kind: 'extension', row }],
  );
  const total = fileHits.length + commandHits.length + extensionVisualRows.length;

  // Flattened hit list in render order (extensions → commands → files):
  // index maps 1:1 onto the DOM buttons (`data-search-index`), so
  // ArrowUp/ArrowDown/Enter can drive the UI.
  const items = useMemo<SearchItem[]>(
    () => [
      ...extensionVisualRows.map((vr): SearchItem => {
        if (vr.kind === 'translation-main') {
          return { kind: 'builtin-translation', mode: 'main' };
        }
        if (vr.kind === 'translation-popup') {
          return { kind: 'builtin-translation', mode: 'popup' };
        }
        return {
          kind: 'extension',
          extensionId: vr.row.entry.id,
          builtin: !!vr.row.builtin,
        };
      }),
      ...commandHits.map((c): SearchItem => ({ kind: 'command', commandId: c.id })),
      ...fileHits.map((f): SearchItem => ({ kind: 'file', path: f.path })),
    ],
    [fileHits, commandHits, extensionVisualRows],
  );

  // A new query starts with the first result highlighted.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlight in range if the hit list shrinks (e.g. extensions load
  // asynchronously and the mount snapshot is incomplete).
  useEffect(() => {
    setActiveIndex((i) => Math.min(i, Math.max(items.length - 1, 0)));
  }, [items.length]);

  // Keep the highlighted row visible while navigating with the keyboard.
  useEffect(() => {
    if (items.length === 0) return;
    document
      .querySelector<HTMLElement>(`[data-search-index="${activeIndex}"]`)
      ?.scrollIntoView?.({ block: 'nearest' });
  }, [activeIndex, items.length]);

  const activateItem = useCallback(
    async (item: SearchItem) => {
      if (item.kind === 'file') {
        await emitNavigateFile(item.path);
      } else if (item.kind === 'command') {
        await emitRunCommand(item.commandId);
        // The inbox command opens the extension-tool popup, which floats
        // over the user's current app — hide the panel restoring the user's
        // previous frontmost app (same as the open-extension-tool path
        // below), so picking it doesn't leave Folyn in the foreground.
        if (item.commandId === 'action.open-inbox' && isTauri()) {
          try {
            const { invoke } = await import('@tauri-apps/api/core');
            await invoke('pet_panel_hide', { restoreFocus: true });
          } catch {
            // Non-fatal — the generic onDone() hide still runs.
          }
        }
      } else if (item.kind === 'builtin-translation') {
        // The translation hit's two rows: "main app" runs the registered
        // `panel.translation` command in the main window (ActivityBar page
        // switch + focus), "popup" opens the floating translation popup —
        // the main window's petHostRouter invokes `open_extension_tool_window`
        // directly for builtin:translation (no `extension.openTool.*`
        // command exists — it's not an on-disk extension).
        if (item.mode === 'main') {
          await emitRunCommand('panel.translation');
        } else {
          await emitOpenExtensionTool('builtin:translation');
        }
      } else if (item.kind === 'extension') {
        if (item.builtin) {
          // Other built-in panels route to the main window via
          // `run-command: panel.<name>` when such a command is registered;
          // built-ins without one fall back to open-extension-tool which
          // opens the Extensions settings tab.
          const { getCommands } = await import('@/services/commandRegistry');
          const cmdId = `panel.${item.extensionId.replace(/^builtin:/, '')}`;
          if (getCommands().some((c) => c.id === cmdId)) {
            await emitRunCommand(cmdId);
          } else {
            await emitOpenExtensionTool(item.extensionId);
          }
        } else {
          await emitOpenExtensionTool(item.extensionId);
        }
      }
      onDone();
    },
    [onDone],
  );

  useImperativeHandle(
    ref,
    () => ({
      moveNext: () => setActiveIndex((i) => Math.min(i + 1, items.length - 1)),
      movePrev: () => setActiveIndex((i) => Math.max(i - 1, 0)),
      activate: () => {
        const item = items[activeIndex];
        if (item) activateItem(item);
      },
    }),
    [items, activeIndex, activateItem],
  );

  if (!q) return <div className="pet-panel-search-empty" />;

  return (
    <div className="pet-panel-search-results" role="listbox">
      {total === 0 && (
        <div className="pet-panel-search-empty">
          {t('pet:search.noResults')}
        </div>
      )}
      {extensionVisualRows.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.extensions')}
          </div>
          {extensionVisualRows.map((vr, i) => {
            // The extensions group is FIRST in the flattened render order and
            // every visual row is exactly one button, so the in-group index IS
            // the flattened `data-search-index` (command/file groups offset
            // from this array's length below).
            const index = i;
            // The two translation rows replace the single built-in row's
            // generic title; both keep the row's icon + description.
            const isTranslationMain = vr.kind === 'translation-main';
            const isTranslationPopup = vr.kind === 'translation-popup';
            const title = isTranslationMain
              ? t('pet:search.translationMain')
              : isTranslationPopup
                ? t('pet:search.translationPopup')
                : vr.row.nameKey
                  ? t(vr.row.nameKey)
                  : vr.row.entry.name;
            // Functional description: built-in rows carry a descKey (i18n),
            // third-party rows carry manifest `description`. Falls back to the
            // id·version sub when neither is present so the row isn't blank.
            const desc =
              vr.row.builtin && vr.row.descKey
                ? t(vr.row.descKey)
                : (vr.row.description ?? '');
            const sub =
              desc ||
              (vr.row.builtin
                ? vr.row.entry.id
                : `${vr.row.entry.id} · v${vr.row.entry.version}`);
            const item: SearchItem = isTranslationMain
              ? { kind: 'builtin-translation', mode: 'main' }
              : isTranslationPopup
                ? { kind: 'builtin-translation', mode: 'popup' }
                : {
                    kind: 'extension',
                    extensionId: vr.row.entry.id,
                    builtin: !!vr.row.builtin,
                  };
            return (
            <button
              key={
                isTranslationMain
                  ? `${vr.row.entry.id}:main`
                  : isTranslationPopup
                    ? `${vr.row.entry.id}:popup`
                    : vr.row.entry.id
              }
              type="button"
              data-search-index={index}
              className={`pet-panel-search-item is-with-icon${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              title={desc || undefined}
              onClick={() => activateItem(item)}
            >
              <ExtensionIcon icon={vr.row.icon} iconDark={vr.row.iconDark} name={title} size={16} />
              <span className="pet-panel-search-item-text">
                <span className="pet-panel-search-item-title">{title}</span>
                <span className="pet-panel-search-item-sub">{sub}</span>
              </span>
            </button>
            );
          })}
        </section>
      )}
      {commandHits.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.commands')}
          </div>
          {commandHits.map((c, i) => {
            const index = extensionVisualRows.length + i;
            return (
            <button
              key={c.id}
              type="button"
              data-search-index={index}
              className={`pet-panel-search-item is-with-icon${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => activateItem({ kind: 'command', commandId: c.id })}
            >
              <Terminal size={16} className="pet-panel-search-item-glyph" />
              <span className="pet-panel-search-item-text">
                <span className="pet-panel-search-item-title">{c.title}</span>
              </span>
            </button>
            );
          })}
        </section>
      )}
      {fileHits.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.files')}
          </div>
          {fileHits.map((f, i) => {
            const index = extensionVisualRows.length + commandHits.length + i;
            return (
            <button
              key={f.path}
              type="button"
              data-search-index={index}
              className={`pet-panel-search-item is-with-icon${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => activateItem({ kind: 'file', path: f.path })}
            >
              <FileIcon filename={f.name} />
              <span className="pet-panel-search-item-text">
                <span className="pet-panel-search-item-title">{f.name}</span>
                <span className="pet-panel-search-item-sub">{f.path}</span>
              </span>
            </button>
            );
          })}
        </section>
      )}
    </div>
  );
});

/** Open a vault file in the main editor via the bubble-action jump router. */
async function emitNavigateFile(path: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://bubble-action', {
      type: 'navigate',
      target: { kind: 'file', id: path },
      source: 'pet-panel-search',
    });
  } catch {
    // Non-fatal.
  }
}

/** Run a registered command in the main window. */
async function emitRunCommand(commandId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action: 'run-command', commandId });
  } catch {
    // Non-fatal.
  }
}

/** Open a extension's tool window (popup) in the main window. Exported for
 *  PetSearchRecents — its chips re-fire the exact same open path (emit
 *  menu-action + hide the panel restoring focus) as a picked search row. */
export async function emitOpenExtensionTool(extensionId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action: 'open-extension-tool', extensionId });
    // The panel hide for THIS path restores the user's previous frontmost
    // app: the panel activated Folyn (set_focus for Esc support), but the
    // tool popup is meant to float over the user's app — Folyn must not
    // stay in the foreground after the panel hides. The generic onDone()
    // hide that follows is a no-op (window already hidden).
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('pet_panel_hide', { restoreFocus: true });
  } catch {
    // Non-fatal.
  }
}
