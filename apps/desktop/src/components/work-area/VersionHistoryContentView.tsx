import { useTranslation } from 'react-i18next';
import { useEditorStore, type FileTab } from '@/store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useEditorPrefsStore } from '@/store/editorPrefsStore';
import { useVaultStore } from '@/store/vaultStore';
import { getHandlerById } from '@/components/file-types/registry';
import { EditorPane } from './EditorPane';
import { PreviewPane } from './PreviewPane';

// ponytail: snapshot view rides the live tab's fileType / path / viewMode so
// the file-type editor pipeline (CodeMirror / custom editor / preview) renders
// the snapshot content with the same fidelity as the live editor — no plain
// `<pre>`. The synthetic tab id encodes the selected snapshot key so QuillEditor
// (keyed by activeTab.id in EditorPane) remounts when the user picks a different
// snapshot. Read-only is enforced on the CodeMirror surface via
// `EditorState.readOnly.of(true)`; custom editors get best-effort read-only by
// passing no-op onChange / onSave callbacks — edits don't flow into the editor
// store (the synthetic id is not in `tabs`), so they never persist to disk.
//
// Mirrors WorkArea's editor-split branching so the snapshot view inherits the
// same viewMode + handler config (split / source / preview) as the live editor.
// Split resizer + editor↔preview scroll-sync are NOT replicated — the snapshot
// view is for inspection + restore, not authoring; 50/50 split is the ceiling.

const SNAPSHOT_TAB_PREFIX = 'version-history-snapshot';
const noop = () => {};
const noopHeading = (_heading: string) => {};

export function VersionHistoryContentView() {
  const { t } = useTranslation();
  const selection = useEditorViewStateStore((s) => s.versionHistorySelection);
  const { snapshotContent, snapshotError, selectedKey } = selection;

  const activeTabId = useEditorStore((s) => s.activeTabId);
  const tabs = useEditorStore((s) => s.tabs);
  const viewMode = useEditorStore((s) => s.viewMode);
  const activeTab = tabs.find((t) => t.id === activeTabId);

  const showLineNumbers = useEditorPrefsStore((s) => s.showLineNumbers);
  const tabSize = useEditorPrefsStore((s) => s.tabSize);
  const wrapColumn = useEditorPrefsStore((s) => s.wrapColumn);
  const editorFont = useEditorPrefsStore((s) => s.editorFont);
  const editorFontSize = useEditorPrefsStore((s) => s.editorFontSize);
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');

  const handler = activeTab ? getHandlerById(activeTab.fileType) : undefined;

  if (snapshotError) {
    return (
      <div className="flex-1 flex items-center justify-center px-4 py-2 text-[12px] text-red-500">
        {snapshotError}
      </div>
    );
  }

  if (!activeTab || !handler || snapshotContent === null) {
    return (
      <div className="flex-1 flex items-center justify-center text-t3 text-[12px]">
        {t('editor:versionHistory.loading')}
      </div>
    );
  }

  // ponytail: no file-type handler in the registry declares `deserialize` today
  // (markdown / code / plantuml / graphviz / dbml / html / drawio / excalidraw /
  // mmap / rich-text / csv / json / svg / clip all store raw text on disk). The
  // branch below honors the contract anyway so a future handler that needs
  // deserialization (e.g. a binary format) gets it for free.
  const deserialized = handler.deserialize ? handler.deserialize(snapshotContent) : snapshotContent;

  const snapshotTab: FileTab = {
    ...activeTab,
    id: selectedKey ? `${SNAPSHOT_TAB_PREFIX}-${selectedKey}` : SNAPSHOT_TAB_PREFIX,
    content: deserialized,
    isDirty: false,
  };

  const showCodeMirror = handler.useCodeMirror && (viewMode === 'edit' || viewMode === 'split' || !handler.Preview);
  const showCustomEditor = handler.Editor && !handler.useCodeMirror && !(viewMode === 'preview' && handler.Preview);
  const isPreviewOnly = handler.Preview && !handler.useCodeMirror && !handler.Editor;
  const showPreview = handler.Preview && (isPreviewOnly || viewMode === 'preview' || viewMode === 'split');
  // ponytail: split flex — 50/50. No drag-resizer (the live editor's resizer
  // owns mutable drag state; replicating it for a transient snapshot view is
  // more abstraction than the feature is worth).
  const splitStyle = { flexGrow: 1, flexBasis: 0 } as const;
  const inSplit = !!handler.Preview && viewMode === 'split' && (handler.useCodeMirror || !!handler.Editor);

  return (
    <>
      {showCodeMirror && (
        <EditorPane
          key={snapshotTab.id}
          activeTab={snapshotTab}
          onContentChange={noop}
          onSave={noop}
          externalContentVersion={0}
          isFileLoading={false}
          showLineNumbers={showLineNumbers}
          tabSize={tabSize}
          wrapColumn={wrapColumn}
          editorFont={editorFont}
          editorFontSize={editorFontSize}
          readOnly
          style={inSplit ? splitStyle : undefined}
        />
      )}

      {showCustomEditor && handler.Editor && activeTab.fileType !== 'web' && (
        <div
          className={`flex-1 flex flex-col overflow-hidden editor-${handler.id} ${inSplit ? 'border-r border-brd' : ''}`}
          style={inSplit ? splitStyle : undefined}
        >
          <handler.Editor
            key={snapshotTab.id}
            content={snapshotTab.content}
            tabId={snapshotTab.id}
            filePath={snapshotTab.path}
            onChange={noop}
            onSave={noop}
          />
        </div>
      )}

      {showPreview && handler.Preview && (
        <PreviewPane
          activeTab={snapshotTab}
          Preview={handler.Preview}
          vaultRoot={vaultRoot}
          viewMode={viewMode}
          previewFlex={1}
          onScrollToHeading={noopHeading}
        />
      )}
    </>
  );
}
