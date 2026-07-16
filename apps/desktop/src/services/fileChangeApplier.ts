import type { FileChange } from '@quill/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore } from '@/store/editorStore';
import { useDiffReviewStore } from '@/store/diffReviewStore';
import { getHandlerById } from '@/components/file-types/registry';
// Runtime import of the injection setter. aiStore's dependency on this file is
// type-only (erased at runtime), so there is no module cycle.
import { setFileChangeApplier } from '@/store/aiStore';

/**
 * FileChangeApplier — owned by the editor layer (PR1, Scope B + 机制 1).
 *
 * Inverts the legacy reverse-dependency where aiStore reached into editorStore
 * to decide editor-mounting policy (useCodeMirror → enterDiffReview vs
 * updateTabContent). The interface is generic over FileChange so future
 * rename/delete change types can plug in without reshaping the contract
 * (ponytail: only the two existing branches are wired in PR1).
 *
 * aiStore receives the applier via `setFileChangeApplier` (module-level
 * injection) and calls `apply(change)` from `addFileChange` in PR2. PR1 only
 * registers the slot — addFileChange still uses its inline editorStore branch
 * (zero behavior change).
 */

export interface FileChangeApplier {
  apply(change: FileChange): void;
}

/**
 * Editor-layer implementation. Routes a pending FileChange to the right
 * editor mutation based on the affected file's FileTypeHandler.useCodeMirror.
 *
 * Equivalence to the old aiStore.ts:269-284 inline branch is the contract —
 * this is what makes the PR2 swap a pure refactor.
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
      // ponytail: matches old aiStore.ts:282 — updateTabContent ONLY (not
      // setContentExternal). The PRD prose listed setContentExternal here, but
      // the old code intentionally omits it: custom-editor iframes (drawio,
      // excalidraw, mmap, …) live-reload via their content-prop effect, and a
      // version bump would remount the iframe. Zero-regression mandates
      // matching the old branch, not the PRD prose. The accept path (PR2,
      // aiFileChangeActions) is where setContentExternal is invoked.
      editorState.updateTabContent(tabId, change.newContent);
    }
  }
}

/**
 * Register the editor-layer FileChangeApplier into aiStore's injection slot.
 *
 * ponytail: PR1 provides the wiring function but does NOT call it from App
 * init (that would touch a consumer — out of scope for PR1). PR2 calls this
 * from the app init sequence and flips `addFileChange` to invoke
 * `fileChangeApplier?.apply(change)`. The wiring path is exercised by the
 * applier test now so it is green before PR2 needs it.
 */
export function registerEditorFileChangeApplier(): void {
  setFileChangeApplier(new EditorFileChangeApplier());
}
