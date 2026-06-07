import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { useAiStore } from '@/store/aiStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useEditorStore } from '@/store/editorStore';
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
  onClose: () => void;
  onStartRename: (path: string, name: string) => void;
  onDeleteItem: (path: string, type: 'file' | 'dir') => void;
  onStartNewItem: (type: 'file' | 'dir', parentDir?: string, ext?: string) => void;
  pinnedPaths: string[];
  onTogglePin: (path: string) => void;
}

const fileTypeLabels: Record<string, string> = {
  markdown: 'Markdown',
  excalidraw: 'Excalidraw',
  html: 'HTML',
  code: '代码文件',
};

export function ContextMenu({
  menu,
  onClose,
  onStartRename,
  onDeleteItem,
  onStartNewItem,
  pinnedPaths,
  onTogglePin,
}: ContextMenuProps): React.JSX.Element | null {
  const creatableTypes = useMemo(() => {
    const handlers = getAllHandlers();
    return handlers.filter((h) => h.supportedViewModes.includes('edit') && h.extensions.length > 0);
  }, []);

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
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}><ThemeIcon name="addFile" size={14} />新建文件</span>
            <span className="text-[10px] text-t3 ml-2">&#9656;</span>
            <div className="hidden group-hover/sub:block absolute left-full top-0 min-w-[180px] w-max py-1 bg-panel border border-brd rounded-lg shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[1001]">
              {creatableTypes.map((handler) => (
                <button
                  key={handler.id}
                  className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov whitespace-nowrap"
                  onClick={() => {
                    onClose();
                    onStartNewItem('file', menu.path, handler.extensions[0]);
                  }}
                >
                  <span style={{ display: 'inline-flex', verticalAlign: 'middle', marginRight: 4 }}>{handler.icon ?? <FileIcon filename={`file.${handler.extensions[0]}`} />}</span>
                  {fileTypeLabels[handler.id] ?? handler.id} (.{handler.extensions[0]})
                </button>
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
                其他（自定义扩展名）
              </button>
            </div>
          </div>
          <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); onStartNewItem('dir', menu.path); }}>
            <ThemeIcon name="newFolder" size={14} /> 新建文件夹
          </button>
          <div className="h-px mx-2 my-1 bg-brd" />
        </>
      )}
      <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { copyToClipboard(menu.path); }}>
        <ThemeIcon name="copyOfFolder" size={14} /> 复制相对路径
      </button>
      <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => {
        const vault = useVaultStore.getState().currentVault;
        const base = vault?.basePath || '';
        copyToClipboard(`${base}/${menu.path}`);
      }}>
        <ThemeIcon name="copyOfFolder" size={14} /> 复制绝对路径
      </button>
      <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { copyToClipboard(menu.name); }}>
        <ThemeIcon name="copyOfFolder" size={14} /> 复制文件名
      </button>
      <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onTogglePin(menu.path); onClose(); }}>
        <ThemeIcon name="pin" size={14} /> {pinnedPaths.includes(menu.path) ? '取消置顶' : '置顶'}
      </button>
      {menu.type === 'file' && (
        <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => {
          useAiStore.getState().addFileToChat(menu.name, menu.path);
          useSettingsStore.getState().updateSettings({ showAiPanel: true });
          useEditorStore.setState({ aiPanelVisible: true });
          onClose();
        }}>
          <span className="font-bold text-[11px] tracking-[-0.5px] leading-none">AI</span>
          添加文件到对话
        </button>
      )}
      {menu.path.endsWith('.md') && (
        <button
          className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov"
          onClick={() => {
            runIngest([menu.path]).catch(console.error);
            onClose();
          }}
        >
          摄入到 Wiki
        </button>
      )}
      <div className="h-px mx-2 my-1 bg-brd" />
      <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-t1 hover:bg-hov" onClick={() => { onClose(); onStartRename(menu.path, menu.name); }}>
        <ThemeIcon name={menu.type === 'dir' ? 'editFolder' : 'edit'} size={14} /> 重命名
      </button>
      <button className="flex items-center gap-1.5 w-full py-1.5 px-3.5 text-xs text-left cursor-pointer bg-transparent border-none text-[#e05252] hover:bg-[rgba(224,82,82,.08)]" onClick={() => { onClose(); onDeleteItem(menu.path, menu.type); }}>
        <ThemeIcon name="delete" size={14} /> 删除
      </button>
    </div>
  );
}
