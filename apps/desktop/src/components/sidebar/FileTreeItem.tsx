import type { VaultEntry } from '@folyn/vault-provider';
import { FileIcon } from '@/components/icons/FileIcon';
import { ThemeIcon } from '@/components/icons/ThemeIcon';

interface FileTreeItemProps {
  item: VaultEntry;
  depth: number;
  isActive: boolean;
  isSelected: boolean;
  isPinned: boolean;
  isExpanded?: boolean;
  isDragOver?: boolean;
  isRenaming: boolean;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement>;
  onSelect: (e: React.MouseEvent) => void;
  onMouseDown: (e: React.MouseEvent) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  onRenameChange: (value: string) => void;
  onRenameConfirm: () => void;
  onRenameCancel: () => void;
}

export function FileTreeItem({
  item,
  depth,
  isActive,
  isSelected,
  isPinned,
  isDragOver,
  isRenaming,
  renameValue,
  renameInputRef,
  onSelect,
  onMouseDown,
  onContextMenu,
  onRenameChange,
  onRenameConfirm,
  onRenameCancel,
}: FileTreeItemProps): React.JSX.Element {
  const isDir = item.type === 'dir';
  const indentUnit = 16;
  const basePad = 12;
  const paddingLeft = `${basePad + depth * indentUnit}px`;

  const baseClasses = 'ft-item flex items-center gap-[5px] py-1 cursor-pointer text-[calc(var(--ui-font-size)-2px)] transition-all duration-[120ms] rounded-none select-none relative overflow-visible';
  const paddingRight = '12px';
  const stateClasses = isSelected
    ? 'bg-act text-t1'
    : (isDir && isDragOver)
      ? 'bg-accdim shadow-[inset_0_0_0_1px_var(--acc)] rounded-[3px]'
      : (!isDir && isActive)
        ? 'bg-accdim text-acc'
        : 'text-t2 hover:bg-hov hover:text-t1';
  const classNames = `${baseClasses} ${stateClasses}${isDir ? ' font-medium' : ''}`;

  const dataAttrs: Record<string, string> = {};
  if (isDir) {
    dataAttrs['data-dirpath'] = item.path;
  } else {
    dataAttrs['data-filepath'] = item.path;
  }

  const handleClick = (e: React.MouseEvent) => {
    if (!isDir && isRenaming) return;
    onSelect(e);
  };

  const handleRenameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onRenameConfirm();
    if (e.key === 'Escape') onRenameCancel();
  };

  return (
    <div
      className={classNames}
      style={{ paddingLeft, paddingRight }}
      onClick={handleClick}
      onMouseDown={onMouseDown}
      onContextMenu={onContextMenu}
      {...dataAttrs}
    >
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="absolute -top-1 -bottom-1 w-px bg-brd2"
          style={{ left: `${basePad + i * indentUnit + 7}px` }}
        />
      ))}
      <span className="shrink-0 w-4 h-4 flex items-center justify-center [&>svg]:block [&>svg]:shrink-0">
        <FileIcon filename={item.name} isDir={isDir} />
      </span>
      {isRenaming ? (
        <input
          ref={renameInputRef}
          className="flex-1 py-px px-1 rounded-[3px] border border-acc bg-inp text-t1 text-[11px] outline-none font-ui"
          value={renameValue}
          onChange={(e) => onRenameChange(e.target.value)}
          onKeyDown={handleRenameKeyDown}
          onBlur={onRenameConfirm}
          onClick={(e) => e.stopPropagation()}
          autoCapitalize="off"
        />
      ) : (
        <span className="overflow-hidden text-ellipsis whitespace-nowrap flex-1">{item.name}</span>
      )}
      {isPinned && <ThemeIcon name="pin" size={12} className="ml-auto opacity-60 shrink-0" />}
    </div>
  );
}
