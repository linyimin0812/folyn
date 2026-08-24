import { writeTextFile } from '@tauri-apps/plugin-fs';
import type { FileChange } from '@mochi/cli-adapter';
import type { AiSession } from './aiStore';
import { useVaultStore } from './vaultStore';
// ESM cycle: aiStore imports applyAcceptChange/applyRejectChange from here
// (runtime), and we import getFileChangeApplier back from aiStore (runtime).
// Safe because both sides export function declarations (hoisted, no TDZ) and
// neither calls the other at module-eval time — aiStore only invokes the
// apply fns inside store actions, we only call getFileChangeApplier inside
// applyAcceptChange/applyRejectChange bodies. Live bindings resolve at call
// time. Same shape as the editorStore↔editorIoService cycle.
import { getFileChangeApplier } from './aiStore';
import { resolveBasePath } from '@/utils/pathResolver';

/**
 * aiFileChangeActions — orchestration of accept/reject user actions over a
 * session's FileChange list. Pure editor mutations (tabId resolution, tab
 * lookup, editorStore/diffReviewStore calls) are delegated to the injected
 * FileChangeApplier (editor-layer owned); this module keeps session state
 * mutation + the reject disk IO, which are not editor-domain.
 */

export function applyAcceptChange(
  session: AiSession,
  path: string,
): { updatedFileChanges: FileChange[]; newContent: string | null } {
  const change = session.fileChanges.find((c) => c.path === path && c.status === 'pending');
  if (!change) return { updatedFileChanges: session.fileChanges, newContent: null };

  const updatedFileChanges = session.fileChanges.map((c) =>
    c.path === path && c.status === 'pending' ? { ...c, status: 'accepted' as const } : c,
  );

  // Editor slice: bump externalContentVersion on the open tab so EditorPane
  // resyncs the CodeMirror doc. No-op if the tab isn't open or no applier is
  // registered yet (init-order safe).
  getFileChangeApplier()?.acceptEditorChange(path, change.newContent);

  return { updatedFileChanges, newContent: change.newContent };
}

export async function applyRejectChange(
  session: AiSession,
  path: string,
): Promise<FileChange[]> {
  const change = session.fileChanges.find((c) => c.path === path && c.status === 'pending');
  if (!change) return session.fileChanges;

  const vaultRoot = useVaultStore.getState().currentVault?.basePath ?? '';
  if (vaultRoot) {
    const resolvedRoot = await resolveBasePath(vaultRoot);
    const fullPath = resolvedRoot + '/' + path;
    await writeTextFile(fullPath, change.oldContent);
  }

  const updatedFileChanges = session.fileChanges.map((c) =>
    c.path === path && c.status === 'pending' ? { ...c, status: 'rejected' as const } : c,
  );

  // Editor slice: write oldContent back to the open tab. No-op if the tab
  // isn't open or no applier is registered yet.
  getFileChangeApplier()?.revertEditorTab(path, change.oldContent);

  return updatedFileChanges;
}
