import type { ReactNode, CSSProperties, WheelEvent } from 'react';
import type {
  PreviewProps,
  FileTypeHandler,
  PluginModule,
  ExporterContext,
  MarkdownCodeRendererProps,
  ContainerProps,
  ExportEnhancerHandler,
} from 'quill-plugin-sdk';
import plantumlEncoder from 'plantuml-encoder';
import { resolveReact } from './react';
import { plantumlLanguage } from './plantumlLanguage';

const PLANTUML_SERVER = 'https://www.plantuml.com/plantuml/svg/';
const DEBOUNCE_MS = 300;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.15;

// ponytail: small SVG pictogram (two nodes + arrow — UML-ish). Resolves
// window.React at module load; the host assigns window.React in main.tsx
// before any trusted plugin is import()-ed, and tests assign it in setup.ts.
function makeIcon(): ReactNode {
  const { createElement: h } = resolveReact();
  return h('svg', { width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round' },
    h('rect', { x: 1.5, y: 3, width: 4, height: 4, rx: 0.6 }),
    h('rect', { x: 10.5, y: 9, width: 4, height: 4, rx: 0.6 }),
    h('path', { d: 'M5.5 5h4a2 2 0 0 1 2 2v2' }),
  );
}

// ponytail: SVG export = fetch the same svg URL the img renders, return as a
// Blob for the host's exporterAdapter to pipe through `downloadBlob` (native
// save dialog). Throws on non-2xx so the host surfaces the error.
export async function exportPlantUmlSvg(
  content: string,
  _ctx: ExporterContext,
): Promise<Blob> {
  const encoded = plantumlEncoder.encode(content);
  const res = await fetch(PLANTUML_SERVER + encoded);
  if (!res.ok) throw new Error(`PlantUML SVG export failed: HTTP ${res.status}`);
  const svg = await res.text();
  return new Blob([svg], { type: 'image/svg+xml' });
}

export function PlantUmlPreview(props: PreviewProps) {
  const R = resolveReact();
  const { createElement: h, useState, useEffect, useCallback } = R;
  const [debounced, setDebounced] = useState(props.content);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    setError(null);
    const t = setTimeout(() => setDebounced(props.content), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [props.content]);

  const clampZoom = useCallback((z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)), []);
  const zoomIn = useCallback(() => setZoom((z) => clampZoom(z + ZOOM_STEP)), [clampZoom]);
  const zoomOut = useCallback(() => setZoom((z) => clampZoom(z - ZOOM_STEP)), [clampZoom]);

  // ponytail: ctrl/cmd+wheel zoom — common web canvas convention. Native
  // wheel defaults to page-scroll; we cancel when the modifier is held so
  // the preview pane doesn't scroll-then-zoom.
  const onWheel = useCallback((e: WheelEvent<HTMLDivElement>) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP;
    setZoom((z) => clampZoom(z + delta));
  }, [clampZoom]);

  const encoded = plantumlEncoder.encode(debounced);
  const url = PLANTUML_SERVER + encoded;

  return h('div', {
      className: 'plantuml-preview',
      style: { position: 'relative', width: '100%', height: '100%', overflowX: 'hidden', overflowY: 'auto', background: 'var(--bg, #fff)' },
      onWheel,
    },
    // Content wrapper — fills the scroll container, centers the image. Width
    // is constrained to container so zoom never triggers horizontal scroll
    // (overflow-x is hidden on the outer).
    h('div', {
        style: { width: '100%', minHeight: '100%', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' },
      },
      error
        ? h('div', { className: 'plantuml-error', style: { color: '#c00', whiteSpace: 'pre-wrap', padding: '16px' } },
            `PlantUML rendering failed. Check syntax or network.\n\nSource:\n${debounced}`)
        : h('img', {
            src: url,
            alt: 'PlantUML diagram',
            onError: () => setError('render-failed'),
            style: { transform: `scale(${zoom})`, transformOrigin: 'top center', maxWidth: '100%', transition: 'transform 80ms' },
          }),
    ),
    // Toolbar — zoom controls only. SVG export is surfaced by the host's
    // ExportMenu (via contributes.exporters[]), not in-preview.
    h('div', {
        style: { position: 'absolute', top: 8, right: 8, display: 'flex', gap: '4px', background: 'var(--panel, #fff)', border: '1px solid var(--brd, #ccc)', borderRadius: 6, padding: 4, zIndex: 10, boxShadow: '0 1px 4px rgba(0,0,0,.08)' },
      },
      h('button', { onClick: zoomOut, disabled: zoom <= MIN_ZOOM, style: btnStyle(zoom <= MIN_ZOOM) }, '−'),
      h('span', { style: { padding: '2px 6px', fontVariantNumeric: 'tabular-nums', fontSize: 12, minWidth: 40, textAlign: 'center' } }, `${Math.round(zoom * 100)}%`),
      h('button', { onClick: zoomIn, disabled: zoom >= MAX_ZOOM, style: btnStyle(zoom >= MAX_ZOOM) }, '+'),
    ),
  );
}

