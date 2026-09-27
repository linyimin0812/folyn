import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Code2, Eye } from 'lucide-react';
import { useAiConfigStore } from '@/store/aiConfigStore';
import {
  formatResultBlock,
  mapLanguageToRuntime,
  replaceOrAppendResultBlock,
  runScript,
} from '@/services/scriptRunner/scriptRunnerService';

/** Recursively extract plain text from React children */
export function extractTextContent(children: any): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractTextContent).join('');
  if (children?.props?.children) return extractTextContent(children.props.children);
  return '';
}

/** Copy button SVG icons */
const COPY_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
const CHECK_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';

// Run / Stop button SVGs. Colors are spec'd: play = #59A869, pause = #C7222D.
const RUN_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M7 5v14l12-7z"/></svg>';
const STOP_SVG = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none"><rect x="6" y="6" width="12" height="12" rx="1"/></svg>';
// ponytail: lucide loader — shown while running (replaces the static pause icon).
const SPINNER_SVG = '<svg class="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M21 12a9 9 0 1 1-6.219-8.56" /></svg>';
// ponytail: lucide send — sync result to editor.
const SYNC_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-2-9-9-2Z"/><path d="M22 2 11 13"/></svg>';
const RUN_COLOR = '#59A869';
const STOP_COLOR = '#C7222D';

interface CodeBlockWrapperProps {
  children?: React.ReactNode;
  node?: any;
  lang?: string;
  sourceLine?: number;
  content?: string;
  onChange?: (content: string) => void;
  [key: string]: any;
}

/** Code block wrapper component — renders line numbers + copy button via React.
 *  Also renders a Run/Stop button when the fence language maps to a configured
 *  script runtime. Run output streams into a panel below the code block.
 *  For ```html fences, also renders a source/preview toggle: source shows the
 *  code (default); preview renders the HTML in a sandboxed iframe. */
