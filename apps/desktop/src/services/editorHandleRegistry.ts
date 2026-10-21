/**
 * Global registry for the active editor handle (the CodeMirror-backed
 * FolynEditor). EditorPane/WorkArea register the current handle on mount +
 * active-tab change; the ExtensionApi's `editor` capability reads from here
 * so extensions can query/replace the selection without touching the internal
 * view directly (doc §15 — core owns CodeMirror; extensions get high-level ops).
 */

import type { FolynEditorHandle } from '@/editor/EditorView';

let active: FolynEditorHandle | null = null;
let activeTabId: string | null = null;
const listeners = new Set<() => void>();

export function setActiveEditorHandle(handle: FolynEditorHandle | null, tabId: string | null = null): void {
  active = handle;
  activeTabId = handle ? tabId : null;
  for (const listener of listeners) listener();
}

export function getActiveEditorHandle(): FolynEditorHandle | null {
  return active;
}

/** File-aware access prevents a delayed append from editing the previous tab. */
export function getActiveEditorHandleFor(tabId: string): FolynEditorHandle | null {
  return activeTabId === tabId ? active : null;
}

export function onActiveEditorHandleChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
