import type { FileChange } from '@folyn/cli-adapter';
import { useVaultStore } from '@/store/vaultStore';
import { useEditorStore, type FileTab } from '@/store/editorStore';
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
 * injection) and calls `apply(change)` from `addFileChange`,
 * `acceptEditorChange` from accept, and `revertEditorTab` from reject.
 * Registered at App init via `registerEditorFileChangeApplier`.
 *
 * TabId format (`${vaultId}:${path}`) and tab lookup live here once, shared by
 * apply/accept/revert — aiFileChangeActions no longer imports
 * editorStore/diffReviewStore or constructs the tabId.
 */

export interface FileChangeApplier {
  apply(change: FileChange): void;
  /** Accept-path editor slice: bump externalContentVersion so EditorPane
   *  resyncs the CodeMirror doc. Called by aiFileChangeActions.applyAcceptChange. */
  acceptEditorChange(path: string, newContent: string): void;
  /** Reject-path editor slice: write oldContent back to the open tab. Called by
   *  aiFileChangeActions.applyRejectChange. */
  revertEditorTab(path: string, oldContent: string): void;
}

/**
 * Editor-layer implementation. Routes a pending FileChange to the right
 * editor mutation based on the affected file's FileTypeHandler.useCodeMirror.
 *
 * Equivalence to the old aiStore/aiFileChangeActions inline branches is the
 * contract — this is what makes the swap a pure refactor.
 */
export class EditorFileChangeApplier implements FileChangeApplier {
  /**
   * Resolve the open tab for `path` using the editor-owned tabId format.
   * Returns null when no tab is open — callers treat that as a no-op.
   */
  private resolveTab(path: string): { tab: FileTab; tabId: string } | null {
    const vaultId = useVaultStore.getState().activeVaultId || '';
    const tabId = `${vaultId}:${path}`;
    const editorState = useEditorStore.getState();
    const tab = editorState.tabs.find((t) => t.id === tabId);
    if (!tab) return null;
    return { tab, tabId };
  }

  apply(change: FileChange): void {
    if (change.status !== 'pending') return;
    const resolved = this.resolveTab(change.path);
    if (!resolved) return;
    const { tab, tabId } = resolved;

    const handler = getHandlerById(tab.fileType);
    if (handler?.useCodeMirror) {
      useDiffReviewStore
        .getState()
        .enterDiffReview(change.path, change.oldContent, change.newContent);
    } else {
      // setContentExternal bumps externalContentVersion + updateTabContent.
      // Version bump forces WorkArea to remount the editor via
      // `key={tabId-externalContentVersion}`, required for custom editors
      // whose content prop is mount-only (excalidraw's `initialData` has no
      // internal reload effect, unlike DrawIoEmbed's `xml`). Editors with
      // their own reload mechanism (drawio, markmap) still work — the remount
      // is redundant but harmless; useState(content) init handles the new
      // content on remount.
      useDiffReviewStore.getState().setContentExternal(tabId, change.newContent);
    }
  }

  acceptEditorChange(path: string, newContent: string): void {
    const resolved = this.resolveTab(path);
    if (!resolved) return;
    // setContentExternal bumps externalContentVersion so EditorPane resyncs the
    // CodeMirror doc — direct write, no useCodeMirror branch (accept applies to
    // the already-open diff review, not a fresh mount).
    useDiffReviewStore.getState().setContentExternal(resolved.tabId, newContent);
  }

  revertEditorTab(path: string, oldContent: string): void {
    const resolved = this.resolveTab(path);
    if (!resolved) return;
    useEditorStore.getState().updateTabContent(resolved.tabId, oldContent);
  }
}

/**
 * Register the editor-layer FileChangeApplier into aiStore's injection slot.
 * Called from App init.
 */
export function registerEditorFileChangeApplier(): void {
  setFileChangeApplier(new EditorFileChangeApplier());
}
