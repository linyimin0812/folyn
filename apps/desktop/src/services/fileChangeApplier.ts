import type { FileChange } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { getHandlerById } from '@/components/file-types/registry';
// Runtime import of the injection setter. aiStore's dependency on this file is
// type-only (erased at runtime), so there is no module cycle.
import { setFileChangeApplier } from '@/store/aiStore';

/**
 * FileChangeApplier — owned by the editor layer (Scope B + 机制 1).
 *
 * Inverts the legacy reverse-dependency where aiStore reached into editorStore
 * to decide editor-mounting policy (useCodeMirror → enterDiffReview vs
 * updateTabContent). The interface is generic over FileChange so future
 * rename/delete change types can plug in without reshaping the contract
 * (ponytail: only the two existing branches are wired today).
 *
 * aiStore receives the applier via `setFileChangeApplier` (module-level
 * injection) and calls `apply(change)` from `addFileChange`. Registered at App
 * init via `registerEditorFileChangeApplier`.
 */

export interface FileChangeApplier {
  apply(change: FileChange): void;
}

/**
 * Editor-layer implementation. Routes a pending FileChange to the right
 * editor mutation based on the affected file's FileTypeHandler.useCodeMirror.
 *
 * Equivalence to the old aiStore inline branch is the contract — this is what
 * makes the swap a pure refactor.
 */
export class EditorFileChangeApplier implements FileChangeApplier {
  apply(change: FileChange): void {
    if (change.status !== 'pending') return;
    const vaultId = useVaultStore.getState().activeVaultId || '';
    const tabId = `${vaultId}:${change.path}`;
    const editorState = useEditorStore.getState();
    const tab = editorState.tabs.find((t) => t.id === tabId);
    if (!tab) return;

    const handler = getHandlerById(tab.fileType);
    if (handler?.useCodeMirror) {
      useDiffReviewStore
        .getState()
        .enterDiffReview(change.path, change.oldContent, change.newContent);
    } else {
      // ponytail: matches the old aiStore branch — updateTabContent ONLY (not
      // setContentExternal). Custom-editor iframes (drawio, excalidraw, mmap, …)
      // live-reload via their content-prop effect, and a version bump would
      // remount the iframe. Zero-regression mandates matching the old branch.
      // The accept path (aiFileChangeActions) is where setContentExternal fires.
      editorState.updateTabContent(tabId, change.newContent);
    }
  }
}

/**
 * Register the editor-layer FileChangeApplier into aiStore's injection slot.
 * Called from App init.
 */
export function registerEditorFileChangeApplier(): void {
  setFileChangeApplier(new EditorFileChangeApplier());
}
