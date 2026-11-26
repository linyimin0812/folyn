/**
 * External-folder section — renders the externalFolderStore folders under the
 * vault tree in the Files panel. Owns its expand/collapse state (separate from
 * the vault tree's) and its row rendering (lighter than FileTreeItem: no
 * rename/pin/drag-drop — external folders are read-browse only; files still
 * open fully-featured external tabs). Right-click rows get a compact context
 * menu (open / copy paths / reveal in file manager / root: refresh + remove)
 * — deliberately NOT the vault ContextMenu, whose actions (new/rename/move/
 * delete/hide/pin) are all vault-FS operations with no external equivalent.
 *
 * Rows reuse FileTreeItem's ft-item visual classes so both trees read as one
 * design language. The folder root row carries a remove (×) button; the
 * section is hidden entirely when no folders are open.
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X, SquareArrowOutUpRight } from 'lucide-react';
import { ChevronRight } from 'lucide-react';
import type { VaultEntry } from '@folyn/vault-provider';
import { useExternalFolderStore } from '@/store/externalFolderStore';
import { useImportFlowStore } from '@/store/importFlowStore';
import { useEditorStore } from '@/store/editorStore';
import { openFile } from '@/services/editorIoService';
import { FileIcon } from '@/components/icons/FileIcon';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

/** Item row padding mirrors FileTreeItem: base 12px + 16px per depth. */

/** Which row the menu targets. `root` = a registered external folder (refresh/
 *  remove apply); `dir` = a subdirectory inside it; `file` = an openable file. */
interface ExternalMenuData {
  x: number;
  y: number;
  path: string;
  name: string;
  kind: 'root' | 'dir' | 'file';
}

