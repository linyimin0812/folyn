import { Fragment, useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { EyeOff, SquareArrowOutUpRight } from 'lucide-react';
import { useVaultStore } from '@/store/vaultStore';
import { resolveBasePath } from '@/utils/pathResolver';
import { useAiStore } from '@/store/aiStore';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import injectAllIcon from '@/assets/icons/inject_all.svg';
import { getAllHandlers } from '@/components/file-types/registry';
import { FileIcon } from '@/components/icons/FileIcon';
import { ThemeIcon } from '@/components/icons/ThemeIcon';
import { runIngest } from '@/services/wikiIngestService';

export interface ContextMenuData {
  x: number;
  y: number;
  path: string;
  name: string;
  type: 'file' | 'dir';
}

export interface ContextMenuProps {
  menu: ContextMenuData | null;
  selectedPaths: Set<string>;
  onClose: () => void;
  onStartRename: (path: string, name: string) => void;
  onDeleteItem: (paths: string[]) => void;
  onStartNewItem: (type: 'file' | 'dir', parentDir?: string, ext?: string) => void;
  onStartMove: (paths: string[]) => void;
  onStartCopy: (paths: string[]) => void;
  pinnedPaths: string[];
  onTogglePin: (path: string) => void;
}

const fileTypeLabelKeys: Record<string, string> = {
  markdown: 'Markdown',
  excalidraw: 'Excalidraw',
  html: 'HTML',
  'rich-text': 'sidebar:contextMenu.fileType.richText',
  code: 'sidebar:contextMenu.fileType.code',
};

const NEW_FILE_GROUPS: string[][] = [
  ['markdown', 'rich-text', 'csv', 'json'],
  ['svg'],
  ['markmap', 'dbml', 'drawio', 'excalidraw'],
];

/** Resolve a vault-relative path to an absolute, platform-native path string
 *  (e.g. `C:\Users\me\...\file.md` on Windows). Mirrors `openInFileManager`'s
 *  base resolution so a copied path matches what the OS file manager uses,
 *  instead of the raw `~/...` basePath with forward slashes. */
async function resolveAbsoluteVaultPath(path: string): Promise<string> {
  const vault = useVaultStore.getState().currentVault;
  if (!vault?.basePath) return path;
  const base = await resolveBasePath(vault.basePath);
  if (!path) return base;
  const { join } = await import('@tauri-apps/api/path');
  return join(base, path);
}

/** Open a vault item in the OS file manager. A file opens its containing
 *  folder, a directory opens itself, and an empty path opens the vault root.
 *  Uses the opener plugin's `openPath` (ACL scope `**` — vaults at any path, e.g. `D:\mochi`, open). */
async function openInFileManager(path: string, type: 'file' | 'dir'): Promise<void> {
  try {
    const vault = useVaultStore.getState().currentVault;
    if (!vault?.basePath) return;
    const base = await resolveBasePath(vault.basePath);
    let target = base;
    if (path) {
      const { join, dirname } = await import('@tauri-apps/api/path');
      target = await join(base, path);
      if (type === 'file') target = await dirname(target);
    }
    const { openPath } = await import('@tauri-apps/plugin-opener');
    await openPath(target);
  } catch (err) {
    console.warn('[ContextMenu] open in file manager failed:', err);
  }
}

export function ContextMenu({
  menu,
  selectedPaths,
  onClose,
  onStartRename,
  onDeleteItem,
  onStartNewItem,
  onStartMove,
  onStartCopy,
  pinnedPaths,
  onTogglePin,
}: ContextMenuProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const creatableTypes = useMemo(() => {
    const handlers = getAllHandlers();
    return handlers.filter((h) => h.supportedViewModes.includes('edit') && h.extensions.length > 0);
  }, []);
  const creatableById = useMemo(
    () => new Map(creatableTypes.map((handler) => [handler.id, handler])),
    [creatableTypes],
  );
  // ponytail: NEW_FILE_GROUPS is the curated built-in ordering. Plugin
  // handlers (anything in creatableById not already in a built-in group)
  // are appended as a final "extensions" group so plugins surface in the
  // new-file menu without modifying host source.
  const newFileGroups = useMemo(() => {
    const builtin = new Set(NEW_FILE_GROUPS.flat());
    const extras = creatableTypes.filter((h) => !builtin.has(h.id)).map((h) => h.id);
    return extras.length > 0 ? [...NEW_FILE_GROUPS, extras] : NEW_FILE_GROUPS;
  }, [creatableTypes]);

  const copyToClipboard = useCallback((text: string) => {
    navigator.clipboard.writeText(text);
    onClose();
  }, [onClose]);

  // Use a ref to keep onClose stable in the click-outside effect
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Close context menu on click outside
  useEffect(() => {
    if (!menu) return;
    const close = () => onCloseRef.current();
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menu]);

  if (!menu) return null;

  // ponytail: when the right-clicked item is part of a multi-selection, batch
  // actions operate on the whole selection; otherwise just the clicked item.
  const batchPaths = selectedPaths.size > 1 && selectedPaths.has(menu.path)
    ? Array.from(selectedPaths)
    : [menu.path];

  return (
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
      {menu.type === 'dir' && (
        <>
          <div className="relative flex items-center justify-between w-full py-1.5 px-3.5 text-xs cursor-pointer bg-transparent border-none text-t1 hover:bg-hov group/sub">
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ThemeIcon name="addFile" size={14} />{t('sidebar:contextMenu.newFile')}</span>
            <span className="text-[10px] text-t3 ml-2">&#9656;</span>
            <div className="hidden group-hover/sub:block absolute left-full top-0 min-w-[180px] w-max py-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[1001]">
              {newFileGroups.map((group, groupIndex) => (
                <Fragment key={group.join('-')}>
                  {groupIndex > 0 && <div className="h-px mx-2 my-1 bg-brd" />}
                  {group.map((handlerId) => {
                    const handler = creatableById.get(handlerId);
                    if (!handler) return null;
                    return (
                      <button
                        key={handler.id}
                        className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov whitespace-nowrap"
                        onClick={() => {
                          onClose();
                          onStartNewItem('file', menu.path, handler.extensions[0]);
                        }}
                      >
                        <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>{handler.icon ?? <FileIcon filename={`file.${handler.extensions[0]}`} />}</span>
                        {(fileTypeLabelKeys[handler.id] ? t(fileTypeLabelKeys[handler.id]) : handler.id)} (.{handler.extensions[0]})
                      </button>
                    );
                  })}
                </Fragment>
              ))}
              <div className="h-px mx-2 my-1 bg-brd" />
              <button
                className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov whitespace-nowrap"
                onClick={() => {
                  onClose();
                  onStartNewItem('file', menu.path);
                }}
              >
                <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}><FileIcon filename="file.txt" /></span>
                {t('sidebar:contextMenu.newFileOther')}
              </button>
            </div>
          </div>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); onStartNewItem('dir', menu.path); }}>
            <ThemeIcon name="newFolder" size={14} /> {t('sidebar:contextMenu.newFolder')}
          </button>
          {menu.path === '' && (
            <>
              <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => {
                void resolveAbsoluteVaultPath('').then(copyToClipboard).catch((err) => console.warn('[ContextMenu] copy vault path failed:', err));
              }}>
                <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copyVaultPath')}
              </button>
              <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); void openInFileManager('', 'dir'); }}>
                <SquareArrowOutUpRight size={14} className="text-t3" /> {t('sidebar:contextMenu.openInFileManager')}
              </button>
            </>
          )}
        </>
      )}
      {menu.path && (
        <>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onTogglePin(menu.path); onClose(); }}>
            <ThemeIcon name="pin" size={14} /> {pinnedPaths.includes(menu.path) ? t('sidebar:contextMenu.unpin') : t('sidebar:contextMenu.pin')}
          </button>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-[#e05252] hover:bg-[rgba(224,82,82,.08)]" onClick={() => { onClose(); onDeleteItem(batchPaths); }}>
            <ThemeIcon name="delete" size={14} /> {t('sidebar:contextMenu.delete')}
          </button>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => {
            onClose();
            const appearance = useAppearanceStore.getState();
            const lines = appearance.excludePatterns.split('\n').map((s) => s.trim()).filter((s) => s.length > 0 && !s.startsWith('#'));
            if (lines.includes(menu.name)) return;
            appearance.setExcludePatterns([...lines, menu.name].join('\n'));
            useVaultStore.getState().refreshFileTree();
          }}>
            <EyeOff size={14} className="text-t3" /> {t('sidebar:contextMenu.hide')}
          </button>
          <div className="h-px mx-2 my-1 bg-brd" />
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); onStartCopy(batchPaths); }}>
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copy')}
          </button>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); onStartRename(menu.path, menu.name); }}>
            <ThemeIcon name={menu.type === 'dir' ? 'editFolder' : 'edit'} size={14} /> {t('sidebar:contextMenu.rename')}
          </button>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); onStartMove(batchPaths); }}>
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.move')}
          </button>
          <div className="h-px mx-2 my-1 bg-brd" />
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { copyToClipboard(menu.name); }}>
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copyFileName')}
          </button>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { copyToClipboard(menu.path); }}>
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copyRelativePath')}
          </button>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => {
            void resolveAbsoluteVaultPath(menu.path).then(copyToClipboard).catch((err) => console.warn('[ContextMenu] copy absolute path failed:', err));
          }}>
            <ThemeIcon name="copyOfFolder" size={14} /> {t('sidebar:contextMenu.copyAbsolutePath')}
          </button>
          {menu.type === 'file' && (
            <>
              <div className="h-px mx-2 my-1 bg-brd" />
              {menu.path.endsWith('.md') && useAppearanceStore.getState().enableWikiPanel && (
                <button
                  className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
                  onClick={() => {
                    runIngest([menu.path]).catch(console.error);
                    onClose();
                  }}
                >
                  <img src={injectAllIcon} className="w-[11px] h-[11px] shrink-0" alt="" />
                  {t('sidebar:contextMenu.ingestToWiki')}
                </button>
              )}
              <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => {
                useAiStore.getState().addFileToChat(menu.name, menu.path);
                useAppearanceStore.getState().setShowAiPanel(true);
                useEditorViewStateStore.setState({ aiPanelVisible: true });
                onClose();
              }}>
                <span className="font-bold text-[11px] tracking-[-0.5px] leading-none">AI</span>
                {t('sidebar:contextMenu.addToChat')}
              </button>
            </>
          )}
          <div className="h-px mx-2 my-1 bg-brd" />
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); void openInFileManager(menu.path, menu.type); }}>
            <SquareArrowOutUpRight size={14} className="text-t3" /> {t('sidebar:contextMenu.openInFileManager')}
          </button>
        </>
      )}
    </div>
  );
}
