/**
 * Bridge between the command palette's "new file / new folder" actions and the
 * Sidebar's inline new-item flow.
 *
 * The Sidebar owns the new-item UI state (inline rename input) inside
 * {@link useSidebarActions}. The command palette runs commands outside React
 * (imperatively, via `getState()`), so it cannot call the hook directly. This
 * tiny module holds a stable starter function registered by the Sidebar on
 * mount and invoked by the palette's new-file/new-folder commands.
 *
 * Mount-race handling: if a request arrives before the Sidebar has mounted
 * (e.g. the palette switched `currentPage` from 'settings' to 'editor' and the
 * Sidebar hasn't rendered yet), the request is queued and fulfilled on mount.
 */

export type NewItemType = 'file' | 'dir';

type Starter = (type: NewItemType, parentDir?: string) => void;

let starter: Starter | null = null;
let pending: NewItemType | null = null;

/**
 * Register the Sidebar's new-item starter. Called on mount; cleared on unmount.
 * Fulfills any request that arrived while the Sidebar was not mounted.
 */
export function setNewItemStarter(fn: Starter | null): void {
  starter = fn;
  if (fn && pending !== null) {
    const type = pending;
    pending = null;
    fn(type);
  }
}

/**
 * Request that the Sidebar begin a new-item flow. If the Sidebar is not
 * mounted, the request is queued and replayed when it mounts.
 */
export function requestNewItem(type: NewItemType): void {
  if (starter) {
    starter(type);
  } else {
    pending = type;
  }
}

/** Test helper: reset the bridge to its initial state. */
export function resetNewItemBridge(): void {
  starter = null;
  pending = null;
}
