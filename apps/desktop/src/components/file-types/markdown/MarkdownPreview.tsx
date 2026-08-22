import { useMemo, useRef, useEffect, useCallback, useState, createElement, Fragment } from 'react';
import { Code2, Eye } from 'lucide-react';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkMath from 'remark-math';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import remarkDirective from 'remark-directive';
import remarkDirectiveRehype from 'remark-directive-rehype';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeHighlight from 'rehype-highlight';
import rehypeMathjax from 'rehype-mathjax';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { transformMathBrackets, unwrapInlineMath } from '@/services/markdown/renderMarkdown';
import { rehypeSourceLine } from './rehypeSourceLine';
import { ContainerRegistry, registerBuiltinPlugins, VaultContext } from '@quill/container-plugins';
import type { ContainerProps } from '@quill/container-plugins';
import { registerBuiltinCodeContributions } from '@/services/registerBuiltinCodeContributions';
import { getMarkdownCodeRenderer } from '@/services/plugin-host/markdownCodeRendererAdapter';
import { getHandlerByExtension, getHandlerById } from '@/components/file-types/registry';
import { isTauri } from '@/utils/platform';
import { convertFileSrc } from '@tauri-apps/api/core';
import { useAppearanceStore } from '@/store/appearanceStore';
import { readFileByRoute } from '@/services/editorIoService';
import { useEditorStore } from '@/store/editorStore';
import { useAiConfigStore } from '@/store/aiConfigStore';
import {
  formatResultBlock,
  mapLanguageToRuntime,
  replaceOrAppendResultBlock,
  runScript,
} from '@/services/scriptRunner/scriptRunnerService';
import { ExcalidrawPreview } from '../excalidraw/ExcalidrawPreview';
import { FileIcon } from '@/components/icons/FileIcon';
import { PanelErrorBoundary } from '@/components/sidebar/PanelErrorBoundary';
import { getResizedMediaWidth, stripImageSize } from './mediaResize';
/**
 * Rehype plugin: remove <br> nodes inside <code> elements (within <pre> blocks).
 * remark-breaks converts soft line breaks to <br> in paragraphs,
 * but can also leak <br> into code blocks, causing extra blank lines in preview.
 */
function rehypeRemoveCodeBreaks() {
  function walk(node: any, insideCode: boolean) {
    if (!node || !Array.isArray(node.children)) return;
    const isCodeElement = node.type === 'element' && node.tagName === 'code';
    if (isCodeElement || insideCode) {
      node.children = node.children.filter(
        (child: any) => !(child.type === 'element' && child.tagName === 'br'),
      );
    }
    for (const child of node.children) {
      walk(child, insideCode || isCodeElement);
    }
  }
  return (tree: any) => walk(tree, false);
}

/**
 * Rehype plugin: mark the blockquote that immediately follows a
 * `<!-- Result -->` HTML comment with the `run-result` class, so the synced
 * run output keeps its monospace alignment (dir table columns etc.) instead
 * of falling back to the proportional body font every blockquote uses.
 * Without this, saving a run result to the editor "loses" the alignment the
 * live .code-run-output panel had. CSS targets blockquote.run-result.
 *
 * The comment survives into hast via remarkRehype({allowDangerousHtml}) +
 * rehypeRaw as a `comment` node; the run result blockquote is the next
 * non-whitespace sibling. Skip stray whitespace text nodes between them.
 */
function rehypeMarkResultBlock() {
  return (tree: any) => {
    const kids = Array.isArray(tree.children) ? tree.children : [];
    for (let i = 0; i < kids.length; i++) {
      const node = kids[i];
      if (node?.type !== 'comment' || !/^\s*Result\s*$/.test(node.value ?? '')) continue;
      // Find the next element sibling, tolerating whitespace text nodes.
      let j = i + 1;
      while (j < kids.length && kids[j].type === 'text' && /^\s*$/.test(kids[j].value ?? ' ')) j++;
      const target = kids[j];
      if (target?.type === 'element' && target.tagName === 'blockquote') {
        const props = target.properties || (target.properties = {});
        const cls = Array.isArray(props.className) ? props.className : (props.className ? [String(props.className)] : []);
        if (!cls.includes('run-result')) cls.push('run-result');
        props.className = cls;
      }
    }
  };
}

