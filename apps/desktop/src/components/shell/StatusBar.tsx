import { useEditorStore } from '../../store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useTranslation } from 'react-i18next';

export function StatusBar() {
  const { t } = useTranslation();
  const viewMode = useEditorStore((state) => state.viewMode);
  const cursorLine = useEditorViewStateStore((state) => state.cursorLine);
  const cursorCol = useEditorViewStateStore((state) => state.cursorCol);
  const wordCount = useEditorViewStateStore((state) => state.wordCount);
  const vaultName = useAppearanceStore((state) => state.vaultName);

  return (
    <footer className="status-bar h-6 shrink-0 bg-panel border-t border-brd flex items-center justify-between px-3 text-[length:calc(var(--ui-font-size)-3px)] text-t3 font-mono">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1">{t('shell:statusBar.aiReady')}</span>
        <span>{vaultName}</span>
      </div>
      <div className="flex items-center gap-3">
        <span>{t('shell:statusBar.markdown')}</span>
        <span>{t(`shell:statusBar.viewMode.${viewMode}`, { defaultValue: viewMode })}</span>
        <span>{t('shell:statusBar.lineCol', { line: cursorLine, col: cursorCol })}</span>
        <span>{t('shell:statusBar.wordCount', { count: wordCount })}</span>
      </div>
    </footer>
  );
}
