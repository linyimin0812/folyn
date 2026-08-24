import { useRef, useState, useCallback, useEffect, useImperativeHandle, forwardRef } from 'react';
import { useVaultStore } from '@/store/vaultStore';
import { MochiEditor, type MochiEditorHandle } from '@/editor/EditorView';
import { SlashMenu } from '../editor/SlashMenu';
import { CodeBlockLangMenu } from '../editor/CodeBlockLangMenu';
import { ImagePasteDialog, type ImageSaveConfig } from '../editor/ImagePasteDialog';
import { type SlashMenuState } from '@/editor/extensions/SlashCommandExtension';
import { type CodeBlockMenuState } from '@/editor/extensions/CodeBlockExtension';
import { getStrategy, fileToBase64, convertImageFormat } from '@/utils/imageUploader';
import type { ContainerPlugin } from '@mochi/container-plugins';
import type { FileTab } from '@/store/editorStore';
import { DiffReviewBar } from './DiffReviewBar';
import { DbmlStyleStatusButton } from '../file-types/dbml/DbmlStyleStatusButton';

interface EditorPaneProps {
  activeTab: FileTab | undefined;
  onContentChange: (tabId: string, content: string) => void;
  onSave: (tabId: string) => void;
  externalContentVersion: number;
  isFileLoading: boolean;
  showLineNumbers: boolean;
  tabSize: number;
  wrapColumn: number;
  editorFont: string;
  editorFontSize: number;
  style?: React.CSSProperties;
  /** ponytail: read-only mode for the version-history snapshot view. Passes
   *  through to MochiEditor's `EditorState.readOnly.of(true)`. */
  readOnly?: boolean;
}

