// Pet-panel unified search results — the panel search box (above the tabs)
// searches three sources: vault files, registered commands, and installed
// plugins. Rendered in the panel body while the query is non-empty.
//
// Cross-window routing (the panel is a separate JS realm):
//  - File → `pet://bubble-action { type:'navigate', target:{ kind:'file' } }`
//    (the main window's existing jump router opens it — same as PetInbox).
//  - Command → `pet://menu-action { action:'run-command', commandId }` — the
//    main window's routePetMenuAction runs it via the command registry.
//  - Plugin → `pet://menu-action { action:'open-plugins-settings' }` — the
//    main window opens the Plugins settings tab.

import { useEffect, useMemo, useState } from 'react';
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

export function PetPanelSearchResults({
  query,
  onDone,
}: PetPanelSearchResultsProps): JSX.Element {
  const { t } = useTranslation();
  const fileTree = useVaultStore((s) => s.fileTree);
  const [plugins, setPlugins] = useState<PluginEntry[]>([]);

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
          {fileHits.map((f) => (
            <button
              key={f.path}
              type="button"
              className="pet-panel-search-item"
              role="option"
              onClick={() => {
                void emitNavigateFile(f.path);
                onDone();
              }}
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
          {commandHits.map((c) => (
            <button
              key={c.id}
              type="button"
              className="pet-panel-search-item"
              role="option"
              onClick={() => {
                void emitRunCommand(c.id);
                onDone();
              }}
            >
              <span className="pet-panel-search-item-title">{c.title}</span>
            </button>
          ))}
        </section>
      )}
      {pluginHits.length > 0 && (
        <section className="pet-panel-search-group">
          <div className="pet-panel-search-group-label">
            {t('pet:search.plugins')}
          </div>
          {pluginHits.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pet-panel-search-item"
              role="option"
              onClick={() => {
                void emitOpenPluginsSettings();
                onDone();
              }}
            >
              <span className="pet-panel-search-item-title">{p.name}</span>
              <span className="pet-panel-search-item-sub">
                {p.id} · v{p.version}
              </span>
            </button>
          ))}
        </section>
      )}
    </div>
  );
}

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

/** Open the Plugins settings tab in the main window. */
async function emitOpenPluginsSettings(): Promise<void> {
  if (!isTauri()) return;
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit('pet://menu-action', { action: 'open-plugins-settings' });
  } catch {
    // Non-fatal.
  }
}
