import { useRef, useState, useCallback, useEffect } from 'react';
import { useEditorStore } from '@/store/editorStore';
import { useSettingsStore } from '@/store/settingsStore';
import { useVaultStore } from '@/store/vaultStore';
import { QuillEditor, type QuillEditorHandle } from '@/editor/EditorView';
import { MarkdownPreview } from '../preview/MarkdownPreview';
import { SlashMenu } from '../editor/SlashMenu';
import { CodeBlockLangMenu } from '../editor/CodeBlockLangMenu';
import { ImagePasteDialog, type ImageSaveConfig } from '../editor/ImagePasteDialog';
import { hideSlashMenu, type SlashMenuState } from '@/editor/extensions/SlashCommandPlugin';
import { type CodeBlockMenuState } from '@/editor/extensions/CodeBlockExtension';
import { getStrategy, fileToBase64, convertImageFormat } from '@/utils/imageUploader';
import { isTauri } from '@/utils/platform';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { ContainerPlugin } from '@quill/container-plugins';
import { EditorView } from '@codemirror/view';

type WebviewErrorCode = 'dns' | 'refused' | 'timeout' | 'http' | 'invalid_url' | 'blocked' | 'unknown';
type WebviewError = { code: WebviewErrorCode; status?: number };
type WebviewTabStatus = 'loading' | 'ready' | { error: WebviewError };

