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

/** The modes this view knows how to render, in top-bar order. */
const ORDER: ViewMode[] = ['edit', 'split', 'preview'];

function Notice({ text }: { text: string }) {
  return <div className="prev-body flex-1 overflow-auto pt-2 px-8" style={{ color: 'var(--t3)', fontSize: 13 }}>{text}</div>;
}

function ExtensionFileView({ path, content = '', onChange, onSave }: ExtensionFileViewProps) {
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
            />
          </div>
        )}
        {showPreview && Preview && (
          // Same body wrapper (and reading padding) the editor's preview pane uses.
          <div className={fileType === 'markdown'
            ? 'prev-body flex-1 overflow-auto pt-2 px-8 pb-[20vh]'
            : 'prev-body flex-1 h-full overflow-auto'}
          >
            <Preview content={text} filePath={path} vaultRoot="" onChange={handleChange}/>
          </div>
        )}
      </div>
    </div>
  );
}

export function buildExtensionFileView(_manifest: ExtensionManifest): ExtensionFileViewCapability {
  return { component: () => ExtensionFileView };
}