export const EditorPane = forwardRef<MochiEditorHandle, EditorPaneProps>(
  function EditorPane(
    {
      activeTab,
      onContentChange,
      onSave,
      externalContentVersion,
      isFileLoading,
      showLineNumbers,
      tabSize,
      wrapColumn,
      editorFont,
      editorFontSize,
      style,
      readOnly,
    },
    ref,
  ) {
    const editorRef = useRef<MochiEditorHandle>(null);

    // Expose MochiEditorHandle to parent via forwarded ref
    useImperativeHandle(ref, () => ({
      getView: () => editorRef.current?.getView() ?? null,
      getScrollDOM: () => editorRef.current?.getScrollDOM() ?? null,
      replaceContent: (content: string) => {
        editorRef.current?.replaceContent(content);
      },
    }));

    // Slash menu state
    const [slashMenu, setSlashMenu] = useState<SlashMenuState>({ visible: false, pos: 0, filter: '' });
    const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
    // Escape closes the menu even though the "/filter" text stays in the doc;
    // the menu stays closed only while the trigger position is unchanged.
    // Typing more or moving the cursor clears the dismissal (mirrors the
    // rich-text editor's dismissedFromRef pattern).
    const dismissedSlashPosRef = useRef<number | null>(null);

    // Code block language menu state
    const [codeBlockMenu, setCodeBlockMenu] = useState<CodeBlockMenuState>({ visible: false, triggerPos: 0, blockStart: 0, filter: '', selectedIndex: 0 });
    const [codeBlockMenuPosition, setCodeBlockMenuPosition] = useState({ top: 0, left: 0 });

    // Image paste dialog state
    const [imagePasteVisible, setImagePasteVisible] = useState(false);
    const [imagePasteFile, setImagePasteFile] = useState<File | null>(null);
    const [imagePastePreviewUrl, setImagePastePreviewUrl] = useState('');
    const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');

    // Sync external content changes (e.g. AI accept) to the CodeMirror editor
    useEffect(() => {
      if (externalContentVersion === 0) return;
      if (!activeTab || !editorRef.current) return;
      editorRef.current.replaceContent(activeTab.content);
    }, [externalContentVersion]);

    const getView = useCallback(() => editorRef.current?.getView() ?? null, []);

    const handleCodeBlockMenuChange = useCallback((state: CodeBlockMenuState) => {
      setCodeBlockMenu(state);
      if (state.visible) {
        requestAnimationFrame(() => {
          const view = getView();
          if (!view) return;
          try {
            const pos = view.state.selection.main.head;
            const safePos = Math.min(pos, view.state.doc.length);
            const coords = view.coordsAtPos(safePos);
            if (coords) {
              setCodeBlockMenuPosition({ top: coords.bottom + 4, left: coords.left });
            }
          } catch {}
        });
      }
    }, [getView]);

    const handleSlashMenuChange = useCallback((state: SlashMenuState) => {
      // Re-arm the menu once the trigger moves (user typed more or moved the
      // cursor); a dismissed menu stays closed only at the same position.
      if (dismissedSlashPosRef.current !== null && state.pos !== dismissedSlashPosRef.current) {
        dismissedSlashPosRef.current = null;
      }
      const effective = dismissedSlashPosRef.current !== null && state.pos === dismissedSlashPosRef.current
        ? { ...state, visible: false }
        : state;
      setSlashMenu(effective);
      if (effective.visible) {
        const view = getView();
        if (view) {
          const coords = view.coordsAtPos(effective.pos);
          if (coords) {
            setSlashMenuPosition({ top: coords.bottom + 4, left: coords.left });
          }
        }
      }
    }, [getView]);

    const handleSlashSelect = useCallback((plugin: ContainerPlugin) => {
      const view = getView();
      if (!view) return;

      const menuState = slashMenu;
      const line = view.state.doc.lineAt(menuState.pos);
      const slashStart = line.from;

      // ponytail: if template contains an empty "" (e.g. file-preview's src=""),
      // drop the cursor between the quotes so the user can type the path immediately.
      // Ceiling: no other plugin template uses empty quotes today; if one starts,
      // the heuristic would jump to the first "" — revisit if/when it bites.
      const emptyQuoteIdx = plugin.template.indexOf('""');

      dismissedSlashPosRef.current = null;
      view.dispatch({
        changes: { from: slashStart, to: menuState.pos, insert: plugin.template },
        selection: emptyQuoteIdx >= 0
          ? { anchor: slashStart + emptyQuoteIdx + 1 }
          : undefined,
      });
      view.focus();
    }, [getView, slashMenu]);

    const handleSlashClose = useCallback(() => {
      dismissedSlashPosRef.current = slashMenu.pos;
    }, [slashMenu]);

    const handleImageConfirm = useCallback(async (config: ImageSaveConfig) => {
      if (!imagePasteFile) return;
      try {
        const strategy = getStrategy(config.target);
        const originalFormat = imagePasteFile.type.split('/')[1] as string;
        const needsConversion = config.format !== originalFormat;
        const base64 = needsConversion
          ? await convertImageFormat(imagePasteFile, config.format)
          : await fileToBase64(imagePasteFile);
        const result = await strategy.upload(base64, config, vaultRoot, activeTab?.path);
        const view = editorRef.current?.getView();
        if (view) {
          const pos = view.state.selection.main.head;
          const hasCustomSize = config.width || config.height;
          // ponytail: per-segment encodeURIComponent is for local paths
          // whose segments may contain spaces / special chars. Applying it
          // to an `https://` URL splits on `/` and runs encodeURIComponent
          // on `https:` → `https%3A` (because `:` is not in encodeURIComponent's
          // always-allowed set), breaking the protocol. Skip the encode pass
          // for URLs that are already valid (http(s) / data / asset) — only
          // local relative paths (`./foo/bar baz.png`) need it.
          const raw = result.markdownUrl;
          const encodedUrl = /^(?:https?:|data:|asset:)/i.test(raw)
            ? raw
            : raw.split('/').map(encodeURIComponent).join('/');
          const imageMarkdown = hasCustomSize
            ? `<img src="${encodedUrl}" alt="${config.fileName}"${config.width ? ` width="${config.width}"` : ''}${config.height ? ` height="${config.height}"` : ''} />`
            : `![${config.fileName}](${encodedUrl})`;
          view.dispatch({
            changes: { from: pos, to: pos, insert: imageMarkdown },
            selection: { anchor: pos + imageMarkdown.length },
          });
          view.focus();
        }
      } catch (error) {
        console.error('[ImageUpload] Failed:', error);
      } finally {
        URL.revokeObjectURL(imagePastePreviewUrl);
        setImagePasteVisible(false);
        setImagePasteFile(null);
        setImagePastePreviewUrl('');
      }
    }, [imagePasteFile, imagePastePreviewUrl, vaultRoot, activeTab?.path]);

    const handleImageCancel = useCallback(() => {
      URL.revokeObjectURL(imagePastePreviewUrl);
      setImagePasteVisible(false);
      setImagePasteFile(null);
      setImagePastePreviewUrl('');
    }, [imagePastePreviewUrl]);

    return (
      <div className="flex-1 flex flex-col overflow-hidden border-r border-brd min-w-[200px]" style={style}>
        <DiffReviewBar editorRef={editorRef} activeTab={activeTab} />
        <div className="flex-1 overflow-hidden flex flex-col bg-surf min-h-0 relative">
          {isFileLoading && (
            <div className="ed-loading-overlay">
              <span className="ft-spinner" /> 加载文件中…
            </div>
          )}
          <MochiEditor
            key={`${activeTab?.id}-${showLineNumbers}-${tabSize}-${wrapColumn}-${editorFont}-${editorFontSize}`}
            ref={editorRef}
            filePath={activeTab?.path ?? ''}
            initialContent={activeTab?.content ?? ''}
            initialCursorLine={activeTab?.cursorLine}
            initialCursorCol={activeTab?.cursorCol}
            onChange={(content) => {
              if (activeTab) onContentChange(activeTab.id, content);
            }}
            onSave={() => {
              if (activeTab) onSave(activeTab.id);
            }}
            onSlashMenuChange={handleSlashMenuChange}
            onCodeBlockMenuChange={handleCodeBlockMenuChange}
            onImagePaste={(file, previewUrl) => {
              setImagePasteFile(file);
              setImagePastePreviewUrl(previewUrl);
              setImagePasteVisible(true);
            }}
            readOnly={readOnly}
          />
          <SlashMenu
            visible={slashMenu.visible}
            filter={slashMenu.filter}
            position={slashMenuPosition}
            onSelect={handleSlashSelect}
            onClose={handleSlashClose}
          />
          <CodeBlockLangMenu
            visible={codeBlockMenu.visible}
            menuState={codeBlockMenu}
            position={codeBlockMenuPosition}
            getView={getView}
          />
          <ImagePasteDialog
            visible={imagePasteVisible}
            previewUrl={imagePastePreviewUrl}
            currentFilePath={activeTab?.path ?? ''}
            vaultRoot={vaultRoot}
            onConfirm={handleImageConfirm}
            onCancel={handleImageCancel}
          />
          {/* ponytail: bottom-of-editor status button for dbml persisted
              style state. Reads the trailing `<!-- dbml:meta -->` block
              straight from activeTab.content — no shared runtime state with
              ErDiagramX6, read-only display only. Shown only for .dbml
              tabs. Positioned at the bottom-right of the editor pane. */}
          {activeTab?.fileType === 'dbml' && (
            <DbmlStyleStatusButton content={activeTab.content ?? ''} />
          )}
        </div>
      </div>
    );
  },
);
