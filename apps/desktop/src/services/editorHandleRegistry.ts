/**
 * Global registry for the active editor handle (the CodeMirror-backed
 * FolynEditor). EditorPane/WorkArea register the current handle on mount +
 * active-tab change; the ExtensionApi's `editor` capability reads from here
 * so extensions can query/replace the selection without touching the internal
 * view directly (doc §15 — core owns CodeMirror; extensions get high-level ops).
 */

import type { FolynEditorHandle } from '@/editor/EditorView';

let active: FolynEditorHandle | null = null;

export function setActiveEditorHandle(handle: FolynEditorHandle | null): void {
  active = handle;
}

export function getActiveEditorHandle(): FolynEditorHandle | null {
  return active;
}