function ImageFromVault({ path, vaultRoot, alt }: { path: string; vaultRoot: string; alt: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    import('@tauri-apps/api/path').then(({ homeDir, join }) => {
      const resolvedRoot = vaultRoot.startsWith('~')
        ? homeDir().then((h) => join(h, vaultRoot.slice(2)))
        : Promise.resolve(vaultRoot);
      resolvedRoot.then((root) => join(root, path)).then((absPath) => {
        setSrc(convertFileSrc(absPath));
      });
    });
  }, [path, vaultRoot]);
  if (!src) return null;
  return <img src={src} alt={alt} />;
}

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
  const activeTabId = useEditorStore((state) => state.activeTabId);
  const tabs = useEditorStore((state) => state.tabs);
  const setActiveTab = useEditorStore((state) => state.setActiveTab);
  const closeTab = useEditorStore((state) => state.closeTab);
  const updateTabContent = useEditorStore((state) => state.updateTabContent);
  const markTabDirty = useEditorStore((state) => state.markTabDirty);
  const isFileLoading = useEditorStore((state) => state.isFileLoading);
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

  // Web viewer: embedded Tauri Webview management
  const webViewerRef = useRef<HTMLDivElement>(null);
  // Store webview labels (strings) — webviews are created/managed via Rust commands
  const webviewLabels = useRef<Map<string, string>>(new Map());
  // per-tab webview state
  const [webviewStatus, setWebviewStatus] = useState<Record<string, WebviewTabStatus>>({});

  // Sync a webview's position/size to match the web-viewer-body container via Rust command
  const syncWebviewPosition = useCallback(async (webviewLabel: string) => {
    const container = webViewerRef.current;
    if (!container || !webviewLabel) return;
    try {
      const rect = container.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('set_webview_position', {
        label: webviewLabel,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    } catch {}
  }, []);

  // Create / destroy / show-hide embedded webviews based on active tab
  useEffect(() => {
    if (!isTauri()) return;
    const isWebTab = activeTab?.fileType === 'web';
    const tabId = activeTab?.id;
    const url = activeTab?.path;

    // Hide all webviews that are not the active one
    (async () => {
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        for (const [id, wvLabel] of webviewLabels.current.entries()) {
          if (id !== tabId) {
            try {
              await invoke('set_webview_position', {
                label: wvLabel, x: -10000, y: -10000, width: 1, height: 1,
              });
            } catch {}
          }
        }
      } catch {}
    })();

    if (!isWebTab || !tabId || !url) return;

    const existingLabel = webviewLabels.current.get(tabId);
    if (existingLabel) {
      requestAnimationFrame(() => syncWebviewPosition(existingLabel));
      return;
    }

    // Mark as loading for this tab
    setWebviewStatus((prev) => ({ ...prev, [tabId]: 'loading' }));

    // Create new webview — delay to ensure the container is visible and has layout
    const createTimer = setTimeout(async () => {
      // ── Validate URL format ──────────────────────────────────────────────
      try {
        const parsed = new URL(url);
        if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('bad protocol');
      } catch {
        setWebviewStatus((prev) => ({ ...prev, [tabId]: { error: { code: 'invalid_url' } } }));
        return;
      }

      // ── Step 2: Network pre-check via curl (no CORS restrictions) ──────
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const result = await invoke<{ reachable: boolean; error: string }>('check_url', { url });
        if (!result.reachable) {
          setWebviewStatus((prev) => ({ ...prev, [tabId]: { error: { code: 'unknown' } } }));
          return;
        }
      } catch (invokeErr) {
        console.warn('[WorkArea] check_url failed, proceeding anyway:', invokeErr);
      }

      // ── Step 3: Create native Webview via Rust command ───────────────────
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const container = webViewerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return;
        const label = `wv-${Date.now()}`;
        const userAgent = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';

        await invoke('create_webview', {
          label,
          url,
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          userAgent,
        });

        webviewLabels.current.set(tabId, label);
        setWebviewStatus((prev) => ({ ...prev, [tabId]: 'ready' }));
      } catch (error) {
        console.error('[WorkArea] Failed to create embedded webview:', error);
        setWebviewStatus((prev) => ({ ...prev, [tabId]: { error: { code: 'unknown' } } }));
      }
    }, 150);

    return () => clearTimeout(createTimer);
  }, [activeTab?.id, activeTab?.fileType, activeTab?.path, syncWebviewPosition]);

  // ResizeObserver to keep webview in sync with container
  useEffect(() => {
    if (!isTauri()) return;
    const container = webViewerRef.current;
    if (!container) return;
    const observer = new ResizeObserver(() => {
      if (activeTab?.fileType !== 'web' || !activeTab?.id) return;
      const wvLabel = webviewLabels.current.get(activeTab.id);
      if (wvLabel) syncWebviewPosition(wvLabel);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [activeTab?.id, activeTab?.fileType, syncWebviewPosition]);

  // Clean up webviews when tabs are closed
  useEffect(() => {
    const openTabIds = new Set(tabs.filter((t) => t.fileType === 'web').map((t) => t.id));
    for (const [id, wvLabel] of webviewLabels.current.entries()) {
      if (!openTabIds.has(id)) {
        import('@tauri-apps/api/core').then(({ invoke }) => {
          invoke('close_webview', { label: wvLabel }).catch(() => {});
        });
        webviewLabels.current.delete(id);
        setWebviewStatus((prev) => {
          const next = { ...prev };
          delete next[id];
          return next;
        });
      }
    }
  }, [tabs]);

  // Clean up all webviews when WorkArea unmounts (e.g. switching to settings page)
  useEffect(() => {
    const labels = webviewLabels.current;
    return () => {
      import('@tauri-apps/api/core').then(({ invoke }) => {
        for (const [, wvLabel] of labels.entries()) {
          invoke('close_webview', { label: wvLabel }).catch(() => {});
        }
      });
      labels.clear();
    };
  }, []);

  // Listen for webview URL changes and update the corresponding tab
  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | null = null;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen<{ label: string; url: string; title: string }>('webview-url-changed', (event) => {
        const { label, url, title } = event.payload;
        // Find the tab id that corresponds to this webview label
        for (const [tabId, wvLabel] of webviewLabels.current.entries()) {
          if (wvLabel === label) {
            useEditorStore.getState().updateWebTabUrl(tabId, url, title);
            break;
          }
        }
      }).then((fn) => { unlisten = fn; });
    });
    return () => { unlisten?.(); };
  }, []);

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
        document.body.style.userSelect = '';
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

  // ── Synchronized scrolling between editor and preview (split mode) ──
  const scrollSourceRef = useRef<'editor' | 'preview' | null>(null);
  const scrollResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (viewMode !== 'split' || activeTab?.fileType !== 'text') return;

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
    // Scroll preview pane to the heading
    const container = prevBodyRef.current;
    if (container) {
      const headingId = headingText.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '');
      const target = container.querySelector(`#${CSS.escape(headingId)}`);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    // Scroll editor to the corresponding heading line
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
      // Defer position calculation to next frame to ensure view is fully updated
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
        } catch {
          // Position may be invalid during rapid edits, ignore
        }
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


  return (
    <div className="work-area" ref={splitContainerRef}>
      {/* File tabs — always visible as a standalone bar */}
      {tabs.length > 0 && (
        <div className="file-tabs">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`ftab ${activeTabId === tab.id ? 'on' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.isDirty && <span className="ftab-dot" />}
              {tab.fileType === 'web' && <span className="ftab-icon">🌐</span>}
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
          ))}
        </div>
      )}

      {/* Content area: editor + resizer + preview / image viewer */}
      <div className="work-area-content">

      {/* Editor pane (CodeMirror) */}
      {activeTab?.fileType !== 'image' && activeTab?.fileType !== 'web' && (activeTab?.fileType === 'code' || viewMode === 'split' || viewMode === 'edit') && (
        <div className="pane-src" style={activeTab?.fileType === 'text' && viewMode === 'split' ? { flex: editorFlex } : undefined}>
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
            {/* Slash command menu */}
            <SlashMenu
              visible={slashMenu.visible}
              filter={slashMenu.filter}
              position={slashMenuPosition}
              onSelect={handleSlashSelect}
              onClose={handleSlashClose}
            />
            {/* Code block language picker */}
            <CodeBlockLangMenu
              visible={codeBlockMenu.visible}
              menuState={codeBlockMenu}
              position={codeBlockMenuPosition}
              getView={getView}
            />
            {/* Image paste dialog */}
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
                  const result = await strategy.upload(base64, config, vaultRoot);
                  // Insert markdown image at cursor
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

      {/* Split resizer — only for markdown files */}
      {activeTab?.fileType === 'text' && viewMode === 'split' && (
        <div
          className="split-resizer"
          onMouseDown={() => {
            splitDragging.current = true;
            document.body.style.cursor = 'col-resize';
            document.body.style.userSelect = 'none';
          }}
        />
      )}

      {/* Image viewer — full area when active tab is an image */}
      {activeTab?.fileType === 'image' && (
        <div className="image-viewer">
          <div className="image-viewer-inner">
            <ImageFromVault path={activeTab.path} vaultRoot={vaultRoot} alt={activeTab.name} />
            <div className="image-viewer-info">
              <span>📄 {activeTab.path}</span>
            </div>
          </div>
        </div>
      )}


      {/* Web viewer — embedded Tauri Webview placeholder */}
      <div
        className="web-viewer-container"
        style={{ display: activeTab?.fileType === 'web' ? 'flex' : 'none' }}
      >
        <div className="web-viewer-bar">
          {/* Back / Forward navigation */}
          {isTauri() && activeTab?.id && webviewLabels.current.get(activeTab.id) && (
            <>
              <button
                className="web-viewer-nav-btn"
                title="后退"
                onClick={() => {
                  const label = webviewLabels.current.get(activeTab.id!);
                  if (!label) return;
                  import('@tauri-apps/api/core').then(({ invoke }) => {
                    invoke('navigate_webview', { label, action: 'back' }).catch(() => {});
                  });
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              <button
                className="web-viewer-nav-btn"
                title="前进"
                onClick={() => {
                  const label = webviewLabels.current.get(activeTab.id!);
                  if (!label) return;
                  import('@tauri-apps/api/core').then(({ invoke }) => {
                    invoke('navigate_webview', { label, action: 'forward' }).catch(() => {});
                  });
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </>
          )}
          <span className="web-viewer-url" title={activeTab?.path}>🌐 {activeTab?.fileType === 'web' ? activeTab.path : ''}</span>
          <button
            className="web-viewer-open-btn"
            title="在外部浏览器打开"
            onClick={() => {
              if (!activeTab?.path) return;
              if (isTauri()) {
                import('@tauri-apps/plugin-shell').then(({ open }) => {
                  open(activeTab.path);
                });
              } else {
                window.open(activeTab.path, '_blank', 'noopener,noreferrer');
              }
            }}
          >
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
              <path d="M9 2h5v5" />
              <line x1="14" y1="2" x2="7" y2="9" />
            </svg>
          </button>
        </div>

        {/* Loading overlay */}
        {activeTab?.id && webviewStatus[activeTab.id] === 'loading' && (
          <div className="web-viewer-status">
            <div className="web-viewer-spinner" />
            <span>正在连接…</span>
          </div>
        )}

        {/* Error overlay */}
        {activeTab?.id && typeof webviewStatus[activeTab.id] === 'object' && (() => {
          const s = webviewStatus[activeTab.id] as { error: WebviewError };
          const { code, status } = s.error;
          const host = (() => { try { return new URL(activeTab.path).hostname; } catch { return activeTab.path; } })();
          const info: { title: string; desc: string; detail?: string } =
            code === 'invalid_url' ? {
              title: '无效的网址',
              desc: `"${activeTab.path}" 不是一个有效的网址，请检查拼写是否正确。`,
            } : code === 'blocked' ? {
              title: '网站拒绝了嵌入显示',
              desc: `${host} 不允许在应用内打开。`,
              detail: '该网站设置了安全策略，禁止被其他程序嵌入显示。请在外部浏览器中访问。',
            } : code === 'dns' ? {
              title: '找不到该网站',
              desc: `无法解析 ${host} 的地址。`,
              detail: '请检查网址是否有拼写错误，或者该网站可能已不存在。',
            } : code === 'refused' ? {
              title: '连接被拒绝',
              desc: `${host} 拒绝了连接请求。`,
              detail: '该网站可能暂时停止服务，或者服务器配置了访问限制。',
            } : code === 'timeout' ? {
              title: '连接超时',
              desc: `连接 ${host} 超时，服务器没有响应。`,
              detail: '请检查网络连接是否正常，或稍后再试。',
            } : code === 'http' ? {
              title: `请求失败（${status}）`,
              desc: status === 404 ? `找不到页面：${host} 上不存在该内容。`
                : status === 403 ? `访问被拒绝：无权限访问 ${host}。`
                : status === 500 ? `服务器内部错误：${host} 出了点问题。`
                : `服务器返回了错误状态 ${status}。`,
            } : {
              title: '页面无法打开',
              desc: '加载页面时发生了未知错误。',
            };
          return (
            <div className="web-viewer-status web-viewer-error">
              <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.2" className="web-viewer-error-icon">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 1 0 20M12 2a14.5 14.5 0 0 0 0 20M2 12h20" />
                <line x1="4.5" y1="4.5" x2="19.5" y2="19.5" strokeWidth="1.8" stroke="#e05252" />
              </svg>
              <p className="web-viewer-error-title">{info.title}</p>
              <p className="web-viewer-error-desc">{info.desc}</p>
              {info.detail && <p className="web-viewer-error-detail">{info.detail}</p>}
              <div className="web-viewer-error-url">{activeTab.path}</div>
              <button
                className="web-viewer-error-btn"
                onClick={() => {
                  if (!activeTab?.path) return;
                  if (isTauri()) {
                    import('@tauri-apps/plugin-shell').then(({ open }) => { open(activeTab.path); });
                  } else {
                    window.open(activeTab.path, '_blank', 'noopener,noreferrer');
                  }
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M12 9v4a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h4" />
                  <path d="M9 2h5v5" />
                  <line x1="14" y1="2" x2="7" y2="9" />
                </svg>
                在外部浏览器打开
              </button>
            </div>
          );
        })()}

        <div ref={webViewerRef} className="web-viewer-body" />
      </div>

      {/* Preview pane — only for markdown files */}
      {activeTab?.fileType === 'text' && (viewMode === 'split' || viewMode === 'preview') && (
        <div className="pane-prev" style={{ ...(viewMode === 'split' ? { flex: previewFlex } : {}), position: 'relative' }}>
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
          <div className="prev-content-row">
            <div className="prev-body" ref={prevBodyRef}>
              <MarkdownPreview content={activeTab?.content ?? ''} currentFilePath={activeTab?.path ?? ''} vaultRoot={vaultRoot} />
            </div>
            {outlineVisible && (
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
