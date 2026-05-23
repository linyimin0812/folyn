/** Whether the app is running inside a Tauri webview. Always true for desktop-only builds. */
export function isTauri(): boolean {
  return true;
}
