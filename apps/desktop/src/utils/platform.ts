/** Whether the app is running inside a Tauri webview. Always true for desktop-only builds. */
export function isTauri(): boolean {
  return true;
}

/** Whether the app is running in the secondary `pet-panel` window (route
 *  `/#/pet-panel`). The panel is a separate JS realm with its own store
 *  instances; this mirrors the hash detection in main.tsx so store-level code
 *  can branch on the window (e.g. skip local fs persistence and sync from the
 *  main window instead). */
export function isPetPanelWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return (window.location.hash || window.location.href || '').indexOf('#/pet-panel') !== -1;
}
