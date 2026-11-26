import { create } from 'zustand';
import { useVaultStore } from './vaultStore';
import { getHandlerByExtension, listProviders } from '@/components/file-types/registry';
import { isBinaryExtension } from '@/components/file-types/binaryExtensions';
import { isDeclaredByInstalledExtension } from '@/components/file-types/declaredByExtension';
import { useFileTypePreferenceStore } from './fileTypePreferenceStore';
import { persistOpenTabs, flushPersistOpenTabs, flushPersistExternalOpenTabs } from './editorPersistence';
import { scheduleAutoSave } from './editorAutoSave';
import { saveFile as saveFileIo } from '@/services/editorIoService';
import { useEditorPrefsStore } from './editorPrefsStore';
import type { ActivityPanel } from '@/components/shell/ActivityBar';
import type { ViewMode } from '@/components/file-types/types';
export type { ViewMode };

export type FileType = string;

export function detectFileType(filePath: string): FileType {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  // User preference (Open With, §53) overrides the priority default — but
  // only if the preferred provider still claims this extension.
  const preferred = useFileTypePreferenceStore.getState().getPreferredProvider(ext);
  if (preferred && listProviders(ext).some((p) => p.id === preferred)) {
    return preferred;
  }
  const handler = getHandlerByExtension(ext);
  if (handler) return handler.id;
  // No builtin or active extension claims this extension. A known non-text
  // format (binary) → unsupported preview-only (don't dump binary bytes as
  // text); a format an installed-but-inactive extension declares (disabled,
  // or awaiting approval) → unsupported-text (plain-text edit + notice);
  // anything else → the generic code/text editor.
  if (isBinaryExtension(ext)) return 'unsupported';
  if (isDeclaredByInstalledExtension(ext)) return 'unsupported-text';
  return 'code';
}

export interface FileTab {
  id: string;
  name: string;
  path: string;
  content: string;
  isDirty: boolean;
  fileType: FileType;
  /** Which activity panel this tab belongs to */
  activity: ActivityPanel;
  /** Pinned tabs (refactor spec Phase 6.2): rendered as a stable leading
   *  group, skipped by close-others/close-all, no close affordance in the
   *  tab strip — closing one is an explicit context-menu action. */
  pinned?: boolean;
  /** Saved cursor line (1-based) for this tab */
  cursorLine?: number;
  /** Saved cursor column (1-based) for this tab */
  cursorCol?: number;
  /** Saved editor scroll top (px) for this tab — restored on remount so
   *  switching files preserves the exact scroll position (cursorLine alone
   *  only scrollIntoView's to the cursor, not the precise viewport). */
  editorScrollTop?: number;
  /** Saved preview scroll top (px) for this tab — restored on tab switch so
   *  the preview pane resumes the exact scroll position of each file, not
   *  the previous file's. */
  previewScrollTop?: number;
  /** Saved container-state snapshot of the reading scene (open collapsibles,
   *  tabs selections — refactor spec Phase 4.5) for this tab. Replayed by
   *  back/forward restores and tab returns. Structurally compatible with
   *  headingNav's ComponentStateSnapshot. */
  previewComponents?: {
    openCollapsibles: number[];
    tabsSelections: Array<{ line: number; active: number }>;
  };
  /** Saved view mode for this tab (restored on tab switch) */
  viewMode?: ViewMode;
  /** Last reading section (refactor spec Phase 6.2): the nearest heading
   *  above the preview viewport when the pane last scrolled. Kept on the
   *  tab record so the tab switcher can label each reading scene — two tabs
   *  of the same document show different sections instead of two identical
   *  filenames. Written from PreviewPane's scroll listener (throttled). */
  readingHeading?: { line: number; text: string };
}

/** Determine which activity panel a tab belongs to based on its path and file type */
export function detectActivity(_filePath: string, _fileType: FileType): ActivityPanel {
  return 'files';
}

interface EditorState {
  /** Currently active view mode */
  viewMode: ViewMode;
  /** Currently active activity panel */
  activePanel: ActivityPanel;
  /** List of open file tabs */
  tabs: FileTab[];
  /** ID of the currently active tab */
  activeTabId: string | null;
  /** Whether a file is currently being loaded */
  isFileLoading: boolean;

  // Actions
  setViewMode: (mode: ViewMode) => void;
  setActivePanel: (panel: ActivityPanel) => void;
  addTab: (tab: FileTab, opts?: { activate?: boolean; insertAfterTabId?: string | null }) => void;
  closeTab: (tabId: string) => void;
  closeOthers: (keepTabId: string) => void;
  setActiveTab: (tabId: string) => void;
  updateTabContent: (tabId: string, content: string) => void;
  markTabDirty: (tabId: string, isDirty: boolean) => void;
  togglePin: (tabId: string) => void;
  /** MRU order (most recently used first) — drives close-to-MRU, the quick
   *  switcher and the tab-switch ordering. Tab STRIP order stays the tab
   *  array order (stable, never reordered by usage). */
  mruOrder: string[];
  /** Step the MRU ring: +1 = previous tab (most recent before current),
   *  -1 = back. Used by Ctrl+Tab / Ctrl+Shift+Tab. */
  stepMru: (dir: 1 | -1) => void;

