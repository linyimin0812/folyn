import { useEditorStore } from '../../store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';

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
  const vaultName = useSettingsStore((state) => state.vaultName);

  return (
    <footer className="status-bar">
      <div className="sb-left">
        <span className="sb-ai">✦ AI 就绪</span>
        <span className="sb-vault">{vaultName}</span>
      </div>
      <div className="sb-right">
        <span className="sb-type">Markdown</span>
        <span className="sb-view">{VIEW_LABELS[viewMode]}</span>
        <span className="sb-pos">Ln {cursorLine}, Col {cursorCol}</span>
        <span className="sb-words">{wordCount} 字</span>
      </div>
    </footer>
  );
}
