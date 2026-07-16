import { useEditorStore } from '../../store/editorStore';
import { useAppearanceStore } from '@/store/appearanceStore';

const VIEW_LABELS: Record<string, string> = {
  split: '分屏模式',
  edit: '编辑模式',
  preview: '预览模式',
};

export function StatusBar() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const cursorLine = useEditorStore((state) => state.cursorLine);
  const cursorCol = useEditorStore((state) => state.cursorCol);
  const wordCount = useEditorStore((state) => state.wordCount);
  const vaultName = useAppearanceStore((state) => state.vaultName);

  return (
    <footer className="status-bar h-6 shrink-0 bg-panel border-t border-brd flex items-center justify-between px-3 text-[length:calc(var(--ui-font-size)-3px)] text-t3 font-mono">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">✦ AI 就绪</span>
        <span>{vaultName}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>Markdown</span>
        <span>{VIEW_LABELS[viewMode]}</span>
        <span>Ln {cursorLine}, Col {cursorCol}</span>
        <span>{wordCount} 字</span>
      </div>
    </footer>
  );
}
