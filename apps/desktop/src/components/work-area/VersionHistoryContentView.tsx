import { useTranslation } from 'react-i18next';
import { useEditorViewStateStore } from '@/store/editorViewState';

// ponytail: editor-area content view rendered in place of the active editor
// (CodeMirror / custom) when a snapshot is selected in the version-history
// side panel. Reads its state from `editorViewState.versionHistorySelection`
// so the panel writes selection + WorkArea reads it without prop-drilling.
// The snapshot blob is fetched in the panel (which owns the activeTab + fs
// read); this component is a pure render of the stored content, with
// loading / empty / error states.

export function VersionHistoryContentView() {
  const { t } = useTranslation();
  const selection = useEditorViewStateStore((s) => s.versionHistorySelection);

  const { snapshotContent, snapshotError } = selection;

  if (snapshotError) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-2 text-[12px] text-red-500">
        {snapshotError}
      </div>
    );
  }

  if (snapshotContent === null) {
    // ponytail: still fetching the blob — show a non-blocking hint so the
    // editor area is not blank during the async fs read.
    return (
      <div className="flex-1 flex items-center justify-center text-t3 text-[12px]">
        {t('editor:versionHistory.loading')}
      </div>
    );
  }

  if (snapshotContent === '') {
    return (
      <div className="flex-1 flex items-center justify-center text-t3 text-[12px]">
        {t('editor:versionHistory.diff.identical')}
      </div>
    );
  }

  return (
    <pre className="flex-1 overflow-auto px-3 py-2 text-[12px] font-mono leading-[1.5] m-0 whitespace-pre bg-bg">
      {snapshotContent}
    </pre>
  );
}
