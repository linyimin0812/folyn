import { useRef, useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { QuillEditor, type QuillEditorHandle } from '@/editor/EditorView';
import { SlashMenu } from '../editor/SlashMenu';
import { CodeBlockLangMenu } from '../editor/CodeBlockLangMenu';
import { ImagePasteDialog, type ImageSaveConfig } from '../editor/ImagePasteDialog';
import { hideSlashMenu, type SlashMenuState } from '@/editor/extensions/SlashCommandPlugin';
import { type CodeBlockMenuState } from '@/editor/extensions/CodeBlockExtension';
import { getStrategy, fileToBase64, convertImageFormat } from '@/utils/imageUploader';
import type { ContainerPlugin } from '@quill/container-plugins';
import { EditorView } from '@codemirror/view';
import { getHandlerById } from '@/file-types/registry';

interface HeadingItem {
  level: number;
  text: string;
  line: number;
}

function extractHeadings(content: string): HeadingItem[] {
  const lines = content.split('\n');
  const headings: HeadingItem[] = [];
  lines.forEach((line, index) => {
    const match = line.match(/^(#{1,6})\s+(.+)/);
    if (match) {
      headings.push({ level: match[1].length, text: match[2], line: index + 1 });
    }
  });
  return headings;
}


export function WorkArea() {
  const viewMode = useEditorStore((state) => state.viewMode);
  const setViewMode = useEditorStore((state) => state.setViewMode);
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabs);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const isFileLoading = useEditorStore((state) => state.isFileLoading);
  const externalContentVersion = useEditorStore((state) => state.externalContentVersion);
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const showLineNumbers = useSettingsStore((s) => s.showLineNumbers);
  const settingsTabSize = useSettingsStore((s) => s.tabSize);
  const wrapColumn = useSettingsStore((s) => s.wrapColumn);
  const editorFont = useSettingsStore((s) => s.editorFont);
  const editorFontSize = useSettingsStore((s) => s.editorFontSize);

  const [outlineVisible, setOutlineVisible] = useState(false);
  const [outlineWidth, setOutlineWidth] = useState(180);
  const outlineDragging = useRef(false);
  const prevBodyRef = useRef<HTMLDivElement>(null);

  const editorRef = useRef<QuillEditorHandle>(null);
  const [slashMenu, setSlashMenu] = useState<SlashMenuState>({ visible: false, pos: 0, filter: '' });
  const [slashMenuPosition, setSlashMenuPosition] = useState({ top: 0, left: 0 });
  const [codeBlockMenu, setCodeBlockMenu] = useState<CodeBlockMenuState>({ visible: false, triggerPos: 0, blockStart: 0, filter: '', selectedIndex: 0 });
  const [codeBlockMenuPosition, setCodeBlockMenuPosition] = useState({ top: 0, left: 0 });

  // Image paste dialog state
  const [imagePasteVisible, setImagePasteVisible] = useState(false);
  const [imagePasteFile, setImagePasteFile] = useState<File | null>(null);
  const [imagePastePreviewUrl, setImagePastePreviewUrl] = useState('');
  const vaultRoot = useVaultStore((s) => s.currentVault?.basePath ?? '');

  // Get the handler for the active tab
  const handler = activeTab ? getHandlerById(activeTab.fileType) : undefined;

  // Apply handler's defaultViewMode when switching to a tab
  const prevTabIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeTabId && activeTabId !== prevTabIdRef.current) {
      prevTabIdRef.current = activeTabId;
      if (handler?.defaultViewMode && viewMode !== handler.defaultViewMode) {
        setViewMode(handler.defaultViewMode);
      }
    }
  }, [activeTabId, handler, viewMode, setViewMode]);

  // Sync external content changes (e.g. AI accept) to the CodeMirror editor
  useEffect(() => {
    if (externalContentVersion === 0) return;
    if (!activeTab || !editorRef.current) return;
    editorRef.current.replaceContent(activeTab.content);
  }, [externalContentVersion]);

  // Pane resize (editor vs preview split ratio)
  const [editorFlex, setEditorFlex] = useState(1);
  const [previewFlex, setPreviewFlex] = useState(1);
  const splitDragging = useRef(false);
  const splitContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!splitDragging.current || !splitContainerRef.current) return;
      const rect = splitContainerRef.current.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const clamped = Math.max(0.2, Math.min(0.8, ratio));
      setEditorFlex(clamped);
      setPreviewFlex(1 - clamped);
    };
    const handleMouseUp = () => {
      if (splitDragging.current) {
        splitDragging.current = false;
        document.body.style.cursor = '';
        document.documentElement.classList.remove('is-resizing');
      }
    };
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  // Outline resize
  useEffect(() => {
    const handleOutlineMove = (e: MouseEvent) => {
      if (!outlineDragging.current || !prevBodyRef.current) return;
      const container = prevBodyRef.current.closest('.pane-prev');
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const newWidth = Math.max(120, Math.min(400, rect.right - e.clientX));
      setOutlineWidth(newWidth);
    };
    const handleOutlineUp = () => {
      if (outlineDragging.current) {
        outlineDragging.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    };
    document.addEventListener('mousemove', handleOutlineMove);
    document.addEventListener('mouseup', handleOutlineUp);
    return () => {
      document.removeEventListener('mousemove', handleOutlineMove);
      document.removeEventListener('mouseup', handleOutlineUp);
    };
  }, []);

  // ── Synchronized scrolling between editor and preview (markdown split mode) ──
  const scrollSourceRef = useRef<'editor' | 'preview' | null>(null);
  const scrollResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (viewMode !== 'split' || activeTab?.fileType !== 'markdown') return;

    const scrollDOM = editorRef.current?.getScrollDOM();
    const previewDOM = prevBodyRef.current;
    if (!scrollDOM || !previewDOM) return;

    function resetScrollSource() {
      if (scrollResetTimer.current) clearTimeout(scrollResetTimer.current);
      scrollResetTimer.current = setTimeout(() => {
        scrollSourceRef.current = null;
      }, 150);
    }

    function handleEditorScroll() {
      if (scrollSourceRef.current === 'preview') return;
      scrollSourceRef.current = 'editor';
      resetScrollSource();

      const view = editorRef.current?.getView();
      if (!view || !previewDOM) return;

      const topBlock = view.lineBlockAtHeight(scrollDOM!.scrollTop);
      const topLine = view.state.doc.lineAt(topBlock.from).number;

      const anchors = previewDOM.querySelectorAll<HTMLElement>('[data-source-line]');
      if (anchors.length === 0) return;

      let lo = 0, hi = anchors.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (parseInt(anchors[mid].dataset.sourceLine!) <= topLine) lo = mid;
        else hi = mid - 1;
      }

      const anchorEl = anchors[lo];
      const anchorLine = parseInt(anchorEl.dataset.sourceLine!);

      if (lo + 1 < anchors.length) {
        const nextEl = anchors[lo + 1];
        const nextLine = parseInt(nextEl.dataset.sourceLine!);
        const progress = nextLine > anchorLine
          ? (topLine - anchorLine) / (nextLine - anchorLine)
          : 0;
        const anchorTop = anchorEl.offsetTop;
        const nextTop = nextEl.offsetTop;
        previewDOM.scrollTop = anchorTop + (nextTop - anchorTop) * progress;
      } else {
        previewDOM.scrollTop = anchorEl.offsetTop;
      }
    }

    function handlePreviewScroll() {
      if (scrollSourceRef.current === 'editor') return;
      scrollSourceRef.current = 'preview';
      resetScrollSource();

      const view = editorRef.current?.getView();
      if (!view || !previewDOM) return;

      const scrollTop = previewDOM.scrollTop;
      const anchors = previewDOM.querySelectorAll<HTMLElement>('[data-source-line]');
      if (anchors.length === 0) return;

      let target: HTMLElement | null = null;
      for (const anchor of anchors) {
        if (anchor.offsetTop <= scrollTop + 10) target = anchor;
        else break;
      }
      if (!target) target = anchors[0];

      const targetLine = parseInt(target.dataset.sourceLine!);
      const lineCount = view.state.doc.lines;
      if (targetLine < 1 || targetLine > lineCount) return;

      const lineInfo = view.state.doc.line(targetLine);
      const block = view.lineBlockAt(lineInfo.from);
      scrollDOM!.scrollTop = block.top;
    }

    let editorRaf = 0;
    let previewRaf = 0;

    const onEditorScroll = () => {
      cancelAnimationFrame(editorRaf);
      editorRaf = requestAnimationFrame(handleEditorScroll);
    };
    const onPreviewScroll = () => {
      cancelAnimationFrame(previewRaf);
      previewRaf = requestAnimationFrame(handlePreviewScroll);
    };

    scrollDOM.addEventListener('scroll', onEditorScroll, { passive: true });
    previewDOM.addEventListener('scroll', onPreviewScroll, { passive: true });

    return () => {
      scrollDOM.removeEventListener('scroll', onEditorScroll);
      previewDOM.removeEventListener('scroll', onPreviewScroll);
      cancelAnimationFrame(editorRaf);
      cancelAnimationFrame(previewRaf);
      if (scrollResetTimer.current) clearTimeout(scrollResetTimer.current);
    };
  }, [viewMode, activeTab?.fileType, activeTabId]);

  const scrollToHeading = useCallback((headingText: string) => {
    const container = prevBodyRef.current;
    if (container) {
      const headingId = headingText.toLowerCase().replace(/\s+/g, '-').replace(/[^\w一-鿿-]/g, '');
      const target = container.querySelector(`#${CSS.escape(headingId)}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    const view = editorRef.current?.getView();
    if (!view) return;
    const doc = view.state.doc;
    for (let lineNum = 1; lineNum <= doc.lines; lineNum++) {
      const line = doc.line(lineNum);
      const headingMatch = line.text.match(/^(#{1,6})\s+(.*)/);
      if (headingMatch && headingMatch[2].trim() === headingText.trim()) {
        view.dispatch({
          effects: EditorView.scrollIntoView(line.from, { y: 'start' }),
        });
        break;
      }
    }
  }, []);

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
    setSlashMenu(state);
    if (state.visible) {
      const view = getView();
      if (view) {
        const coords = view.coordsAtPos(state.pos);
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

    view.dispatch({
      changes: { from: slashStart, to: menuState.pos, insert: plugin.template },
    });
    hideSlashMenu(view);
    view.focus();
  }, [getView, slashMenu]);

  const handleSlashClose = useCallback(() => {
    const view = getView();
    if (view) hideSlashMenu(view);
  }, [getView]);

  // Determine what to show
  const showCodeMirror = handler?.useCodeMirror && (viewMode === 'edit' || viewMode === 'split' || !handler.Preview);
  const showCustomEditor = handler?.Editor && !handler.useCodeMirror;
  const isPreviewOnly = handler?.Preview && !handler.useCodeMirror && !handler.Editor;
  const showPreview = handler?.Preview && (isPreviewOnly || viewMode === 'preview' || viewMode === 'split');
  const showSplitResizer = handler?.useCodeMirror && handler?.Preview && viewMode === 'split';

  return (
    <div className="work-area" ref={splitContainerRef}>
      {/* File tabs */}
      {tabs.length > 0 && (
        <div className="file-tabs">
          {tabs.map((tab) => {
            const tabHandler = getHandlerById(tab.fileType);
            return (
              <div
                key={tab.id}
                className={`ftab ${activeTabId === tab.id ? 'on' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.isDirty && <span className="ftab-dot" />}
                {tabHandler?.icon && <span className="ftab-icon">{tabHandler.icon}</span>}
                <span className="ftab-name">{tab.name}</span>
                <span
                  className="ftab-x"
                  onClick={(event) => {
                    event.stopPropagation();
                    closeTab(tab.id);
                  }}
                >
                  ✕
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Content area */}
      <div className="work-area-content">

      {/* CodeMirror editor pane */}
      {showCodeMirror && (
        <div className="pane-src" style={handler?.Preview && viewMode === 'split' ? { flex: editorFlex } : undefined}>
          <div className="ed-body">
            {isFileLoading && (
              <div className="ed-loading-overlay">
                <span className="ft-spinner" /> 加载文件中…
              </div>
            )}
            <QuillEditor
              key={`${activeTabId}-${showLineNumbers}-${settingsTabSize}-${wrapColumn}-${editorFont}-${editorFontSize}`}
              ref={editorRef}
              filePath={activeTab?.path ?? ''}
              initialContent={activeTab?.content ?? ''}
              initialCursorLine={activeTab?.cursorLine}
              initialCursorCol={activeTab?.cursorCol}
              onChange={(content) => {
                if (activeTab) updateTabContent(activeTab.id, content);
              }}
              onSave={() => {
                if (activeTab) markTabDirty(activeTab.id, false);
              }}
              onSlashMenuChange={handleSlashMenuChange}
              onCodeBlockMenuChange={handleCodeBlockMenuChange}
              onImagePaste={(file, previewUrl) => {
                setImagePasteFile(file);
                setImagePastePreviewUrl(previewUrl);
                setImagePasteVisible(true);
              }}
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
              onConfirm={async (config: ImageSaveConfig) => {
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
                    const encodedUrl = result.markdownUrl.split('/').map(encodeURIComponent).join('/');
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
              }}
              onCancel={() => {
                URL.revokeObjectURL(imagePastePreviewUrl);
                setImagePasteVisible(false);
                setImagePasteFile(null);
                setImagePastePreviewUrl('');
              }}
            />
          </div>
        </div>
      )}

      {/* Split resizer */}
      {showSplitResizer && (
        <div
          className="split-resizer"
          onMouseDown={() => {
            splitDragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.documentElement.classList.add('is-resizing');
          }}
        />
      )}

      {/* Custom editor (full area) — e.g. Excalidraw, Web */}
      {showCustomEditor && activeTab && handler?.Editor && (
        <div className={`editor-fullarea editor-${handler.id}`}>
          <handler.Editor
            key={`${activeTab.id}-${externalContentVersion}`}
            content={activeTab.content}
            tabId={activeTab.id}
            filePath={activeTab.path}
            onChange={(content) => updateTabContent(activeTab.id, content)}
            onSave={() => markTabDirty(activeTab.id, false)}
          />
        </div>
      )}

      {/* Preview pane */}
      {showPreview && activeTab && handler?.Preview && (
        <div className="pane-prev" style={{ ...(viewMode === 'split' ? { flex: previewFlex } : {}), position: 'relative' }}>
          {/* Outline toggle — markdown only */}
          {activeTab.fileType === 'markdown' && (
            <div className="prev-outline-toggle">
              <button
                className={`prev-outline-btn ${outlineVisible ? 'on' : ''}`}
                onClick={() => setOutlineVisible((v) => !v)}
                title="大纲"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
                  <line x1="2" y1="3.5" x2="14" y2="3.5" />
                  <line x1="4" y1="6.5" x2="14" y2="6.5" />
                  <line x1="4" y1="9.5" x2="14" y2="9.5" />
                  <line x1="2" y1="12.5" x2="14" y2="12.5" />
                </svg>
              </button>
            </div>
          )}
          <div className="prev-content-row">
            <div className="prev-body" ref={prevBodyRef}>
              <handler.Preview
                content={activeTab.content}
                filePath={activeTab.path}
                vaultRoot={vaultRoot}
              />
            </div>
            {activeTab.fileType === 'markdown' && outlineVisible && (
              <div className="prev-outline" style={{ width: `${outlineWidth}px` }}>
                <div
                  className="prev-outline-resizer"
                  onMouseDown={() => {
                    outlineDragging.current = true;
                    document.body.style.cursor = 'col-resize';
                    document.body.style.userSelect = 'none';
                  }}
                />
                <div className="prev-outline-header">大纲</div>
                <div className="prev-outline-body">
                  {(() => {
                    const headings = extractHeadings(activeTab?.content ?? '');
                    if (headings.length === 0) {
                      return <p className="prev-outline-empty">暂无标题</p>;
                    }
                    return headings.map((heading, index) => (
                      <div
                        key={index}
                        className="prev-outline-item"
                        style={{ paddingLeft: `${8 + (heading.level - 1) * 12}px` }}
                        title={`Ln ${heading.line}`}
                        onClick={() => scrollToHeading(heading.text)}
                      >
                        {heading.text}
                      </div>
                    ));
                  })()}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      </div>{/* end .work-area-content */}
    </div>
  );
}
