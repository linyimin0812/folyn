/**
 * Sidebar shell — the panel-agnostic chrome (aside + resizer + collapse
 * toggle) that hosts the currently-active feature panel.
 *
 * PR2 change: the panel body is no longer a hardcoded `sidebarTab` switch.
 * Instead the active panel id is read from {@link useFeaturePanelStore} (which
 * mirrors `editorStore.activePanel`), and the registered `PanelEntry.
 * component` is rendered inside {@link PanelErrorBoundary}. Built-in panels
 * (files/wiki/clips/analyze/calendar) are registered by
 * `registerBuiltinPanels`; plugin panels arrive via `featureAdapter` (PR3).
 *
 * Shell-owned state stays here: sidebar width, collapse, resize-in-progress.
 * Panel-owned state (e.g. the files tree's search/expanded dirs) lives in each
 * panel component. Shell-level values reach the panel via {@link SidebarContext}.
 */

import { useState } from 'react';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import { SidebarResizer } from './SidebarResizer';
import { PanelErrorBoundary } from './PanelErrorBoundary';
import { SidebarContext, type SidebarContextValue } from './SidebarContext';

const DEFAULT_WIDTH = 224;

interface SidebarProps {
  /** Whether the sidebar is collapsed (hidden). Lifted to App so panel clicks can expand. */
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  /** Mobile-only: called after a file is opened so the overlay closes. */
  onFileSelect?: () => void;
}

export function Sidebar({ collapsed, onCollapsedChange, onFileSelect }: SidebarProps): React.JSX.Element {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [isResizing, setIsResizing] = useState(false);

  // Active panel entry — stable ref (found object or null). The store's
  // `activePanelId` mirrors `editorStore.activePanel`, so this reflects both
  // the persisted source of truth and UI clicks.
  const entry = useFeaturePanelStore((s) => {
    if (!s.activePanelId) return null;
    return s.panels.find((p) => p.id === s.activePanelId) ?? null;
  });
  const ActiveComponent = entry?.component;

  const ctx: SidebarContextValue = { width, onFileSelect, onCollapse: () => onCollapsedChange(true) };

  return (
    <>
      <aside
        // ponytail: aside intentionally has no right border — the adjacent
        // SidebarResizer draws the 1px divider (and tints it on hover). Drawing
        // both produces two stacked 1px lines that macOS subpixel AA blurs into
        // one but Windows WebView2 renders as a visibly thick 2px rule.
        className={`sidebar shrink-0 h-full overflow-hidden bg-panel flex flex-col${isResizing ? '' : ' transition-[width,opacity] duration-200 ease-in-out'}`}
        style={{ width: collapsed ? '0px' : `${width}px`, display: collapsed ? 'none' : undefined }}
      >
        <SidebarContext.Provider value={ctx}>
          {ActiveComponent ? (
            // ponytail: `key` on the boundary remounts it on panel switch,
            // resetting `state.error` so a panel that threw earlier doesn't
            // leave the fallback stuck when the user switches to another
            // (healthy) panel. Without this, the boundary instance persists
            // and `render()` keeps returning the fallback even after the
            // child changed. Add a per-panel error-recovery hook here if a
            // throw-then-retry-without-switch path becomes needed.
            <PanelErrorBoundary key={entry?.id} panelId={entry?.id}>
              <ActiveComponent />
            </PanelErrorBoundary>
          ) : (
            // Fallback: no panel registered for the active id (e.g. a plugin
            // panel still loading). Render nothing rather than crash; the
            // store's fallback logic will re-route to 'files' shortly.
            <div className="flex-1" />
          )}
        </SidebarContext.Provider>
      </aside>

      {/* Resize handle with collapse/expand toggle */}
      <SidebarResizer
        collapsed={collapsed}
        onCollapsedChange={onCollapsedChange}
        width={width}
        onWidthChange={setWidth}
        onResizingChange={setIsResizing}
      />
    </>
  );
}