// Ensure built-in plugins are registered once
registerBuiltinPlugins();
registerBuiltinCodeContributions();

/**
 * Build a component map from the ContainerRegistry for rehype-react.
 * remark-directive-rehype converts :::name{attrs} into <name ...attrs> hast nodes.
 * We map each registered plugin name to its React component.
 */
function buildComponentMap(): Record<string, React.ComponentType<any>> {
  const registry = ContainerRegistry.getInstance();
  const componentMap: Record<string, React.ComponentType<any>> = {};

  for (const plugin of registry.getAll()) {
    const PluginComponent = plugin.component;
    // Wrapper that adapts hast element props to ContainerProps
    componentMap[plugin.name] = function DirectiveWrapper(props: any) {
      const { children, node, ...rest } = props;
      // Merge hast node properties to ensure directive attributes like "type" are preserved
      // (some attributes like "type" may be consumed by rehype as HTML-native props)
      const nodeProperties = node?.properties ?? {};
      const mergedAttributes = { ...nodeProperties, ...rest };
      const containerProps: ContainerProps = {
        children,
        attributes: mergedAttributes,
        name: plugin.name,
      };
      // Tag with data-container so the export DOM walk can locate rendered
      // containers by directive name and apply plugin enhancers. Transparent
      // wrapper div — container plugins use inline styles, so an extra plain
      // div does not affect their rendering.
      // ponytail: PanelErrorBoundary isolates plugin render throws so a broken
      // container doesn't white-screen the whole markdown preview.
      return createElement(
        'div',
        { 'data-container': plugin.name },
        createElement(PanelErrorBoundary, { panelId: plugin.name, children: createElement(PluginComponent, containerProps) }),
      );
    };
  }

  return componentMap;
}

/** Parse YAML frontmatter from markdown content */
interface FrontmatterMeta {
  name?: string;
  description?: string;
  [key: string]: string | undefined;
}

function parseFrontmatter(content: string): { meta: FrontmatterMeta | null; body: string; frontmatterLineCount: number } {
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n---\s*\n?/;
  const match = content.match(frontmatterRegex);
  if (!match) return { meta: null, body: content, frontmatterLineCount: 0 };

  const yamlBlock = match[1];
  const meta: FrontmatterMeta = {};
  let currentKey = '';
  let currentValue = '';

  for (const line of yamlBlock.split('\n')) {
    const keyValueMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)/);
    if (keyValueMatch) {
      if (currentKey) {
        meta[currentKey] = currentValue.trim();
      }
      currentKey = keyValueMatch[1];
      currentValue = keyValueMatch[2];
    } else if (currentKey && (line.startsWith('  ') || line.startsWith('\t'))) {
      currentValue += ' ' + line.trim();
    }
  }
  if (currentKey) {
    meta[currentKey] = currentValue.trim();
  }

  // ponytail: count newlines in the frontmatter match (incl. closing --- line) so
  // rehypeSourceLine can offset anchor source lines to match editor content lines.
  const frontmatterLineCount = (match[0].match(/\n/g) ?? []).length;

  return { meta: Object.keys(meta).length > 0 ? meta : null, body: content.slice(match[0].length), frontmatterLineCount };
}

