import { writeTextFile } from '@tauri-apps/plugin-fs';
import type { FileChange } from '@quill/cli-adapter';
import type { AiSession } from './aiStore';
import { useVaultStore } from './vaultStore';
import { useEditorStore } from './editorStore';
import { useDiffReviewStore } from './diffReviewStore';
import { resolveBasePath } from '@/utils/pathResolver';

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
    // ponytail: setContentExternal moved to diffReviewStore (PR2) — bumps
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
