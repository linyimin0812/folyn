/**
 * View mode of the file view an extension page is showing.
 *
 * The top bar owns the one mode segment (edit / split / preview) in the app.
 * An extension page that mounts `api.fileView` publishes its available modes
 * here, and the segment reads and writes them — so the page is switched from
 * the top bar instead of growing a second, duplicate set of icons.
 */

import { create } from 'zustand';
import type { ExtensionAssetResolver, ViewMode } from 'folyn-extension-sdk';

/** A document an extension page shows; `resolveAsset` loads the images it
 *  references when the document is not on disk. */
export interface ExtensionDocument {
  path: string;
  content: string;
  resolveAsset?: ExtensionAssetResolver;
}

export interface ExtensionFileViewState {
  /** Modes the mounted file view supports; empty when nothing is mounted. */
  modes: ViewMode[];
  mode: ViewMode;
  setMode: (mode: ViewMode) => void;
  /** The document the mounted file view shows, so the 演示模式 shortcut can
   *  present it the way it presents the editor's active tab. */
  current: ExtensionDocument | null;
  /** Markdown an extension page is showing in the Vault's 演示模式, or null. */
  presenting: ExtensionDocument | null;
  setPresenting: (doc: ExtensionDocument | null) => void;
}

export const useExtensionFileViewStore = create<ExtensionFileViewState>((set) => ({
  modes: [],
  mode: 'preview',
  setMode: (mode) => set({ mode }),
  current: null,
  presenting: null,
  setPresenting: (presenting) => set({ presenting }),
}));
