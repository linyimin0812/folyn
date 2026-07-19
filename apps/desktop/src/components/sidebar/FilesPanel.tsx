/**
 * Files panel — the built-in "files" sidebar panel (vault selector + search +
 * new-item actions + file tree + context menu). Extracted from the old
 * monolithic Sidebar so the sidebar shell can data-drive panel rendering via
 * {@link useFeaturePanelStore}: the files panel is now registered as a
 * `PanelEntry.component` like every other built-in/plugin panel.
 *
 * Behavior is identical to the pre-PR2 inline files block in Sidebar.tsx —
 * all files-specific state (search, expanded dirs, drag-drop, context menu,
 * new-item flow) lives here. Shell-level state (width, collapse, resize) stays
 * in Sidebar and reaches this component via {@link SidebarContext}.
 */

import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavStore } from '@/store/navStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorStore } from '@/store/editorStore';
import * as editorIoService from '@/services/editorIoService';
import { useVaultStore } from '@/store/vaultStore';
import type { VaultEntry } from '@quill/vault-provider';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { setNewItemStarter } from '@/services/newItemBridge';
import { flattenTree } from '@/utils/treeUtils';
import { useDragDrop } from './useDragDrop';
import { FileTreeItem } from './FileTreeItem';
import { useSidebarActions, DeleteConfirmDialog, NewItemInput } from './SidebarActions';
import { ContextMenu } from './ContextMenu';
import type { ContextMenuData } from './ContextMenu';
import { useSidebarContext } from './SidebarContext';

