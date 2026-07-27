/**
 * Bridge between non-sidebar callers (e.g. the Topbar "copy external file to
 * vault" action) and the Sidebar's reveal-and-select flow.
 *
 * The Sidebar owns the tree state (`expandedDirs`, `selectedPaths`, the
 * `data-filepath` DOM nodes) inside {@link FilesPanel}. Actions that run
 * outside the Sidebar — opening a freshly-copied file from the Topbar — need
 * to ask the Sidebar to expand the file's parent dirs, scroll it into view,
 * and select its row. They cannot reach into the component directly, so this
 * tiny module holds a stable starter function registered by the Sidebar on
 * mount and invoked imperatively.
 *
 * Mount-race handling mirrors {@link newItemBridge}: if a request arrives
 * before the Sidebar has mounted (e.g. the editor page was not yet visible),
 * the path is queued and replayed on mount.
 */

type Starter = (path: string) => void;

let starter: Starter | null = null;
let pending: string | null = null;

/**
 * Register the Sidebar's reveal-and-select starter. Called on mount; cleared
 * on unmount. Fulfills any request that arrived while the Sidebar was not
 * mounted.
 */
export function setRevealPathStarter(fn: Starter | null): void {
  starter = fn;
  if (fn && pending !== null) {
    const path = pending;
    pending = null;
    fn(path);
  }
}

/**
 * Request that the Sidebar reveal and select a vault-relative path. If the
 * Sidebar is not mounted, the request is queued and replayed when it mounts.
 */
export function requestRevealPath(path: string): void {
  if (starter) {
    starter(path);
  } else {
    pending = path;
  }
}

/** Test helper: reset the bridge to its initial state. */
export function resetRevealPathBridge(): void {
  starter = null;
  pending = null;
}
