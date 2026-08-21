// Pet-panel unified search results — the panel search box (above the tabs)
// searches three sources: vault files, registered commands, and plugins
// (on-disk third-party + built-in panels like translation/wiki/clips).
// Rendered in the panel body while the query is non-empty.
//
// Cross-window routing (the panel is a separate JS realm):
//  - File → `pet://bubble-action { type:'navigate', target:{ kind:'file' } }`
//    (the main window's existing jump router opens it — same as PetInbox).
//  - Command → `pet://menu-action { action:'run-command', commandId }` — the
//    main window's routePetMenuAction runs it via the command registry.
//  - Plugin (third-party) → `pet://menu-action { action:'open-plugin-tool',
//    pluginId }` — the main window opens the plugin's tool window (popup).
//  - Plugin (built-in panel) → host panel tries in-panel activation first
//    (e.g. switch to the translation tab); otherwise `run-command: panel.<name>`
//    routes to the main window. Built-ins without such a command fall back
//    to open-plugin-tool (Plugins settings tab).

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { useVaultStore } from '@/store/vaultStore';
import { flattenMarkdownFiles } from '@/services/fileCommands';
import { getCommands } from '@/services/commandRegistry';
import { usePluginStore } from '@/store/pluginStore';
import { isTauri } from '@/utils/platform';

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
  /** Try to activate a built-in panel in-panel (e.g. switch to the
   * translation tab). Return true if handled; false → fall back to
   * main-window routing via `run-command: panel.<name>`. */
  onActivateBuiltin?: (id: string) => boolean;
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

/** One flattened search hit, in render order (files → commands → plugins). */
type SearchItem =
  | { kind: 'file'; path: string }
  | { kind: 'command'; commandId: string }
  | { kind: 'plugin'; pluginId: string; builtin: boolean };

export const PetPanelSearchResults = forwardRef<
  PetPanelSearchResultsHandle,
  PetPanelSearchResultsProps
>(function PetPanelSearchResults({ query, onDone, onActivateBuiltin }, ref) {
  const { t } = useTranslation();
  const fileTree = useVaultStore((s) => s.fileTree);
  // ponytail: read plugin rows from the store (includes built-in panels
  // like translation/wiki/clips/analyze/schedule) instead of invoking
  // `list_plugins` directly — that command returns only on-disk third-party
  // plugins and skips BUILTIN_PANEL_DEFS, so searches for "翻译" never hit
  // the translation panel.
  const rows = usePluginStore((s) => s.rows);
  const refreshRows = usePluginStore((s) => s.refresh);
  const [activeIndex, setActiveIndex] = useState(0);

  // Vault files (the panel receives the tree via `pet://file-tree-updated`).
  const files = useMemo(() => flattenMarkdownFiles(fileTree), [fileTree]);
  // Registered commands (static registry is available in this realm too).
  const commands = useMemo(
    () => getCommands().filter((c) => !c.enabled || c.enabled()),
    [],
  );

  // Installed + built-in plugins — refreshed once on mount (the panel window
  // lives as long as the app, and installs happen in the main window's
  // settings; `plugin://installed` listeners in App.tsx call refresh too).
  useEffect(() => {
    void refreshRows();
  }, [refreshRows]);

  const q = query.trim();
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
  const pluginHits = q
    ? rows
        .filter((r) => {
          // Built-in rows carry nameKey/descKey (i18n labels); third-party
          // rows use entry.name + manifest description. Match both so
          // searching "翻译" hits the translation panel via its zh label.
          const name = r.nameKey ? t(r.nameKey) : r.entry.name;
          const desc = r.descKey ? t(r.descKey) : (r.description ?? '');
          return matches(q, name, r.entry.id, r.entry.name, desc);
        })
        .slice(0, MAX_PER_GROUP)
    : [];
  const total = fileHits.length + commandHits.length + pluginHits.length;

  // Flattened hit list in render order — index maps 1:1 onto the DOM buttons
  // (`data-search-index`), so ArrowUp/ArrowDown/Enter can drive the UI.
  const items = useMemo<SearchItem[]>(
    () => [
      ...fileHits.map((f): SearchItem => ({ kind: 'file', path: f.path })),
      ...commandHits.map((c): SearchItem => ({ kind: 'command', commandId: c.id })),
      ...pluginHits.map((p): SearchItem => ({
        kind: 'plugin',
        pluginId: p.entry.id,
        builtin: !!p.builtin,
      })),
    ],
    [fileHits, commandHits, pluginHits],
  );

  // A new query starts with the first result highlighted.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  // Keep the highlight in range if the hit list shrinks (e.g. plugins load
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
      } else if (item.kind === 'plugin') {
        if (item.builtin) {
          // Built-in panel hit: let the host panel try in-panel activation
          // first (e.g. switch to the translation tab). The host clears the
          // search query itself; we must NOT call onDone() here — onDone
          // hides the whole pet panel, which would mask the tab switch.
          // Otherwise route to the main window via `run-command: panel.<name>`.
          // Built-ins without such a command (schedule) fall back to
          // open-plugin-tool which opens the Plugins settings tab.
          if (onActivateBuiltin?.(item.pluginId)) {
            return;
          }
          const { getCommands } = await import('@/services/commandRegistry');
          const cmdId = `panel.${item.pluginId.replace(/^builtin:/, '')}`;
          if (getCommands().some((c) => c.id === cmdId)) {
            await emitRunCommand(cmdId);
          } else {
            await emitOpenPluginTool(item.pluginId);
          }
        } else {
          await emitOpenPluginTool(item.pluginId);
        }
      }
      onDone();
    },
    [onActivateBuiltin, onDone],
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
      {fileHits.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.files')}
          </div>
          {fileHits.map((f, i) => (
            <button
              key={f.path}
              type="button"
              data-search-index={i}
              className={`pet-panel-search-item${i === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={i === activeIndex}
              onClick={() => activateItem({ kind: 'file', path: f.path })}
            >
              <span className="pet-panel-search-item-title">{f.name}</span>
              <span className="pet-panel-search-item-sub">{f.path}</span>
            </button>
          ))}
        </section>
      )}
      {commandHits.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.commands')}
          </div>
          {commandHits.map((c, i) => {
            const index = fileHits.length + i;
            return (
            <button
              key={c.id}
              type="button"
              data-search-index={index}
              className={`pet-panel-search-item${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => activateItem({ kind: 'command', commandId: c.id })}
            >
              <span className="pet-panel-search-item-title">{c.title}</span>
            </button>
            );
          })}
        </section>
      )}
      {pluginHits.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.plugins')}
          </div>
          {pluginHits.map((p, i) => {
            const index = fileHits.length + commandHits.length + i;
            const title = p.nameKey ? t(p.nameKey) : p.entry.name;
            const sub = p.builtin
              ? p.entry.id
              : `${p.entry.id} · v${p.entry.version}`;
            return (
            <button
              key={p.entry.id}
              type="button"
              data-search-index={index}
              className={`pet-panel-search-item${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => activateItem({
                kind: 'plugin',
                pluginId: p.entry.id,
                builtin: !!p.builtin,
              })}
            >
              <span className="pet-panel-search-item-title">{title}</span>
              <span className="pet-panel-search-item-sub">{sub}</span>
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

/** Open a plugin's tool window (popup) in the main window. */
async function emitOpenPluginTool(pluginId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action: 'open-plugin-tool', pluginId });
  } catch {
    // Non-fatal.
  }
}