// ponytail: shared inline button style. No CSS file — keeps the bundle
// self-contained (the trusted-plugin contract forbids relative CSS imports).
function btnStyle(disabled: boolean): CSSProperties {
  return {
    width: 24,
    height: 24,
    padding: 0,
    fontSize: 13,
    lineHeight: 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
    background: 'transparent',
    border: '1px solid var(--brd, #ccc)',
    borderRadius: 4,
    opacity: disabled ? 0.4 : 1,
  };
}

const handler: FileTypeHandler = {
  id: 'plantuml',
  extensions: ['puml', 'plantuml', 'pu'],
  icon: makeIcon(),
  supportedViewModes: ['edit', 'split', 'preview'],
  defaultViewMode: 'split',
  needsFileContent: true,
  useCodeMirror: true,
  Preview: PlantUmlPreview,
};

// ponytail: shared encode/render/error helper — dedupes the <img>+onError
// shape between the markdown fenced-block renderer and the container
// directive component. Only acceptable internal abstraction per dispatch.
function PlantUmlDiagram({ source }: { source: string }) {
  const R = resolveReact();
  const { createElement: h, useState, useEffect } = R;
  const [debounced, setDebounced] = useState(source);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    const t = setTimeout(() => setDebounced(source), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [source]);

  if (error || !debounced.trim()) {
    return h('div', {
      'data-container': 'plantuml',
      className: 'plantuml-block',
      style: { padding: '8px' },
    },
      error
        ? h('div', { className: 'plantuml-error', style: { color: '#c00', whiteSpace: 'pre-wrap', marginBottom: 8 } },
            `PlantUML rendering failed. Check syntax or network.\n\nSource:\n${debounced}`)
        : h('pre', { style: { whiteSpace: 'pre-wrap', margin: 0, padding: 8, background: 'var(--surf, #f6f6f6)', borderRadius: 4 } }, debounced),
    );
  }

  const url = PLANTUML_SERVER + plantumlEncoder.encode(debounced);
  return h('div', {
    'data-container': 'plantuml',
    className: 'plantuml-block',
    style: { display: 'flex', justifyContent: 'center', padding: '8px' },
  },
    h('img', {
      src: url,
      alt: 'PlantUML diagram',
      onError: () => setError('render-failed'),
      style: { maxWidth: '100%' },
    }),
  );
}

export function PlantUmlMarkdownBlock(props: MarkdownCodeRendererProps) {
  const R = resolveReact();
  return R.createElement(PlantUmlDiagram, { source: props.source });
}

// ponytail: container children serialization mirrors MermaidPlugin.extractText
// — handles string / array / React node trees. Naive: only walks props.children
// (no text nodes split across sibling spans); upgrade path is a proper
// text-extractor if directive bodies get complex.
function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children;
  if (typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(extractText).join('');
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children);
  }
  return '';
}

export function PlantUmlContainerBlock(props: ContainerProps) {
  const R = resolveReact();
  return R.createElement(PlantUmlDiagram, { source: extractText(props.children) });
}

// ponytail: best-effort SVG inlining for export. Swallows per-img fetch/parse
// errors — on failure the <img> stays (remote URL; broken if offline, but
// source text remains in the rendered block elsewhere). DOMParser is stdlib.
export const enhancePlantUml: ExportEnhancerHandler = async (body: HTMLElement) => {
  const imgs = Array.from(body.querySelectorAll('img'));
  await Promise.all(imgs.map(async (img) => {
    const src = img.getAttribute('src') ?? '';
    if (!src.startsWith(PLANTUML_SERVER)) return;
    try {
      const res = await fetch(src);
      if (!res.ok) return;
      const text = await res.text();
      const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return;
      const adopted = document.importNode(svg, true);
      img.replaceWith(adopted);
    } catch {
      // ponytail: per-img failure leaves the <img> in place — export falls
      // back to remote URL (acceptable per prd offline-fallback note).
    }
  }));
};

const module: PluginModule = {
  handlers: { plantuml: handler },
  exporters: { svg: exportPlantUmlSvg },
  markdownCodeRenderers: { PlantUmlMarkdownBlock },
  containers: { PlantUmlContainerBlock },
  exportEnhancers: { enhancePlantUml },
  editorLanguages: { plantumlLanguage: () => plantumlLanguage() },
};

export default module;
export { handler };
