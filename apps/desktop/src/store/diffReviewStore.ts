import { create } from 'zustand';
import { useEditorStore } from './editorStore';

/**
 * Inline diff-review + external-content-version state split out of the legacy
 * editorStore god-store.
 *
 * `diffReviewMode`/`diffFilePath`/`diffOldContent`/`diffNewContent` are the
 * inline diff-review banner state; `externalContentVersion` is the remount
 * counter bumped when content is set from outside the editor (AI stream,
 * fileWatcher disk-sync). The two are coupled (fileWatcher reads diff state
 * and bumps the version on non-active-tab disk changes), so they move
 * together.
 *
 * Runtime-only — NOT persisted. Consumers (fileWatcher, EditorPane,
 * aiFileChangeActions) read diff state directly from here.
 */

interface DiffReviewState {
  diffReviewMode: boolean;
  diffFilePath: string | null;
  diffOldContent: string | null;
  diffNewContent: string | null;
  externalContentVersion: number;

  enterDiffReview: (filePath: string, oldContent: string, newContent: string) => void;
  exitDiffReview: () => void;
  /** Set tab content from an external source — bumps externalContentVersion
   * so editors watching the version remount/re-sync. */
  setContentExternal: (tabId: string, content: string) => void;
}

export const useDiffReviewStore = create<DiffReviewState>((set) => ({
  diffReviewMode: false,
  diffFilePath: null,
  diffOldContent: null,
  diffNewContent: null,
  externalContentVersion: 0,

  enterDiffReview: (filePath, oldContent, newContent) => {
    set({
      diffReviewMode: true,
      diffFilePath: filePath,
      diffOldContent: oldContent,
      diffNewContent: newContent,
    });
  },

  exitDiffReview: () => {
    set({
      diffReviewMode: false,
      diffFilePath: null,
      diffOldContent: null,
      diffNewContent: null,
    });
  },

  // ponytail: old editorStore.setContentExternal mutated `tabs` (editorStore's
  // concern) AND bumped externalContentVersion in one atomic set. The version
  // bump now lives here; the tab mutation delegates to editorStore.updateTabContent
  // (which does the same tabs-map + isDirty + scheduleAutoSave the old
  // setContentExternal did). Two sets instead of one — a brief intermediate
  // state, but no observer reads both atomically. Equivalent end state.
  setContentExternal: (tabId, content) => {
    set((state) => ({ externalContentVersion: state.externalContentVersion + 1 }));
    // Delegate tab mutation to editorStore.updateTabContent — it does the same
    // tabs-map + isDirty + scheduleAutoSave the old setContentExternal did.
    useEditorStore.getState().updateTabContent(tabId, content);
  },
}));