/** Render SKILL frontmatter meta as a styled card */
function SkillMetaCard({ meta }: { meta: FrontmatterMeta }) {
  return (
    <div className="skill-meta-card">
      <div className="skill-meta-header">
        <span className="skill-meta-badge">SKILL</span>
        {meta.name && <span className="skill-meta-name">{meta.name}</span>}
      </div>
      {meta.description && (
        <p className="skill-meta-description">{meta.description}</p>
      )}
      {Object.entries(meta)
        .filter(([key]) => key !== 'name' && key !== 'description')
        .map(([key, value]) => (
          <div className="skill-meta-field" key={key}>
            <span className="skill-meta-key">{key}</span>
            <span className="skill-meta-value">{value}</span>
          </div>
        ))}
    </div>
  );
}

/** Recursively extract plain text from React children */
function extractTextContent(children: any): string {
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

// ponytail: regex read/write on the source line, no AST writeback. =WxH for img
// (GFM-ish: =Wx means width-only, height auto) and `width=W` after fence lang.
// Ceiling: only matches when width sits right after lang/src; mid-info-string
// widths elsewhere in the line are untouched. Upgrade to AST writeback only if
// a real author writes `width=` somewhere other than right after the lang word.
const IMG_SIZE_RE = /(!\[[^\]]*\]\([^)\s]+)(?:\s+=\d*x\d*)?(\))/;
const IMG_LINE_SIZE_RE = /!\[[^\]]*\]\([^)\s]+(?:\s+=(\d*)x(\d*))?\)/;
const FENCE_WIDTH_RE = /(```\w+)(?:\s+width=\d+)?/;
const FENCE_LINE_WIDTH_RE = /```(\w+)(?:\s+width=(\d+))?/;

function applyImageSize(content: string, sourceLine: number, w: number | null): string {
  const lines = content.split('\n');
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return content;
  const before = lines[idx];
  const stripped = before.replace(IMG_SIZE_RE, '$1$2');
  const next = w != null ? stripped.replace(IMG_SIZE_RE, `$1 =${w}x$2`) : stripped;
  if (next === before) return content;
  lines[idx] = next;
  return lines.join('\n');
}

function applyFenceWidth(content: string, sourceLine: number, w: number | null): string {
  const lines = content.split('\n');
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return content;
  const before = lines[idx];
  const stripped = before.replace(FENCE_WIDTH_RE, '$1');
  const next = w != null ? stripped.replace(FENCE_WIDTH_RE, `$1 width=${w}`) : stripped;
  if (next === before) return content;
  lines[idx] = next;
  return lines.join('\n');
}

interface ResizableMediaProps {
  kind: 'img' | 'fence';
  sourceLine: number | undefined;
  contentRef: React.MutableRefObject<string>;
  onChangeRef: React.MutableRefObject<((content: string) => void) | undefined>;
  // ponytail: optional — createElement(ResizableMedia, {...}, child) injects
  // child as props.children at runtime; making it required trips TS2769.
  children?: React.ReactNode;
}

/** Wrap an <img> or fence-renderer output with a right-bottom drag handle.
 *  Width-only resize; inner media fills 100% of the wrapper via CSS.
 *  On commit, write the new width back to the markdown source line. */
function readSourceWidth(kind: 'img' | 'fence', content: string | undefined, sourceLine: number | undefined): number | null {
  if (!content || sourceLine == null) return null;
  const line = content.split('\n')[sourceLine - 1];
  if (!line) return null;
  if (kind === 'img') {
    const m = line.match(IMG_LINE_SIZE_RE);
    return m?.[1] ? Number(m[1]) : null;
  }
  const m = line.match(FENCE_LINE_WIDTH_RE);
  return m?.[2] ? Number(m[2]) : null;
}

function ResizableMedia({ kind, sourceLine, contentRef, onChangeRef, children }: ResizableMediaProps) {
  // ponytail: lazy init from source so re-mount after writeback doesn't flash
  // through width=null — handle would visibly jump from natural-size position
  // back to the persisted width otherwise.
  const [width, setWidth] = useState<number | null>(() => readSourceWidth(kind, contentRef.current, sourceLine));
  const widthRef = useRef<number | null>(null);
  widthRef.current = width;
  const dragRef = useRef<{ startX: number; startW: number; maxW: number; wallRight: number } | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    const wrapper = wrapperRef.current ?? e.currentTarget.parentElement as HTMLElement | null;
    // ponytail: walk all ancestors, snapshot the narrowest one's width (maxW)
    // and right edge (wallRight). The wrapper is centered (margin:auto) so its
    // right edge moves as it grows; the wall stays put. Comparing the wrapper's
    // CURRENT rendered right edge (which respects CSS max-width:100% capping)
    // to wallRight tells us when to freeze — robust against float-valued maxW
    // and state that hasn't yet reached the clamp. Narrowest ancestor handles
    // preview-only mode where the immediate <p> parent is wider than the pane.
    let maxW = Infinity;
    let wallRight = Infinity;
    let ancestor = wrapper?.parentElement ?? null;
    while (ancestor) {
      const r = ancestor.getBoundingClientRect();
      if (r.width < maxW) {
        maxW = r.width;
        wallRight = r.right;
      }
      ancestor = ancestor.parentElement;
    }
    dragRef.current = {
      startX: e.clientX,
      startW: wrapper?.getBoundingClientRect().width ?? 0,
      maxW,
      wallRight,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    // ponytail: freeze on rightward drag at the wall — when the wrapper's
    // current rendered right edge has reached the wall (snapshot from
    // pointerdown), further rightward dx doesn't enlarge the image or move
    // the handle. Uses getBoundingClientRect().right, which respects CSS
    // max-width:100% capping. Leftward dx (shrink) always allowed.
    if (dx > 0) {
      const currentRight = wrapperRef.current?.getBoundingClientRect().right ?? -Infinity;
      if (currentRight >= dragRef.current.wallRight - 1) return;
    }
    const nextWidth = getResizedMediaWidth(dragRef.current.startW, dx, dragRef.current.maxW);
    setWidth(nextWidth);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try { (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId); } catch { /* pointer already released */ }
    const w = widthRef.current;
    if (w == null) return;
    const content = contentRef.current;
    const onChange = onChangeRef.current;
    if (!content || sourceLine == null || !onChange) return;
    const next = kind === 'img' ? applyImageSize(content, sourceLine, w) : applyFenceWidth(content, sourceLine, w);
    if (next !== content) onChange(next);
  };
  const onDoubleClick = () => {
    const content = contentRef.current;
    const onChange = onChangeRef.current;
    setWidth(null);
    if (!content || sourceLine == null || !onChange) return;
    const next = kind === 'img' ? applyImageSize(content, sourceLine, null) : applyFenceWidth(content, sourceLine, null);
    if (next !== content) onChange(next);
  };

  // ponytail: width-only resize, height auto-derived — inner img/svg keep their
  // natural aspect ratio via CSS height:auto. Shift-unlock is a no-op here since
  // height was never constrained; add height state if independent H ever needed.
  // Wrapper stays centered (margin:auto) throughout drag — handle drifts at
  // half cursor speed because the wrapper grows symmetrically; accepted tradeoff
  // vs. the layout-jump alternative (left during drag, centered after release).
  return (
    <div
      className="resizable-media"
      ref={wrapperRef}
      style={width != null ? { width: `${width}px`, height: 'auto' } : undefined}
    >
      {children}
      <div
        className="resize-handle"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}

/** Code block wrapper component — renders line numbers + copy button via React.
 *  Also renders a Run/Stop button when the fence language maps to a configured
 *  script runtime. Run output streams into a panel below the code block.
 *  For ```html fences, also renders a source/preview toggle: source shows the
 *  code (default); preview renders the HTML in a sandboxed iframe. */
function CodeBlockWrapper({ children, node, lang, sourceLine, content, onChange, ...rest }: CodeBlockWrapperProps) {
  const preRef = useRef<HTMLPreElement>(null);
  const copyBtnRef = useRef<HTMLButtonElement>(null);
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

  return (
    <div className={`code-block-wrapper${isHtml && htmlView === 'preview' && !isEmptyHtml ? ' code-block-wrapper--no-height-cap' : ''}${isEmptyHtml ? ' code-block-wrapper--empty-html' : ''}`}>
      {isEmptyHtml ? (
        <div className="code-block-empty-html" />
      ) : htmlView === 'source' || !isHtml ? (
        <div className="code-block-inner">
          <div className="code-line-numbers" aria-hidden="true">
            {Array.from({ length: lineCount }, (_, i) => (
              <span className="code-ln" key={i}>{i + 1}</span>
            ))}
          </div>
          <pre ref={preRef} {...rest}>{children}</pre>
        </div>
      ) : (
        <iframe
          title="html-preview"
          sandbox="allow-scripts allow-popups allow-forms allow-modals allow-same-origin"
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

export function MarkdownPreview({ content, filePath, vaultRoot, onChange }: import('../types').PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedVaultRoot, setResolvedVaultRoot] = useState('');
  const [assetBase, setAssetBase] = useState('');

  // ponytail: content/onChange change every keystroke. componentMap below
  // used to close over them, which forced a full map rebuild + unified re-parse
  // + VaultContext value churn on each character — every :::file-preview block
  // re-fetched and re-mounted. Refs let the pre wrapper read live values
  // without being a closure dependency of the memoized componentMap.
  const contentRef = useRef(content);
  contentRef.current = content;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!vaultRoot) return;
    import('@tauri-apps/api/path').then(({ homeDir, join }) => {
      if (vaultRoot.startsWith('~')) {
        homeDir().then((h) => join(h, vaultRoot.slice(2))).then(setResolvedVaultRoot);
      } else {
        setResolvedVaultRoot(vaultRoot);
      }
    });
  }, [vaultRoot]);

  // ponytail: precompute the directory that relative asset references
  // (e.g. `![](pic.png)`) should resolve against. For vault files this is
  // `<vaultRoot>/<fileDir>` (legacy); for EXTERNAL files it's the file's own
  // directory — so images embedded next to an external markdown file load.
  useEffect(() => {
    let cancelled = false;
    import('../previewPath').then(({ resolveAssetBase }) =>
      resolveAssetBase(filePath, vaultRoot).then((base) => {
        if (!cancelled) setAssetBase(base.replace(/\/+$/, ''));
      }),
    );
    return () => { cancelled = true; };
  }, [filePath, vaultRoot]);

  const renderFile = useCallback((path: string, content: string) => {
    const ext = path.toLowerCase().match(/\.([^.]+)$/)?.[1] || '';
    const handler = ext ? getHandlerByExtension(ext) : undefined;
    // ponytail: only fall back to code viewer when no handler matched (unknown
    // ext). A matched handler with no Preview (e.g. rich-text .rt) returns null
    // so FilePreviewPlugin shows its "暂无预览" UI instead of dumping the raw
    // disk JSON as code.
    const Preview = handler?.Preview ?? (handler ? null : getHandlerById('code')?.Preview);
    if (!Preview) return null;
    // ponytail: no recursion-depth guard — a markdown file that embeds itself
    // via :::file-preview will stack-overflow. Add a depth counter if it bites.
    return createElement(Preview, { content, filePath: path, vaultRoot: resolvedVaultRoot });
  }, [resolvedVaultRoot]);

  const openFile = useCallback((path: string) => {
    const name = path.substring(path.lastIndexOf('/') + 1) || path;
    void import('@/services/editorIoService').then(({ openFile: open }) => open(path, name));
  }, []);

  const componentMap = useMemo(() => {
    const map = buildComponentMap();
    // Add heading components with auto-generated id anchors for outline navigation
    const headingLevels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
    for (const tag of headingLevels) {
      map[tag] = function HeadingWithId(props: any) {
        const { children, ...rest } = props;
        const textContent = extractTextContent(children);
        const headingId = textContent.toLowerCase().replace(/\s+/g, '-').replace(/[^\w\u4e00-\u9fff-]/g, '');
        return createElement(tag, { ...rest, id: headingId }, children);
      };
    }

    // Custom anchor component: handle external links based on linkOpenMode setting
    map['a'] = function ExternalLink(props: any) {
      const { href, children, node, ...rest } = props;
      // ponytail: markdown `[baidu](www.baidu.com)` (no scheme) parses as a
      // relative path → href="www.baidu.com". Without normalization it bypasses
      // the external-link branch and the Tauri webview tries to navigate to the
      // path → looks like an app restart. Treat www.-prefixed hrefs as https
      // URLs and route through the existing two-mode open logic. Bare-domain
      // (baidu.com) and protocol-relative (//host) cases left for later.
      const normalizedHref = href && typeof href === 'string' && href.startsWith('www.')
        ? `https://${href}`
        : href;
      const isExternal = normalizedHref && (normalizedHref.startsWith('http://') || normalizedHref.startsWith('https://'));
      if (isExternal) {
        return createElement('a', {
          ...rest,
          href: normalizedHref,
          onClick: (e: React.MouseEvent) => {
            e.preventDefault();
            const linkOpenMode = useAppearanceStore.getState().linkOpenMode;
            if (linkOpenMode === 'internal') {
              const linkText = typeof children === 'string' ? children : normalizedHref;
              useEditorStore.getState().openWebTab(normalizedHref, linkText);
            } else if (isTauri()) {
              import('@tauri-apps/plugin-shell').then(({ open }) => {
                open(normalizedHref);
              });
            } else {
              window.open(normalizedHref, '_blank', 'noopener,noreferrer');
            }
          },
        }, children);
      }
      return createElement('a', { href, ...rest }, children);
    };

    // Custom img component: resolve paths relative to the current document's directory
    map['img'] = function VaultImage(props: any) {
      const { src, alt, node, ...rest } = props;
      const sourceLineRaw = rest['data-source-line'] ?? node?.properties?.['data-source-line'];
      const sourceLine = sourceLineRaw != null ? Number(sourceLineRaw) : undefined;
      let imgEl: React.ReactElement;
      if (!src || src.startsWith('http') || src.startsWith('data:')) {
        imgEl = createElement('img', { src, alt, ...rest });
      } else {
        const rawPath = src.replace(/^\.\//, '');
        const imagePath = decodeURIComponent(rawPath);

        if (imagePath.endsWith('.excalidraw')) {
          const fileDir = filePath
            ? filePath.substring(0, filePath.lastIndexOf('/'))
            : '';
          const vaultPath = fileDir ? `${fileDir}/${imagePath}` : imagePath;
          imgEl = createElement(ExcalidrawPreview, { filePath: vaultPath, alt });
        } else if (assetBase) {
          const absPath = `${assetBase}/${imagePath}`;
          const imageUrl = convertFileSrc(absPath);
          imgEl = createElement('img', { src: imageUrl, alt, loading: 'lazy', ...rest });
        } else {
          imgEl = createElement('img', { src, alt, loading: 'lazy', ...rest });
        }
      }
      // ponytail: skip wrapping when sourceLine missing (WikiQueryView, external
      // md) — writeback no-ops anyway, and ExcalidrawPreview isn't a media el.
      if (sourceLine == null) return imgEl;
      return createElement(
        ResizableMedia,
        { kind: 'img', sourceLine, contentRef, onChangeRef },
        imgEl,
      );
    };

    map['pre'] = function PreWithCodeRenderer(props: any) {
      const { children, node, ...rest } = props;
      // Detect fence language + source line for renderer dispatch + run/write-back.
      const langEl = Array.isArray(children)
        ? children.find((c: any) => typeof c?.props?.className === 'string' && c.props.className.includes('language-'))
        : (typeof children?.props?.className === 'string' && children.props.className.includes('language-') ? children : null);
      const lang = langEl?.props?.className?.match(/language-([\w-]+)/)?.[1];
      const rawLine = node?.properties?.['data-source-line'] ?? rest['data-source-line'];
      const sourceLine = rawLine != null ? Number(rawLine) : undefined;
      const renderer = lang ? getMarkdownCodeRenderer(lang) : undefined;
      if (renderer && langEl) {
        const source = extractTextContent(langEl.props.children);
        return createElement(
          ResizableMedia,
          { kind: 'fence', sourceLine, contentRef, onChangeRef },
          createElement(renderer.component, {
            source,
            language: lang,
            resolvedLanguage: renderer.canonical,
            filePath,
          }),
        );
      }
      return createElement(
        CodeBlockWrapper,
        { ...rest, lang, sourceLine, content: contentRef.current, onChange: onChangeRef.current },
        children,
      );
    };

    // ponytail: drop <style>/<script> from raw HTML blocks — rehypeRaw embeds
    // them as live DOM nodes, so a raw <style> with body{height:100vh;...}
    // leaks out of .md-preview and obscures the sidebar. Inline HTML
    // (<u>, <details>, …) still renders. Use a ```html code block for live
    // styled preview (CodeBlockWrapper sandboxes it in an iframe).
    // rehype-mathjax emits a scoped <style> for mjx-container layout — that
    // one is safe (scoped to MathJax selectors), so let it through.
    map['style'] = function FilteredStyle(props: any) {
      const text = extractTextContent(props.children);
      if (text.includes('mjx-')) return createElement('style', null, text);
      return null;
    };
    map['script'] = () => null;

    return map;
  }, [filePath, vaultRoot, resolvedVaultRoot, assetBase]);

  const { meta, body, frontmatterLineCount } = useMemo(() => parseFrontmatter(content), [content]);

  const reactContent = useMemo(() => {
    try {
      const result = unified()
        .use(remarkParse)
        .use(remarkMath)
        .use(remarkGfm)
        .use(remarkBreaks)
        .use(remarkDirective)
        .use(remarkDirectiveRehype)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeHighlight, { ignoreMissing: true } as any)
        .use(rehypeRemoveCodeBreaks)
        .use(rehypeMarkResultBlock)
        .use(rehypeMathjax)
        .use(rehypeSourceLine, { offset: frontmatterLineCount })
        .use(rehypeReact, {
          jsx,
          jsxs,
          Fragment,
          passNode: true,
          components: componentMap,
        } as any)
        .processSync(stripImageSize(unwrapInlineMath(transformMathBrackets(body))));

      return result.result as React.ReactElement;
    } catch (error) {
      console.error('[MarkdownPreview] render error:', error);
      return createElement('p', null, '渲染错误');
    }
  }, [body, componentMap, frontmatterLineCount]);

  // ponytail: memoize VaultContext value — without this, every keystroke
  // (content change → MarkdownPreview re-renders) creates a fresh value object,
  // which made every FilePreviewComponent's useEffect([src, ctx]) re-fire and
  // re-read + re-mount the preview. readFile is a stable module import; only
  // filePath/resolvedVaultRoot/renderFile actually vary.
  const vaultContextValue = useMemo(() => ({
    vaultRoot: resolvedVaultRoot,
    filePath,
    readFile: (p: string) => readFileByRoute(p),
    renderFile,
    openFile,
    getFileIcon: (path: string) => createElement(FileIcon, { filename: path }),
  }), [resolvedVaultRoot, filePath, renderFile, openFile]);

  return (
    <VaultContext.Provider value={vaultContextValue}>
      <div className="md-preview" ref={containerRef}>
        {meta && <SkillMetaCard meta={meta} />}
        {reactContent}
      </div>
    </VaultContext.Provider>
  );
}
