/**
 * Command registry for the unified command palette (⌘P).
 *
 * A command is a single executable item surfaced in the palette. The registry
 * is the single source of truth and the future extension point for additional
 * command sources (custom commands, plugin commands).
 *
 * Static commands (actions + panels/modes) are registered once at app start via
 * {@link registerBuiltinCommands}. File commands are NOT registered here — they
 * are built lazily from the live `vaultStore` file tree by the palette store
 * (see `services/fileCommands.ts`) so they always reflect the watched tree.
 */

import { useNavStore } from '@/store/navStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorStore } from '@/store/editorStore';
import * as editorIoService from '@/services/editorIoService';
import { useSearchStore } from '@/store/searchStore';
import type { ActivityPanel } from '@/components/shell/ActivityBar';
import {
  exportActiveMarkdown,
  exportActiveHtml,
} from '@/hooks/useExport';
import { requestNewItem } from './newItemBridge';
import { requestPlanMyDay } from './planMyDayBridge';

export type CommandCategory = 'action' | 'panel-mode' | 'file';

export interface Command {
  /** Stable unique id; used by the palette store to run commands by id. */
  id: string;
  /** Display title shown in the palette UI; also the primary fuzzy-match target. */
  title: string;
  category: CommandCategory;
  /** Optional icon name for rendering. */
  icon?: string;
  /** Extra terms to match against in addition to `title`. */
  keywords?: string[];
  /**
   * Optional visibility predicate. When it returns `false` the command is
   * hidden from the palette (e.g. a panel command whose feature is disabled in
   * settings). Evaluated by the palette store at list-build time.
   */
  enabled?: () => boolean;
  /** Execute the command. Errors are caught and logged by the registry. */
  run: () => void | Promise<void>;
}

const registry = new Map<string, Command>();

/** Minimal disposable returned by command registration for plugin cleanup. */
export interface CommandDisposable {
  dispose(): void;
}

/**
 * Register a command. A later registration with the same id replaces the prior
 * one (allows re-seeding during HMR / tests). Returns a disposable that removes
 * the command only if it is still the same instance (avoids clobbering a
 * re-registered command on late dispose — the plugin-uninstall safe path).
 */
export function registerCommand(cmd: Command): CommandDisposable {
  registry.set(cmd.id, cmd);
  return {
    dispose: () => {
      const existing = registry.get(cmd.id);
      if (existing === cmd) registry.delete(cmd.id);
    },
  };
}

/** Register many commands at once. */
export function registerCommands(commands: Command[]): void {
  for (const cmd of commands) registerCommand(cmd);
}

/** Read all currently-registered commands (insertion order). */
export function getCommands(): Command[] {
  return Array.from(registry.values());
}

/** Look up a single command by id. */
export function getCommand(id: string): Command | undefined {
  return registry.get(id);
}

/** Remove a command by id. Returns true if a command was removed. */
export function unregisterCommand(id: string): boolean {
  return registry.delete(id);
}

/** Remove all registered commands (test helper). */
export function clearCommands(): void {
  registry.clear();
}

/**
 * Safely run a command by id. Errors are logged and never propagate so a single
 * failing command cannot take down the palette.
 */
export async function runCommand(id: string): Promise<void> {
  const cmd = registry.get(id);
  if (!cmd) {
    console.warn('[commandRegistry] unknown command:', id);
    return;
  }
  try {
    await cmd.run();
  } catch (err) {
    console.error(`[commandRegistry] command "${id}" failed:`, err);
  }
}

/** Switch to the editor surface and a given activity panel. */
function gotoPanel(panel: ActivityPanel): void {
  useNavStore.getState().setCurrentPage('editor');
  useEditorStore.getState().setActivePanel(panel);
}

/**
 * Seed the built-in (static) command set: actions + panel/mode commands.
 * File commands are sourced dynamically by the palette store.
 *
 * Safe to call multiple times — re-registration replaces by id.
 */
