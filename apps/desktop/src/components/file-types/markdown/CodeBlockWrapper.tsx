import { useMemo, useRef, useEffect, useCallback, useState } from 'react';
import { Code2, Eye, Maximize2, ChevronsUp, ChevronsDown } from 'lucide-react';
import { FocusViewShell } from './FocusViewShell';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { isShortcutCandidate } from '@/utils/iframeShortcuts';
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

/** Blocks at/above this many lines get a collapse affordance in the header. */
const COLLAPSE_MIN_LINES = 10;

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
 *  code (default); preview renders the HTML in a sandboxed iframe.
 *
 *  Reading controls (user control over long code): collapse for long blocks,
 *  focus view (portal overlay, big type). Code renders in full — no height
 *  cap, no inner vertical scrolling; the block scrolls with the page.
 *  （用户拍板：折叠按钮保留；无行数标注、无换行切换。） */
export function CodeBlockWrapper({ children, node, lang, sourceLine, content, onChange, ...rest }: CodeBlockWrapperProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const lineRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [lineCount, setLineCount] = useState(0);
  const isHtml = lang === 'html';
  const [htmlView, setHtmlView] = useState<'source' | 'preview'>('source');
  const [htmlSrc, setHtmlSrc] = useState('');

  // Reading controls.
  const [collapsed, setCollapsed] = useState(false);
  const [focused, setFocused] = useState(false);

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

  // Esc closes the focus overlay (window-level: focus may sit on the overlay
  // shell, not an interactive child).
  useEffect(() => {
    if (!focused) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setFocused(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [focused]);

  // Sync line-number column scroll with code scroll so they stay aligned.
  const handleScroll = useCallback(() => {
    if (lineRef.current && scrollRef.current) {
      lineRef.current.scrollTop = scrollRef.current.scrollTop;
    }
  }, []);

  // ponytail: reads text from the in-page <pre> DOM, falling back to the
  // React children — the pre is display:none while collapsed, and absent in
  // html preview mode; textContent survives both. The button that triggered
  // the copy (event currentTarget) gets the check feedback.
  const handleCopy = useCallback((e?: React.MouseEvent<HTMLButtonElement>) => {
    const codeEl = preRef.current?.querySelector('code');
    const text = codeEl?.textContent ?? preRef.current?.textContent ?? extractTextContent(children);
    const btn = e?.currentTarget;
    if (!btn || !text) return;
    navigator.clipboard.writeText(text).then(() => {
      btn.innerHTML = CHECK_SVG;
      btn.classList.add('copied');
      setTimeout(() => {
        btn.innerHTML = COPY_SVG;
        btn.classList.remove('copied');
      }, 1500);
    });
  }, [children]);

  const handleRun = useCallback(async () => {
    if (!runtime || running || !content || sourceLine == null) return;
    const codeEl = preRef.current?.querySelector('code');
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
  // Fenced blocks with a language get a header row (label + actions). The
  // empty-html sliver keeps its centred toggles and no header.
  const hasHeader = !!lang && !isEmptyHtml;
  // Focus reads the source <pre> (children); html preview mode has no pre.
  const canFocus = !isEmptyHtml && (!isHtml || htmlView === 'source');

  const collapseBtn = lineCount >= COLLAPSE_MIN_LINES && (
    <button
      className="code-act-btn"
      type="button"
      title={collapsed ? `展开（${lineCount} 行）` : '折叠'}
      aria-label="toggle collapse"
      onClick={() => setCollapsed((c) => !c)}
    >
      {collapsed ? <ChevronsDown size={13} /> : <ChevronsUp size={13} />}
    </button>
  );
  const focusBtn = canFocus && (
    <button
      className="code-act-btn"
      type="button"
      title="专注查看"
      aria-label="focus view"
      onClick={() => setFocused(true)}
    >
      <Maximize2 size={13} />
    </button>
  );
  const copyBtn = !isEmptyHtml && (
    <button
      className="code-act-btn code-copy-btn"
      type="button"
      title="复制"
      aria-label="copy code"
      onClick={handleCopy}
      dangerouslySetInnerHTML={{ __html: COPY_SVG }}
    />
  );
  const htmlToggle = isHtml && (
    <div className={isEmptyHtml
      ? 'absolute top-1/2 right-2 -translate-y-1/2 flex items-center gap-1 z-3'
      : 'flex items-center gap-0.5'}>
      <button
        type="button"
        aria-label="source"
        title="Source"
        onClick={() => setHtmlView('source')}
        className={`code-act-btn${htmlView === 'source' ? ' is-on' : ''}`}
      >
        <Code2 size={13} />
      </button>
      <button
        type="button"
        aria-label="preview"
        title="Preview"
        onClick={() => setHtmlView('preview')}
        className={`code-act-btn${htmlView === 'preview' ? ' is-on' : ''}`}
      >
        <Eye size={13} />
      </button>
    </div>
  );
  const runBtn = runtime && (
    <button
      className="code-act-btn code-run-btn"
      type="button"
      title={running ? 'Stop' : 'Run'}
      onClick={running ? handleStop : handleRun}
      style={{ color: running || stopped ? STOP_COLOR : RUN_COLOR }}
      dangerouslySetInnerHTML={{ __html: running ? SPINNER_SVG : (stopped ? STOP_SVG : RUN_SVG) }}
    />
  );

  // the grid must see capped code blocks: rootEl.children counts only data-source-line
  return (
    <div
      className={`code-block-wrapper${isHtml && htmlView === 'preview' && !isEmptyHtml ? ' code-block-wrapper--no-height-cap' : ''}${isEmptyHtml ? ' code-block-wrapper--empty-html' : ''}${collapsed ? ' code-block-wrapper--collapsed' : ''}`}
      data-source-line={sourceLine}
    >
      {hasHeader && (
        <div className="code-block-header">
          <span className="code-block-lang">{lang}</span>
          <div className="code-block-actions">
            {htmlToggle}
            {runBtn}
            {collapseBtn}
            {focusBtn}
            {copyBtn}
          </div>
        </div>
      )}
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
              // Keys pressed inside this iframe never reach the app's
              // shortcut handler. This code runs in the app (same-origin
              // iframe), so replay shortcut candidates on the app document.
              // (No file drag forwarding needed: OS-originated drags are
              // consumed by Tauri's native drag-drop handler at the AppKit
              // level before WebKit sees them, so the window-level
              // useOsFileDragDrop gets every drop regardless of which
              // iframe is under the cursor.)
              doc.addEventListener('keydown', (ev) => {
                if (!isShortcutCandidate(ev)) return;
                const { key, code, metaKey, ctrlKey, altKey, shiftKey } = ev;
                document.dispatchEvent(new KeyboardEvent('keydown', { key, code, metaKey, ctrlKey, altKey, shiftKey, bubbles: true, cancelable: true }));
              }, true);
            } catch { /* cross-origin — leave default height */ }
          }}
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
      {/* Focus view (专注查看): shared FocusViewShell portal overlay, big type,
          own scroll. Esc/backdrop click close (shell); the shell gates on
          PreviewActiveContext so a hidden pane's overlay doesn't leak across
          tab switches. */}
      {focused && (
        <FocusViewShell
          title={lang ?? 'code'}
          onClose={() => setFocused(false)}
          ariaLabel="专注查看代码"
          actions={<>{copyBtn}</>}
        >
          <pre>{children}</pre>
        </FocusViewShell>
      )}
    </div>
  );
}
