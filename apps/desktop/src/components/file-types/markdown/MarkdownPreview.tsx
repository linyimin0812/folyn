import { useMemo, useRef, useEffect, useLayoutEffect, useCallback, useState, createElement, Fragment } from 'react';
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
import { all as allLowlightGrammars } from 'lowlight';
import rehypeMathjax from 'rehype-mathjax';
import rehypeReact from 'rehype-react';
import { jsx, jsxs } from 'react/jsx-runtime';
import { transformMathBrackets, unwrapInlineMath } from '@/services/markdown/renderMarkdown';
import { rehypeSourceLine } from './rehypeSourceLine';
import { rehypeBlankGap } from './rehypeBlankGap';
import { codeBlockAlignPoint, codeBlockCloseLine } from './codeBlockAlign';
import { blockAlignPoint, blockLastSrcLine, blockRelativeOffsetY, containerAlignPoint, directiveCloseLine, gapAlignPoint, tableRowAnchor } from './blockAlignPoint';
import { planGapHeights } from './gapCompensation';
import { registerBuiltinExtensions, VaultContext } from '@folyn/container-extensions';
import type { ContainerProps } from '@folyn/container-extensions';
import { registerBuiltinCodeContributions } from '@/services/registerBuiltinCodeContributions';
import { getMarkdownCodeRenderer } from '@/services/extension-host/markdownCodeRendererAdapter';
import { getActiveContainers } from '@/services/containerRegistryService';
import { getHandlerByExtension, getHandlerById, getModeComponent } from "@/components/file-types/registry";
import { isTauri } from '@/utils/platform';
import { convertFileSrc } from '@tauri-apps/api/core';
import { resolveAbsolutePath } from '@/services/externalFileProvider';
import { useAppearanceStore } from '@/store/appearanceStore';
import { readFileByRoute } from '@/services/editorIoService';
import { useEditorStore } from '@/store/editorStore';
import { useEditorViewStateStore } from '@/store/editorViewState';
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
import { getResizedMediaWidth } from './mediaResize';

// ponytail: P2 — large-doc parse debounce knobs. Docs above
// PARSE_DEBOUNCE_CHARS re-parse at most every PARSE_DEBOUNCE_MS after the
// last keystroke, never stalling longer than PARSE_MAX_WAIT_MS during a
// continuous typing burst. Below the threshold, per-keystroke parsing is
// cheap and stays instant.
const PARSE_DEBOUNCE_CHARS = 6_000;
const PARSE_DEBOUNCE_MS = 150;
const PARSE_MAX_WAIT_MS = 500;

/**
 * Rehype extension: remove <br> nodes inside <code> elements (within <pre> blocks).
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
 * Rehype extension: mark the blockquote that immediately follows a
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

// Ensure built-in extensions are registered once
registerBuiltinExtensions();
registerBuiltinCodeContributions();

/**
 * Build a component map from the ContainerRegistry for rehype-react.
 * remark-directive-rehype converts :::name{attrs} into <name ...attrs> hast nodes.
 * We map each registered extension name to its React component.
 *
 * `offset` is the frontmatter line count, folded into each directive's
 * `data-source-line` (node.position.start.line + offset) so cursor sync
 * can locate the container block by editor line number — without it,
 * `:::name` blocks carry no `data-source-line` (directive tag names
 * aren't in rehypeSourceLine's BLOCK_TAGS), and the preview's cursor
 * sync can't align while the cursor sits inside a container directive.
 */
