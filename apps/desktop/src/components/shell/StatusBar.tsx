import { useEditorStore } from '../../store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useWikiStore } from '@/store/wikiStore';
import { useWikiQueryStore } from '@/store/wikiQueryStore';
import { useTranslation } from 'react-i18next';
import { BookOpen } from 'lucide-react';

export function StatusBar() {
  const { t } = useTranslation();
  const viewMode = useEditorStore((state) => state.viewMode);
  const activeTab = useEditorStore((state) => state.tabs.find((t) => t.id === state.activeTabId) ?? null);
  const cursorLine = useEditorViewStateStore((state) => state.cursorLine);
  const cursorCol = useEditorViewStateStore((state) => state.cursorCol);
  const wordCount = useEditorViewStateStore((state) => state.wordCount);
  const vaultName = useAppearanceStore((state) => state.vaultName);

  return (
    <footer className="status-bar h-6 shrink-0 bg-panel border-t border-brd flex items-center justify-between px-3 text-[length:calc(var(--ui-font-size)-3px)] text-t3 font-mono">
      <div className="flex items-center gap-3">
        <span>{vaultName}</span>
        <WikiStatusBarIndicator />
      </div>
      <div className="flex items-center gap-3">
        {activeTab && (
          <span>{activeTab.fileType.charAt(0).toUpperCase() + activeTab.fileType.slice(1)}</span>
        )}
        <span>{t(`shell:statusBar.viewMode.${viewMode}`, { defaultValue: viewMode })}</span>
        <span>{t('shell:statusBar.lineCol', { line: cursorLine, col: cursorCol })}</span>
        <span>{t('shell:statusBar.wordCount', { count: wordCount })}</span>
      </div>
    </footer>
  );
}

// ponytail: hidden when all three wiki activity flags are idle; else show
// priority ingest > lint > query. Mirrors the WikiFileTree activity surface.
function WikiStatusBarIndicator() {
  const { t } = useTranslation();
  const isIngesting = useWikiStore((s) => s.isIngesting);
  const isLinting = useWikiStore((s) => s.isLinting);
  const isQuerying = useWikiQueryStore((s) => s.isRunning);

  if (!isIngesting && !isLinting && !isQuerying) return null;

  const label = isIngesting
    ? t('shell:statusBar.wiki.ingesting')
    : isLinting
      ? t('shell:statusBar.wiki.linting')
      : t('shell:statusBar.wiki.querying');

  return (
    <span className="inline-flex items-center gap-1 text-acc">
      <BookOpen size={11} />
      <span>{label}</span>
    </span>
  );
}