export function registerBuiltinCommands(): void {
  const nav = () => useNavStore.getState();
  const appearance = () => useAppearanceStore.getState();

  registerCommands([
    // ── Actions ──
    {
      id: 'action.toggle-theme',
      title: 'Toggle Theme',
      category: 'action',
      keywords: ['dark', 'light', 'appearance'],
      run: () => appearance().toggleTheme(),
    },
    {
      id: 'action.new-file',
      title: 'New File',
      category: 'action',
      keywords: ['create', 'markdown', 'note'],
      run: () => {
        gotoPanel('files');
        requestNewItem('file');
      },
    },
    {
      id: 'action.new-folder',
      title: 'New Folder',
      category: 'action',
      keywords: ['create', 'directory', 'folder'],
      run: () => {
        gotoPanel('files');
        requestNewItem('dir');
      },
    },
    {
      id: 'action.open-daily-note',
      title: 'Open Daily Note',
      category: 'action',
      keywords: ['today', 'journal', 'calendar'],
      run: () => editorIoService.openDailyNote(),
    },
    {
      id: 'action.open-external-file',
      title: 'Open External File…',
      category: 'action',
      keywords: ['open', 'external', 'outside', 'vault', 'disk', 'browse'],
      run: () => {
        void editorIoService.openExternalFile();
      },
    },
    {
      id: 'action.export-markdown',
      title: 'Export as Markdown',
      category: 'action',
      keywords: ['download', 'md', 'save'],
      run: () => exportActiveMarkdown(),
    },
    {
      id: 'action.export-html',
      title: 'Export as HTML',
      category: 'action',
      keywords: ['download', 'web', 'page'],
      run: () => {
        void exportActiveHtml();
      },
    },
    {
      id: 'action.open-global-search',
      title: 'Open Global Search',
      category: 'action',
      keywords: ['find', 'grep', 'search'],
      run: () => useSearchStore.getState().openPanel(),
    },
    {
      id: 'action.plan-my-day',
      title: 'AI Plan My Day',
      category: 'action',
      keywords: ['ai', 'schedule', 'plan', 'today'],
      run: () => {
        // Switch to the schedule workbench, then trigger the plan flow via the
        // bridge (handles the mount-race where the workbench isn't mounted
        // yet — the request is replayed on mount).
        nav().setCurrentPage('schedule');
        requestPlanMyDay();
      },
    },

    // ── Panels (ActivityBar) ──
    {
      id: 'panel.files',
      title: 'Go to Files',
      category: 'panel-mode',
      keywords: ['explorer', 'tree'],
      run: () => gotoPanel('files'),
    },
    {
      id: 'panel.clips',
      title: 'Go to Clips',
      category: 'panel-mode',
      keywords: ['bookmark', 'clip'],
      enabled: () => appearance().enableClipsPanel,
      run: () => gotoPanel('clips'),
    },
    {
      id: 'panel.wiki',
      title: 'Go to Wiki',
      category: 'panel-mode',
      enabled: () => appearance().enableWikiPanel,
      run: () => gotoPanel('wiki'),
    },
    {
      id: 'panel.analyze',
      title: 'Go to Analyze',
      category: 'panel-mode',
      keywords: ['analysis', 'project'],
      enabled: () => appearance().enableAnalyzePanel,
      run: () => gotoPanel('analyze'),
    },
    {
      id: 'panel.settings',
      title: 'Open Settings',
      category: 'panel-mode',
      keywords: ['preferences', 'config'],
      run: () => nav().setCurrentPage('settings'),
    },

    // ── Wiki ingest ──
    {
      id: 'wiki.ingestCurrentFile',
      title: 'Wiki: Ingest Current File',
      category: 'action',
      keywords: ['wiki', 'ingest', 'import', 'knowledge'],
      enabled: () => {
        if (!appearance().enableWikiPanel) return false;
        const s = useEditorStore.getState();
        if (!s.activeTabId) return false;
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        return !!tab && !tab.path.startsWith('__wiki__/');
      },
      run: () => {
        const s = useEditorStore.getState();
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        if (!tab) return;
        void import('@/services/wikiIngestService').then((m) => m.runIngest([tab.path])).catch(console.error);
      },
    },

    {
      id: 'wiki.newQuery',
      title: 'Wiki: New Query',
      category: 'panel-mode',
      keywords: ['wiki', 'query', 'ask', 'search'],
      enabled: () => appearance().enableWikiPanel,
      run: () => {
        useEditorStore.setState({ activePanel: 'wiki' });
        void editorIoService.openFile('wiki-query', 'Wiki Query');
      },
    },
    {
      id: 'wiki.openGraph',
      title: 'Wiki: Open Graph',
      category: 'panel-mode',
      keywords: ['wiki', 'graph', 'network', 'visualize'],
      enabled: () => appearance().enableWikiPanel,
      run: () => {
        useEditorStore.setState({ activePanel: 'wiki' });
        void editorIoService.openFile('wiki-graph', 'Wiki Graph');
      },
    },

    // ── Editor view modes ──
    {
      id: 'mode.split',
      title: 'View: Split',
      category: 'panel-mode',
      keywords: ['view', 'editor'],
      run: () => useEditorStore.getState().setViewMode('split'),
    },
    {
      id: 'mode.edit',
      title: 'View: Edit Only',
      category: 'panel-mode',
      keywords: ['view', 'editor'],
      run: () => useEditorStore.getState().setViewMode('edit'),
    },
    {
      id: 'mode.preview',
      title: 'View: Preview Only',
      category: 'panel-mode',
      keywords: ['view', 'render'],
      run: () => useEditorStore.getState().setViewMode('preview'),
    },
  ]);
}
