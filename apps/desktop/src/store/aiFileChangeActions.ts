import { writeTextFile } from '@tauri-apps/plugin-fs';
import type { FileChange } from '@quill/cli-adapter';
import type { AiSession } from './aiStore';
import { useVaultStore } from './vaultStore';
import { useEditorStore } from './editorStore';
import { useDiffReviewStore } from './diffReviewStore';
import { resolveBasePath } from '@/utils/pathResolver';

// ponytail: these accept/reject paths still construct the `${vaultId}:${path}`
// tabId inline (lines below). The apply-path tabId already lives in
// EditorFileChangeApplier (the audit-named reverse dependency); accept/reject
// are forward user actions, not a reverse dependency, so centralizing their
// tabId is lower value. Extending FileChangeApplier with accept/reject was
// considered and deferred: the reject path interleaves disk IO (writeTextFile)
// + session-status mutation + editor mutation, and moving only the editor
// slice would split one logical operation across two modules. Revisit if
// accept/reject grow a useCodeMirror branch (then the applier is the right
// home for the routing).

export function applyAcceptChange(
  session: AiSession,
  path: string,
): { updatedFileChanges: FileChange[]; newContent: string | null } {
  const change = session.fileChanges.find((c) => c.path === path && c.status === 'pending');
  if (!change) return { updatedFileChanges: session.fileChanges, newContent: null };

  const updatedFileChanges = session.fileChanges.map((c) =>
    c.path === path && c.status === 'pending' ? { ...c, status: 'accepted' as const } : c,
  );

  const vaultId = useVaultStore.getState().activeVaultId || '';
  const tabId = `${vaultId}:${path}`;
  const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
  if (tab) {
    // setContentExternal lives on diffReviewStore — bumps
    // externalContentVersion so EditorPane resyncs the CodeMirror doc.
    useDiffReviewStore.getState().setContentExternal(tabId, change.newContent);
  }

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

  const vaultId = useVaultStore.getState().activeVaultId || '';
  const tabId = `${vaultId}:${path}`;
  const tab = useEditorStore.getState().tabs.find((t) => t.id === tabId);
  if (tab) {
    useEditorStore.getState().updateTabContent(tabId, change.oldContent);
  }

  return updatedFileChanges;
}
