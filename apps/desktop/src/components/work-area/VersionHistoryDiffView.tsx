import { useTranslation } from 'react-i18next';
import { useEditorViewStateStore } from '@/store/editorViewState';

// ponytail: editor-area diff view rendered in place of the active editor
// (CodeMirror / custom) when a snapshot is selected in the version-history
// side panel. Reads its state from `editorViewState.versionHistorySelection`
// so the panel writes selection + WorkArea reads it without prop-drilling.
// The diff lines themselves are computed in the panel (which owns the
// activeTab + fs reads); this component is a pure render of the stored
// lines, with loading / empty / error states.

export function VersionHistoryDiffView() {
  const { t } = useTranslation();
  const selection = useEditorViewStateStore((s) => s.versionHistorySelection);

  const { diffLines, diffError } = selection;

  if (diffError) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-2 text-[12px] text-red-500">
        {diffError}
      </div>
    );
  }

  if (!diffLines) {
    // ponytail: still computing the patch — show a non-blocking hint so the
    // editor area is not blank during the async fs reads.
    return (
      <div className="flex-1 flex items-center justify-center text-t3 text-[12px]">
        {t('editor:versionHistory.loading')}
      </div>
    );
  }

  if (diffLines.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-t3 text-[12px]">
        {t('editor:versionHistory.diff.identical')}
      </div>
    );
  }

  return (
    <pre className="flex-1 overflow-auto text-[12px] font-mono leading-[1.5] m-0 px-4 py-2 bg-bg">
      {diffLines.map((line, i) => {
        const cls =
          line.kind === 'add' ? 'text-green-600 dark:text-green-400 bg-green-500/5'
          : line.kind === 'del' ? 'text-red-600 dark:text-red-400 bg-red-500/5'
          : line.kind === 'hunk' ? 'text-t3'
          : line.kind === 'meta' ? 'text-t3'
          : 'text-t2';
        const prefix =
          line.kind === 'add' ? '+ '
          : line.kind === 'del' ? '- '
          : line.kind === 'hunk' ? ''
          : line.kind === 'meta' ? ''
          : '  ';
        return (
          <div key={i} className={`whitespace-pre ${cls}`}>
            <span>{prefix}{line.text}</span>
          </div>
        );
      })}
    </pre>
  );
}
