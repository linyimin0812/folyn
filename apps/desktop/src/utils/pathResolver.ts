// ponytail: module-level homeDir cache. Tauri's homeDir() is a static
// per-session value; calling it on every NodeView mount and every image
// paste fires redundant invokes that pile up against any teardown
// (HMR, tab close, ProseMirror remount) and produce
// `[TAURI] Couldn't find callback id` warnings. Cache the first resolution;
// subsequent callers get the same Promise/value with no new IPC round-trip.
// Upgrade: invalidate if the app ever supports user-switching the OS user
// mid-session (it doesn't).
let homeDirPromise: Promise<string> | null = null;

function getCachedHomeDir(): Promise<string> {
  if (!homeDirPromise) {
    homeDirPromise = import('@tauri-apps/api/path')
      .then(({ homeDir }) => homeDir())
      .then((h) => h.replace(/[/\\]+$/, ''));
  }
  return homeDirPromise;
}

export async function resolveBasePath(basePath: string): Promise<string> {
  let resolved = basePath;
  if (resolved.startsWith('~')) {
    const home = await getCachedHomeDir();
    const { join } = await import('@tauri-apps/api/path');
    // ponytail: join() is separator-aware (\ on Windows, / on macOS). String
    // concat `home + resolved.slice(1)` produced mixed separators on Windows
    // (C:\Users\x/folyn/...) which Tauri 2's fs scope glob fails to match
    // against $HOME/** → "forbidden path:" errors.
    resolved = await join(home, resolved.slice(1));
  }
  return resolved.replace(/[/\\]+$/, '');
}