function buildComponentMap(offset: number = 0): Record<string, React.ComponentType<any>> {
  const componentMap: Record<string, React.ComponentType<any>> = {};

  for (const extension of getActiveContainers()) {
    const ExtensionComponent = extension.component;
    // Wrapper that adapts hast element props to ContainerProps
    componentMap[extension.name] = function DirectiveWrapper(props: any) {
      const { children, node, ...rest } = props;
      // Merge hast node properties to ensure directive attributes like "type" are preserved
      // (some attributes like "type" may be consumed by rehype as HTML-native props)
      const nodeProperties = node?.properties ?? {};
      const mergedAttributes = { ...nodeProperties, ...rest };
      const containerProps: ContainerProps = {
        children,
        attributes: mergedAttributes,
        name: extension.name,
      };
      // Stamp the directive's source line (frontmatter-offset-adjusted) so
      // the preview's cursor sync can locate this container block —
      // querySelectorAll('[data-source-line]') then matches it like any
      // other block-level element.
      // ponytail: a container that `hidesInactiveChildren` (e.g. `tabs`,
      // `carousel`) is an OUTER container whose non-active children render
      // display:none. Stamp BOTH data-source-line (so cursor-sync can locate
      // this visible outer block) AND data-hides-inactive (so the promote-
      // to-wrapper step below pins the cursor to it by attribute, not name).
      //
      // The hidden sub-directives (tab/slide) get data-source-line too (all
      // wrappers do, above) — cursor-sync's selection loop skips them as
      // hidden / 0-height, and the promotion step decides per line whether
      // the ACTIVE child's content aligns directly or the container pins.
      const startLine = node?.position?.start?.line;
      const hides = extension.hidesInactiveChildren === true;
      const dataProps: Record<string, string> = { 'data-container': extension.name };
      if (typeof startLine === 'number') {
        dataProps['data-source-line'] = String(startLine + offset);
      }
      if (hides) dataProps['data-hides-inactive'] = 'true';
      // Tag with data-container so the export DOM walk can locate rendered
      // containers by directive name and apply extension enhancers. Transparent
      // wrapper div — container extensions use inline styles, so an extra plain
      // div does not affect their rendering.
      // ponytail: PanelErrorBoundary isolates extension render throws so a broken
      // container doesn't white-screen the whole markdown preview.
      return createElement(
        'div',
        dataProps,
        createElement(PanelErrorBoundary, { panelId: extension.name, children: createElement(ExtensionComponent, containerProps) }),
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

// ponytail: regex read/write on the source line, no AST writeback. Image
// resize uses an HTML comment `<!-- width=N -->` placed right after `![alt](url)`
// so the source remains valid CommonMark — other markdown compilers ignore
// the comment and still render the image. Code fences keep `width=N` after
// the lang word (fence info-string allows arbitrary text).
// Ceiling: only matches when the comment sits immediately after `)` (img)
// or the width sits right after the lang word (fence). Upgrade to AST
// writeback only if a real author puts the marker elsewhere.
const IMG_COMMENT_WIDTH_RE = /(!\[[^\]]*\]\([^)\s]+\))(?:<!--\s*width=(\d+)\s*-->)?/;
const IMG_COMMENT_STRIP_RE = /<!--\s*width=\d+\s*-->/g;
const FENCE_WIDTH_RE = /(```\w+)(?:\s+width=\d+)?/;
const FENCE_LINE_WIDTH_RE = /```(\w+)(?:\s+width=(\d+))?/;

function applyImageSize(content: string, sourceLine: number, w: number | null): string {
  const lines = content.split('\n');
  const idx = sourceLine - 1;
  if (idx < 0 || idx >= lines.length) return content;
  const before = lines[idx];
  const stripped = before.replace(IMG_COMMENT_STRIP_RE, '');
  const next = w != null ? stripped.replace(IMG_COMMENT_WIDTH_RE, `$1<!-- width=${w} -->`) : stripped;
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
    const m = line.match(IMG_COMMENT_WIDTH_RE);
    return m?.[2] ? Number(m[2]) : null;
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
      // ponytail: stamp the source line so extension-rendered code fences
      // (mermaid/plantuml/dot — the renderer path in map['pre']) participate
      // in cursor-sync selection/highlight and the gap-compensation grid;
      // without it they had NO alignment target (the CodeBlockWrapper path
      // stamps its own div). For images this duplicates the inner <img>'s
      // stamp — same line, the later-in-DOM img wins the selection, harmless.
      data-source-line={sourceLine}
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

/**
 * Async img renderer: resolves `~/` and `$HOME/`-prefixed paths via Tauri
 * path APIs (homeDir is async), then converts to an asset:// URL via
 * `convertFileSrc`. Absolute paths (`/…`, `C:\…`) pass straight to
 * `convertFileSrc`. Vault-relative and `./` `../` paths join against
 * `assetBase` (the document's directory). Excalidraw paths route through
 * ExcalidrawPreview. Wrapped in ResizableMedia when a source line is
 * attached (for drag-resize writeback).
 */
function VaultImageInner(props: {
  src?: string;
  alt?: string;
  rest: Record<string, any>;
  sourceLine?: number;
  filePath: string;
  assetBase: string;
  contentRef: React.MutableRefObject<string>;
  onChangeRef: React.MutableRefObject<((content: string) => void) | undefined>;
}) {
  const { src, alt, rest, sourceLine, filePath, assetBase, contentRef, onChangeRef } = props;
  const [resolvedSrc, setResolvedSrc] = useState<string | null>(null);

  // ponytail: resolve ~ / $HOME / absolute / vault-relative paths. Synchronous
  // for http/data/absolute; async for ~/ and $HOME/ (homeDir() IPC) AND for
  // relative paths with ../ segments (join+normalize IPC to resolve them).
  // The effect re-runs when src or assetBase changes.
  useEffect(() => {
    let cancelled = false;
    if (!src || src.startsWith('http') || src.startsWith('data:')) {
      setResolvedSrc(src ?? '');
      return () => { cancelled = true; };
    }
    const rawPath = src.replace(/^\.\//, '');
    const imagePath = decodeURIComponent(rawPath);
    const isHomeRel = imagePath.startsWith('~/') || imagePath.startsWith('$HOME/');
    const isAbs = /^(\/|[A-Za-z]:[\\/])/.test(imagePath);
    const hasRelSegments = /(?:^|\/|\\)\.\.?(?:\/|\\|$)/.test(imagePath);

    if (isHomeRel) {
      resolveAbsolutePath(imagePath).then((abs) => {
        if (!cancelled) setResolvedSrc(convertFileSrc(abs));
      }).catch(() => {
        if (!cancelled) setResolvedSrc(src);
      });
    } else if (isAbs) {
      setResolvedSrc(convertFileSrc(imagePath));
    } else if (assetBase) {
      if (hasRelSegments) {
        // ../ and ./ segments must be normalized — convertFileSrc can't
        // resolve them from the asset:// URL alone.
        import('@tauri-apps/api/path').then(({ join, normalize }) =>
          join(assetBase, imagePath).then((joined) => normalize(joined)),
        ).then((abs) => {
          if (!cancelled) setResolvedSrc(convertFileSrc(abs));
        }).catch(() => {
          if (!cancelled) setResolvedSrc(convertFileSrc(`${assetBase}/${imagePath}`));
        });
      } else {
        setResolvedSrc(convertFileSrc(`${assetBase}/${imagePath}`));
      }
    } else {
      setResolvedSrc(src);
    }
    return () => { cancelled = true; };
  }, [src, assetBase]);

  if (!src || src.startsWith('http') || src.startsWith('data:')) {
    const imgEl = createElement('img', { src, alt, ...rest });
    if (sourceLine == null) return imgEl;
    return createElement(ResizableMedia, { kind: 'img', sourceLine, contentRef, onChangeRef }, imgEl);
  }

  const rawPath = src.replace(/^\.\//, '');
  const imagePath = decodeURIComponent(rawPath);
  const isHomeRel = imagePath.startsWith('~/') || imagePath.startsWith('$HOME/');
  const isAbs = /^(\/|[A-Za-z]:[\\/])/.test(imagePath);
  const isExternal = isHomeRel || isAbs;

  if (imagePath.endsWith('.excalidraw')) {
    const fileDir = filePath ? filePath.substring(0, Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'))) : '';
    const vaultPath = isExternal ? imagePath : (fileDir ? `${fileDir}/${imagePath}` : imagePath);
    const imgEl = createElement(ExcalidrawPreview, { filePath: vaultPath, alt });
    if (sourceLine == null) return imgEl;
    return createElement(ResizableMedia, { kind: 'img', sourceLine, contentRef, onChangeRef }, imgEl);
  }

  const imgEl = createElement('img', {
    src: resolvedSrc ?? src,
    alt,
    loading: 'lazy',
    ...rest,
  });
  if (sourceLine == null) return imgEl;
  return createElement(ResizableMedia, { kind: 'img', sourceLine, contentRef, onChangeRef }, imgEl);
}

/**
 * Find the next visible [data-source-line] block after `current` in DOM order,
 * for cursor-sync gap alignment + highlight. Mirrors the selection filter
 * (skip display:none and 0-height data-container wrappers) so the gap
 * aligns to a block the user actually sees. Returns the element, or null
 * if there is none (cursor on trailing EOF blanks). `current` itself is
 * excluded. Returns the ELEMENT only — its offset must be measured by the
 * caller AFTER the cursor-sync highlight swap (the swap changes layout:
 * an active code block re-caps, shifting everything below).
 */
function findNextBlockEl(root: HTMLElement, current: HTMLElement): HTMLElement | null {
  const blocks = Array.from(root.querySelectorAll('[data-source-line]')) as HTMLElement[];
  const startIdx = blocks.indexOf(current);
  for (let i = startIdx + 1; i < blocks.length; i++) {
    const el = blocks[i];
    // Same visibility model as the selection loop: no client rects = the
    // element itself or an ancestor is display:none (a hidden sibling
    // tab/slide's blocks must never be the gap's next block).
    if (el.getClientRects().length === 0) continue;
    if (el.hasAttribute('data-container') && el.offsetHeight === 0) continue;
    return el;
  }
  return null;
}

export function MarkdownPreview({ content, filePath, vaultRoot, onChange, cursorLine, cursorViewportY, editorViewportTop, hasSelection }: import('../types').PreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [resolvedVaultRoot, setResolvedVaultRoot] = useState('');
  const [assetBase, setAssetBase] = useState('');
  // ponytail: editor line height lets headings center on the cursor LINE
  // center, not just its top (coordsAtPos gives the line top). Read from
  // the store directly so no new prop threads through PreviewProps.
  const editorLineHeight = useEditorViewStateStore((s) => s.editorLineHeight);
  const cursorLineFrac = useEditorViewStateStore((s) => s.cursorLineFrac);
  // ponytail: the cursor's MEASURED Y below its paragraph's first line
  // (wrap-exact — includes earlier lines' soft-wrap rows); the multi-line
  // align-point step. Read from the store directly like cursorLineFrac, no
  // prop threading.
  const cursorBlockOffsetY = useEditorViewStateStore((s) => s.cursorBlockOffsetY);
  // ponytail: the cursor's block MEASURED HEIGHT + last line — the
  // multi-line align-point's DENOMINATOR. The preview maps the cursor's
  // relative depth (offset / height) onto the preview block because the
  // two panes re-wrap the same paragraph at different widths: an absolute
  // editor-px offset has no valid scale in preview px.
  const cursorBlockHeight = useEditorViewStateStore((s) => s.cursorBlockHeight);
  const cursorBlockEndLine = useEditorViewStateStore((s) => s.cursorBlockEndLine);
  // ponytail: the editor's line-1 phase in content space (cm-content
  // padding-top) — the gap-compensation grid's absolute origin. With it,
  // leading blank lines / frontmatter lines render as a leading gap and
  // block 0 pins onto the editor's line grid, so doc tops align instead of
  // clamping desiredRaw at 0 (the reported 短文档/文档顶部对不齐).
  const editorContentPadTop = useEditorViewStateStore((s) => s.editorContentPadTop);
  // ponytail: the editor-side line cursorBlockOffsetY is measured from (the
  // syntax-tree block's first line). The effect re-anchors the offset into
  // each target block's frame with it (blockRelativeOffsetY) — inside
  // ::::tabs / ::::carousel the anchor and the target block's first line
  // differ by the directive scaffolding lines between them.
  const cursorBlockLine = useEditorViewStateStore((s) => s.cursorBlockLine);
  // ponytail: the wrap-exact editor screen Y of the container line the pin
  // targets (editor-measured via lineBlockAt on request — see
  // setSyncTargetLine). The pin subtracts it from the cursor's screen Y
  // instead of line arithmetic, which missed soft-wrap rows and drifted the
  // container top a row per wrap (the reported 严重偏下).
  const syncTargetLine = useEditorViewStateStore((s) => s.syncTargetLine);
  const syncTargetScreenY = useEditorViewStateStore((s) => s.syncTargetScreenY);
  const syncTargetMeasuredLine = useEditorViewStateStore((s) => s.syncTargetMeasuredLine);

  // ponytail: P2 — deferred markdown parse for LARGE docs. Per-keystroke
  // processSync + a full React reconcile of the preview tree is what made
  // typing lag on long docs; small docs (< PARSE_DEBOUNCE_CHARS) parse per
  // keystroke (cheap, keeps the preview instantly live). Large docs:
  // trailing debounce (150ms after the last edit) capped by a max wait
  // (500ms — a long typing burst still updates ~2×/sec instead of stalling
  // indefinitely). Tab switches / different files parse immediately — never
  // flash the previous doc while a debounce window runs. parsedContent is
  // what the DOM shows, so the cursor-sync effect and its srcLines read it
  // (not the live content, which can be a few keystrokes ahead).
  const [parsedContent, setParsedContent] = useState(content);
  const parseRef = useRef(parsedContent);
  parseRef.current = parsedContent;
  const lastParsedPathRef = useRef(filePath);
  const pendingSinceRef = useRef(0);
  useEffect(() => {
    if (filePath !== lastParsedPathRef.current) {
      lastParsedPathRef.current = filePath;
      pendingSinceRef.current = 0;
      setParsedContent(content);
      return;
    }
    if (content === parsedContent) return;
    if (content.length <= PARSE_DEBOUNCE_CHARS) {
      pendingSinceRef.current = 0;
      setParsedContent(content);
      return;
    }
    const now = Date.now();
    if (!pendingSinceRef.current) pendingSinceRef.current = now;
    const wait = Math.max(0, Math.min(
      PARSE_DEBOUNCE_MS,
      PARSE_MAX_WAIT_MS - (now - pendingSinceRef.current),
    ));
    const t = setTimeout(() => {
      pendingSinceRef.current = 0;
      setParsedContent(content);
    }, wait);
    return () => clearTimeout(t);
  }, [content, filePath, parsedContent]);

  // ponytail: cursor-driven preview scroll (split mode only). When the
  // editor cursor moves, scroll the preview so the point in the matched
  // block that corresponds to the cursor line aligns to the same
  // vertical viewport position as the cursor. Both panes share the same
  // flex-row height. Scroll-sync (preview scroll -> editor) is NOT
  // implemented; only cursor -> preview. The effect never parses anything
  // itself — it re-runs on parsedContent, i.e. once per actual re-parse,
  // not per keystroke (see the deferred-parse effect above).
  const activeBlockRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (cursorLine == null || cursorLine <= 0) {
      // sync disabled (cursorSyncPreview off or left split mode) → drop the
      // highlight that the last active run stamped, so toggling off clears it.
      if (activeBlockRef.current) {
        activeBlockRef.current.classList.remove('cursor-sync-active');
        activeBlockRef.current = null;
      }
      return;
    }
    if (hasSelection) return;
    const root = containerRef.current;
    if (!root) return;
    const blocks = root.querySelectorAll('[data-source-line]');
    if (blocks.length === 0) return;
    let target: Element | null = null;
    let bestLine = 0;
    for (const el of blocks) {
      const raw = el.getAttribute('data-source-line');
      if (raw == null) continue;
      const line = Number(raw);
      if (!Number.isFinite(line)) continue;
      // Skip blocks that render hidden OR collapse to 0 height.
      // - getClientRects() === []: the element generates NO boxes — either
      //   itself display:none OR any display:none ANCESTOR (the hidden
      //   :::tab/:::slide wrappers). getComputedStyle(el).display can't
      //   catch the ancestor case — display isn't inherited, so a <p> inside
      //   display:none computes display:block while rendering nothing.
      //   Selecting such a block (a hidden sibling's paragraph — the
      //   greatest line ≤ cursorLine once the cursor is in the hidden
      //   child) aligned to its ZERO rect and shoved the whole preview
      //   down via the sync-offset transform (the reported 严重向下偏移;
      //   the old unconditional promote-to-container papered over it).
      // - offsetHeight===0 on a [data-container] wrapper: the `:::slide` /
      //   `:::tab` DirectiveWrapper div itself is NOT display:none (so the
      //   box check above misses it — it generates a 0×W box), but its only
      //   child (the component's data-is-slide/data-is-tab root) is
      //   display:none → the wrapper has 0 height. Selecting it lands the
      //   cursor on a 0-height block → line-proportional interpolation
      //   drifts. Skipping it falls back to the visible `carousel`/`tabs`
      //   parent (promoted below).
      if (el.getClientRects().length === 0) continue;
      if (el.hasAttribute('data-container') && (el as HTMLElement).offsetHeight === 0) continue;
      if (line <= cursorLine && line >= bestLine) {
        bestLine = line;
        target = el;
      }
    }
    const scrollContainer = root.parentElement;
    if (!scrollContainer) return;
    if (!target) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    // A show-one-at-a-time container (tabs / carousel). Two cursor kinds:
    // (a) the cursor's line maps to the ACTIVE child's visible content —
    // keep the block and align it directly, exactly like a block outside a
    // container (paragraph pin / code / table paths below); (b) the cursor's
    // line has no visible counterpart — directive scaffolding, a hidden
    // sibling's lines, a blank between children — promote to the container
    // wrapper and PIN it (the data-hides-inactive branch below). The old
    // unconditional promotion top-aligned the container to the cursor's
    // line, dragging the whole preview down as the cursor descended (the
    // reported 只有首行对齐 / 预览整体偏下). Keep the target only when it
    // is a content block (NOT a directive wrapper) whose source span
    // reaches the cursor's line, or when the gap's next visible block is
    // still inside this container (an in-child blank advances to the next
    // paragraph via the gap path). Driven by the declaration
    // (data-hides-inactive), not names.
    const srcLines = parseRef.current.split('\n');
    const containerWrap = (target as HTMLElement).closest('[data-hides-inactive][data-source-line]');
    if (containerWrap && target !== containerWrap) {
      const tLine = Number(target.getAttribute('data-source-line'));
      const tIsCode = target.tagName === 'PRE' && target.closest('.code-block-wrapper') != null;
      const tClose = tIsCode
        ? codeBlockCloseLine(srcLines, tLine)
        : blockLastSrcLine(srcLines, tLine);
      const covered = !target.hasAttribute('data-container') && cursorLine <= tClose;
      let nextInside = false;
      if (!covered && cursorLine > tClose) {
        const next = findNextBlockEl(root, target as HTMLElement);
        nextInside = next != null && containerWrap.contains(next);
      }
      if (!covered && !nextInside) target = containerWrap;
    }
    const el = target as HTMLElement;
    const blockSrcLine = Number(el.getAttribute('data-source-line'));

    // ponytail: when the cursor sits on a blank line below the selected block
    // (the gap between this block and the next), blank lines render no preview
    // height, so the in-block align functions can't place the cursor. Align to
    // the NEXT block's top instead — the preview advances to the content that
    // follows the cursor's blank line (the cursor is on the separator before
    // the next block), so the preview visibly tracks the cursor instead of
    // clamping to the current block bottom and drifting one line per blank
    // line. If there is no next block (cursor on trailing blanks at EOF),
    // stay on the current block bottom — nothing below to advance to.
    // Covers every block kind (paragraph/heading/list, code, container) so the
    // gap is handled once, in one place, with the live DOM (no editor line
    // height needed — editor vs preview line heights differ, and a guessed
    // value drifted).
    const isCodeBlock = el.tagName === 'PRE' && el.closest('.code-block-wrapper');
    const lastSrcLine = el.hasAttribute('data-container')
      ? directiveCloseLine(srcLines, blockSrcLine) // a directive block's span = open..closing fence (inner ::: fences don't close it)
      : isCodeBlock
        ? codeBlockCloseLine(srcLines, blockSrcLine) // closing fence: cursor on/after it is the gap
        : blockLastSrcLine(srcLines, blockSrcLine);
    const inGap = cursorLine > lastSrcLine;
    const nextBlockEl = inGap ? findNextBlockEl(root, el) : null;

    // The highlight target: when in a gap with a next block, highlight the
    // NEXT block (the content the cursor is about to enter / the separator
    // sits before it), not the block above the blank line — otherwise the
    // .cursor-sync-active highlight stayed on the previous block after a
    // line break while the user typed into the new one. When the cursor sits
    // on TRAILING blank lines at EOF (in a gap with NO next block), clear the
    // highlight — the cursor is past all content, no block corresponds to
    // it, and keeping the highlight on the last block left it stuck ABOVE
    // the cursor (the reported "光标所在的行没有对齐高亮" / "高亮块在光标
    // 上方"). For short content the preview also can't scroll the block down
    // to the cursor (desired clamps to 0), so the highlight-above drift was
    // unavoidable with a block highlight — clearing it is the honest fix.
    // NOTE: `nextBlockEl` is non-null ONLY when inGap (findNextBlockEl runs
    // in the gap branch); when not in a gap (cursor inside a block) it is
    // null, so the fallback must be the current block `el` — not null — or
    // the normal in-block highlight gets cleared too.
    const highlightEl = inGap ? (nextBlockEl ?? null) : el;
    // ponytail: swap the highlight BEFORE measuring any rect. The swap
    // changes layout: the ACTIVE code block is uncapped (CSS
    // .code-block-wrapper:has(.cursor-sync-active) → max-height:none), so
    // when the cursor LEAVES it the block re-caps and everything below
    // shifts up by hundreds of px — a rect measured before the swap is
    // stale by exactly that amount, and the scroll overshot, landing the
    // new block ABOVE the cursor (the reported 从代码块移到段落预览偏上).
    // (And entering a code block uncaps it — the block's own rect must be
    // the post-swap full height too.) Measuring after the swap reads the
    // final layout; the paragraph highlight itself is layout-neutral
    // (background only).
    const blockChanged = activeBlockRef.current !== highlightEl;
    if (blockChanged) {
      activeBlockRef.current?.classList.remove('cursor-sync-active');
      activeBlockRef.current = highlightEl;
      highlightEl?.classList.add('cursor-sync-active');
    }

    // Align the preview block to the cursor's screen position (measured in
    // the post-swap layout).
    const containerRect = scrollContainer.getBoundingClientRect();
    const blockRect = el.getBoundingClientRect();
    // Cancel nothing: no transform exists (see the desiredRaw comment
    // below) — rects are already in un-transformed content space.
    const blockOffset = blockRect.top - containerRect.top + scrollContainer.scrollTop;
    const blockHeight = blockRect.height;
    const blockBottom = blockOffset + blockHeight;
    // The next block's top, also un-transformed (mirrors blockOffset).
    const nextBlockOffset = nextBlockEl
      ? nextBlockEl.getBoundingClientRect().top - containerRect.top + scrollContainer.scrollTop
      : null;

    // Where the cursor line top sits on screen (editor frame) — the align
    // target: the scroll puts the preview's align point at this screen Y
    // (both panes' scroll containers share the viewport top in split mode).
    const cursorScreenY = (editorViewportTop ?? 0) + (cursorViewportY ?? 0);
    // The editor-side line cursorBlockOffsetY is measured from (0/unknown →
    // the cursor's own line, making the re-anchoring below a no-op).
    const anchorLine = cursorBlockLine > 0 ? cursorBlockLine : cursorLine;
    // The wrap-exact screen Y of the pin target's first line, when the
    // editor has measured it for THIS container (stale-guard: measured for a
    // different line → not trustworthy → null → line-arithmetic fallback).
    const targetLineY =
      syncTargetMeasuredLine === blockSrcLine && syncTargetScreenY > 0 ? syncTargetScreenY : null;
    let alignPoint: number;
    if (inGap) {
      // EOF trailing blanks: no next block exists, so the align point has
      // no rendered target — extend into the virtual trailing region at the
      // EDITOR's line rate (the same rate .md-blank-gap renders between
      // blocks) so the cursor's blank line exists in preview content space.
      // The base is the block's EDITOR-RATE bottom: the rendered bottom
      // extended by the block's own shortfall (its source-line span ×
      // editorLH − rendered height — a re-wrapped paragraph renders fewer
      // rows than the editor; its gap compensation below only benefits the
      // NEXT block, so the virtual EOF region must start where the editor's
      // block ends, not where the shorter preview rendering ends).
      // Clamping to the rendered bottom left desiredRaw negative by
      // K×lineHeight → the old syncOffset transform pushed the whole
      // preview down — the blank band at the preview top + per-keystroke
      // bounce (the reported 新建文件输入闪动 + 头部大片空白). The
      // trailing .md-blank-gap div (rehypeBlankGap) extends the scroll
      // height so the scroll can actually reach the extension.
      const lh = editorLineHeight > 0 ? editorLineHeight : 0;
      const span = lastSrcLine - blockSrcLine + 1;
      const eofSteps = nextBlockOffset == null
        ? Math.max(0, cursorLine - lastSrcLine - 1)
        : 0;
      const gapBase = nextBlockOffset == null
        ? blockBottom + Math.max(0, span * lh - blockHeight)
        : blockBottom; // unused when a next block exists (gapAlignPoint takes it)
      alignPoint = gapAlignPoint(gapBase, nextBlockOffset) + eofSteps * lh;
    } else if (isCodeBlock) {
      const codeEl = el.querySelector('code');
      const padTop = codeEl ? parseFloat(getComputedStyle(codeEl).paddingTop) || 0 : 0;
      alignPoint = codeBlockAlignPoint(srcLines, blockSrcLine, cursorLine, blockOffset, blockHeight, padTop);
    } else if (el.tagName === 'TABLE') {
      // Tables render one <tr> per source line, but the |---| separator
      // line renders as the thead/tbody border (~0 height) and cell
      // padding makes rows taller than editor lines. Neither the
      // editor-line step (pins the table top → rows drift below the
      // cursor, growing per row: the reported "表格预览偏下") nor a
      // height fraction (mis-maps the separator) fits — map the cursor's
      // source line to its MEASURED row top in the live DOM instead:
      // header line → thead row 0; separator → thead bottom (the border
      // it renders as); body line K → tbody row K-3's top. A row index
      // past the rendered rows (content directly after the table with no
      // blank line, counted into the span by blockLastSrcLine) falls back
      // to the table bottom.
      const table = el as HTMLTableElement;
      const anchor = tableRowAnchor(cursorLine - blockSrcLine);
      let anchorEl: Element | null = null;
      let useBottom = false;
      if (anchor.kind === 'thead-row') {
        anchorEl = table.tHead?.rows[0] ?? null;
      } else if (anchor.kind === 'thead-bottom') {
        anchorEl = table.tHead;
        useBottom = true;
      } else {
        const tbody = table.tBodies[0];
        anchorEl = tbody ? (tbody.rows[anchor.index] ?? null) : null;
      }
      if (anchorEl) {
        const ar = anchorEl.getBoundingClientRect();
        alignPoint =
          ar.top - containerRect.top + scrollContainer.scrollTop +
          (useBottom ? ar.height : 0);
      } else {
        alignPoint = anchor.kind === 'tbody-row' ? blockBottom : blockOffset;
      }
    } else if (el.hasAttribute('data-hides-inactive')) {
      // A show-one-at-a-time container (carousel/tabs) with the cursor on a
      // line its visible content doesn't map to (scaffolding / hidden
      // sibling / blank between children): only ONE child renders, so there
      // is no per-line pixel map — PIN the container top to the editor
      // position of its first line: the cursor's screen Y minus the editor's
      // wrap-exact screen Y of that line (measured via the syncTarget
      // feedback channel — line arithmetic missed soft-wrap rows and drifted
      // the container a row per wrap: the reported 严重偏下; it accumulates
      // across paragraph boundaries when the container has internal blanks).
      // Falls back to the line-arithmetic re-anchor for the first move into
      // a container (the measurement lands on the next cursor update).
      // Top-aligning the container to the cursor's line instead dragged the
      // whole preview down as the cursor descended (the original 预览整体
      // 偏下); the pin keeps the container glued to the editor's ::::tabs
      // line while the cursor walks the container's lines (mirrors the
      // paragraph pin: the pane doesn't move).
      // Request the measurement for THIS container (idempotent — the store
      // write only re-renders selectors that read these fields).
      if (syncTargetLine !== blockSrcLine) {
        useEditorViewStateStore.getState().setSyncTargetLine(blockSrcLine);
      }
      const rel = targetLineY != null ? cursorScreenY - targetLineY : blockRelativeOffsetY(cursorBlockOffsetY, anchorLine, blockSrcLine, editorLineHeight ?? 0);
      alignPoint = containerAlignPoint(blockOffset, rel, cursorScreenY - containerRect.top);
    } else {
      // Non-code block: headings center on the cursor line (block center,
      // so the highlight box is symmetric around the cursor instead of
      // top-aligned with the box hanging below); list items top-align to
      // the cursor line (one line each, independent — the whole <ul> is
      // no longer treated as one block); multi-line blocks map the
      // cursor's RELATIVE depth in its editor block (offset / height,
      // both wrap-exact editor measurements) proportionally onto the
      // preview block — first line pins the tops together, last line
      // rides at the block bottom, middle lands at the matching relative
      // place, so the text at the cursor's screen height corresponds to
      // the cursor's line even when the panes re-wrap differently (the
      // old absolute-px step had no valid scale and drifted — the
      // reported 没完全对齐 on long paragraphs). A single source line
      // that renders tall tracks the cursor's soft-wrap fraction.
      //
      // Both editor metrics are re-anchored into THIS block's frame first:
      // the editor parser is directive-blind, so inside ::::tabs / ::::carousel
      // its paragraph run starts ABOVE the preview block's first line
      // (scaffolding — subtract via blockRelativeOffsetY) and ends BELOW
      // the preview block's span (fences + hidden siblings — subtract at
      // one editor line height per line, so the fraction's denominator
      // matches the preview block's own line range). Outside containers
      // both corrections are 0.
      const relOffsetY = blockRelativeOffsetY(cursorBlockOffsetY, anchorLine, blockSrcLine, editorLineHeight ?? 0);
      const belowScaffolding = cursorBlockEndLine > 0
        ? Math.max(0, cursorBlockEndLine - lastSrcLine) * (editorLineHeight ?? 0)
        : 0;
      const relHeight = Math.max(0,
        blockRelativeOffsetY(cursorBlockHeight, anchorLine, blockSrcLine, editorLineHeight ?? 0) - belowScaffolding);
      alignPoint = blockAlignPoint(
        el.tagName, srcLines, blockSrcLine, blockOffset, blockHeight, cursorLineFrac,
        relOffsetY,
        relHeight,
      );
    }

    // After setting scrollTop=desired, the align point appears at
    // screen y = containerRect.top + (alignPoint - desired).
    // For headings (cursor on the heading line, not in a gap below it), align
    // the block CENTER to the cursor LINE center (cursorScreenY +
    // editorLineHeight/2) so the highlight is symmetric around the cursor
    // line; coordsAtPos gives the line top, so half the editor line height
    // offsets to the line center. The gap path aligns the NEXT block's TOP
    // to the cursor line top (not center), so it must not apply the heading
    // center offset. Other blocks align to the line top.
    const headingCenter = !inGap && /^H[1-6]$/.test(el.tagName);
    const targetY = headingCenter ? cursorScreenY + (editorLineHeight ?? 0) / 2 : cursorScreenY;
    // Raw align target: the content offset that should land at the cursor's
    // screen Y. scrollTop = desired scrolls the preview so the block aligns
    // to the cursor. desiredRaw < 0 means the preview content above the
    // cursor is SHORTER than the editor's (re-wrapped CJK paragraphs render
    // fewer rows in the wider preview; a bigger editor font; capped code
    // blocks) — geometry scrollTop cannot fix (it can't go below 0). Degrade
    // gracefully: clamp to 0 and let the highlight ride above the cursor.
    // The old fallback pushed the whole preview down via a translateY
    // transform, but that traded the misalignment for a blank band at the
    // preview top that GREW as the drift accumulated (the reported
    // 预览页为了对齐不断下移/头部大片空白) — alignment-by-blank-band is
    // rejected; a short doc simply sits at its natural top.
    const desiredRaw = alignPoint - (targetY - containerRect.top);
    const desired = Math.max(0, desiredRaw);
    if (Math.abs(scrollContainer.scrollTop - desired) > 2) {
      scrollContainer.scrollTop = desired;
    }
  }, [cursorLine, cursorViewportY, editorViewportTop, hasSelection, editorLineHeight, cursorLineFrac, cursorBlockOffsetY, cursorBlockLine, cursorBlockHeight, cursorBlockEndLine, syncTargetLine, syncTargetScreenY, syncTargetMeasuredLine, parsedContent]);

  // Clean up the active-block marker on unmount.
  useEffect(() => {
    return () => activeBlockRef.current?.classList.remove('cursor-sync-active');
  }, []);

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
    // ext). A matched handler with no Preview (e.g. rich-text .richtext) returns null
    // so FilePreviewExtension shows its "暂无预览" UI instead of dumping the raw
    // disk JSON as code.
    const Preview = getModeComponent(handler, 'preview') ?? (handler ? null : getModeComponent(getHandlerById('code'), 'preview'));
    if (!Preview) return null;
    // ponytail: no recursion-depth guard — a markdown file that embeds itself
    // via :::file-preview will stack-overflow. Add a depth counter if it bites.
    return createElement(Preview, { content, filePath: path, vaultRoot: resolvedVaultRoot });
  }, [resolvedVaultRoot]);

  const openFile = useCallback((path: string) => {
    const name = path.substring(path.lastIndexOf('/') + 1) || path;
    void import('@/services/editorIoService').then(({ openFile: open }) => open(path, name));
  }, []);

  // Parse frontmatter before building the component map so the directive
  // wrappers can stamp a frontmatter-offset-adjusted `data-source-line`
  // (matches rehypeSourceLine's offset, so cursor sync lines up).
  const { meta, body, frontmatterLineCount } = useMemo(() => parseFrontmatter(parsedContent), [parsedContent]);

  const componentMap = useMemo(() => {
    const map = buildComponentMap(frontmatterLineCount);
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

    // Custom img component: resolve paths relative to the current document's directory.
    // Supports absolute paths (/, ~/, $HOME/, C:\), vault-relative paths, and
    // relative paths (./ ../). Absolute/home-relative paths bypass the vault
    // base join and are resolved via Tauri fs APIs.
    map['img'] = function VaultImage(props: any) {
      const { src, alt, node, ...rest } = props;
      const sourceLineRaw = rest['data-source-line'] ?? node?.properties?.['data-source-line'];
      const sourceLine = sourceLineRaw != null ? Number(sourceLineRaw) : undefined;
      return createElement(VaultImageInner, {
        src, alt, rest, sourceLine, filePath, assetBase,
        contentRef, onChangeRef,
      });
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
  }, [filePath, vaultRoot, resolvedVaultRoot, assetBase, frontmatterLineCount]);

  // ponytail: blank-line gaps exist ONLY for cursor-sync alignment — they make
  // the preview descend at the editor's line rate past blank lines so the
  // synced block tracks the cursor. When sync is off (preview-only reading,
  // or split with sync toggled off, cursorLine===0) the gaps are pure noise,
  // so the gap plugin is skipped and the preview reads like normal markdown.
  // syncActive is a primitive boolean — it flips only on the sync on/off
  // transition, NOT on every cursor move (once sync is on, cursorLine stays
  // ≥1), so this does not re-parse per keystroke or per cursor move; only
  // one re-parse when the user toggles sync.
  const syncActive = (cursorLine ?? 0) > 0;

  const reactContent = useMemo(() => {
    try {
      const pipeline = unified()
        .use(remarkParse)
        .use(remarkMath)
        .use(remarkGfm)
        .use(remarkBreaks)
        .use(remarkDirective)
        .use(remarkDirectiveRehype)
        .use(remarkRehype, { allowDangerousHtml: true })
        .use(rehypeRaw)
        .use(rehypeHighlight, { languages: allLowlightGrammars, ignoreMissing: true } as any)
        .use(rehypeRemoveCodeBreaks)
        .use(rehypeMarkResultBlock)
        .use(rehypeMathjax)
        .use(rehypeSourceLine, { offset: frontmatterLineCount });
      if (syncActive) pipeline.use(rehypeBlankGap, { offset: frontmatterLineCount, totalLines: parsedContent.split('\n').length });
      const result = pipeline
        .use(rehypeReact, {
          jsx,
          jsxs,
          Fragment,
          passNode: true,
          components: componentMap,
        } as any)
        .processSync(unwrapInlineMath(transformMathBrackets(body)));

      return result.result as React.ReactElement;
    } catch (error) {
      console.error('[MarkdownPreview] render error:', error);
      return createElement('p', null, '渲染错误');
    }
  }, [body, componentMap, frontmatterLineCount, syncActive, parsedContent]);

  // ponytail: runtime blank-gap compensation — the last piece of the
  // "preview descends at the editor's rate" design. rehypeBlankGap sizes
  // gap divs statically (blank lines × editor line height), which is exact
  // only when every block renders at the editor's per-line rate. Blocks
  // that render SHORTER (long CJK paragraphs re-wrap to fewer rows in the
  // wider preview; a bigger editor font; capped code blocks) leave the
  // preview falling behind the editor's descent rate, and the shortfall
  // ACCUMULATES down the doc — that is why short docs sat unaligned (only
  // >1-page docs aligned: 只有超过一页才对齐) and why the old transform
  // push-down grew a blank band at the top. Fix the geometry instead:
  // measure each top-level block and re-size the gap div BEFORE the next
  // block so every block lands on the editor's line grid. The grid is
  // ABSOLUTE when the editor publishes its line-1 phase (editorContentPadTop
  // — grid.top + (line−1)·editorLineHeight): the leading blank / frontmatter
  // gap renders above block 0 and gets pinned so the FIRST block also sits
  // on the grid (doc tops + short docs with leading blanks align); without
  // the phase (not yet measured) it falls back to the relative grid (first
  // block's measured top as origin). Then the cursor-sync desiredRaw stays
  // ≈ 0 at any doc length: scrollTop 0, every block aligned to its editor
  // line, no content pushed down, no band.
  // useLayoutEffect (pre-paint) so per-keystroke re-parses never flash the
  // static gap before the compensated height — that would flicker. One
  // rect pass, cumulative in-memory adjustment, one write pass (single
  // reflow). Floor 8px: a block rendering TALLER than its editor span
  // (tables, code) only shrinks the gap so far — its positive drift is
  // handled by the normal scroll path, and the natural separation stays.
  // Gaps only exist between blocks (rehypeBlankGap); adjacency without a
  // blank line is absorbed at the next gap (the grid math is absolute).
  useLayoutEffect(() => {
    if (!syncActive || editorLineHeight == null || editorLineHeight <= 0) return;
    const rootEl = containerRef.current;
    const sc = rootEl?.parentElement;
    if (!rootEl || !sc) return;
    const contentTop = (el: HTMLElement) =>
      el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop;
    const blocks: { el: HTMLElement; line: number; top: number }[] = [];
    const gapAfter = new Map<number, { el: HTMLElement; curH: number }>(); // block index → the .md-blank-gap following it (measured)
    // The leading .md-blank-gap (before block 0 — leading blanks /
    // frontmatter lines; rehypeBlankGap inserts it). Resized by the grid pin
    // so block 0 lands on the editor's line-1 phase, absorbing whatever sits
    // above (the SkillMetaCard for frontmatter docs).
    let leadingGap: { el: HTMLElement; curH: number } | null = null;
    for (const kid of Array.from(rootEl.children) as HTMLElement[]) {
      if (kid.classList.contains('md-blank-gap')) {
        if (blocks.length === 0) {
          if (!leadingGap) leadingGap = { el: kid, curH: kid.getBoundingClientRect().height };
        } else if (!gapAfter.has(blocks.length - 1)) {
          gapAfter.set(blocks.length - 1, { el: kid, curH: kid.getBoundingClientRect().height });
        }
        continue;
      }
      const line = Number(kid.getAttribute('data-source-line'));
      if (Number.isFinite(line) && line > 0) blocks.push({ el: kid, line, top: contentTop(kid) });
    }
    if (blocks.length < 1) return;
    // Absolute grid (editor's line-1 phase) when the editor has published
    // it; before that (or non-split) fall back to the relative grid.
    const grid = editorContentPadTop > 0 ? { top: editorContentPadTop, leadingGap: leadingGap ?? undefined } : undefined;
    const { writes } = planGapHeights(blocks, gapAfter, editorLineHeight, undefined, grid);
    for (const [el, h] of writes) (el as HTMLElement).style.height = `${h}px`;
  }, [reactContent, editorLineHeight, syncActive, editorContentPadTop]);

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
      <div className="md-preview" ref={containerRef} style={{ '--md-gap-line': editorLineHeight > 0 ? `${editorLineHeight}px` : undefined } as React.CSSProperties}>
        {meta && <SkillMetaCard meta={meta} />}
        {reactContent}
      </div>
    </VaultContext.Provider>
  );
}