export function FilesPanel(): React.JSX.Element {
  const { t } = useTranslation();
  const { width, onFileSelect } = useSidebarContext();
  const vaultName = useAppearanceStore((state) => state.vaultName);
  const setCurrentPage = useNavStore((state) => state.setCurrentPage);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const openFile = editorIoService.openFile;
  const tabs = useEditorStore((state) => state.tabs);

  const fileTree = useVaultStore((state) => state.fileTree);
  const vaultError = useVaultStore((state) => state.error);
  const pinnedPaths = useVaultStore((state) => state.pinnedPaths);
  const togglePin = useVaultStore((state) => state.togglePin);

  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const isCompact = width < 260;
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const hasAutoExpanded = useRef(false);

  // Close actions menu when clicking outside
  useEffect(() => {
    if (!actionsMenuOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(event.target as Node)) {
        setActionsMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [actionsMenuOpen]);

  // Auto-expand first 2 levels when fileTree is loaded
  useEffect(() => {
    if (hasAutoExpanded.current || fileTree.length === 0) return;
    hasAutoExpanded.current = true;
    const dirs = new Set<string>();
    const collect = (entries: VaultEntry[], depth: number) => {
      if (depth >= 2) return;
      for (const entry of entries) {
        if (entry.type === 'dir') {
          dirs.add(entry.path);
          if (entry.children) collect(entry.children, depth + 1);
        }
      }
    };
    collect(fileTree, 0);
    if (dirs.size > 0) setExpandedDirs(dirs);
  }, [fileTree]);

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedPath = useRef<string | null>(null);
  const flatPaths = useMemo(() => flattenTree(fileTree), [fileTree]);

  const vaultMoveFiles = useVaultStore((state) => state.moveFiles);

  const fileTreeRef = useRef<HTMLDivElement>(null);

  const { dragOverDir, handleItemMouseDown } = useDragDrop({
    selectedPaths,
    moveFiles: vaultMoveFiles,
    onSelectionClear: useCallback(() => setSelectedPaths(new Set()), []),
  });

  const handleFileClick = useCallback(
    (filePath: string, fileName: string) => {
      openFile(filePath, fileName);
      onFileSelect?.();
    },
    [openFile, onFileSelect],
  );

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (prev.has(dirPath)) {
        next.delete(dirPath);
      } else {
        next.add(dirPath);
      }
      return next;
    });
  }, []);

  const {
    newItemType, newItemName, setNewItemName, newItemParent, newItemExtension,
    newItemInputRef,
    startNewItem, confirmNewItem, cancelNewItem,
    renamingItem, renameValue, setRenameValue, renameInputRef,
    startRename, confirmRename, cancelRename,
    deleteConfirm, setDeleteConfirm, confirmDelete, deleteItem,
  } = useSidebarActions({ handleFileClick, setExpandedDirs });

  // Bridge the command palette's new-file/new-folder actions to the Sidebar's
  // inline new-item flow. Registered on mount; cleared on unmount. A request
  // that arrived while unmounted (e.g. palette switched from settings page) is
  // fulfilled on mount by the bridge.
  useEffect(() => {
    setNewItemStarter(startNewItem);
    return () => setNewItemStarter(null);
  }, [startNewItem]);

  const handleItemSelect = useCallback(
    (e: React.MouseEvent, path: string, entry: VaultEntry) => {
      const isMetaKey = e.metaKey || e.ctrlKey;
      const isShiftKey = e.shiftKey;

      if (isMetaKey) {
        setSelectedPaths((prev) => {
          const next = new Set(prev);
          if (next.has(path)) next.delete(path);
          else next.add(path);
          return next;
        });
        lastClickedPath.current = path;
        return;
      }

      if (isShiftKey && lastClickedPath.current) {
        const startIdx = flatPaths.indexOf(lastClickedPath.current);
        const endIdx = flatPaths.indexOf(path);
        if (startIdx !== -1 && endIdx !== -1) {
          const from = Math.min(startIdx, endIdx);
          const to = Math.max(startIdx, endIdx);
          setSelectedPaths(new Set(flatPaths.slice(from, to + 1)));
        }
        return;
      }

      setSelectedPaths(new Set());
      lastClickedPath.current = path;
      if (entry.type === 'file') {
        handleFileClick(entry.path, entry.name);
      } else {
        handleToggleDir(entry.path);
      }
    },
    [flatPaths, handleFileClick, handleToggleDir],
  );

  /** Expand all parent directories of the active file and scroll it into view */
  const locateActiveFile = useCallback(async () => {
    const activeTab = tabs.find((t) => t.id === activeTabId);
    if (!activeTab) return;

    const filePath = activeTab.path;
    // Expand all parent directories
    const parts = filePath.split('/');
    const dirsToExpand: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      dirsToExpand.push(parts.slice(0, i).join('/'));
    }

    // Expand all parent directories
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const dir of dirsToExpand) next.add(dir);
      return next;
    });

    // Scroll to the file element after DOM update
    requestAnimationFrame(() => {
      const container = fileTreeRef.current;
      if (!container) return;
      const fileElement = container.querySelector(`[data-filepath="${CSS.escape(filePath)}"]`);
      if (fileElement) {
        fileElement.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      }
    });
  }, [activeTabId, tabs]);

  const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, name: string, type: 'file' | 'dir') => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path, name, type });
  }, []);

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  /** Collect all directory paths from the file tree */
  const collectAllDirPaths = useCallback((entries: VaultEntry[]): string[] => {
    const paths: string[] = [];
    const walk = (items: VaultEntry[]) => {
      for (const item of items) {
        if (item.type === 'dir') {
          paths.push(item.path);
          if (item.children) walk(item.children);
        }
      }
    };
    walk(entries);
    return paths;
  }, []);

  const expandAllDirs = useCallback(() => {
    const allPaths = collectAllDirPaths(fileTree);
    setExpandedDirs(new Set(allPaths));
  }, [fileTree, collectAllDirPaths]);

  const collapseAllDirs = useCallback(() => {
    setExpandedDirs(new Set());
  }, []);

  /** Check if an entry (or any descendant) matches the search query */
  const matchesSearch = (entry: VaultEntry, query: string): boolean => {
    if (entry.name.toLowerCase().includes(query)) return true;
    if (entry.type === 'dir' && entry.children) {
      return entry.children.some((child) => matchesSearch(child, query));
    }
    return false;
  };

  const renderFileTree = (items: VaultEntry[], depth = 0) => {
    const lowerQuery = searchQuery.toLowerCase();
    const filtered = items.filter((item) => !searchQuery || matchesSearch(item, lowerQuery));
    const sorted = [...filtered].sort((a, b) => {
      const aPinned = pinnedPaths.includes(a.path);
      const bPinned = pinnedPaths.includes(b.path);
      if (aPinned && !bPinned) return -1;
      if (!aPinned && bPinned) return 1;
      return 0;
    });
    return sorted
      .map((item) => {
        const isPinned = pinnedPaths.includes(item.path);
        const isRenaming = renamingItem === item.path;

        if (item.type === 'dir') {
          const isExpanded = searchQuery ? true : expandedDirs.has(item.path);
          const children = item.children || [];
          const isDirSelected = selectedPaths.has(item.path);
          const isDragOver = dragOverDir === item.path;
          return (
            <div key={item.path}>
              <FileTreeItem
                item={item}
                depth={depth}
                isActive={false}
                isSelected={isDirSelected}
                isPinned={isPinned}
                isExpanded={isExpanded}
                isDragOver={isDragOver}
                isRenaming={isRenaming}
                renameValue={renameValue}
                renameInputRef={renameInputRef}
                onSelect={(e) => handleItemSelect(e, item.path, item)}
                onMouseDown={(e) => handleItemMouseDown(e, item.path)}
                onContextMenu={(e) => handleContextMenu(e, item.path, item.name, 'dir')}
                onRenameChange={setRenameValue}
                onRenameConfirm={confirmRename}
                onRenameCancel={cancelRename}
              />
              {isExpanded && newItemType && newItemParent === item.path && (
                <NewItemInput
                  type={newItemType}
                  name={newItemName}
                  placeholder={newItemType === 'dir' ? t('sidebar:filesPanel.newItem.folderName') : newItemExtension ? t('sidebar:filesPanel.newItem.fileNameDefault', { ext: newItemExtension }) : t('sidebar:filesPanel.newItem.fileNameWithExt')}
                  depth={depth + 1}
                  inputRef={newItemInputRef}
                  onNameChange={setNewItemName}
                  onConfirm={confirmNewItem}
                  onCancel={cancelNewItem}
                />
              )}
              {isExpanded && renderFileTree(children, depth + 1)}
            </div>
          );
        }

        const isActive = tabs.find((t) => t.path === item.path)?.id === activeTabId;
        const isFileSelected = selectedPaths.has(item.path);
        return (
          <FileTreeItem
            key={item.path}
            item={item}
            depth={depth}
            isActive={isActive}
            isSelected={isFileSelected}
            isPinned={isPinned}
            isRenaming={isRenaming}
            renameValue={renameValue}
            renameInputRef={renameInputRef}
            onSelect={(e) => handleItemSelect(e, item.path, item)}
            onMouseDown={(e) => handleItemMouseDown(e, item.path)}
            onContextMenu={(e) => handleContextMenu(e, item.path, item.name, 'file')}
            onRenameChange={setRenameValue}
            onRenameConfirm={confirmRename}
            onRenameCancel={cancelRename}
          />
        );
      });
  };

  return (
    <>
      {/* Vault selector + actions + search */}
      <div className="pt-3 px-2.5 pb-2 shrink-0">
        <div className="flex items-center gap-1 min-w-0">
          <div className="inline-flex items-center gap-1 px-2 py-1.5 rounded-[5px] cursor-pointer transition-colors duration-[140ms] text-[calc(var(--ui-font-size)-2px)] font-semibold min-w-[60px] max-w-full overflow-hidden shrink hover:bg-hov" onClick={() => setCurrentPage('vault')}>
            <span className="overflow-hidden text-ellipsis whitespace-nowrap">{vaultName}</span>
            <span className="text-t3 text-[10px] shrink-0">&#9662;</span>
          </div>

          {/* Actions: new file / new folder / locate / refresh / expand / collapse */}
          {isCompact ? (
            <div className="flex items-center gap-0.5 ml-auto shrink-0 relative" ref={actionsMenuRef}>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={locateActiveFile} data-tip={t('sidebar:filesPanel.actions.locateActive')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="1.5" x2="8" y2="6.5"/><line x1="8" y1="9.5" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="6.5" y2="8"/><line x1="9.5" y1="8" x2="14.5" y2="8"/></svg>
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={() => useVaultStore.getState().refreshFileTree()} data-tip={t('sidebar:filesPanel.actions.refresh')}>
                <ThemeIcon name="updateFolders" size={14} />
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={() => setActionsMenuOpen((v) => !v)} data-tip={t('sidebar:filesPanel.actions.more')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
              </button>
              {actionsMenuOpen && (
                <div className="absolute top-full right-0 z-[100] min-w-[150px] p-1 bg-panel border border-brd rounded-md shadow-[0_4px_12px_rgba(0,0,0,.15)]">
                  <button className="flex items-center gap-2 w-full py-1.5 px-2.5 border-none rounded bg-transparent text-t1 text-xs cursor-pointer transition-colors duration-[120ms] whitespace-nowrap font-ui hover:bg-hov [&>svg]:shrink-0 [&>svg]:text-t2" onClick={() => { startNewItem('file'); setActionsMenuOpen(false); }}>
                    <ThemeIcon name="addFile" size={14} />
                    <span>{t('sidebar:contextMenu.newFile')}</span>
                  </button>
                  <button className="flex items-center gap-2 w-full py-1.5 px-2.5 border-none rounded bg-transparent text-t1 text-xs cursor-pointer transition-colors duration-[120ms] whitespace-nowrap font-ui hover:bg-hov [&>svg]:shrink-0 [&>svg]:text-t2" onClick={() => { startNewItem('dir'); setActionsMenuOpen(false); }}>
                    <ThemeIcon name="newFolder" size={14} />
                    <span>{t('sidebar:contextMenu.newFolder')}</span>
                  </button>
                  <button className="flex items-center gap-2 w-full py-1.5 px-2.5 border-none rounded bg-transparent text-t1 text-xs cursor-pointer transition-colors duration-[120ms] whitespace-nowrap font-ui hover:bg-hov [&>svg]:shrink-0 [&>svg]:text-t2" onClick={() => { expandAllDirs(); setActionsMenuOpen(false); }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><polyline points="4,5 8,9 12,5" /><polyline points="4,9 8,13 12,9" /></svg>
                    <span>{t('sidebar:filesPanel.actions.expandAll')}</span>
                  </button>
                  <button className="flex items-center gap-2 w-full py-1.5 px-2.5 border-none rounded bg-transparent text-t1 text-xs cursor-pointer transition-colors duration-[120ms] whitespace-nowrap font-ui hover:bg-hov [&>svg]:shrink-0 [&>svg]:text-t2" onClick={() => { collapseAllDirs(); setActionsMenuOpen(false); }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><polyline points="4,9 8,5 12,9" /><polyline points="4,13 8,9 12,13" /></svg>
                    <span>{t('sidebar:filesPanel.actions.collapseAll')}</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="flex items-center gap-0.5 ml-auto shrink-0 relative">
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={() => startNewItem('file')} data-tip={t('sidebar:contextMenu.newFile')}>
                <ThemeIcon name="addFile" size={14} />
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={() => startNewItem('dir')} data-tip={t('sidebar:contextMenu.newFolder')}>
                <ThemeIcon name="newFolder" size={14} />
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={locateActiveFile} data-tip={t('sidebar:filesPanel.actions.locateActive')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="1.5" x2="8" y2="6.5"/><line x1="8" y1="9.5" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="6.5" y2="8"/><line x1="9.5" y1="8" x2="14.5" y2="8"/></svg>
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={() => useVaultStore.getState().refreshFileTree()} data-tip={t('sidebar:filesPanel.actions.refresh')}>
                <ThemeIcon name="updateFolders" size={14} />
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={expandAllDirs} data-tip={t('sidebar:filesPanel.actions.expandAllFolders')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <polyline points="4,5 8,9 12,5" />
                  <polyline points="4,9 8,13 12,9" />
                </svg>
              </button>
              <button className="flex items-center justify-center w-7 h-6 rounded text-[11px] cursor-pointer transition-colors duration-[120ms] bg-transparent text-t2 border-none hover:bg-hov hover:text-t1" onClick={collapseAllDirs} data-tip={t('sidebar:filesPanel.actions.collapseAllFolders')}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <polyline points="4,9 8,5 12,9" />
                  <polyline points="4,13 8,9 12,13" />
                </svg>
              </button>
            </div>
          )}
        </div>

        {/* Search */}
        <div className="mt-2">
          <input
            className="w-full py-[5px] px-2 rounded-[5px] border border-brd bg-inp text-t1 text-[calc(var(--ui-font-size)-3px)] outline-none transition-[border-color] duration-[140ms] font-ui focus:border-acc placeholder:text-t3"
            placeholder={t('sidebar:filesPanel.search.placeholder')}
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            autoCapitalize="off"
          />
        </div>
      </div>

      {/* New item inline input (root level only) */}
      {newItemType && !newItemParent && (
        <NewItemInput
          type={newItemType}
          name={newItemName}
          placeholder={newItemType === 'dir' ? t('sidebar:filesPanel.newItem.folderName') : t('sidebar:filesPanel.newItem.fileNameMd')}
          depth={0}
          inputRef={newItemInputRef}
          onNameChange={setNewItemName}
          onConfirm={confirmNewItem}
          onCancel={cancelNewItem}
        />
      )}

      {/* File tree */}
      <div
        className={`sb-body flex-1 overflow-y-auto py-1 transition-colors duration-[120ms] [scrollbar-width:none] hover:[scrollbar-width:thin] [&::-webkit-scrollbar]:w-0 [&:hover::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-thumb]:bg-t4 [&::-webkit-scrollbar-thumb]:rounded-[3px] [&::-webkit-scrollbar-track]:bg-transparent${dragOverDir === '' ? ' bg-accglow' : ''}`}
        ref={fileTreeRef}
      >
        {renderFileTree(fileTree)}
        {fileTree.length === 0 && !newItemType && (
          <div className="py-4 px-3 text-center text-xs text-t3">
            {vaultError
              ? <span className="text-[#e05252]">{vaultError}</span>
              : <span>{t('sidebar:filesPanel.empty')}</span>
            }
          </div>
        )}
      </div>

      {/* Delete confirmation dialog */}
      {deleteConfirm && (
        <DeleteConfirmDialog
          deleteConfirm={deleteConfirm}
          onCancel={() => setDeleteConfirm(null)}
          onConfirm={confirmDelete}
        />
      )}

      {/* Context menu */}
      <ContextMenu
        menu={contextMenu}
        onClose={closeContextMenu}
        onStartRename={startRename}
        onDeleteItem={deleteItem}
        onStartNewItem={startNewItem}
        pinnedPaths={pinnedPaths}
        onTogglePin={togglePin}
      />
    </>
  );
}
