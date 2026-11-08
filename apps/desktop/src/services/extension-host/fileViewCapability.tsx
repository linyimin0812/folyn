/**
 * File view capability: the Vault editor's editor + preview, handed to an
 * extension as one component.
 *
 * The editor is `FolynEditor` — the same CodeMirror instance EditorPane mounts,
 * so keybindings, highlighting, line numbers and the user's editor preferences
 * are the Vault's rather than a second implementation. The preview is the file
 * type's own `preview` mode component, the one PreviewPane mounts.
 *
 * The edit / split / preview switch is NOT drawn here: this publishes the modes
 * it supports to {@link useExtensionFileViewStore} so the top bar's single mode
 * segment drives it, exactly as it drives the Vault editor.
 */

import { useCallback, useEffect, useMemo, useState, type ComponentType } from 'react';
import type {
  ExtensionFileViewCapability,
  ExtensionFileViewProps,
  ExtensionManifest,
  ViewMode,
} from '@folyn/extension-host';
import type { PreviewProps } from '@/components/file-types/types';
import { FolynEditor } from '@/editor/EditorView';
import { detectFileType } from '@/store/editorStore';
import { getHandlerById, getModeComponent, getSupportedModes } from '@/components/file-types/registry';
import { useExtensionFileViewStore } from '@/store/extensionFileViewStore';
import { externalFileProvider } from '@/services/externalFileProvider';
import { isExternalPath } from '@/utils/isExternalPath';
import { AssetResolverContext } from '@/components/file-types/markdown/assetResolver';

/** The modes this view knows how to render, in top-bar order. */
const ORDER: ViewMode[] = ['edit', 'split', 'preview'];

function Notice({ text }: { text: string }) {
  return <div className="prev-body flex-1 overflow-auto pt-2 px-8" style={{ color: 'var(--t3)', fontSize: 13 }}>{text}</div>;
}

function ExtensionFileView({ path, content = '', onChange, onSave, resolveAsset, listDir }: ExtensionFileViewProps) {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const fileType = useMemo(() => detectFileType(path), [path]);
  const handler = getHandlerById(fileType);
  const Preview = useMemo(() => (
    fileType === 'unsupported' ? undefined : getModeComponent(handler, 'preview') as unknown as ComponentType<PreviewProps> | undefined
  ), [fileType, handler]);

  // Only modes the handler declares are offered; a preview-only format (image,
  // PDF) hides the segment entirely.
  const modes = useMemo<ViewMode[]>(() => {
    const declared = getSupportedModes(handler);
    return ORDER.filter(m => declared.includes(m));
  }, [handler]);
  const hasEditor = modes.includes('edit');

  const mode = useExtensionFileViewStore((s) => s.mode);
  const [text, setText] = useState(content);

  // A handler that renders from text (SVG, markdown, CSV…) needs the file's
  // contents. When the page passes only a local path — a saved download —
  // read it here, the way the Vault editor reads a file before its preview.
  const needsText = !!handler?.needsFileContent && !content && isExternalPath(path);
  const [reading, setReading] = useState(needsText);
  useEffect(() => {
    if (!needsText) return;
    let cancelled = false;
    setReading(true);
    externalFileProvider.readFile(path)
      .then((value) => { if (!cancelled) setText(value); })
      .catch(() => { /* left empty: the notice below explains */ })
      .finally(() => { if (!cancelled) setReading(false); });
    return () => { cancelled = true; };
  }, [needsText, path]);

  // Publish this view's modes, and land on a mode it actually offers.
  useEffect(() => {
    const store = useExtensionFileViewStore.getState();
    const next = modes.includes(store.mode) ? store.mode : (hasEditor ? 'edit' : 'preview');
    useExtensionFileViewStore.setState({ modes, mode: next });
    return () => { useExtensionFileViewStore.setState({ modes: [] }); };
  }, [modes, hasEditor]);

  const handleChange = useCallback((next: string) => {
    setText(next);
    onChange?.(next);
  }, [onChange]);

  // Publish what is on screen, live, for the 演示模式 shortcut.
  useEffect(() => {
    useExtensionFileViewStore.setState({ current: { path, content: text, resolveAsset } });
  }, [path, text, resolveAsset]);
  useEffect(() => () => { useExtensionFileViewStore.setState({ current: null }); }, []);

  if (reading) return null;
  if (fileType === 'unsupported' || (!Preview && !text)) {
    return <Notice text={`Folyn 没有可显示 .${ext || '?'} 文件的视图。`}/>;
  }

  const showEditor = mode !== 'preview' && !!text && hasEditor;
  const showPreview = mode !== 'edit' && !!Preview;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      <div className="flex-1 flex overflow-hidden min-h-0">
        {showEditor && (
          <div className={showPreview ? 'flex-1 flex flex-col overflow-hidden border-r border-brd min-w-[200px]' : 'flex-1 flex flex-col overflow-hidden'}>
            <FolynEditor
              filePath={path}
              initialContent={text}
              onChange={handleChange}
              onSave={() => onSave?.(text)}
              // This editor lives outside the files panel tab system, so it must
              // not persist its scroll onto that panel's active tab.
              persistTabScroll={false}
              pathSource={listDir}
            />
          </div>
        )}
        {showPreview && Preview && (
          // Same body wrapper (and reading padding) the editor's preview pane uses.
          <div className={fileType === 'markdown'
            ? 'prev-body flex-1 overflow-auto pt-2 px-8 pb-[20vh]'
            : 'prev-body flex-1 h-full overflow-auto'}
          >
            <AssetResolverContext.Provider value={resolveAsset ?? null}>
              <Preview content={text} filePath={path} vaultRoot="" onChange={handleChange}/>
            </AssetResolverContext.Provider>
          </div>
        )}
      </div>
    </div>
  );
}

export function buildExtensionFileView(_manifest: ExtensionManifest): ExtensionFileViewCapability {
  return {
    component: () => ExtensionFileView,
    // Same guard as the Vault's togglePresentationMode: markdown only.
    present({ path, content, resolveAsset }) {
      if (detectFileType(path) !== 'markdown') return;
      useExtensionFileViewStore.getState().setPresenting({ path, content, resolveAsset });
    },
  };
}
