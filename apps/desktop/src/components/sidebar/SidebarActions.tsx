import { useState, useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import { usePrefsStore } from '@/store/prefsStore';
import { FileIcon } from '@/components/icons/FileIcon';

/* -------------------------------------------------------------------------- */
/*  useSidebarActions hook                                                     */
/* -------------------------------------------------------------------------- */

interface UseSidebarActionsOptions {
  handleFileClick: (filePath: string, fileName: string) => void;
  setExpandedDirs: React.Dispatch<React.SetStateAction<Set<string>>>;
}

export function useSidebarActions({ handleFileClick, setExpandedDirs }: UseSidebarActionsOptions) {
  const vaultCreateFile = useVaultStore((state) => state.createFile);
  const vaultCreateDir = useVaultStore((state) => state.createDir);
  const vaultDeleteFile = useVaultStore((state) => state.deleteFile);
  const vaultDeleteDir = useVaultStore((state) => state.deleteDir);
  const vaultRenameFile = useVaultStore((state) => state.renameFile);
  const closeTab = useEditorStore((state) => state.closeTab);

  /* -- New-item state -- */
  const [newItemType, setNewItemType] = useState<'file' | 'dir' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemParent, setNewItemParent] = useState<string | null>(null);
  const [newItemExtension, setNewItemExtension] = useState<string | null>(null);
  const newItemInputRef = useRef<HTMLInputElement>(null);

  /* -- Rename state -- */
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  /* -- Delete-confirm state -- */
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; type: 'file' | 'dir'; name: string } | null>(null);

  /* ---- New-item callbacks ---- */

  const startNewItem = useCallback((type: 'file' | 'dir', parentDir?: string, ext?: string) => {
    setNewItemType(type);
    setNewItemName('');
    setNewItemParent(parentDir ?? null);
    setNewItemExtension(ext ?? null);
    if (parentDir) {
      setExpandedDirs((prev) => new Set([...prev, parentDir]));
    }
    setTimeout(() => newItemInputRef.current?.focus(), 50);
  }, [setExpandedDirs]);

  const confirmNewItem = useCallback(async () => {
    const trimmedName = newItemName.trim();
    if (!trimmedName || !newItemType) {
      setNewItemType(null);
      setNewItemName('');
      setNewItemParent(null);
      setNewItemExtension(null);
      return;
    }

    let finalName = trimmedName;
    if (newItemType === 'file' && !trimmedName.includes('.')) {
      finalName = newItemExtension ? `${trimmedName}.${newItemExtension}` : `${trimmedName}.md`;
    }

    const fullPath = newItemParent ? `${newItemParent}/${finalName}` : finalName;

    if (newItemType === 'dir') {
      await vaultCreateDir(fullPath);
    } else {
      const ext = finalName.includes('.') ? finalName.split('.').pop()! : '';
      const title = finalName.substring(0, finalName.lastIndexOf('.')) || finalName;
      const templates = usePrefsStore.getState().fileTemplates;
      const template = templates[ext];

      let content: string;
      if (template !== undefined) {
        const now = new Date();
        content = template
          .replace(/\{\{title\}\}/g, title)
          .replace(/\{\{filename\}\}/g, finalName)
          .replace(/\{\{date\}\}/g, `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`)
          .replace(/\{\{ext\}\}/g, ext);
      } else {
        content = '';
      }
      await vaultCreateFile(fullPath, content);
    }

    setNewItemType(null);
    setNewItemName('');
    setNewItemParent(null);
    setNewItemExtension(null);

    if (newItemType === 'file') {
      handleFileClick(fullPath, finalName);
    } else {
      setExpandedDirs((prev) => new Set([...prev, fullPath]));
    }
  }, [newItemName, newItemType, newItemParent, newItemExtension, handleFileClick, vaultCreateFile, vaultCreateDir, setExpandedDirs]);

  const cancelNewItem = useCallback(() => {
    setNewItemType(null);
    setNewItemName('');
    setNewItemParent(null);
    setNewItemExtension(null);
  }, []);

  /* ---- Rename callbacks ---- */

  const startRename = useCallback((itemPath: string, itemName: string) => {
    setRenamingItem(itemPath);
    setRenameValue(itemName);
    setTimeout(() => renameInputRef.current?.focus(), 50);
  }, []);

  const confirmRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    if (!trimmed || !renamingItem) {
      setRenamingItem(null);
      setRenameValue('');
      return;
    }
    const oldPath = renamingItem;
    const parentDir = oldPath.includes('/') ? oldPath.substring(0, oldPath.lastIndexOf('/')) : '';
    const newPath = parentDir ? `${parentDir}/${trimmed}` : trimmed;

    if (newPath !== oldPath) {
      await vaultRenameFile(oldPath, newPath);
    }
    setRenamingItem(null);
    setRenameValue('');
  }, [renameValue, renamingItem, vaultRenameFile]);

  const cancelRename = useCallback(() => {
    setRenamingItem(null);
    setRenameValue('');
  }, []);

  /* ---- Delete callbacks ---- */

  const confirmDelete = useCallback(async () => {
    if (!deleteConfirm) return;
    const { path: itemPath, type: itemType } = deleteConfirm;
    if (itemType === 'dir') {
      const openTabs = useEditorStore.getState().tabs;
      for (const tab of openTabs) {
        if (tab.path === itemPath || tab.path.startsWith(itemPath + '/')) {
          closeTab(tab.id);
        }
      }
      await vaultDeleteDir(itemPath);
    } else {
      const openTabs = useEditorStore.getState().tabs;
      const matchingTab = openTabs.find((t) => t.path === itemPath);
      if (matchingTab) {
        closeTab(matchingTab.id);
      }
      await vaultDeleteFile(itemPath);
    }
    setDeleteConfirm(null);
  }, [deleteConfirm, vaultDeleteFile, vaultDeleteDir, closeTab]);

  const deleteItem = useCallback((itemPath: string, itemType: 'file' | 'dir') => {
    const itemName = itemPath.includes('/') ? itemPath.substring(itemPath.lastIndexOf('/') + 1) : itemPath;
    setDeleteConfirm({ path: itemPath, type: itemType, name: itemName });
  }, []);

  return {
    // New item
    newItemType,
    newItemName,
    setNewItemName,
    newItemParent,
    newItemExtension,
    newItemInputRef,
    startNewItem,
    confirmNewItem,
    cancelNewItem,
    // Rename
    renamingItem,
    renameValue,
    setRenameValue,
    renameInputRef,
    startRename,
    confirmRename,
    cancelRename,
    // Delete
    deleteConfirm,
    setDeleteConfirm,
    confirmDelete,
    deleteItem,
  };
}

