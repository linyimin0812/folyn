import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSettingsStore } from '@/store/settingsStore';
import { useEditorStore } from '@/store/editorStore';
import { useVaultStore } from '@/store/vaultStore';
import { useAiStore } from '@/store/aiStore';
import type { VaultEntry } from '@quill/vault-provider';
import { getAllHandlers } from '@/components/file-types/registry';
import { FileIcon } from '@/components/icons/FileIcon';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

function flattenTree(entries: VaultEntry[]): string[] {
  const result: string[] = [];
  for (const entry of entries) {
    result.push(entry.path);
    if (entry.type === 'dir' && entry.children) {
      result.push(...flattenTree(entry.children));
    }
  }
  return result;
}

const DEFAULT_WIDTH = 224;
interface SidebarProps {
  onFileSelect?: () => void;
}

export function Sidebar({ onFileSelect }: SidebarProps): React.JSX.Element {
  const vaultName = useSettingsStore((state) => state.vaultName);
  const setCurrentPage = useSettingsStore((state) => state.setCurrentPage);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const openFile = useEditorStore((state) => state.openFile);
  const tabs = useEditorStore((state) => state.tabs);

  const fileTree = useVaultStore((state) => state.fileTree);
  const vaultError = useVaultStore((state) => state.error);
  const vaultCreateFile = useVaultStore((state) => state.createFile);
  const vaultCreateDir = useVaultStore((state) => state.createDir);
  const vaultDeleteFile = useVaultStore((state) => state.deleteFile);
  const vaultDeleteDir = useVaultStore((state) => state.deleteDir);
  const vaultRenameFile = useVaultStore((state) => state.renameFile);
  const pinnedPaths = useVaultStore((state) => state.pinnedPaths);
  const togglePin = useVaultStore((state) => state.togglePin);

  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const actionsMenuRef = useRef<HTMLDivElement>(null);
  const isCompact = width < 260;
  const [collapsed, setCollapsed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [resizerHovered, setResizerHovered] = useState(false);
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

  const [newItemType, setNewItemType] = useState<'file' | 'dir' | null>(null);
  const [newItemName, setNewItemName] = useState('');
  const [newItemParent, setNewItemParent] = useState<string | null>(null);
  const [newItemExtension, setNewItemExtension] = useState<string | null>(null);
  const [renamingItem, setRenamingItem] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const newItemInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);
  const isDragging = useRef(false);

  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const lastClickedPath = useRef<string | null>(null);
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const flatPaths = useMemo(() => flattenTree(fileTree), [fileTree]);

  const vaultMoveFiles = useVaultStore((state) => state.moveFiles);

  const fileTreeRef = useRef<HTMLDivElement>(null);

  // ── Custom mouse-based drag & drop ──
  const mouseDragState = useRef<{
    startX: number;
    startY: number;
    paths: string[];
    active: boolean;
    ghost: HTMLDivElement | null;
    dropTarget: string | null;
  } | null>(null);

  const handleItemMouseDown = useCallback(
    (e: React.MouseEvent, path: string) => {
      if (e.button !== 0) return;
      if ((e.target as HTMLElement).closest('.ft-actions, .ft-rename-input, .ft-act-btn, input, button')) return;

      const paths = selectedPaths.has(path) ? Array.from(selectedPaths) : [path];

      mouseDragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        paths,
        active: false,
        ghost: null,
        dropTarget: null,
      };
    },
    [selectedPaths],
  );

  const vaultMoveFilesRef = useRef(vaultMoveFiles);
  vaultMoveFilesRef.current = vaultMoveFiles;

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      const state = mouseDragState.current;
      if (!state) return;

      if (!state.active) {
        const dx = Math.abs(e.clientX - state.startX);
        const dy = Math.abs(e.clientY - state.startY);
        if (dx < 5 && dy < 5) return;
        state.active = true;

        const ghost = document.createElement('div');
        ghost.className = 'drag-ghost';
        ghost.textContent = state.paths.length === 1
          ? (state.paths[0].includes('/') ? state.paths[0].substring(state.paths[0].lastIndexOf('/') + 1) : state.paths[0])
          : `${state.paths.length} 个项目`;
        document.body.appendChild(ghost);
        state.ghost = ghost;
      }

      if (state.ghost) {
        state.ghost.style.left = `${e.clientX + 12}px`;
        state.ghost.style.top = `${e.clientY + 12}px`;
      }

      if (state.ghost) state.ghost.style.display = 'none';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (state.ghost) state.ghost.style.display = '';

      let newTarget: string | null = null;
      if (el) {
        const dirItem = (el as HTMLElement).closest('[data-dirpath]') as HTMLElement | null;
        if (dirItem) {
          newTarget = dirItem.getAttribute('data-dirpath')!;
        } else {
          const sbBody = (el as HTMLElement).closest('.sb-body') as HTMLElement | null;
          if (sbBody) {
            newTarget = '';
          }
        }
      }

      state.dropTarget = newTarget;
      setDragOverDir(newTarget);
    };

    const handleMouseUp = async () => {
      const state = mouseDragState.current;
      if (!state) return;

      if (state.ghost) {
        state.ghost.remove();
      }

      if (state.active && state.paths.length > 0 && state.dropTarget !== null) {
        await vaultMoveFilesRef.current(state.paths, state.dropTarget);
        setSelectedPaths(new Set());
      }

      mouseDragState.current = null;
      setDragOverDir(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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

  const startNewItem = useCallback((type: 'file' | 'dir', parentDir?: string, ext?: string) => {
    setNewItemType(type);
    setNewItemName('');
    setNewItemParent(parentDir ?? null);
    setNewItemExtension(ext ?? null);
    if (parentDir) {
      setExpandedDirs((prev) => new Set([...prev, parentDir]));
    }
    setTimeout(() => newItemInputRef.current?.focus(), 50);
  }, []);

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
    } else if (finalName.endsWith('.excalidraw')) {
      const emptyExcalidraw = JSON.stringify({
        type: 'excalidraw',
        version: 2,
        elements: [],
        appState: { viewBackgroundColor: '#ffffff' },
      }, null, 2);
      await vaultCreateFile(fullPath, emptyExcalidraw);
    } else {
      const defaultContent = `# ${finalName.substring(0, finalName.lastIndexOf('.'))}`;
      await vaultCreateFile(fullPath, defaultContent);
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

  }, [newItemName, newItemType, newItemParent, handleFileClick, vaultCreateFile, vaultCreateDir]);

  const cancelNewItem = useCallback(() => {
    setNewItemType(null);
    setNewItemName('');
    setNewItemParent(null);
    setNewItemExtension(null);
  }, []);

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

  const closeTab = useEditorStore((state) => state.closeTab);

  const creatableTypes = useMemo(() => {
    const handlers = getAllHandlers();
    return handlers.filter((h) => h.supportedViewModes.includes('edit') && h.extensions.length > 0);
  }, []);

  const fileTypeLabels: Record<string, string> = {
    markdown: 'Markdown',
    excalidraw: 'Excalidraw',
    html: 'HTML',
    code: '代码文件',
  };

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; path: string; name: string; type: 'file' | 'dir' } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ path: string; type: 'file' | 'dir'; name: string } | null>(null);

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

  const handleContextMenu = useCallback((e: React.MouseEvent, path: string, name: string, type: 'file' | 'dir') => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, path, name, type });
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setContextMenu(null);
  }, []);

  // Close context menu on click outside
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [contextMenu]);

  const [isResizing, setIsResizing] = useState(false);

  // Drag resize
  const handleMouseDown = useCallback(() => {
    isDragging.current = true;
    setIsResizing(true);
    document.body.style.cursor = 'col-resize';
    document.documentElement.classList.add('is-resizing');
  }, []);

  const widthRef = useRef(width);
  widthRef.current = width;

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      if (!isDragging.current) return;
      const newWidth = Math.max(0, event.clientX);
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      if (!isDragging.current) return;
      isDragging.current = false;
      setIsResizing(false);
      document.body.style.cursor = '';
      document.documentElement.classList.remove('is-resizing');
      if (widthRef.current < 60) {
        setCollapsed(true);
        setWidth(DEFAULT_WIDTH);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

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
              <div
                className={`ft-item ft-dir${isDirSelected ? ' selected' : ''}${isDragOver ? ' drag-over' : ''}${isPinned ? ' pinned' : ''}`}
                style={{ paddingLeft: `${12 + depth * 14}px` }}
                data-dirpath={item.path}
                onClick={(e) => handleItemSelect(e, item.path, item)}
                onMouseDown={(e) => handleItemMouseDown(e, item.path)}
                onContextMenu={(e) => handleContextMenu(e, item.path, item.name, 'dir')}
              >
                <span className="ft-icon"><FileIcon filename={item.name} isDir /></span>
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    className="ft-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmRename();
                      if (e.key === 'Escape') { setRenamingItem(null); setRenameValue(''); }
                    }}
                    onBlur={confirmRename}
                    onClick={(e) => e.stopPropagation()}
                    autoCapitalize="off"
                  />
                ) : (
                  <span className="ft-name">{item.name}</span>
                )}
                {isPinned && <ThemeIcon name="pin" size={12} className="ft-pin-icon" />}
              </div>
              {isExpanded && newItemType && newItemParent === item.path && (
                <div className="ft-item" style={{ paddingLeft: `${12 + (depth + 1) * 14}px` }}>
                  <span className="ft-icon"><FileIcon filename={newItemType === 'dir' ? '' : (newItemName || 'untitled.md')} isDir={newItemType === 'dir'} /></span>
                  <input
                    ref={newItemInputRef}
                    className="ft-rename-input"
                    placeholder={newItemType === 'dir' ? '文件夹名称' : newItemExtension ? `文件名（默认 .${newItemExtension}）` : '文件名（含扩展名）'}
                    value={newItemName}
                    onChange={(e) => setNewItemName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') confirmNewItem();
                      if (e.key === 'Escape') cancelNewItem();
                    }}
                    onBlur={confirmNewItem}
                    autoCapitalize="off"
                  />
                </div>
              )}
              {isExpanded && renderFileTree(children, depth + 1)}
            </div>
          );
        }

        const isActive = tabs.find((t) => t.path === item.path)?.id === activeTabId;
        const isFileSelected = selectedPaths.has(item.path);
        return (
          <div
            key={item.path}
            data-filepath={item.path}
            className={`ft-item ft-file${isActive ? ' on' : ''}${isFileSelected ? ' selected' : ''}${isPinned ? ' pinned' : ''}`}
            style={{ paddingLeft: `${12 + depth * 14}px` }}
            onClick={(e) => !isRenaming && handleItemSelect(e, item.path, item)}
            onMouseDown={(e) => handleItemMouseDown(e, item.path)}
            onContextMenu={(e) => handleContextMenu(e, item.path, item.name, 'file')}
          >
            <span className="ft-icon"><FileIcon filename={item.name} /></span>
            {isRenaming ? (
              <input
                ref={renameInputRef}
                className="ft-rename-input"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmRename();
                  if (e.key === 'Escape') { setRenamingItem(null); setRenameValue(''); }
                }}
                onBlur={confirmRename}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <span className="ft-name">{item.name}</span>
            )}
            {isPinned && <ThemeIcon name="pin" size={12} className="ft-pin-icon" />}
          </div>
        );
      });
  };

  return (
    <>
      <aside className={`sidebar${isResizing ? ' resizing' : ''}`} style={{ width: collapsed ? '0px' : `${width}px`, display: collapsed ? 'none' : undefined }}>
        {/* Vault selector */}
        <div className="sb-header">
          <div className="sb-header-row">
          <div className="vault-sel" onClick={() => setCurrentPage('vault')}>
            <span className="vs-name">{vaultName}</span>
            <span className="vs-arrow">▾</span>
          </div>

          {/* Actions: new file / new folder / locate / refresh / expand / collapse */}
          {isCompact ? (
            <div className="sb-actions" ref={actionsMenuRef}>
              <button className="sb-action-btn" onClick={locateActiveFile} data-tip="定位当前文件">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="1.5" x2="8" y2="6.5"/><line x1="8" y1="9.5" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="6.5" y2="8"/><line x1="9.5" y1="8" x2="14.5" y2="8"/></svg>
              </button>
              <button className="sb-action-btn" onClick={() => useVaultStore.getState().refreshFileTree()} data-tip="刷新文件树">
                <ThemeIcon name="updateFolders" size={14} />
              </button>
              <button className="sb-action-btn sb-more-btn" onClick={() => setActionsMenuOpen((v) => !v)} data-tip="更多操作">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><circle cx="8" cy="3" r="1.5"/><circle cx="8" cy="8" r="1.5"/><circle cx="8" cy="13" r="1.5"/></svg>
              </button>
              {actionsMenuOpen && (
                <div className="sb-actions-menu">
                  <button className="sb-menu-item" onClick={() => { startNewItem('file'); setActionsMenuOpen(false); }}>
                    <ThemeIcon name="addFile" size={14} />
                    <span>新建文件</span>
                  </button>
                  <button className="sb-menu-item" onClick={() => { startNewItem('dir'); setActionsMenuOpen(false); }}>
                    <ThemeIcon name="newFolder" size={14} />
                    <span>新建文件夹</span>
                  </button>
                  <button className="sb-menu-item" onClick={() => { expandAllDirs(); setActionsMenuOpen(false); }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><polyline points="4,5 8,9 12,5" /><polyline points="4,9 8,13 12,9" /></svg>
                    <span>展开全部</span>
                  </button>
                  <button className="sb-menu-item" onClick={() => { collapseAllDirs(); setActionsMenuOpen(false); }}>
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><polyline points="4,9 8,5 12,9" /><polyline points="4,13 8,9 12,13" /></svg>
                    <span>折叠全部</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="sb-actions">
              <button className="sb-action-btn" onClick={() => startNewItem('file')} data-tip="新建文件">
                <ThemeIcon name="addFile" size={14} />
              </button>
              <button className="sb-action-btn" onClick={() => startNewItem('dir')} data-tip="新建文件夹">
                <ThemeIcon name="newFolder" size={14} />
              </button>
              <button className="sb-action-btn" onClick={locateActiveFile} data-tip="定位当前文件">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="8" cy="8" r="6.5"/><line x1="8" y1="1.5" x2="8" y2="6.5"/><line x1="8" y1="9.5" x2="8" y2="14.5"/><line x1="1.5" y1="8" x2="6.5" y2="8"/><line x1="9.5" y1="8" x2="14.5" y2="8"/></svg>
              </button>
              <button className="sb-action-btn" onClick={() => useVaultStore.getState().refreshFileTree()} data-tip="刷新文件树">
                <ThemeIcon name="updateFolders" size={14} />
              </button>
              <button className="sb-action-btn" onClick={expandAllDirs} data-tip="展开全部文件夹">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <polyline points="4,5 8,9 12,5" />
                  <polyline points="4,9 8,13 12,9" />
                </svg>
              </button>
              <button className="sb-action-btn" onClick={collapseAllDirs} data-tip="折叠全部文件夹">
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <polyline points="4,9 8,5 12,9" />
                  <polyline points="4,13 8,9 12,13" />
                </svg>
              </button>
            </div>
          )}
          </div>

          {/* Search */}
          <div className="sb-search-wrap">
            <input
              className="sb-search"
              placeholder="搜索文件..."
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              autoCapitalize="off"
            />
          </div>
        </div>

        {/* New item inline input (root level only) */}
        {newItemType && !newItemParent && (
          <div className="ft-item" style={{ paddingLeft: '12px' }}>
            <span className="ft-icon"><FileIcon filename={newItemType === 'dir' ? '' : (newItemName || 'untitled.md')} isDir={newItemType === 'dir'} /></span>
            <input
              ref={newItemInputRef}
              className="ft-rename-input"
              placeholder={newItemType === 'dir' ? '文件夹名称' : '文件名称（默认 .md）'}
              value={newItemName}
              onChange={(event) => setNewItemName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') confirmNewItem();
                if (event.key === 'Escape') cancelNewItem();
              }}
              onBlur={confirmNewItem}
            />
          </div>
        )}

        {/* File tree */}
        <div
          className={`sb-body${dragOverDir === '' ? ' drag-over' : ''}`}
          ref={fileTreeRef}
        >
          {renderFileTree(fileTree)}
          {fileTree.length === 0 && !newItemType && (
            <div className="sb-empty">
              {vaultError
                ? <span className="sb-empty-err">{vaultError}</span>
                : <span className="sb-empty-hint">暂无文件</span>
              }
            </div>
          )}
        </div>

        {/* Settings button at bottom */}
        <div className="sb-footer">
          <button className="sb-settings-btn" onClick={() => setCurrentPage('settings')}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <line x1="2" y1="4" x2="14" y2="4" />
              <line x1="2" y1="8" x2="14" y2="8" />
              <line x1="2" y1="12" x2="14" y2="12" />
              <circle cx="5" cy="4" r="1.5" fill="var(--panel)" />
              <circle cx="9" cy="8" r="1.5" fill="var(--panel)" />
              <circle cx="6" cy="12" r="1.5" fill="var(--panel)" />
            </svg>
            设置
          </button>
        </div>

        {/* Delete confirmation dialog */}
        {deleteConfirm && (
          <div className="delete-confirm-overlay" onClick={() => setDeleteConfirm(null)}>
            <div className="delete-confirm-dialog" onClick={(e) => e.stopPropagation()}>
              <div className="delete-confirm-title">确认删除</div>
              <div className="delete-confirm-msg">
                确定要删除{deleteConfirm.type === 'dir' ? '文件夹' : '文件'} <strong>{deleteConfirm.name}</strong> 吗？
                {deleteConfirm.type === 'dir' && <span style={{ display: 'block', marginTop: 4, fontSize: 12, color: 'var(--t3, #71717a)' }}>文件夹内的所有内容也将被删除</span>}
              </div>
              <div className="delete-confirm-actions">
                <button className="delete-confirm-btn cancel" onClick={() => setDeleteConfirm(null)}>取消</button>
                <button className="delete-confirm-btn danger" onClick={confirmDelete}>删除</button>
              </div>
            </div>
          </div>
        )}

        {/* Context menu */}
        {contextMenu && (
          <div
            className="ft-context-menu"
            ref={(el) => {
              if (!el) return;
              const rect = el.getBoundingClientRect();
              const maxY = window.innerHeight - rect.height - 8;
              const maxX = window.innerWidth - rect.width - 8;
              if (contextMenu.y > maxY) el.style.top = `${maxY}px`;
              if (contextMenu.x > maxX) el.style.left = `${maxX}px`;
            }}
            style={{ top: contextMenu.y, left: contextMenu.x }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {contextMenu.type === 'dir' && (
              <>
                <div className="ft-ctx-item ft-ctx-submenu-wrap">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ThemeIcon name="addFile" size={14} />新建文件</span>
                  <span className="ft-ctx-arrow">▸</span>
                  <div className="ft-ctx-submenu">
                    {creatableTypes.map((handler) => (
                      <button
                        key={handler.id}
                        className="ft-ctx-item"
                        onClick={() => {
                          setContextMenu(null);
                          startNewItem('file', contextMenu.path, handler.extensions[0]);
                        }}
                      >
                        <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>{handler.icon ?? <FileIcon filename={`file.${handler.extensions[0]}`} />}</span>
                        {fileTypeLabels[handler.id] ?? handler.id} (.{handler.extensions[0]})
                      </button>
                    ))}
                    <div className="ft-ctx-divider" />
                    <button
                      className="ft-ctx-item"
                      onClick={() => {
                        setContextMenu(null);
                        startNewItem('file', contextMenu.path);
                      }}
                    >
                      <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><FileIcon filename="file.txt" /></span>
                      其他（自定义扩展名）
                    </button>
                  </div>
                </div>
                <button className="ft-ctx-item" onClick={() => { setContextMenu(null); startNewItem('dir', contextMenu.path); }}>
                  <ThemeIcon name="newFolder" size={14} /> 新建文件夹
                </button>
                <div className="ft-ctx-divider" />
              </>
            )}
            <button className="ft-ctx-item" onClick={() => { copyToClipboard(contextMenu.path); }}>
              <ThemeIcon name="copyOfFolder" size={14} /> 复制相对路径
            </button>
            <button className="ft-ctx-item" onClick={() => {
              const vault = useVaultStore.getState().currentVault;
              const base = vault?.basePath || '';
              copyToClipboard(`${base}/${contextMenu.path}`);
            }}>
              <ThemeIcon name="copyOfFolder" size={14} /> 复制绝对路径
            </button>
            <button className="ft-ctx-item" onClick={() => { copyToClipboard(contextMenu.name); }}>
              <ThemeIcon name="copyOfFolder" size={14} /> 复制文件名
            </button>
            <button className="ft-ctx-item" onClick={() => { togglePin(contextMenu.path); setContextMenu(null); }}>
              <ThemeIcon name="pin" size={14} /> {pinnedPaths.includes(contextMenu.path) ? '取消置顶' : '置顶'}
            </button>
            {contextMenu.type === 'file' && (
              <button className="ft-ctx-item" onClick={() => {
                useAiStore.getState().addFileToChat(contextMenu.name, contextMenu.path);
                useSettingsStore.getState().updateSettings({ showAiPanel: true });
                useEditorStore.setState({ aiPanelVisible: true });
                setContextMenu(null);
              }}>
                <span className="ft-ctx-ai-icon">AI</span>
                添加文件到对话
              </button>
            )}
            <div className="ft-ctx-divider" />
            <button className="ft-ctx-item" onClick={() => { setContextMenu(null); startRename(contextMenu.path, contextMenu.name); }}>
              <ThemeIcon name={contextMenu.type === 'dir' ? 'editFolder' : 'edit'} size={14} /> 重命名
            </button>
            <button className="ft-ctx-item ft-ctx-danger" onClick={() => { setContextMenu(null); deleteItem(contextMenu.path, contextMenu.type); }}>
              <ThemeIcon name="delete" size={14} /> 删除
            </button>
          </div>
        )}
      </aside>

      {/* Resize handle with collapse/expand toggle */}
      <div
        className={`resizer-wrapper ${collapsed ? 'collapsed' : ''}`}
        onMouseEnter={() => setResizerHovered(true)}
        onMouseLeave={() => setResizerHovered(false)}
      >
        <div className="resizer" onMouseDown={collapsed ? undefined : handleMouseDown} />
        {(resizerHovered || collapsed) && (
          <button
            className="resizer-toggle-btn"
            onClick={() => setCollapsed((prev) => !prev)}
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8">
              {collapsed ? (
                <polyline points="6,3 11,8 6,13" />
              ) : (
                <polyline points="10,3 5,8 10,13" />
              )}
            </svg>
          </button>
        )}
      </div>
    </>
  );
}
