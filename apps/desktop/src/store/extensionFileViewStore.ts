/**
 * View mode of the file view an extension page is showing.
 *
 * The top bar owns the one mode segment (edit / split / preview) in the app.
 * An extension page that mounts `api.fileView` publishes its available modes
 * here, and the segment reads and writes them — so the page is switched from
 * the top bar instead of growing a second, duplicate set of icons.
 */

import { create } from 'zustand';
import type { ViewMode } from 'folyn-extension-sdk';

export interface ExtensionFileViewState {
  /** Modes the mounted file view supports; empty when nothing is mounted. */
  modes: ViewMode[];
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** The document the mounted file view shows, so the 演示模式 shortcut can
   *  present it the way it presents the editor's active tab. */
  current: { path: string; content: string } | null;
  /** Markdown an extension page is showing in the Vault's 演示模式, or null. */
  presenting: { path: string; content: string } | null;
  setPresenting: (doc: { path: string; content: string } | null) => void;
}

export const useExtensionFileViewStore = create<ExtensionFileViewState>((set) => ({
  modes: [],
  mode: 'preview',
  setMode: (mode) => set({ mode }),
  current: null,
  presenting: null,
  setPresenting: (presenting) => set({ presenting }),
}));