export function ExternalFolderSection(): React.JSX.Element | null {
  const { t } = useTranslation();
  const folders = useExternalFolderStore((s) => s.folders);
  const removeFolder = useExternalFolderStore((s) => s.removeFolder);
  const refreshFolder = useExternalFolderStore((s) => s.refreshFolder);
  const tabs = useEditorStore((s) => s.tabs);
  const activeTabId = useEditorStore((s) => s.activeTabId);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<ExternalMenuData | null>(null);

  // Close the context menu on click outside (same pattern as ContextMenu).
  const closeMenuRef = useRef(() => setMenu(null));
  useEffect(() => {
    if (!menu) return;
    document.addEventListener('mousedown', closeMenuRef.current);
    return () => document.removeEventListener('mousedown', closeMenuRef.current);
  }, [menu]);

  const handleOpenMenu = useCallback((e: React.MouseEvent, path: string, name: string, kind: ExternalMenuData['kind']) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, path, name, kind });
  }, []);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    setMenu(null);
  }, []);

  /** Reveal in the OS file manager: a directory opens itself, a file opens its
   *  containing folder. External paths are already absolute — no vault base
   *  resolution needed (unlike ContextMenu.openInFileManager). */
  const revealInFileManager = useCallback(async (path: string, kind: ExternalMenuData['kind']) => {
    try {
      const { openPath } = await import('@tauri-apps/plugin-opener');
      let target = path;
      if (kind === 'file') {
        const { dirname } = await import('@tauri-apps/api/path');
        target = await dirname(path);
      }
      await openPath(target);
    } catch (err) {
      console.warn('[ExternalFolderSection] open in file manager failed:', err);
    }
    setMenu(null);
  }, []);

  const handleToggleDir = useCallback((dirPath: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (prev.has(dirPath)) next.delete(dirPath);
      else next.add(dirPath);
      return next;
    });
  }, []);

  const handleFileClick = useCallback(
    (path: string, name: string) => {
      void openFile(path, name);
    },
    [],
  );

  const renderTree = useMemo(
    () =>
      (items: VaultEntry[], depth: number): React.JSX.Element[] =>
        items.map((item) => {
          const isActive =
            tabs.find((t) => t.path === item.path)?.id === activeTabId;
          const paddingLeft = `${12 + depth * 16}px`;

          if (item.type === 'dir') {
            const isExpanded = expandedDirs.has(item.path);
            return (
              <div key={item.path}>
                <div
                  className="ft-item flex items-center gap-[5px] py-1 cursor-pointer text-[calc(var(--ui-font-size)-2px)] select-none relative font-medium text-t2 hover:bg-hov hover:text-t1"
                  style={{ paddingLeft, paddingRight: '12px' }}
                  data-dirpath={item.path}
                  onClick={() => handleToggleDir(item.path)}
                  onContextMenu={(e) => handleOpenMenu(e, item.path, item.name, 'dir')}
                >
                  <ChevronRight
                    size={12}
                    className={`shrink-0 transition-transform duration-[120ms]${isExpanded ? ' rotate-90' : ''}`}
                  />
                  <span className="ft-ico shrink-0 w-4 h-4 flex items-center justify-center [&>svg]:block [&>svg]:shrink-0">
                    <FileIcon filename={item.name} isDir />
                  </span>
                  <span className="truncate">{item.name}</span>
                </div>
                {isExpanded && renderTree(item.children ?? [], depth + 1)}
              </div>
            );
          }

          return (
            <div
              key={item.path}
              className={`ft-item flex items-center gap-[5px] py-1 cursor-pointer text-[calc(var(--ui-font-size)-2px)] select-none relative${isActive ? ' active bg-accdim text-acc' : ' text-t2 hover:bg-hov hover:text-t1'}`}
              style={{ paddingLeft: `${28 + depth * 16}px`, paddingRight: '12px' }}
              onClick={() => handleFileClick(item.path, item.name)}
              onContextMenu={(e) => handleOpenMenu(e, item.path, item.name, 'file')}
              title={item.path}
            >
              <span className="ft-ico shrink-0 w-4 h-4 flex items-center justify-center [&>svg]:block [&>svg]:shrink-0"><FileIcon filename={item.name} /></span>
              <span className="truncate">{item.name}</span>
            </div>
          );
        }),
    [expandedDirs, tabs, activeTabId, handleToggleDir, handleFileClick, handleOpenMenu],
  );

  if (folders.length === 0) return null;

  return (
    <div className="mt-1">
      <div className="px-3 pt-1 pb-[2px] text-[calc(var(--ui-font-size)-4px)] text-t3 uppercase tracking-wide select-none">
        {t('sidebar:filesPanel.externalFolders.title')}
      </div>
      {folders.map((folder) => (
        <div key={folder.path} className="mb-[2px]">
          <div
            className="ft-item group flex items-center gap-[5px] py-1 cursor-pointer text-[calc(var(--ui-font-size)-2px)] select-none relative font-medium text-t2 hover:bg-hov hover:text-t1"
            style={{ paddingLeft: '12px', paddingRight: '12px' }}
            data-dirpath={folder.path}
            onClick={() => handleToggleDir(folder.path)}
            onContextMenu={(e) => handleOpenMenu(e, folder.path, folder.name, 'root')}
            title={folder.path}
          >
            <ChevronRight
              size={12}
              className={`shrink-0 transition-transform duration-[120ms]${expandedDirs.has(folder.path) ? ' rotate-90' : ''}`}
            />
            <span className="ft-ico shrink-0 w-4 h-4 flex items-center justify-center [&>svg]:block [&>svg]:shrink-0">
              <FileIcon filename={folder.name} isDir />
            </span>
            <span className="truncate">{folder.name}</span>
            <button
              className="ml-auto shrink-0 w-5 h-5 rounded-[4px] border-none bg-transparent text-t3 cursor-pointer flex items-center justify-center opacity-0 group-hover:opacity-100 hover:bg-hov hover:text-t1"
              title={t('sidebar:filesPanel.externalFolders.remove')}
              aria-label={t('sidebar:filesPanel.externalFolders.remove')}
              onClick={(e) => {
                e.stopPropagation();
                removeFolder(folder.path);
              }}
            >
              <X size={12} />
            </button>
          </div>
          {folder.error && (
            <div className="px-3 py-1 text-[calc(var(--ui-font-size)-4px)] text-t3 italic">
              {folder.error}
            </div>
          )}
          {expandedDirs.has(folder.path) && renderTree(folder.tree, 1)}
        </div>
      ))}

      {menu && (
        <div
          className="fixed z-[1000] min-w-[160px] py-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)]"
          ref={(el) => {
            if (!el) return;
            const rect = el.getBoundingClientRect();
            const maxY = window.innerHeight - rect.height - 8;
            const maxX = window.innerWidth - rect.width - 8;
            if (menu.y > maxY) el.style.top = `${maxY}px`;
            if (menu.x > maxX) el.style.left = `${maxX}px`;
          }}
          style={{ top: menu.y, left: menu.x }}
          onMouseDown={(e) => e.stopPropagation()}
        >
          {menu.kind === 'file' && (
            <button
              className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
              onClick={() => {
                void openFile(menu.path, menu.name);
                setMenu(null);
              }}
            >
              <ThemeIcon name="file-viewer" size={14} /> {t('sidebar:contextMenu.open')}
            </button>
          )}
          {menu.kind === 'root' && (
            <button
              className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
              onClick={() => {
                void refreshFolder(menu.path);
                setMenu(null);
              }}
            >
              <ThemeIcon name="updateFolders" size={14} /> {t('sidebar:contextMenu.refresh')}
            </button>
          )}
          {menu.kind === 'file' && <div className="h-px mx-2 my-1 bg-brd" />}
          <button
            className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
            onClick={() => {
              void useImportFlowStore.getState().startImport([menu.path]);
              setMenu(null);
            }}
          >
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.importToVault')}
          </button>
          <button
            className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
            onClick={() => copyToClipboard(menu.name)}
          >
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copyFileName')}
          </button>
          <button
            className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
            onClick={() => copyToClipboard(menu.path)}
          >
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copyAbsolutePath')}
          </button>
          <div className="h-px mx-2 my-1 bg-brd" />
          <button
            className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
            onClick={() => void revealInFileManager(menu.path, menu.kind)}
          >
            <SquareArrowOutUpRight size={14} className="text-t3" /> {t('sidebar:contextMenu.openInFileManager')}
          </button>
          {menu.kind === 'root' && (
            <>
              <div className="h-px mx-2 my-1 bg-brd" />
              <button
                className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-[#e05252] hover:bg-[rgba(224,82,82,.08)]"
                onClick={() => {
                  removeFolder(menu.path);
                  setMenu(null);
                }}
              >
                <ThemeIcon name="delete" size={14} /> {t('sidebar:filesPanel.externalFolders.remove')}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