  /** Open a web URL in a new tab */
  openWebTab: (url: string, title?: string) => void;
  /** Rewrite open tab paths after a directory rename (e.g. legacy prefix → managed prefix) */
  rewriteTabPrefixes: (mapping: { from: string; to: string }[]) => void;
}

export const useEditorStore = create<EditorState>()(
    (set, get) => ({
      viewMode: 'split',
      activePanel: 'files' as ActivityPanel,
      tabs: [],
      activeTabId: null,
      isFileLoading: false,
      mruOrder: [],

      setViewMode: (mode) => {
        const activeTabId = get().activeTabId;
        set((state) => ({
          viewMode: mode,
          tabs: activeTabId
            ? state.tabs.map((t) =>
                t.id === activeTabId ? { ...t, viewMode: mode } : t,
              )
            : state.tabs,
        }));
      },

      setActivePanel: (panel) => {
        set((state) => {
          // Find the first tab belonging to the new activity panel
          const firstTabOfPanel = state.tabs.find((t) => t.activity === panel);
          return {
            activePanel: panel,
            activeTabId: firstTabOfPanel?.id ?? null,
          };
        });
      },

      addTab: (tab, opts) =>
        set((state) => {
          // Auto-detect activity if not already set on the tab
          const tabWithActivity = tab.activity ? tab : { ...tab, activity: detectActivity(tab.path, tab.fileType) };
          // Insert position: background opens land right of the SOURCE tab
          // (spec 6.2: 新标签页位于来源标签页右侧); default = append at end.
          let tabs = state.tabs;
          if (opts?.insertAfterTabId != null) {
            const at = tabs.findIndex((t) => t.id === opts.insertAfterTabId);
            tabs = [...tabs.slice(0, at + 1), tabWithActivity, ...tabs.slice(at + 1)];
          } else {
            tabs = [...tabs, tabWithActivity];
          }
          // Pinned tabs render as a stable leading group — keep the array
          // pinned-first so the strip never moves a pinned tab (spec: 固定
          // 标签页保持稳定位置).
          tabs = [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
          const activate = opts?.activate !== false;
          return {
            tabs,
            ...(activate
              ? { activeTabId: tabWithActivity.id, mruOrder: [tabWithActivity.id, ...state.mruOrder.filter((id) => id !== tabWithActivity.id)] }
              : {}),
          };
        }),

      closeTab: (tabId) => {
        set((state) => {
          const closedTab = state.tabs.find((t) => t.id === tabId);
          const newTabs = state.tabs.filter((t) => t.id !== tabId);
          let newActiveId = state.activeTabId;
          let newViewMode = state.viewMode;
          if (state.activeTabId === tabId) {
            // Spec 6.2: closing the active tab returns to the most recently
            // used tab (MRU) — not the same-panel/positional neighbor.
            // Walk the MRU list first (only surviving tabs), then fall back
            // to panel affinity and finally the last tab.
            const alive = state.mruOrder
              .filter((id) => id !== tabId)
              .map((id) => newTabs.find((t) => t.id === id))
              .filter((t): t is FileTab => !!t);
            const nextActive =
              (closedTab ? alive.find((t) => t.activity === closedTab.activity) : undefined)
              ?? alive[0]
              ?? (closedTab ? newTabs.find((t) => t.activity === closedTab.activity) : undefined)
              ?? newTabs[newTabs.length - 1];
            newActiveId = nextActive?.id ?? null;
            // ponytail: reconcile viewMode to the new active tab's saved mode,
            // otherwise the closed tab's mode leaks into the new active tab's
            // UI (mirrors setActiveTab's per-tab restoration).
            if (nextActive?.viewMode) newViewMode = nextActive.viewMode;
          }
          return {
            tabs: newTabs,
            activeTabId: newActiveId,
            viewMode: newViewMode,
            mruOrder: state.mruOrder.filter((id) => id !== tabId),
          };
        });
        // Flush immediately (no debounce): a debounced write would be lost if
        // the app quits right after closing, restoring the closed tab on the
        // next launch. Flush both vault and external (vault-independent) tabs.
        const vaultId = useVaultStore.getState().activeVaultId;
        const { tabs, activeTabId } = get();
        if (vaultId) flushPersistOpenTabs(vaultId, tabs, activeTabId);
        flushPersistExternalOpenTabs('ext', tabs, activeTabId);
      },

      closeOthers: (keepTabId) => {
        // Spec 6.2: 批量关闭时保护固定标签页 — pinned tabs survive close-others.
        // Unsaved edits are protected by the caller (WorkArea flushes
        // auto-save / asks); this store action only manages membership.
        set((state) => {
          const kept = state.tabs.filter((t) => t.id === keepTabId || t.pinned);
          const keptIds = new Set(kept.map((t) => t.id));
          return {
            tabs: kept,
            mruOrder: state.mruOrder.filter((id) => keptIds.has(id)),
            activeTabId: keptIds.has(state.activeTabId ?? '') ? state.activeTabId : keepTabId,
          };
        });
        const vaultId = useVaultStore.getState().activeVaultId;
        const { tabs, activeTabId } = get();
        if (vaultId) flushPersistOpenTabs(vaultId, tabs, activeTabId);
        flushPersistExternalOpenTabs('ext', tabs, activeTabId);
      },

      togglePin: (tabId) =>
        set((state) => {
          const target = state.tabs.find((t) => t.id === tabId);
          if (!target) return state;
          if (!target.pinned) {
            // Pin: lift into the leading pinned group (stable position, spec
            // 6.2 固定标签页保持稳定位置).
            return { tabs: [{ ...target, pinned: true }, ...state.tabs.filter((t) => t.id !== tabId)] };
          }
          // Unpin: drop to the END of the unpinned group (same muscle memory
          // as browser tab bars — an unpinned tab never stays on the left).
          return { tabs: [...state.tabs.filter((t) => t.id !== tabId), { ...target, pinned: false }] };
        }),

      setActiveTab: (tabId) => {
        const tab = get().tabs.find((t) => t.id === tabId);
        set({
          activeTabId: tabId,
          mruOrder: [tabId, ...get().mruOrder.filter((id) => id !== tabId)],
          ...(tab?.viewMode ? { viewMode: tab.viewMode } : {}),
        });
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, tabId);
      },

      stepMru: (dir) => {
        const { mruOrder, activeTabId, tabs } = get();
        if (mruOrder.length < 2) return;
        // Single-step switch (spec 6.2 最近使用标签页快速切换): Ctrl+Tab lands
        // on the PREVIOUS tab (mruOrder[1] — mruOrder[0] is the current);
        // Ctrl+Shift+Tab lands on the least-recently-used tab. Hold-to-cycle
        // rings are deliberately out of scope for v1.
        const target = dir === 1 ? mruOrder[1] : mruOrder[mruOrder.length - 1];
        if (target && target !== activeTabId && tabs.some((t) => t.id === target)) {
          get().setActiveTab(target);
        }
      },

      updateTabContent: (tabId, content) => {
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, content, isDirty: true } : t,
          ),
        }));

        // Debounced auto-save — ponytail: saveFile lives in editorIoService;
        // route the debounced save through it. ESM live binding resolves
        // the editorStore↔editorIoService cycle at call time, not eval time.
        if (useEditorPrefsStore.getState().autoSave) {
          scheduleAutoSave(tabId, (id) => saveFileIo(id));
        }
      },

      markTabDirty: (tabId, isDirty) =>
        set((state) => ({
          tabs: state.tabs.map((t) =>
            t.id === tabId ? { ...t, isDirty } : t,
          ),
        })),

      openWebTab: (url, title) => {
        const tabId = `web:${url}`;
        const existing = get().tabs.find((t) => t.id === tabId);
        if (existing) {
          set({ activeTabId: existing.id, mruOrder: [existing.id, ...get().mruOrder.filter((id) => id !== existing.id)] });
          return;
        }
        const displayName = title || (() => { try { return new URL(url).hostname; } catch { return url; } })();
        const newTab: FileTab = {
          id: tabId,
          name: displayName,
          path: url,
          content: '',
          isDirty: false,
          fileType: 'web',
          activity: 'files',
        };
        get().addTab(newTab);
        // Persist web tabs so they reappear in the open-files tab bar on the
        // next launch (same path as file tabs).
        const vaultId = useVaultStore.getState().activeVaultId;
        if (vaultId) persistOpenTabs(vaultId, get().tabs, newTab.id);
      },

      rewriteTabPrefixes: (mapping) => {
        if (mapping.length === 0) return;
        set((state) => {
          const rewritten = state.tabs.map((tab) => {
            if (tab.fileType === 'web') return tab;
            for (const { from, to } of mapping) {
              if (tab.path === from || tab.path.startsWith(`${from}/`)) {
                const suffix = tab.path === from ? '' : tab.path.slice(from.length);
                const newPath = `${to}${suffix}`;
                const newName = newPath.includes('/') ? newPath.substring(newPath.lastIndexOf('/') + 1) : newPath;
                return { ...tab, path: newPath, name: newName };
              }
            }
            return tab;
          });
          return { tabs: rewritten };
        });
      },
    }),
);
