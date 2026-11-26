/**
 * importFlowStore — the shared external→vault import flow.
 *
 * Owns the whole sequence: folder picker (in-app MoveDialog, vault-relative
 * target) → per-source conflict resolution (PasteConflictDialog) → the actual
 * import (vaultStore.copyExternalFileToVault / copyExternalDirToVault) →
 * result toast. Both entry points converge here:
 *   • OS paste (Finder Cmd+C → Folyn Cmd+V) — useOsFilePasteImport's paste
 *     listener calls `startImport(clipboardPaths)`.
 *   • The Files panel「导入…」menu action / palette command — calls
 *     `startImportFromDialog()` (native mixed picker, then this flow).
 *   • External-folder right-click「导入到仓库」— calls `startImport([path])`.
 *
 * Extracted from useOsFilePasteImport so non-App components can trigger it;
 * App renders the dialogs (MoveDialog + PasteConflictDialog) from this
 * store's state. Dialog resolvers live at module level (mutable closure
 * refs, like the hook's useRef pattern — they are not reactive state).
 *
 * i18n: toasts resolve via the i18n singleton directly (`i18n.t`) because a
 * zustand store has no hook context — same pattern as useDragDrop / kbUi.
 */

import { create } from 'zustand';
import i18n from '@/i18n';
import type { ConflictChoice, ConflictResolution } from '@/components/editor/PasteConflictDialog';
import { useToastStore } from '@/store/toastStore';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@folyn/vault-provider';
import { isTauri } from '@/utils/platform';

interface ImportFlowState {
  pickerVisible: boolean;
  pickerFileTree: VaultEntry[];
  conflictFile: string | null;
  conflictRemaining: number;
  /** Whole flow: pick target dir → import each src (file or dir tree). */
  startImport: (srcPaths: string[]) => Promise<void>;
  /** Native mixed picker (files + folders), then startImport. macOS uses the
   *  custom Rust panel; elsewhere (command unsupported) it falls back to the
   *  plugin's files-only dialog — same fallback shape as openExternalFile. */
  startImportFromDialog: () => Promise<void>;
  onPickerConfirm: (dir: string) => Promise<void>;
  onPickerCancel: () => void;
  onConflictResolve: (res: ConflictResolution) => void;
}

let pickerResolver: ((dir: string | null) => void) | null = null;
let conflictResolver: ((res: ConflictResolution) => void) | null = null;

/** stat() a source path to route file vs dir. Returns null on failure. */
async function statKind(path: string): Promise<'file' | 'dir' | null> {
  try {
    const { stat } = await import('@tauri-apps/plugin-fs');
    const st = await stat(path);
    if (st.isDirectory) return 'dir';
    if (st.isFile) return 'file';
    return null;
  } catch {
    return null;
  }
}

/** Native mixed pick (files + folders, multiple). `null` = user cancelled. */
async function pickExternalPaths(): Promise<string[] | null> {
  if (!isTauri()) return null;
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    return await invoke<string[] | null>('pick_external_paths');
  } catch {
    // Non-macOS: the Rust command is macOS-only — fall back to the
    // plugin's files-only open dialog (dirs import via drag/paste there).
    const { open } = await import('@tauri-apps/plugin-dialog');
    const picked = await open({ multiple: true });
    if (!picked) return null;
    return Array.isArray(picked) ? picked : [picked];
  }
}

export const useImportFlowStore = create<ImportFlowState>((set, get) => ({
  pickerVisible: false,
  pickerFileTree: [],
  conflictFile: null,
  conflictRemaining: 0,

  startImport: async (srcPaths) => {
    if (srcPaths.length === 0) return;
    if (!useVaultStore.getState().currentVault?.basePath) {
      useToastStore.getState().push(i18n.t('editor:filePaste.openVaultFirst'));
      return;
    }
    // Folder picker = in-app MoveDialog over the vault tree ('' = root),
    // same UI as right-click "Move to…" — NOT the native OS picker.
    set({ pickerFileTree: useVaultStore.getState().fileTree, pickerVisible: true });
    const relDir = await new Promise<string | null>((resolve) => {
      pickerResolver = resolve;
    });
    pickerResolver = null;
    if (relDir === null) return; // user cancelled the folder picker

    const vault = useVaultStore.getState();
    let imported = 0;
    let skipped = 0;
    let batchChoice: ConflictChoice | null = null;
    let applyToAll = false;
    for (let i = 0; i < srcPaths.length; i++) {
      const src = srcPaths[i];
      // ponytail: split on both separators — arboard/Windows return
      // backslash paths (`C:\Users\…`); `/`-only split left the whole drive
      // path as baseName → invalid vault filename.
      const baseName = src.split(/[\\/]/).pop()!;
      const remaining = srcPaths.length - i - 1;
      let choice: ConflictChoice | 'write' | 'dir';
      const kind = await statKind(src);
      if (kind === 'dir') {
        // Directory import: no per-file conflict UI — the top-level name
        // auto-suffixes (副本) on collision inside copyExternalDirToVault.
        choice = 'dir';
      } else {
        const exists = await vault.externalFileExistsAt(relDir, baseName);
        if (!exists) {
          choice = 'write';
        } else if (applyToAll && batchChoice) {
          choice = batchChoice;
        } else {
          set({ conflictFile: baseName, conflictRemaining: remaining });
          const res = await new Promise<ConflictResolution>((resolve) => {
            conflictResolver = resolve;
          });
          conflictResolver = null;
          set({ conflictFile: null, conflictRemaining: 0 });
          applyToAll = res.applyToAll;
          if (applyToAll) batchChoice = res.choice;
          choice = res.choice;
        }
      }
      try {
        if (choice === 'skip') {
          skipped++;
          continue;
        }
        if (choice === 'overwrite') {
          await vault.overwriteExternalFileToVault(src, relDir);
        } else if (choice === 'dir') {
          await vault.copyExternalDirToVault(src, relDir);
        } else {
          // 'write' (no conflict) or 'rename' — copyExternalFileToVault uses
          // the original name when free, ` 副本` suffix on collision, so it
          // covers both cases (the choice is already resolved upstream).
          await vault.copyExternalFileToVault(src, relDir);
        }
        imported++;
      } catch (err) {
        console.error('[import] import failed', src, err);
      }
    }
    if (imported > 0) {
      useToastStore.getState().push(
        i18n.t('editor:filePaste.imported', {
          count: imported,
          where: relDir || i18n.t('editor:filePaste.vaultRoot'),
        }),
      );
    } else if (skipped > 0) {
      useToastStore.getState().push(i18n.t('editor:filePaste.allSkipped', { count: skipped }));
    }
  },

  startImportFromDialog: async () => {
    const paths = await pickExternalPaths();
    if (!paths || paths.length === 0) return;
    await get().startImport(paths);
  },

  onPickerConfirm: async (dir: string) => {
    set({ pickerVisible: false });
    const r = pickerResolver;
    pickerResolver = null;
    r?.(dir);
  },

  onPickerCancel: () => {
    set({ pickerVisible: false });
    const r = pickerResolver;
    pickerResolver = null;
    r?.(null);
  },

  onConflictResolve: (res: ConflictResolution) => {
    set({ conflictFile: null, conflictRemaining: 0 });
    const r = conflictResolver;
    conflictResolver = null;
    r?.(res);
  },
}));
