// useOsFilePasteImport — OS file paste (Finder Cmd+C → Folyn Cmd+V): clipboard
// file refs, folder picker (MoveDialog) and conflict resolution state.
// Extracted from App.tsx (split-oversized-p1-files).
//
// Returns the picker + conflict-dialog state and handlers the App shell
// renders (MoveDialog + PasteConflictDialog); all paste/import logic lives
// here.
//
// Spec: hook-guidelines.md (effect cleanup).

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConflictChoice, ConflictResolution } from '@/components/editor/PasteConflictDialog';
import { readClipboardFiles } from '@/services/clipboardFiles';
import { useToastStore } from '@/store/toastStore';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@folyn/vault-provider';
import { isTauri } from '@/utils/platform';

export function useOsFilePasteImport() {
  const { t } = useTranslation();

  // ── OS file paste (Finder Cmd+C → Folyn Cmd+V) ──
  // When the user copies a file in Finder/Explorer and pastes in Folyn, open a
  // folder picker restricted to the current vault, then import each clipboard
  // file into the picked folder via `copyExternalFileToVault` (binary-safe —
  // reuses the path proven by the drag-drop flow).
  //
  // File refs on the clipboard can't be read synchronously via
  // `navigator.clipboard` (WKWebView/WebView2 only expose text/plain +
  // image/png), so the Rust `read_clipboard_files` command (arboard) does the
  // read. To avoid racing that async read against the paste event's narrow
  // synchronous preventDefault window, we refresh a cached file list on
  // window focus — the user must focus Folyn before pasting, which updates
  // the cache just-in-time.
  //
  // ponytail: "File wins" — when the cache is non-empty we preventDefault +
  // stopPropagation in capture so CodeMirror/ProseMirror bubble-phase paste
  // handlers never fire (they'd insert the filename as text). When the cache
  // is empty we no-op and the default text paste runs unchanged.
  // Split-screen edge case: copy a file in Finder while Folyn stays focused
  // (no focus event fires) → cache is stale → text paste runs instead of the
  // picker. Acceptable for MVP; a polling fallback can cover it if it bites.
  // Folder picker = in-app MoveDialog (same UI as right-click "Move to…"),
  // NOT the native OS folder picker. Reuses MoveDialog with mode 'copy' +
  // empty sources (the clipboard files are external, not vault entries, so
  // there's no move-into-self to guard). MoveDialog returns a vault-relative
  // dir path ('' = root), so no absolute-path normalization or vault-boundary
  // validation is needed here.
  const [pickerFileTree, setPickerFileTree] = useState<VaultEntry[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const pickerResolverRef = useRef<((dir: string | null) => void) | null>(null);
  const showFolderPicker = useCallback(() => {
    setPickerFileTree(useVaultStore.getState().fileTree);
    setPickerVisible(true);
    return new Promise<string | null>((resolve) => {
      pickerResolverRef.current = resolve;
    });
  }, []);
  const onPickerConfirm = useCallback(async (dir: string) => {
    setPickerVisible(false);
    const r = pickerResolverRef.current;
    pickerResolverRef.current = null;
    r?.(dir);
  }, []);
  const onPickerCancel = useCallback(() => {
    setPickerVisible(false);
    const r = pickerResolverRef.current;
    pickerResolverRef.current = null;
    r?.(null);
  }, []);

  const [conflictFile, setConflictFile] = useState<string | null>(null);
  const [conflictRemaining, setConflictRemaining] = useState(0);
  const conflictResolverRef = useRef<((res: ConflictResolution) => void) | null>(null);
  const showConflictModal = useCallback(
    (fileName: string, remaining: number) =>
      new Promise<ConflictResolution>((resolve) => {
        conflictResolverRef.current = resolve;
        setConflictFile(fileName);
        setConflictRemaining(remaining);
      }),
    [],
  );
  const onConflictResolve = useCallback((res: ConflictResolution) => {
    setConflictFile(null);
    const r = conflictResolverRef.current;
    conflictResolverRef.current = null;
    r?.(res);
  }, []);

  const runFilePasteImport = useCallback(async (srcPaths: string[]) => {
    if (!useVaultStore.getState().currentVault?.basePath) {
      useToastStore.getState().push(t('editor:filePaste.openVaultFirst'));
      return;
    }
    const relDir = await showFolderPicker();
    if (relDir === null) return; // user cancelled the folder picker
    const vault = useVaultStore.getState();
    let imported = 0;
    let skipped = 0;
    let batchChoice: ConflictChoice | null = null;
    let applyToAll = false;
    for (let i = 0; i < srcPaths.length; i++) {
      const src = srcPaths[i];
      // ponytail: split on both separators — arboard returns backslash paths
      // on Windows (`C:\Users\…`), the old `/`-only split made baseName the
      // whole path → invalid vault filename → silent writeFileBytes failure.
      const baseName = src.split(/[\\/]/).pop()!;
      const remaining = srcPaths.length - i - 1;
      let choice: ConflictChoice | 'write';
      const exists = await vault.externalFileExistsAt(relDir, baseName);
      if (!exists) {
        choice = 'write';
      } else if (applyToAll && batchChoice) {
        choice = batchChoice;
      } else {
        const res = await showConflictModal(baseName, remaining);
        applyToAll = res.applyToAll;
        if (applyToAll) batchChoice = res.choice;
        choice = res.choice;
      }
      try {
        if (choice === 'skip') {
          skipped++;
          continue;
        }
        if (choice === 'overwrite') {
          await vault.overwriteExternalFileToVault(src, relDir);
        } else {
          // 'write' (no conflict) or 'rename' — copyExternalFileToVault
          // uses the original name when free, ` 副本` suffix on collision,
          // so it covers both cases (the caller has already resolved the
          // choice; for 'rename' we rely on the auto-suffix).
          await vault.copyExternalFileToVault(src, relDir);
        }
        imported++;
      } catch (err) {
        console.error('[paste] import failed', src, err);
      }
    }
    if (imported > 0) {
      useToastStore.getState().push(
        t('editor:filePaste.imported', { count: imported, where: relDir || t('editor:filePaste.vaultRoot') }),
      );
    } else if (skipped > 0) {
      useToastStore.getState().push(t('editor:filePaste.allSkipped', { count: skipped }));
    }
  }, [t, showFolderPicker, showConflictModal]);

  const clipboardFilesCache = useRef<string[]>([]);
  useEffect(() => {
    if (!isTauri()) return;
    const refresh = () => {
      void readClipboardFiles().then((p) => {
        clipboardFilesCache.current = p;
      });
    };
    refresh();
    window.addEventListener('focus', refresh);
    const onPaste = (e: ClipboardEvent) => {
      const paths = clipboardFilesCache.current;
      if (paths.length === 0) return; // no file ref → default text paste
      e.preventDefault();
      e.stopImmediatePropagation();
      void runFilePasteImport(paths).finally(() => {
        // ponytail: refresh async after this paste so a 2nd paste-without-
        // refocus (different file copied in place) sees the new clipboard.
        setTimeout(refresh, 0);
      });
    };
    window.addEventListener('paste', onPaste, true);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('paste', onPaste, true);
    };
  }, []);

  return {
    pickerVisible,
    pickerFileTree,
    onPickerConfirm,
    onPickerCancel,
    conflictFile,
    conflictRemaining,
    onConflictResolve,
  };
}
