// Pet-panel unified search results — the panel search box (above the tabs)
// searches three sources: vault files, registered commands, and installed
// plugins. Rendered in the panel body while the query is non-empty.
//
// Cross-window routing (the panel is a separate JS realm):
//  - File → `pet://bubble-action { type:'navigate', target:{ kind:'file' } }`
//    (the main window's existing jump router opens it — same as PetInbox).
//  - Command → `pet://menu-action { action:'run-command', commandId }` — the
//    main window's routePetMenuAction runs it via the command registry.
//  - Plugin → `pet://menu-action { action:'open-plugin-tool', pluginId }` —
//    the main window opens the plugin's tool window (popup) via its
//    registered `plugin.openTool.<pluginId>.<toolId>` command; plugins
//    without a window tool fall back to the Plugins settings tab.

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
import type { PluginEntry } from '@/store/pluginStore';
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
  | { kind: 'plugin'; pluginId: string };

export const PetPanelSearchResults = forwardRef<
  PetPanelSearchResultsHandle,
  PetPanelSearchResultsProps
>(function PetPanelSearchResults({ query, onDone }, ref) {
  const { t } = useTranslation();
  const fileTree = useVaultStore((s) => s.fileTree);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  // Vault files (the panel receives the tree via `pet://file-tree-updated`).
  const files = useMemo(() => flattenMarkdownFiles(fileTree), [fileTree]);
  // Registered commands (static registry is available in this realm too).
  const commands = useMemo(
    () => getCommands().filter((c) => !c.enabled || c.enabled()),
    [],
  );

  // Installed plugins — refreshed once on mount (the panel window lives as
  // long as the app, and installs happen in the main window's settings).
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    void import('@tauri-apps/api/core').then(({ invoke }) =>
      invoke<PluginEntry[]>('list_plugins')
        .then((entries) => {
          if (!cancelled) setPlugins(entries ?? []);
        })
        .catch(() => {
          if (!cancelled) setPlugins([]);
        }),
    );
    return () => {
      cancelled = true;
    };
  }, []);

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
    ? plugins
        .filter((p) => matches(q, p.name, p.id))
        .slice(0, MAX_PER_GROUP)
    : [];
  const total = fileHits.length + commandHits.length + pluginHits.length;

  // Flattened hit list in render order — index maps 1:1 onto the DOM buttons
  // (`data-search-index`), so ArrowUp/ArrowDown/Enter can drive the UI.
  const items = useMemo<SearchItem[]>(
    () => [
      ...fileHits.map((f): SearchItem => ({ kind: 'file', path: f.path })),
      ...commandHits.map((c): SearchItem => ({ kind: 'command', commandId: c.id })),
      ...pluginHits.map((p): SearchItem => ({ kind: 'plugin', pluginId: p.id })),
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
    (item: SearchItem) => {
      if (item.kind === 'file') void emitNavigateFile(item.path);
      else if (item.kind === 'command') void emitRunCommand(item.commandId);
      else void emitOpenPluginTool(item.pluginId);
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
            return (
            <button
              key={p.id}
              type="button"
              data-search-index={index}
              className={`pet-panel-search-item${index === activeIndex ? ' is-active' : ''}`}
              role="option"
              aria-selected={index === activeIndex}
              onClick={() => activateItem({ kind: 'plugin', pluginId: p.id })}
            >
              <span className="pet-panel-search-item-title">{p.name}</span>
              <span className="pet-panel-search-item-sub">
                {p.id} · v{p.version}
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