export function CodeBlockWrapper({ children, node, lang, sourceLine, content, onChange, ...rest }: CodeBlockWrapperProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lineCount, setLineCount] = useState(0);
  const isHtml = lang === 'html';
  const [htmlView, setHtmlView] = useState<'source' | 'preview'>('source');
  const [htmlSrc, setHtmlSrc] = useState('');

  const runtimes = useAiConfigStore((s) => s.scriptRuntimes);
  const runtime = useMemo(
    () => mapLanguageToRuntime(lang, runtimes),
    [lang, runtimes],
  );

  const [running, setRunning] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [stdout, setStdout] = useState('');
  const [stderr, setStderr] = useState('');
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [pendingResult, setPendingResult] = useState<string | null>(null);
  const [synced, setSynced] = useState(false);
  const runningRef = useRef<{ stop: () => Promise<void> } | null>(null);

  useEffect(() => {
    // ponytail: read text from React children, not preRef.current — when the
    // html block is empty we render the placeholder (no <pre>), so preRef is
    // null and the DOM read would early-return, locking lineCount at 0 even
    // after the user adds content.
    const text = extractTextContent(children);
    const lines = text.split('\n');
    while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    setLineCount(lines.length);
    if (isHtml) setHtmlSrc(text);
  }, [children, isHtml]);

  // Reset output panel when the code block content changes (e.g. user edits).
  useEffect(() => {
    setStdout('');
    setStderr('');
    setExitCode(null);
    setStopped(false);
    setPendingResult(null);
    setSynced(false);
  }, [lineCount]);

  // Sync line-number column scroll with code scroll so they stay aligned.
  const handleScroll = useCallback(() => {
    if (lineRef.current && scrollRef.current) {
      lineRef.current.scrollTop = scrollRef.current.scrollTop;
    }
  }, []);
  const handleCopy = useCallback(() => {
    const codeEl = preRef.current?.querySelector('code');
    const text = codeEl?.textContent ?? preRef.current?.textContent ?? '';
    const btn = copyBtnRef.current;
    if (!btn) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = CHECK_SVG;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = COPY_SVG;
        btn.classList.remove('copied');
      }, 1500);
    });
  }, []);

  const handleRun = useCallback(async () => {
    if (!runtime || running || !preRef.current || !content || sourceLine == null) return;
    const codeEl = preRef.current.querySelector('code');
    const code = codeEl?.textContent ?? preRef.current?.textContent ?? '';
    setRunning(true);
    setStopped(false);
    setStdout('');
    setStderr('');
    setExitCode(null);
    setPendingResult(null);
    setSynced(false);
    let outBuf = '';
    let errBuf = '';
    try {
      const controller = await runScript(runtime, code, {
        onStdout: (line) => {
          outBuf += line;
          setStdout(outBuf);
        },
        onStderr: (line) => {
          errBuf += line;
          setStderr(errBuf);
        },
        onClose: (code) => {
          setExitCode(code);
          setRunning(false);
          runningRef.current = null;
          // Stash the formatted result block; user syncs to editor explicitly.
          const block = formatResultBlock(outBuf, errBuf, code, false);
          setPendingResult(block);
        },
      });
      runningRef.current = controller;
    } catch (err) {
      setRunning(false);
      setStderr((s) => s + `\n[error: ${String(err)}]`);
    }
  }, [runtime, running, content, sourceLine, onChange]);

  const handleStop = useCallback(async () => {
    await runningRef.current?.stop();
    setRunning(false);
    setStopped(true);
    runningRef.current = null;
    const block = formatResultBlock(stdout, stderr, exitCode, true);
    setPendingResult(block);
  }, [stdout, stderr, exitCode]);

  const handleSync = useCallback(() => {
    if (!pendingResult || !content || sourceLine == null || !onChange) return;
    const next = replaceOrAppendResultBlock(content, sourceLine, pendingResult);
    if (next !== content) onChange(next);
    setSynced(true);
    setTimeout(() => setSynced(false), 1500);
  }, [pendingResult, content, sourceLine, onChange]);

  const hasOutput = stdout !== '' || stderr !== '' || exitCode !== null || stopped;
  // ponytail: empty ```html block renders as a short sliver with the toggle
  // crammed into top-right. Give it real height + right-side centered icons.
  // Applies in both source and preview views so toggling doesn't resize.
  const isEmptyHtml = isHtml && lineCount === 0;

  // the grid must see capped code blocks: rootEl.children counts only data-source-line
  return (
    <div className={`code-block-wrapper${isHtml && htmlView === 'preview' && !isEmptyHtml ? ' code-block-wrapper--no-height-cap' : ''}${isEmptyHtml ? ' code-block-wrapper--empty-html' : ''}`} data-source-line={sourceLine}>
      {isEmptyHtml ? (
        <div className="code-block-empty-html" />
      ) : htmlView === 'source' || !isHtml ? (
        <div className="code-block-inner">
          <div className="code-line-numbers" ref={lineRef} aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <span className="code-ln" key={i}>{i + 1}</span>
            ))}
          </div>
          <div className="code-block-scroll" ref={scrollRef} onScroll={handleScroll}>
            <pre ref={preRef} {...rest}>{children}</pre>
          </div>
        </div>
      ) : (
        <iframe
          title="html-preview"
          sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
          srcDoc={htmlSrc}
          className="w-full border-0"
          style={{ background: '#fff', height: '160px' }}
          onLoad={(e) => {
            // ponytail: reset iframe body margin + hide its internal scroll so
            // scrollHeight reflects true content size. ResizeObserver catches
            // late layout (images, scripts). allow-same-origin is required to
            // read contentDocument; combined with allow-scripts the iframe is
            // same-origin to itself, not the host — still sandboxed.
            //
            // Feedback-loop break: set iframe height to 0 before measuring,
            // otherwise scrollHeight returns max(content, current height) and
            // stale blank space persists.
            try {
              const iframe = e.target as HTMLIFrameElement;
              const doc = iframe.contentDocument;
              if (!doc) return;
              const style = doc.createElement('style');
              style.textContent = 'html, body { margin: 0 !important; padding: 0 !important; overflow: hidden !important; height: auto !important; min-height: 0 !important; }';
              doc.head.appendChild(style);
              const resize = () => {
                iframe.style.height = '0px';
                void doc.body.offsetHeight; // force reflow
                const h = doc.body.scrollHeight;
                if (h > 0) iframe.style.height = `${h}px`;
              };
              resize();
              new ResizeObserver(resize).observe(doc.body);
              // ponytail: the preview iframe is a separate document — file
              // drag/drop events do NOT bubble to the parent window, so
              // WKWebView's default drop navigates the iframe to the file
              // (raw file content replaces the preview). preventDefault here
              // and forward the WebKit `.path` to the parent, which routes
              // through the same openFile path as a window-level drop (new
              // tab, or activate-if-already-open — the user's "detect if
              // already open" expectation is handled by openFile's existing
              // dedup on `ext:<path>` tab id).
              const fwdDragOver = (ev: Event) => {
                const de = ev as DragEvent;
                if (!de.dataTransfer?.types?.includes('Files')) return;
                de.preventDefault();
                de.dataTransfer.dropEffect = 'copy';
                window.parent?.postMessage({ type: 'folyn:file-drag-active' }, '*');
              };
              const fwdDrop = (ev: Event) => {
                const de = ev as DragEvent;
                if (!de.dataTransfer?.types?.includes('Files')) return;
                de.preventDefault();
                // Forward the File OBJECTS (not .path) — a sandboxed iframe
                // without allow-same-origin is cross-origin, and WKWebView
                // hides the private File.path from cross-origin documents, so
                // reading .path here yields undefined and drops were silently
                // lost. File objects survive postMessage's structured clone
                // (name/size/type/content intact); the parent's
                // openDroppedFiles handles path/staging per-platform.
                const files = de.dataTransfer.files;
                const arr: File[] = [];
                if (files) for (let i = 0; i < files.length; i++) arr.push(files[i]);
                if (arr.length > 0) {
                  window.parent?.postMessage({ type: 'folyn:open-dropped-files', files: arr }, '*');
                }
              };
              doc.addEventListener('dragover', fwdDragOver);
              doc.addEventListener('drop', fwdDrop);
            } catch { /* cross-origin — leave default height */ }
          }}
        />
      )}
      {!isEmptyHtml && (
        <button
          ref={copyBtnRef}
          className="code-copy-btn"
          type="button"
          onClick={handleCopy}
          dangerouslySetInnerHTML={{ __html: COPY_SVG }}
        />
      )}
      {isHtml && (
        <div className={isEmptyHtml
          ? 'absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1 z-3'
          : 'absolute top-1 right-8 flex items-center gap-0.5 z-3'}>
          <button
            type="button"
            aria-label="source"
            title="Source"
            onClick={() => setHtmlView('source')}
            className={`w-[22px] h-[22px] flex items-center justify-center rounded-[3px] cursor-pointer border-none transition-colors ${htmlView === 'source' ? 'text-t1 bg-hov' : 'text-t3 hover:text-t1 hover:bg-hov'}`}
          >
            <Code2 size={13} />
          </button>
          <button
            type="button"
            aria-label="preview"
            title="Preview"
            onClick={() => setHtmlView('preview')}
            className={`w-[22px] h-[22px] flex items-center justify-center rounded-[3px] cursor-pointer border-none transition-colors ${htmlView === 'preview' ? 'text-t1 bg-hov' : 'text-t3 hover:text-t1 hover:bg-hov'}`}
          >
            <Eye size={13} />
          </button>
        </div>
      )}
      {runtime && (
        <button
          className="code-run-btn"
          type="button"
          title={running ? 'Stop' : 'Run'}
          onClick={running ? handleStop : handleRun}
          style={{ color: running || stopped ? STOP_COLOR : RUN_COLOR }}
          dangerouslySetInnerHTML={{ __html: running ? SPINNER_SVG : (stopped ? STOP_SVG : RUN_SVG) }}
        />
      )}
      {runtime && hasOutput && (
        <div className="code-run-output">
          {/* ponytail: only the stdout/stderr body scrolls; the sync icon +
              status row stay pinned at the .code-run-output level (not the
              scroll container), so the "sync to editor" icon stays fixed at
              the top-right while long output scrolls under it. */}
          <div className="code-run-output-body">
            {stdout && <pre className="code-run-stdout">{stdout}</pre>}
            {stderr && <pre className="code-run-stderr">{stderr}</pre>}
          </div>
          <div className="code-run-status">
            {stopped ? '[stopped]' : exitCode !== null ? `[exit ${exitCode}]` : null}
          </div>
          {!running && pendingResult && onChange && (
            <button
              className="code-sync-btn"
              type="button"
              title="Sync to editor"
              onClick={handleSync}
              dangerouslySetInnerHTML={{ __html: synced ? CHECK_SVG : SYNC_SVG }}
            />
          )}
        </div>
      )}
    </div>
  );
}
