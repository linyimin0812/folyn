/**
 * Sidebar shell context — passes shell-level concerns (sidebar width for
 * compact-mode layout, mobile `onFileSelect` close callback) from the Sidebar
 * wrapper down to the active panel component (registered via
 * {@link useFeaturePanelStore}).
 *
 * Built-in panels that don't care about these values (WikiFileTree, ClipsPanel,
 * AnalysisPanel, CalendarPanel) simply ignore them. The files panel
 * ({@link FilesPanel}) consumes both: width drives `isCompact`, and
 * `onFileSelect` fires after a file click on mobile to close the sidebar
 * overlay.
 *
 * Using context (vs. props on the registered component) keeps `PanelEntry.
 * component` typed as a plain `ComponentType` so the store/adapter don't need
 * to know about shell plumbing. Plugin panels (PR3) can opt-in to the same
 * context if they need shell-aware behavior.
 */

import { createContext, useContext } from 'react';

export interface SidebarContextValue {
  /** Current sidebar pixel width. Files panel uses this for compact-mode layout. */
  width: number;
  /** Mobile-only: called after a file is opened so the sidebar overlay closes. */
  onFileSelect?: () => void;
  /** Called by panel headers (e.g. files panel hide button) to collapse the sidebar. */
  onCollapse?: () => void;
}

export const SidebarContext = createContext<SidebarContextValue>({ width: 224 });

export function useSidebarContext(): SidebarContextValue {
  return useContext(SidebarContext);
}