/* -------------------------------------------------------------------------- */
/*  DeleteConfirmDialog                                                        */
/* -------------------------------------------------------------------------- */

interface DeleteConfirmDialogProps {
  deleteConfirm: { path: string; type: 'file' | 'dir'; name: string };
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteConfirmDialog({ deleteConfirm, onCancel, onConfirm }: DeleteConfirmDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const typeLabel = deleteConfirm.type === 'dir' ? t('sidebar:sidebarActions.deleteConfirm.typeFolder') : t('sidebar:sidebarActions.deleteConfirm.typeFile');
  return (
    <div className="fixed inset-0 z-[9999] bg-black/35 flex items-center justify-center" onClick={onCancel}>
      <div className="bg-panel rounded-[10px] py-5 px-6 min-w-[300px] max-w-[400px] shadow-[0_8px_32px_rgba(0,0,0,0.18)] border border-brd" onClick={(e) => e.stopPropagation()}>
        <div className="text-[15px] font-semibold text-t1 mb-2">{t('sidebar:sidebarActions.deleteConfirm.title')}</div>
        <div className="text-[13px] text-t2 leading-relaxed mb-4">
          {t('sidebar:sidebarActions.deleteConfirm.prefix', { type: typeLabel })}<strong>{deleteConfirm.name}</strong>{t('sidebar:sidebarActions.deleteConfirm.suffix')}
          {deleteConfirm.type === 'dir' && <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--t3, #71717a)' }}>{t('sidebar:sidebarActions.deleteConfirm.folderContentsHint')}</span>}
        </div>
        <div className="flex justify-end gap-2">
          <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-brd font-ui transition-all duration-[140ms] bg-panel text-t2 hover:bg-hov" onClick={onCancel}>{t('sidebar:sidebarActions.cancel')}</button>
          <button className="py-1.5 px-4 rounded-md text-[13px] cursor-pointer border border-[#e74c3c] font-ui transition-all duration-[140ms] bg-[#e74c3c] text-white hover:bg-[#c0392b] hover:border-[#c0392b]" onClick={onConfirm}>{t('sidebar:sidebarActions.delete')}</button>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  NewItemInput                                                               */
/* -------------------------------------------------------------------------- */

interface NewItemInputProps {
  type: 'file' | 'dir';
  name: string;
  placeholder: string;
  depth: number;
  inputRef: React.RefObject<HTMLInputElement>;
  onNameChange: (name: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}

export function NewItemInput({ type, name, placeholder, depth, inputRef, onNameChange, onConfirm, onCancel }: NewItemInputProps): React.JSX.Element {
  return (
    <div className="flex items-center gap-[5px] py-1 px-3 cursor-pointer text-[calc(var(--ui-font-size)-2px)] text-t2 transition-all duration-[120ms] rounded-none select-none relative overflow-visible hover:bg-hov hover:text-t1" style={{ paddingLeft: `${12 + depth * 14}px` }}>
      <span className="shrink-0 w-4 h-4 flex items-center justify-center [&>svg]:block [&>svg]:shrink-0">
        <FileIcon filename={type === 'dir' ? '' : (name || 'untitled.md')} isDir={type === 'dir'} />
      </span>
      <input
        ref={inputRef}
        className="flex-1 py-px px-1 rounded-[3px] border border-acc bg-inp text-t1 text-[11px] outline-none font-ui"
        placeholder={placeholder}
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm();
          if (e.key === 'Escape') onCancel();
        }}
        onBlur={onConfirm}
        autoCapitalize="off"
      />
    </div>
  );
}
