import { useTranslation } from 'react-i18next';
import { useEffect, useRef, useState, useCallback } from 'react';
import { Settings2 } from 'lucide-react';
import { DARK_THEME, THEME } from 'mind-elixir';
import type { MindElixirInstance } from 'mind-elixir';
import type { PreviewProps } from '../types';
import { createTopicMarkdown } from './topicMarkdown';

// ponytail: mind-elixir's own direction toolbar SVGs (tbltl/tbltr/tblts).
// Lifted verbatim from mind-elixir's bundled HTML so the preview uses the
// same icons the library itself uses — no new icon set, no guessing.
const DIR_ICON_PATHS: Record<'left' | 'right' | 'side', string> = {
  left:
    'M639 463.3L639 285.1c0-36.9-26.4-68.5-61.3-68.5l-150.2 0c-1.5 0-3 0.1-4.5 0.3-10.2-38.7-45.5-67.3-87.5-67.3-50 0-90.5 40.5-90.5 90.5s40.5 90.5 90.5 90.5c42 0 77.3-28.6 87.5-67.4 1.4 0.3 2.9 0.4 4.5 0.4L577.7 263.6c6.8 0 14.3 8.9 14.3 21.5l0 427c0 12.7-7.4 21.5-14.3 21.5l-150.2 0c-1.5 0-3 0.2-4.5 0.4-10.2-38.8-45.5-67.3-87.5-67.3-50 0-90.5 40.5-90.5 90.4 0 49.9 40.5 90.6 90.5 90.6 42 0 77.3-28.6 87.5-67.4 1.4 0.2 2.9 0.4 4.5 0.4L577.7 780.7c34.8 0 61.3-31.6 61.3-68.5L639 510.3l79.1 0c10.4 38.5 45.5 67 87.4 67 50 0 90.5-40.5 90.5-90.5s-40.5-90.5-90.5-90.5c-41.8 0-77 28.4-87.4 67L639 463.3z',
  right:
    'M385 560.7L385 738.9c0 36.9 26.4 68.5 61.3 68.5l150.2 0c1.5 0 3-0.1 4.5-0.3 10.2 38.7 45.5 67.3 87.5 67.3 50 0 90.5-40.5 90.5-90.5s-40.5-90.5-90.5-90.5c-42 0-77.3 28.6-87.5 67.4-1.4-0.3-2.9-0.4-4.5-0.4L446.3 760.4c-6.8 0-14.3-8.9-14.3-21.5l0-427c0-12.7 7.4-21.5 14.3-21.5l150.2 0c1.5 0 3-0.2 4.5-0.4 10.2 38.8 45.5 67.3 87.5 67.3 50 0 90.5-40.5 90.5-90.4 0-49.9-40.5-90.6-90.5-90.6-42 0-77.3 28.6-87.5 67.4-1.4-0.2-2.9-0.4-4.5-0.4L446.3 243.3c-34.8 0-61.3 31.6-61.3 68.5L385 513.7l-79.1 0c-10.4-38.5-45.5-67-87.4-67-50 0-90.5 40.5-90.5 90.5s40.5 90.5 90.5 90.5c41.8 0 77-28.4 87.4-67L385 560.7z',
  side:
    'M851.9 328.5c-60 0-108.6 48.5-108.9 108.4l-137.9 38.4a109.1 109.1 0 0 0-63.5-46.6l1.4-137.1c47.3-11.9 82.3-54.7 82.3-105.6 0-60.2-48.8-108.9-108.9-108.9s-108.9 48.8-108.9 108.9c0 49.2 32.6 90.8 77.4 104.3l-1.4 138.9a109.2 109.2 0 0 0-63.5 48.6l-138.9-39.5 0-0.7c0-60.2-48.8-108.9-108.9-108.9s-108.9 48.8-108.9 108.9c0 60.2 48.8 108.9 108.9 108.9 39.4 0 73.9-20.9 93-52.2l139.2 39.6 0 0.2c0 25.8 9 49.6 24 68.2l-90.1 132.6a108.7 108.7 0 0 0-34.3-5.5c-60.2 0-108.9 48.8-108.9 108.9 0 60.2 48.8 108.9 108.9 108.9 60.2 0 108.9-48.8 108.9-108.9 0-27.1-9.9-52-26.4-71l89-131a108.5 108.5 0 0 0 37.7 6.7 108.7 108.7 0 0 0 36.5-6.3l93.1 132.6a108.5 108.5 0 0 0-24.7 69.1c0 60.2 48.8 108.9 108.9 108.9 60.2 0 108.9-48.8 108.9-108.9 0-60.1-48.8-108.9-108.9-108.9a108.8 108.8 0 0 0-36.7 6.3l-93.1-132.5a108.5 108.5 0 0 0 24.8-72.2l136.1-37.9c19 31.9 53.8 53.4 93.7 53.4 60.2 0 108.9-48.8 108.9-108.9-0-60.2-48.8-108.9-108.9-108.9z',
};
import {
  outlineToMindElixirData,
  mindElixirDataToOutline,
  readRuntimeMapStyle,
  resolveCanvasPalette,
  PRESET_STYLES,
  CREATE_STYLES,
  MONO_PALETTE,
  CANVAS_PALETTES,
  type MmapNodeStyle,
  type MmapMapStyle,
  type MmapSkeleton,
  type MmapDirection,
} from './outlineConverter';
import { resolveBasePath } from '@/utils/pathResolver';
import { useAppearanceStore } from '@/store/appearanceStore';

const FALLBACK_SRC = '- Root';

// ponytail: mind-elixir's default Catppuccin Latte palette (10 colors).
// Used to restore the multi-color rainbow look when the user toggles rainbow
// back ON after turning it OFF. Hardcoded because mind-elixir mutates
// `inst.theme.palette` in place at runtime — there's no API to read the
// "original" default after a mutation.
const RAINBOW_PALETTE = [
  '#dd7878', '#ea76cb', '#8839ef', '#e64553', '#fe640b',
  '#df8e1d', '#40a02b', '#209fb5', '#1e66f5', '#7287fd',
];

// Default text style panel values (used when the field is unset on the node).
const DEFAULT_FONT_FAMILY = 'Microsoft YaHei';
const DEFAULT_FONT_SIZE = '14';
const DEFAULT_BORDER_WIDTH = '1';
const DEFAULT_FIXED_WIDTH = '120';

function toSafeSrc(content: string | undefined): string {
  const trimmed = content?.trim();
  return trimmed || FALLBACK_SRC;
}

// ponytail: read the inline style off the Topic DOM element after
// mind-elixir's `ve` has applied `nodeObj.style` keys via `e.style[o]=n[o]`.
// `nodeObj.style` is the source of truth — we read from it, not from the
// DOM, so we don't get fooled by stray inline styles left over from a
// previous reshapeNode that wasn't followed by a `cssText=''` clear.
function readNodeStyle(node: { style?: MmapNodeStyle } | undefined): MmapNodeStyle {
  return { ...(node?.style ?? {}) };
}

// ponytail: mind-elixir's NodeObj TS type omits `fontStyle`, but the runtime
// applier honors any CSS key. Cast through `unknown` so we can set italic
// without fighting the type. See outlineConverter.ts `MmapNodeStyle` notes.
function setNodeStyleOnObj(node: unknown, style: MmapNodeStyle | undefined): void {
  (node as { style?: MmapNodeStyle }).style = style;
}

// ponytail: skeleton (骨架) layouts. mind-elixir has no native skeleton
// concept, so the canvas maps each preset to a direction plus (where needed)
// a scoped CSS override and custom branch generators:
//  - org (组织结构图): top-down tree with vertical elbow connectors
//  - tree (树型图): right-branching with right-angle elbow connectors
//  - fishbone (鱼骨图): right spine, first-level branches alternate up/down
//  - timeline (时间轴): vertical spine with stub lines into each first-level node
//  - bracket (括号图): right-branching with a bracket overlay that spans
//    each child group (leader to the bracket, stubs into the children)
const SKELETON_CSS = `
  .map-container[data-mmap-skeleton="org"] .map-canvas me-nodes {
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    align-items: center;
    padding: 24px;
  }
  .map-container[data-mmap-skeleton="org"] me-root {
    margin: 8px 0 32px;
  }
  .map-container[data-mmap-skeleton="org"] me-main {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: flex-start;
    width: max-content;
    margin: 0;
  }
  .map-container[data-mmap-skeleton="org"] me-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 14px;
  }
  .map-container[data-mmap-skeleton="org"] me-parent {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0;
    padding: 0;
  }
  .map-container[data-mmap-skeleton="org"] me-wrapper me-children {
    display: flex;
    flex-direction: row;
    justify-content: center;
    align-items: flex-start;
    margin-top: 18px;
  }
  .map-container[data-mmap-skeleton="fishbone"] .map-canvas me-nodes {
    padding: 64px 32px;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-root {
    margin: 0 44px 0 0;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main {
    display: flex;
    flex-direction: row;
    align-items: center;
    margin: 0;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-wrapper {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin: 0 16px;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-wrapper me-children {
    display: flex;
    flex-direction: column;
    align-items: center;
    margin-top: 8px;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main > me-wrapper:nth-child(odd) {
    margin-top: -56px;
    flex-direction: column-reverse;
  }
  .map-container[data-mmap-skeleton="fishbone"] me-main > me-wrapper:nth-child(even) {
    margin-top: 56px;
  }

  .map-container[data-mmap-skeleton="timeline"] .map-canvas me-nodes {
    padding: 24px 40px;
  }
  .map-container[data-mmap-skeleton="timeline"] me-root {
    margin: 0 48px 0 0;
  }

  .map-container[data-mmap-skeleton="tree"] .map-canvas me-nodes,
  .map-container[data-mmap-skeleton="bracket"] .map-canvas me-nodes {
    padding: 24px;
  }
  .map-container[data-mmap-skeleton="tree"] me-children {
    margin-left: 56px;
  }
  .map-container[data-mmap-skeleton="tree"] me-parent {
    padding-left: 0;
  }
  .map-container[data-mmap-skeleton="tree"] .map-canvas {
    --node-gap-y: 48px;
    --main-gap-y: 90px;
  }
  .map-container[data-mmap-skeleton="tree"] me-wrapper:has(> me-children > me-wrapper) > me-parent > me-tpc {
    border: 2px solid var(--main-color);
    background-color: var(--main-bgcolor);
    border-radius: var(--main-radius);
  }
`;

type SkeletonBranchParams = {
  pT: number;
  pL: number;
  pW: number;
  pH: number;
  cT: number;
  cL: number;
  cW: number;
  cH: number;
};

function orgBranch({ pT, pL, pW, pH, cT, cL, cW }: SkeletonBranchParams): string {
  const x1 = pL + pW / 2;
  const y1 = pT + pH;
  const x2 = cL + cW / 2;
  const y2 = cT;
  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}

function slantedBranch({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const y1 = pT + pH / 2;
  const x2 = cL;
  const y2 = cT + cH / 2;
  return `M ${x1} ${y1} L ${x2} ${y2}`;
}

function treeBranch({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const y1 = pT + pH / 2;
  const x2 = cL;
  const y2 = cT + cH / 2;
  // Lines always leave the parent's right-center and enter the child's
  // left-center. Only when the two centers are already aligned does the
  // connector stay a single horizontal line; otherwise it is a clean
  // orthogonal elbow. No diagonals.
  if (Math.abs(y2 - y1) < 2) {
    return `M ${x1} ${y1} L ${x2} ${y2}`;
  }
  const midX = x1 + (x2 - x1) / 2;
  return `M ${x1} ${y1} L ${midX} ${y1} L ${midX} ${y2} L ${x2} ${y2}`;
}

function verticalBranch({ pT, pL, pW, pH, cT, cL, cW }: SkeletonBranchParams): string {
  const x1 = pL + pW / 2;
  const y1 = pT + pH;
  const x2 = cL + cW / 2;
  const y2 = cT;
  const midY = y1 + (y2 - y1) / 2;
  return `M ${x1} ${y1} L ${x1} ${midY} L ${x2} ${midY} L ${x2} ${y2}`;
}

function timelineMain({ pT, pL, pW, pH, cT, cL, cH }: SkeletonBranchParams): string {
  const x1 = pL + pW;
  const yRoot = pT + pH / 2;
  const yChild = cT + cH / 2;
  const x2 = cL;
  return `M ${x1} ${yRoot} V ${yChild} H ${x2}`;
}

// Main/sub branch generators per skeleton. 'mind' (and 'bracket', which
// draws its own overlay) keep the captured mind-elixir defaults.
const SKELETON_BRANCHES: Partial<Record<MmapSkeleton, (p: SkeletonBranchParams) => string>> = {
  org: orgBranch,
  fishbone: slantedBranch,
  tree: treeBranch,
  timeline: timelineMain,
};

function ensureSkeletonStyle(container: HTMLElement): void {
  const existing = container.querySelector<HTMLStyleElement>(
    'style[data-mmap-skeleton-style]',
  );
  if (existing) return;
  const style = document.createElement('style');
  style.dataset.mmapSkeletonStyle = '';
  style.textContent = SKELETON_CSS;
  container.appendChild(style);
}

// ponytail: bracket-map connectors. mind-elixir draws one path per parent-child
// pair, but a real bracket needs the whole sibling group (vertical span + a
// stub into every child). We draw it as an overlay after linkDiv and hide the
// default branch lines while the bracket skeleton is active.
function offsetInNodes(nodes: HTMLElement, el: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  let cur: HTMLElement | null = el;
  while (cur && cur !== nodes) {
    x += cur.offsetLeft;
    y += cur.offsetTop;
    cur = cur.offsetParent as HTMLElement | null;
  }
  return { x, y };
}

function removeBracketOverlay(inst: MindElixirInstance): void {
  inst.container.querySelector('svg.mmap-bracket-lines')?.remove();
  const lines = inst.container.querySelector<HTMLElement>('svg.lines');
  if (lines) lines.style.display = '';
}

// ponytail: give every non-leaf node in the tree skeleton the same box as the
// main (first-level) nodes. mind-elixir only colors first-level borders with
// the branch palette; this pass propagates that color down to deeper branches
// so all boxes stay coordinated.
function applyTreeNonLeafBoxes(inst: MindElixirInstance): void {
  const palette = inst.theme.palette;
  if (!palette?.length) return;
  inst.container.querySelectorAll('me-main > me-wrapper').forEach((mainWrapper, i) => {
    const rootTpc = mainWrapper.querySelector<HTMLElement>(
      ':scope > me-parent > me-tpc',
    );
    if (!rootTpc) return;
    const color =
      (rootTpc as HTMLElement & { nodeObj?: { branchColor?: string } }).nodeObj
        ?.branchColor || palette[i % palette.length];
    mainWrapper.querySelectorAll('me-wrapper').forEach((descWrapper) => {
      const tpc = descWrapper.querySelector<HTMLElement>(
        ':scope > me-parent > me-tpc',
      );
      if (
        tpc &&
        descWrapper.querySelector(':scope > me-children > me-wrapper')
      ) {
        tpc.style.borderColor = color;
      }
    });
  });
}

function drawBracketConnectors(inst: MindElixirInstance): void {
  const nodes = inst.container.querySelector<HTMLElement>('me-nodes');
  if (!nodes) return;
  const lines = inst.container.querySelector<HTMLElement>('svg.lines');
  if (lines) lines.style.display = 'none';
  inst.container.querySelectorAll('svg.subLines').forEach((el) => el.remove());
  const ns = 'http://www.w3.org/2000/svg';
  let svg = inst.container.querySelector<SVGSVGElement>('svg.mmap-bracket-lines');
  if (!svg) {
    svg = document.createElementNS(ns, 'svg');
    svg.classList.add('mmap-bracket-lines');
    svg.setAttribute('overflow', 'visible');
    nodes.appendChild(svg);
  }
  svg.innerHTML = '';
  const drawGroup = (
    parentTpc: HTMLElement | null,
    childTpcs: HTMLElement[],
  ) => {
    if (!parentTpc || childTpcs.length === 0) return;
    const p = {
      ...offsetInNodes(nodes, parentTpc),
      w: parentTpc.offsetWidth,
      h: parentTpc.offsetHeight,
    };
    const children = childTpcs.map((c) => ({
      ...offsetInNodes(nodes, c),
      w: c.offsetWidth,
      h: c.offsetHeight,
    }));
    const busX = p.x + p.w + 12;
    const topY = Math.min(...children.map((c) => c.y));
    const bottomY = Math.max(...children.map((c) => c.y + c.h));
    const color = getComputedStyle(parentTpc).borderColor || '#666';
    const d = [
      `M ${p.x + p.w} ${p.y + p.h / 2} L ${busX} ${p.y + p.h / 2}`,
      `M ${busX} ${topY} L ${busX} ${bottomY}`,
      ...children.map(
        (c) => `M ${busX} ${c.y + c.h / 2} L ${c.x} ${c.y + c.h / 2}`,
      ),
    ].join(' ');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', d);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    svg.appendChild(path);
  };
  const rootTpc = inst.container.querySelector<HTMLElement>('me-root > me-tpc');
  const firstLevelTpcs = Array.from(
    inst.container.querySelectorAll<HTMLElement>(
      'me-main > me-wrapper > me-parent > me-tpc',
    ),
  );
  drawGroup(rootTpc, firstLevelTpcs);
  inst.container.querySelectorAll('me-wrapper').forEach((wrapper) => {
    const parentTpc = wrapper.querySelector<HTMLElement>(
      ':scope > me-parent > me-tpc',
    );
    const childTpcs = Array.from(
      wrapper.querySelectorAll<HTMLElement>(
        ':scope > me-children > me-wrapper > me-parent > me-tpc',
      ),
    );
    drawGroup(parentTpc, childTpcs);
  });
}
export default function MindMapCanvas({ content, onChange, filePath, vaultRoot }: PreviewProps) {
  const { t } = useTranslation('mmap');
  const elRef = useRef<HTMLDivElement>(null);
  const instRef = useRef<MindElixirInstance | null>(null);
  const lastEmittedRef = useRef<string | null>(null);
  // Exposed so the styling panel can trigger a writeback after a style edit
  // (mind-elixir fires `operation` for reshapeNode but NOT for direct
  // theme.palette mutations like the rainbow toggle).
  const syncOutRef = useRef<(() => void) | null>(null);
  // ponytail: canvas-level runtime-only mapStyle (palette preset name,
  // background color, sibling alignment, topic spacing). rainbow/direction/
  // compact live in `inst` (read via getData at syncOut). State drives the
  // panel re-render; ref mirrors state so syncOut (captured at mount) reads
  // the latest without re-binding the operation listener.
  const [canvasStyle, setCanvasStyle] = useState<MmapMapStyle>({});
  const canvasStyleRef = useRef<MmapMapStyle>({});
  // ponytail: the default branch-line generators captured after the first
  // theme apply. changeTheme() resets them to mind-elixir's defaults, and the
  // org skeleton swaps in its own vertical connectors, so we need the originals
  // to restore when switching back to a non-org skeleton.
  const defaultMainBranchRef = useRef<MindElixirInstance['generateMainBranch']>(undefined);
  const defaultSubBranchRef = useRef<MindElixirInstance['generateSubBranch']>(undefined);
  // ponytail: single merged "样式" panel with two tabs (画布样式 / 节点样式).
  // Replaces the old `showCanvasPanel` + `showNodePanel` pair. The panel
  // only opens via the toolbar button — node clicks don't auto-open it
  // (matching the previous no-pop-on-click contract). Once open, the panel
  // stays open across node clicks: the node tab's content refreshes for
  // the new selection, the canvas tab is unaffected. Default tab is
  // 'canvas' because it works without a node selection; user switches to
  // 'node' to style the currently-selected node.
  const [showStylePanel, setShowStylePanel] = useState(false);
  const [activeStyleTab, setActiveStyleTab] = useState<'canvas' | 'node'>('canvas');
  const [previewSrc, setPreviewSrc] = useState<string | null>(null);
  const [notePopover, setNotePopover] = useState<{ text: string; x: number; y: number } | null>(null);
  // Track the currently-selected node's id + a tick to force a re-read of
  // the node's style after each style mutation (we don't store the style
  // object itself because reshapeNode replaces `nodeObj.style` with a new
  // reference and we'd be reading a stale snapshot).
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [, forceStyleReread] = useState(0);

  // ponytail: resolve the app theme ('light'|'dark'|'system') to a concrete
  // isDark boolean. mind-elixir's constructor auto-detects OS dark mode via
  // `prefers-color-scheme`, but it ignores the app's explicit `data-theme`
  // override (a user can set theme='light' while OS is dark). We re-sync on
  // every resolved-theme flip via `changeTheme` below. Lazy useState init so
  // the constructor gets the right theme on first mount (no flash).
  const themeSetting = useAppearanceStore((state) => state.theme);
  const [isDark, setIsDark] = useState<boolean>(() => {
    const s = useAppearanceStore.getState().theme;
    if (s === 'dark') return true;
    if (s === 'light') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    if (themeSetting !== 'system') {
      setIsDark(themeSetting === 'dark');
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setIsDark(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, [themeSetting]);

  // ponytail: apply the resolved dark/light theme to the canvas. mind-elixir
  // ships both THEME (Latte light) and DARK_THEME — we swap between them.
  // `changeTheme(theme, false)` updates cssVar on container.style (node
  // colors flip via CSS cascade — no refresh needed); `linkDiv()` redraws
  // SVG branch lines with the new palette. We also preserve the user's
  // rainbow-OFF state: changeTheme replaces `inst.theme` (and thus palette),
  // so if palette was the single-color MONO before, re-apply it after.
  // Ceiling: the canvas bg / node fills use mind-elixir's own dark palette,
  // not the app's exact `--bg`/`--panel` tokens — close enough for MVP; if
  // visual mismatch bothers anyone, swap DARK_THEME for a custom Theme
  // whose cssVar values reference `var(--bg)` etc. (container is under
  // `<html data-theme>`, so app CSS vars are reachable).
  const applyThemeToInst = useCallback((dark: boolean) => {
    const inst = instRef.current;
    if (!inst) return;
    const wasMono = (inst.theme.palette?.length ?? 10) <= 1;
    inst.changeTheme(dark ? DARK_THEME : THEME, false);
    if (wasMono) {
      inst.theme.palette = MONO_PALETTE;
    }
    inst.linkDiv();
  }, []);

  // ponytail: apply the skeleton (骨架) layout. Each non-default preset
  // switches the container's data attribute (driving scoped CSS) and installs
  // matching branch generators; 'mind' (and 'bracket', which draws its own
  // overlay) keep the captured mind-elixir defaults. timeline sub-branches
  // and fishbone sub-branches use their own vertical connectors.
  const applySkeleton = useCallback((inst: MindElixirInstance, skeleton: MmapSkeleton | undefined) => {
    const name = skeleton && skeleton !== 'mind' ? skeleton : 'mind';
    if (name === 'mind') {
      delete inst.container.dataset.mmapSkeleton;
    } else {
      inst.container.dataset.mmapSkeleton = name;
      ensureSkeletonStyle(inst.container);
    }
    const gen = SKELETON_BRANCHES[name];
    if (gen) {
      inst.generateMainBranch = gen;
      inst.generateSubBranch =
        name === 'timeline' ? treeBranch : name === 'fishbone' ? verticalBranch : gen;
      return;
    }
    if (defaultMainBranchRef.current) {
      inst.generateMainBranch = defaultMainBranchRef.current;
    }
    if (defaultSubBranchRef.current) {
      inst.generateSubBranch = defaultSubBranchRef.current;
    }
    if (name !== 'bracket') removeBracketOverlay(inst);
  }, []);

  // ponytail: apply canvas-level runtime-only mapStyle (palette preset,
  // background color, sibling alignment, topic spacing, skeleton) to the
  // mind-elixir instance. Called after init + after every theme swap
  // (changeTheme resets every cssVar on container.style, so overrides must be
  // re-applied). rainbow/compact live in `inst` and round-trip via
  // MindElixirData; direction is only touched when a skeleton implies it.
  //
  // Ceilings:
  //  - `palette` overrides `theme.palette` directly (same path as the
  //    rainbow toggle). Picking a preset implies rainbow ON (multi-color);
  //    if rainbow is OFF (mono), this is a no-op so mono wins.
  //  - `background` sets `--bgcolor` on container.style — mind-elixir reads
  //    it for the SVG map-canvas fill. Survives until the next changeTheme.
  //  - `alignment` mutates `inst.alignment` (read by mind-elixir's centering
  //    fn on every toCenter). Requires `refresh()` + `toCenter()` to apply.
  //  - `topicSpacing` sets `--node-gap-y` + `--main-gap-y`. Overridden by
  //    `compact: true` (mind-elixir hardcodes the gaps in compact mode), so
  //    the canvas panel disables this control when compact is on.
  const applyCanvasMapStyle = useCallback((ms: MmapMapStyle | undefined) => {
    const inst = instRef.current;
    if (!inst) return;
    const isMono = (inst.theme.palette?.length ?? 10) <= 1;
    if (ms?.palette && !isMono) {
      const colors = resolveCanvasPalette(ms.palette);
      if (colors) inst.theme.palette = colors;
    }
    if (ms?.background) {
      inst.container.style.setProperty('--bgcolor', ms.background);
    } else {
      inst.container.style.removeProperty('--bgcolor');
    }
    if (ms?.alignment) {
      // Cast: `alignment` is on MindElixirInstance via Required<Options>;
      // mutator pattern is the only way — no setter API.
      (inst as { alignment: 'root' | 'nodes' }).alignment = ms.alignment;
    }
    if (ms?.topicSpacing !== undefined && !inst.compact) {
      const px = `${ms.topicSpacing}px`;
      inst.container.style.setProperty('--node-gap-y', px);
      inst.container.style.setProperty('--main-gap-y', px);
    }
    // Skeleton presets imply a direction: mind = both sides; the rest are
    // right-branching (org/fishbone/timeline/tree/bracket). Enforce it here so
    // a stale data.direction can't fight the skeleton.
    if (
      ms?.skeleton === 'org' ||
      ms?.skeleton === 'tree' ||
      ms?.skeleton === 'fishbone' ||
      ms?.skeleton === 'timeline' ||
      ms?.skeleton === 'bracket'
    ) {
      if (inst.direction !== 1) inst.initRight();
    } else if (ms?.skeleton === 'mind') {
      if (inst.direction !== 2) inst.initSide();
    }
    applySkeleton(inst, ms?.skeleton);
    inst.layout();
    inst.linkDiv();
    inst.toCenter();
  }, []);

  // mind-elixir renders topic HTML via innerHTML, so React can't bind onClick
  // on those <img> nodes. One listener on the container catches them all;
  // upgrade to a portal-based lightbox lib only if zoom/pan is needed.
  // Also tracks the currently-selected node (mind-elixir's selectNode fires
  // no event on existing-node click — only selectNewNode for newly-created
  // nodes — so we read `inst.currentNode` after each click).
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onClick = (e: MouseEvent) => {
      // Update selection state regardless of click target (node click,
      // background click, image click). `inst.currentNode` reflects the
      // post-click selection state.
      const inst = instRef.current;
      if (inst) {
        // Use rAF so mind-elixir's click handler (which calls selectNode
        // synchronously) has run before we read `currentNode`. Click is
        // dispatched after pointerdown/up completes; mind-elixir's
        // selectNode is called from its pointerup handler in the same tick.
        requestAnimationFrame(() => {
          const cur = inst.currentNode as
            | { nodeObj?: { id?: string } }
            | null
            | undefined;
          setSelectedNodeId(cur?.nodeObj?.id ?? null);
        });
      }
      const target = (e.target as HTMLElement | null)?.closest('img');
      if (!target) return;
      const src = target.getAttribute('src');
      if (!src) return;
      e.preventDefault();
      setPreviewSrc(src);
    };
    el.addEventListener('click', onClick);
    return () => el.removeEventListener('click', onClick);
  }, []);

  // ponytail: native `title` tooltip doesn't fire reliably in the Tauri webview,
  // so a delegated `mouseover`/`mouseout` pair drives a single React-rendered
  // popover. `mouseover`/`mouseout` bubble (unlike `mouseenter`/`mouseleave`),
  // so one listener on the container covers every note icon — including ones
  // mind-elixir re-renders via innerHTML after each canvas edit.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onOver = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest('.mmap-note-icon');
      if (!target) return;
      const raw = target.getAttribute('data-note');
      if (raw == null) return;
      const rect = target.getBoundingClientRect();
      setNotePopover({ text: raw, x: rect.left, y: rect.bottom + 6 });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      // Only hide when leaving the icon entirely (not when moving between the
      // icon's own children — closest() still resolves to the icon there).
      if (related && related.closest('.mmap-note-icon')) return;
      setNotePopover(null);
    };
    el.addEventListener('mouseover', onOver);
    el.addEventListener('mouseout', onOut);
    return () => {
      el.removeEventListener('mouseover', onOver);
      el.removeEventListener('mouseout', onOut);
    };
  }, []);

  // Hide the popover on click-elsewhere inside the canvas (e.g. selecting a
  // different node). Independent of the lightbox click handler above.
  useEffect(() => {
    const el = elRef.current;
    if (!el) return;
    const onClick = () => setNotePopover(null);
    el.addEventListener('click', onClick, { capture: true });
    return () => el.removeEventListener('click', onClick, { capture: true });
  }, []);

  useEffect(() => {
    if (!previewSrc) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewSrc(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [previewSrc]);

  useEffect(() => {
    let disposed = false;

    // ponytail: image-load re-link (defined here, before async block, so the
    // cleanup closure can see it). me-tpc > img is `display:block`, so a
    // late-loading image resizes its topic AFTER linkDiv() already drew
    // branches against the pre-image offsetHeight — lines miss the node.
    // img `load` doesn't bubble, so capture phase on the container catches
    // every <img> mind-elixir re-renders via innerHTML. rAF so the new
    // layout is committed before we re-read offsets.
    const onImgLoad = (e: Event) => {
      if ((e.target as HTMLElement | null)?.tagName !== 'IMG') return;
      requestAnimationFrame(() => instRef.current?.linkDiv());
    };

    (async () => {
      const [{ default: MindElixir }, resolvedVaultRoot] = await Promise.all([
        import('mind-elixir'),
        resolveBasePath(vaultRoot),
        // @ts-expect-error — CSS module without type declaration
        import('mind-elixir/style'),
      ]);
      if (disposed || !elRef.current) return;

      const el = elRef.current;
      const inst = new MindElixir({
        el,
        editable: true,
        allowUndo: true,
        // ponytail: pass the resolved theme at construction so the first
        // paint matches the app — avoids a light→dark flash before the
        // isDark effect runs.
        theme: isDark ? DARK_THEME : THEME,
        markdown: createTopicMarkdown({ filePath, vaultRoot: resolvedVaultRoot }) as (
          text: string,
          obj: unknown,
        ) => string,
      });

      const syncOut = () => {
        if (!onChange) return;
        // ponytail: own serializer — mind-elixir's plaintextConverter drops
        // the `note` field, so canvas edits would silently delete notes if
        // we used it. mindElixirDataToOutline walks the tree and emits
        // `> ` continuation lines for any node carrying a note.
        // Pass canvasStyleRef so runtime-only fields (palette/background/
        // alignment/topicSpacing) round-trip alongside data-derived ones.
        const md = mindElixirDataToOutline(inst.getData(), canvasStyleRef.current);
        lastEmittedRef.current = md;
        onChange(md);
      };
      syncOutRef.current = syncOut;
      // ponytail: re-serialize on every operation. Full snapshot, no incremental
      // patch — fine for MVP; if large maps stutter, diff+patch by node id.
      inst.bus.addListener('operation', syncOut);

      // ponytail: redraw bracket-map connectors whenever mind-elixir finishes a
      // linkDiv pass (refresh / theme / add / delete all funnel through it).
      // The overlay hides the default branch lines and draws one bracket per
      // sibling group, so it must run after the lines exist.
      inst.bus.addListener('linkDiv', () => {
        const skeleton = canvasStyleRef.current.skeleton;
        if (skeleton === 'bracket') {
          drawBracketConnectors(inst);
        }
        if (skeleton === 'tree') {
          applyTreeNonLeafBoxes(inst);
        }
      });

      // ponytail: mind-elixir's beginEdit (Pt in MindElixir.js) places
      // #input-box at the topic element's top-left (`top: offsetTop`), but
      // the branch line connects to the topic's vertical center
      // (`e + o/2` in `at`/`dt`). For text-only nodes the gap is half a
      // line — invisible. For nodes with an image, the topic box is
      // image+8px+text tall, so the edit box floats above the branch line
      // by ~half the image height. Shift it down to vertically center on
      // the topic box so it always aligns with the connector.
      //
      // Deferred to the next animation frame: mind-elixir fires
      // `operation: beginEdit` synchronously right after appending
      // `#input-box` and setting its cssText, but its `Qe(t)` text-selection
      // call and the contentEditable focus can trigger a follow-up layout
      // pass in the same tick. Reading offsetHeight and patching `top`
      // inside the same synchronous listener ran before that layout settled,
      // so the shift was computed against a stale height and the edit box
      // ended up off-center — a visible gap remained between the caret and
      // the branch line. rAF defers the patch until after the browser has
      // committed the input box's final layout for this frame.
      // Upgrade: patch mind-elixir itself if other edit-box quirks appear.
      inst.bus.addListener(
        'operation',
        (op: { name: string; obj?: { id?: string } }) => {
          if (op.name !== 'beginEdit' || !op.obj?.id) return;
          const nodeId = op.obj.id;
          requestAnimationFrame(() => {
            const tpc = el.querySelector<HTMLElement>(
              `me-tpc[data-nodeid="me${nodeId}"]`,
            );
            const inputBox = el.querySelector<HTMLElement>('#input-box');
            if (!tpc || !inputBox) return;
            // Align input box vertical CENTER with tpc vertical CENTER.
            // mind-elixir sets `inputBox.style.top` to tpc's offsetTop
            // within `.map-canvas me-nodes` (the positioned ancestor of
            // #input-box), so we read that as the base and add half the
            // height delta. Using `inputBox.style.top` (not `tpc.offsetTop`)
            // because tpc's offsetParent is `me-parent`, not `me-nodes` —
            // a different reference frame than the input box's.
            const baseTop = parseFloat(inputBox.style.top || '0');
            const targetTop =
              baseTop + (tpc.offsetHeight - inputBox.offsetHeight) / 2;
            if (targetTop === baseTop) return;
            inputBox.style.top = `${targetTop}px`;
          });
        },
      );

      // ponytail: create-style operation listener — when a createStyle preset
      // is selected, apply its style to newly created nodes (addChild,
      // insertSibling, insertParent). Uses rAF so mind-elixir's DOM render
      // completes before we query for the new topic element.
      inst.bus.addListener(
        'operation',
        (op: { name: string; obj?: { id?: string } }) => {
          if (
            op.name !== 'addChild' &&
            op.name !== 'insertSibling' &&
            op.name !== 'insertParent'
          ) return;
          const createStyleName = canvasStyleRef.current.createStyle;
          if (!createStyleName || createStyleName === 'default' || !op.obj?.id) return;
          const preset = CREATE_STYLES[createStyleName];
          if (!preset || Object.keys(preset.style).length === 0) return;
          requestAnimationFrame(() => {
            const inst = instRef.current;
            const tpc = inst?.container.querySelector<HTMLElement>(
              `me-tpc[data-nodeid="me${op.obj!.id}"]`,
            );
            if (!tpc) return;
            inst!.reshapeNode(tpc as never, { style: { ...preset.style } } as never);
          });
        },
      );

      const data = outlineToMindElixirData(toSafeSrc(content));
      inst.init(data);
      // ponytail: re-apply dark/light + rainbow-OFF preservation. `init`
      // calls `changeTheme(data.theme || this.theme, false)` — when rainbow
      // is OFF, `data.theme` is the mono theme (light cssVar), which would
      // reset the canvas to light even in dark mode. This call restores the
      // resolved dark/light cssVar and re-applies the mono palette if needed.
      applyThemeToInst(isDark);
      // Capture the theme-resolved default generators once; the org skeleton
      // swaps these out and changeTheme() resets them on every theme flip.
      defaultMainBranchRef.current = inst.generateMainBranch;
      defaultSubBranchRef.current = inst.generateSubBranch;
      // ponytail: read runtime-only canvas-level mapStyle (palette/background/
      // alignment/topicSpacing/skeleton) from the source meta and apply them post-init
      // + post-theme-swap (changeTheme resets all cssVars). direction/compact
      // are already in `data` and applied by init.
      const runtimeMs = readRuntimeMapStyle(toSafeSrc(content));
      canvasStyleRef.current = runtimeMs;
      setCanvasStyle(runtimeMs);
      instRef.current = inst;
      applyCanvasMapStyle(runtimeMs);

      el.addEventListener('load', onImgLoad, true);
      // Catch font swaps (e.g. Microsoft YaHei fallback → real face) which
      // also shift topic heights after linkDiv ran.
      (document as Document & { fonts?: FontFaceSet }).fonts?.ready.then(
        () => requestAnimationFrame(() => instRef.current?.linkDiv()),
      );
      // ponytail: expose the mind-elixir instance on the host element so
      // HTML export can call inst.exportSvg() and grab the live render
      // instead of mounting a parallel instance. mind-elixir's exportSvg
      // serializes the live DOM (nodes + branch lines + summaries), so
      // going through the same instance the user sees is more faithful
      // than re-mounting with default theme.
      if (elRef.current) {
        (elRef.current as any).__mindElixir = inst;
        elRef.current.setAttribute('data-mmap-instance-host', '');
      }
    })();

    return () => {
      disposed = true;
      const elCleanup = elRef.current;
      if (elCleanup) {
        delete (elCleanup as any).__mindElixir;
        elCleanup.removeAttribute('data-mmap-instance-host');
        elCleanup.removeEventListener('load', onImgLoad, true);
      }
      instRef.current?.destroy();
      instRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // External source change → re-init unless it matches the string we just
  // emitted (which would be the feedback from our own onChange writeback).
  useEffect(() => {
    if (!instRef.current || content === lastEmittedRef.current) return;
    // ponytail: full re-init on external edit. Loses cursor/zoom/scroll state
    // on every keystroke in the source pane — acceptable for MVP; upgrade to
    // id-based diff+patch when it annoies.
    instRef.current.init(outlineToMindElixirData(toSafeSrc(content)));
    // Re-apply dark/light + rainbow-OFF (init reset theme to data.theme or
    // this.theme — see mount-effect comment for the mono-theme bug).
    applyThemeToInst(isDark);
    // Re-apply canvas-level mapStyle (changeTheme reset all cssVars).
    const runtimeMs = readRuntimeMapStyle(toSafeSrc(content));
    canvasStyleRef.current = runtimeMs;
    setCanvasStyle(runtimeMs);
    applyCanvasMapStyle(runtimeMs);
    setSelectedNodeId(null);
  }, [content, isDark, applyThemeToInst, applyCanvasMapStyle]);

  // ponytail: runtime theme flip — when the user toggles light/dark (or OS
  // preference changes while on 'system'), swap the canvas theme. Skips the
  // first run (mount effect already applied the initial theme).
  const didFirstRunRef = useRef(false);
  useEffect(() => {
    if (!didFirstRunRef.current) {
      didFirstRunRef.current = true;
      return;
    }
    applyThemeToInst(isDark);
    // changeTheme reset every cssVar — re-apply canvas-level overrides.
    applyCanvasMapStyle(canvasStyleRef.current);
  }, [isDark, applyThemeToInst, applyCanvasMapStyle]);

  // ponytail: apply a full style object (REPLACE, not merge) to the
  // currently-selected node. Path: read `inst.currentNode` (the Topic DOM
  // element) → mutate `nodeObj.style` on the data model → clear the topic
  // element's inline `style.cssText` so mind-elixir's `ve` re-applies only
  // the new keys (otherwise stale keys from a previous style linger on the
  // DOM, since `ve` only SETS keys present in `nodeObj.style`, never
  // clears) → call `reshapeNode` to re-render the topic + fire `operation`
  // (which our listener picks up to write back the source).
  // For reset: pass `undefined` — clears `nodeObj.style` AND `cssText`,
  // then reshapeNode with `{}` (no patch) re-renders the topic bare.
  const applyStyleToSelected = useCallback(
    (newStyle: MmapNodeStyle | undefined) => {
      const inst = instRef.current;
      const tpc = inst?.currentNode as
        | (HTMLElement & { nodeObj?: { id?: string; style?: MmapNodeStyle } })
        | null
        | undefined;
      if (!inst || !tpc || !tpc.nodeObj) return;
      setNodeStyleOnObj(tpc.nodeObj, newStyle);
      // Clear inline styles so `ve`'s `e.style[o]=n[o]` loop re-applies only
      // the new keys (prevents stale color/background leaking from a prior
      // preset). `ve` itself only SETS keys — it never clears, so we must
      // wipe the slate manually.
      tpc.style.cssText = '';
      // Cast: reshapeNode's TS signature wants `Partial<NodeObj>` with the
      // official style shape; ours adds `fontStyle`. Runtime is permissive.
      inst.reshapeNode(
        tpc as never,
        (newStyle ? { style: newStyle } : {}) as never,
      );
      forceStyleReread((n) => n + 1);
    },
    [],
  );

  // Patch a single style field on the selected node (merge with current).
  const patchStyleField = useCallback(
    (patch: MmapNodeStyle) => {
      const inst = instRef.current;
      const tpc = inst?.currentNode as
        | (HTMLElement & { nodeObj?: { id?: string; style?: MmapNodeStyle } })
        | null
        | undefined;
      if (!inst || !tpc || !tpc.nodeObj) return;
      const cur = readNodeStyle(tpc.nodeObj);
      // Toggle semantics for fontWeight / fontStyle / textDecoration: if
      // the new value matches the current, treat as a toggle-OFF (drop the
      // key). Otherwise set. Lets the panel's B/I/strikethrough buttons
      // behave as toggles without separate on/off wiring.
      const merged: MmapNodeStyle = { ...cur };
      for (const [k, v] of Object.entries(patch)) {
        const key = k as keyof MmapNodeStyle;
        if (
          (key === 'fontWeight' || key === 'fontStyle' || key === 'textDecoration') &&
          v === cur[key]
        ) {
          delete merged[key];
        } else {
          merged[key] = v as never;
        }
      }
      applyStyleToSelected(merged);
    },
    [applyStyleToSelected],
  );

  // ponytail: rainbow toggle — swap `inst.theme.palette` between the
  // default multi-color Latte palette and a single muted gray, then call
  // `linkDiv()` to re-draw the branches. `operation` doesn't fire for
  // theme mutations, so we trigger `syncOutRef.current?.()` manually to
  // write back the `mapStyle: {rainbow:bool}` directive. When toggling
  // rainbow OFF, drop any palette preset from canvasStyleRef — mono wins.
  const setRainbow = useCallback((on: boolean) => {
    const inst = instRef.current;
    if (!inst) return;
    inst.theme.palette = on ? RAINBOW_PALETTE : MONO_PALETTE;
    if (!on && canvasStyleRef.current.palette) {
      const next = { ...canvasStyleRef.current, palette: undefined };
      delete next.palette;
      canvasStyleRef.current = next;
      setCanvasStyle(next);
    }
    inst.linkDiv();
    syncOutRef.current?.();
  }, []);

  // ponytail: canvas-level direction mutator. mind-elixir exposes
  // `initLeft/initRight/initSide` (0/1/2) — each fires `changeDirection`
  // (NOT `operation`), so we trigger syncOut manually. No UP/DOWN —
  // ceiling documented in outlineConverter.ts (`MmapDirection`).
  const setDirection = useCallback((d: MmapDirection) => {
    const inst = instRef.current;
    if (!inst) return;
    if (d === 0) inst.initLeft();
    else if (d === 1) inst.initRight();
    else inst.initSide();
    // A manual direction change replaces the skeleton's implied layout;
    // fall back to the standard mind map so the two settings can't conflict.
    const next = { ...canvasStyleRef.current };
    if (next.skeleton) {
      delete next.skeleton;
      canvasStyleRef.current = next;
      setCanvasStyle(next);
      applySkeleton(inst, 'mind');
      inst.linkDiv();
    }
    syncOutRef.current?.();
  }, [applySkeleton]);

  // ponytail: skeleton (骨架) mutator. mind switches back to the classic
  // both-sides map; every other preset is right-branching (org layers the
  // top-down CSS + connectors on top of RIGHT).
  const setSkeleton = useCallback((skeleton: MmapSkeleton) => {
    const inst = instRef.current;
    if (!inst) return;
    if (skeleton === 'mind') {
      inst.initSide();
    } else if (
      skeleton === 'org' ||
      skeleton === 'tree' ||
      skeleton === 'fishbone' ||
      skeleton === 'timeline' ||
      skeleton === 'bracket'
    ) {
      if (inst.direction !== 1) inst.initRight();
    }
    applySkeleton(inst, skeleton);
    const next = { ...canvasStyleRef.current };
    if (skeleton === 'mind') delete next.skeleton;
    else next.skeleton = skeleton;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    inst.layout();
    inst.linkDiv();
    inst.toCenter();
    syncOutRef.current?.();
  }, [applySkeleton]);

  // ponytail: palette preset mutator — swap `inst.theme.palette` to the
  // preset's color array + redraw branches. Picking a preset implies
  // rainbow ON (multi-color), so we also clear any `rainbow:false` from
  // canvasStyleRef. No-op if rainbow is currently OFF — caller should
  // disable the control instead.
  const setPalettePreset = useCallback((name: string | undefined) => {
    const inst = instRef.current;
    if (!inst) return;
    const isMono = (inst.theme.palette?.length ?? 10) <= 1;
    if (isMono) return;
    const colors = name ? resolveCanvasPalette(name) : undefined;
    inst.theme.palette = colors ?? RAINBOW_PALETTE;
    const next = { ...canvasStyleRef.current };
    if (name) next.palette = name;
    else delete next.palette;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    inst.linkDiv();
    syncOutRef.current?.();
  }, []);

  // ponytail: canvas background mutator — set/remove `--bgcolor` on
  // container.style. No layout/redraw needed (SVG fill reads the var live).
  const setCanvasBackground = useCallback((bg: string | undefined) => {
    const inst = instRef.current;
    if (!inst) return;
    if (bg) inst.container.style.setProperty('--bgcolor', bg);
    else inst.container.style.removeProperty('--bgcolor');
    const next = { ...canvasStyleRef.current };
    if (bg) next.background = bg;
    else delete next.background;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    syncOutRef.current?.();
  }, []);

  // ponytail: sibling alignment mutator — 'root' (default, aligns to root)
  // vs 'nodes' (centers the whole tree). `inst.alignment` is read by
  // mind-elixir's centering fn on every toCenter(); mutating it then
  // refresh+toCenter applies. Default 'root' omitted from canvasStyle.
  const setAlignment = useCallback((mode: 'root' | 'nodes') => {
    const inst = instRef.current;
    if (!inst) return;
    (inst as { alignment: 'root' | 'nodes' }).alignment = mode;
    inst.refresh();
    inst.toCenter();
    const next = { ...canvasStyleRef.current };
    if (mode === 'nodes') next.alignment = mode;
    else delete next.alignment;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    syncOutRef.current?.();
  }, []);

  // ponytail: topic-spacing mutator — sets `--node-gap-y` + `--main-gap-y`.
  // No-op when `compact: true` (mind-elixir hardcodes gaps in compact mode,
  // overriding any container.style value). The control is disabled in the
  // panel when compact is on, but guard anyway.
  const setTopicSpacing = useCallback((px: number | undefined) => {
    const inst = instRef.current;
    if (!inst || inst.compact) return;
    if (px !== undefined) {
      const val = `${px}px`;
      inst.container.style.setProperty('--node-gap-y', val);
      inst.container.style.setProperty('--main-gap-y', val);
    } else {
      inst.container.style.removeProperty('--node-gap-y');
      inst.container.style.removeProperty('--main-gap-y');
    }
    const next = { ...canvasStyleRef.current };
    if (px !== undefined) next.topicSpacing = px;
    else delete next.topicSpacing;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    inst.layout();
    inst.linkDiv();
    syncOutRef.current?.();
  }, []);

  // ponytail: compact (骨架) mutator — toggles mind-elixir's compact mode
  // via changeCompact, which adjusts node spacing. After toggling, re-layout
  // and re-center the canvas. syncOut so the compact field persists.
  const setCompact = useCallback((on: boolean) => {
    const inst = instRef.current;
    if (!inst) return;
    inst.changeCompact(on);
    inst.layout();
    inst.linkDiv();
    inst.toCenter();
    syncOutRef.current?.();
  }, []);

  // ponytail: create-style (创建风格) mutator — stores the selected preset
  // name in canvasStyleRef. The actual style application happens in the
  // operation listener (see mount effect), which catches addChild/insertSibling
  // /insertParent and applies the preset's style to the new node.
  const setCreateStyle = useCallback((name: string | undefined) => {
    const next = { ...canvasStyleRef.current };
    if (name && name !== 'default') next.createStyle = name;
    else delete next.createStyle;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    syncOutRef.current?.();
  }, []);

  // ponytail: free-layout (分支自由布局) mutator — enables/disables free drag
  // positioning. When enabled, node positions are saved before each layout
  // and restored after, so the auto-layout doesn't reset user-placed positions.
  const freeLayoutPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());

  const saveAllPositions = useCallback((inst: MindElixirInstance) => {
    const pos = new Map<string, { x: number; y: number }>();
    const data = inst.getData();
    const walk = (node: { id?: string; left?: number; top?: number; children?: unknown[] }) => {
      if (node.id && node.left !== undefined && node.top !== undefined) {
        pos.set(node.id, { x: node.left, y: node.top });
      }
      for (const child of node.children ?? []) walk(child as never);
    };
    walk(data.nodeData as never);
    freeLayoutPositionsRef.current = pos;
  }, []);

  const setFreeLayout = useCallback((on: boolean) => {
    const inst = instRef.current;
    if (!inst) return;
    if (on) {
      saveAllPositions(inst);
    } else {
      freeLayoutPositionsRef.current = new Map();
    }
    const next = { ...canvasStyleRef.current };
    if (on) next.freeLayout = true;
    else delete next.freeLayout;
    canvasStyleRef.current = next;
    setCanvasStyle(next);
    syncOutRef.current?.();
  }, [saveAllPositions]);

  // Read the currently-selected node's style for panel display. Re-reads
  // on every render so we always show the latest state (forceStyleReread
  // bumps a dummy state counter to trigger a re-render after a style
  // mutation in case the panel was already visible).
  const selectedTpc = instRef.current?.currentNode as
    | (HTMLElement & { nodeObj?: { id?: string; style?: MmapNodeStyle } })
    | null
    | undefined;
  const selectedStyle: MmapNodeStyle =
    selectedTpc?.nodeObj?.id === selectedNodeId
      ? readNodeStyle(selectedTpc.nodeObj)
      : {};

  // Read rainbow state from `inst.theme.palette` length.
  const rainbowOn =
    (instRef.current?.theme.palette?.length ?? RAINBOW_PALETTE.length) > 1;

  // Read the live direction/compact from `inst` (the canvas mutates these
  // via initLeft/Right/Side and changeCompact — they're not in canvasStyleRef).
  const liveDirection = (instRef.current?.direction ?? 1) as MmapDirection;
  const liveCompact = instRef.current?.compact ?? false;

  return (
    <div className="flex w-full h-full overflow-hidden">
      <div className="relative flex-1 min-w-0 overflow-hidden">
        <div ref={elRef} className="w-full h-full overflow-hidden" />
      {/* ponytail: config toolbar pinned to right edge, vertically centered.
          Vertical strip — Settings2 on top, then 3 direction buttons (向左/
          向右/双侧). Direction icons are mind-elixir's own bundled SVGs
          (tbltl/tbltr/tblts), lifted verbatim — no new icon set. A SIBLING
          of elRef, not a descendant, so mind-elixir's own listeners never
          see clicks here. */}
      <div
        className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1.5 z-[800]"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={`h-8 w-8 rounded border border-brd bg-panel text-t1 hover:bg-hov shadow-sm flex items-center justify-center active:scale-[0.96] transition-transform ${showStylePanel ? 'border-acc text-acc' : ''}`}
          onClick={() => setShowStylePanel((v) => !v)}
          title={t('toolbar.style')}
        >
          <Settings2 size={14} />
        </button>
        {([
          { d: 0 as MmapDirection, key: 'left' as const },
          { d: 1 as MmapDirection, key: 'right' as const },
          { d: 2 as MmapDirection, key: 'side' as const },
        ]).map(({ d, key }) => {
          const active = liveDirection === d;
          return (
            <button
              key={d}
              type="button"
              className={`h-8 w-8 rounded border border-brd bg-panel shadow-sm flex items-center justify-center active:scale-[0.96] transition-transform ${active ? 'border-acc text-acc' : 'text-t1 hover:bg-hov'}`}
              onClick={() => setDirection(d)}
              title={t('toolbar.direction', { dir: t('canvas.direction' + (key === 'side' ? 'Both' : key.charAt(0).toUpperCase() + key.slice(1))) })}
            >
              <svg width="16" height="16" viewBox="0 0 1024 1024" fill="currentColor">
                <path d={DIR_ICON_PATHS[key]} />
              </svg>
            </button>
          );
        })}
      </div>
      </div>
      {showStylePanel && (
        <StylePanel
          activeTab={activeStyleTab}
          onTabChange={setActiveStyleTab}
          onClose={() => setShowStylePanel(false)}
          // canvas-tab props
          mapStyle={canvasStyle}
          direction={liveDirection}
          compact={liveCompact}
          rainbowOn={rainbowOn}
          onDirection={setDirection}
          onPalette={setPalettePreset}
          onBackground={setCanvasBackground}
          onAlignment={setAlignment}
          onTopicSpacing={setTopicSpacing}
          skeleton={canvasStyle.skeleton ?? 'mind'}
          onSkeleton={setSkeleton}
          onCompact={setCompact}
          onCreateStyle={setCreateStyle}
          onFreeLayout={setFreeLayout}
          // node-tab props
          hasSelection={!!selectedNodeId}
          nodeStyle={selectedStyle}
          onPatchNode={patchStyleField}
          onReplaceNode={applyStyleToSelected}
          onResetNode={() => applyStyleToSelected(undefined)}
          onRainbowToggle={() => setRainbow(!rainbowOn)}
        />
      )}
      {previewSrc && (
        <div
          className="fixed inset-0 z-[1000] bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
          onClick={() => setPreviewSrc(null)}
        >
          <img
            src={previewSrc}
            alt=""
            className="max-w-[90vw] max-h-[90vh] object-contain select-none"
            draggable={false}
          />
        </div>
      )}
      {notePopover && (
        <div
          className="fixed z-[1001] max-w-[320px] rounded bg-surf border border-brd text-t1 text-xs px-2.5 py-1.5 shadow-lg whitespace-pre-wrap pointer-events-none"
          style={{ left: notePopover.x, top: notePopover.y }}
        >
          {notePopover.text}
        </div>
      )}
    </div>
  );
}

// ponytail: the styling panel is a self-contained presentational component
// with no store coupling — receives the current style + callbacks. Native
// HTML inputs only (color picker, number input, checkboxes) — no UI library
// pulled in. Per the file-type styling spec, inline styles use CSS vars
// (`--panel`, `--surf`, `--brd`, `--hov`, `--acc`, `--t1`/`--t2`/`--t3`)
// so light/dark themes adapt automatically.
//
// Ceiling: 连线线宽 (line width) control is NOT implemented — mind-elixir
// hardcodes main/sub branch stroke widths (3/2 in MindElixir.js).
// Overriding would mean patching generateMainBranch / generateSubBranch.
// The panel's line-width row is a placeholder that documents the gap.
interface StylingPanelProps {
  style: MmapNodeStyle;
  rainbowOn: boolean;
  onPatch: (patch: MmapNodeStyle) => void;
  onReplace: (style: MmapNodeStyle) => void;
  onReset: () => void;
  onRainbowToggle: () => void;
}

function StylingPanel({
  style,
  rainbowOn,
  onPatch,
  onReplace,
  onReset,
  onRainbowToggle,
}: StylingPanelProps) {
  const { t } = useTranslation('mmap');
  const labelCls = 'text-t3 text-[12px] font-medium w-[46px] shrink-0';
  const rowCls = 'flex items-center gap-2';
  const inputCls =
    'bg-surf2 border border-brd rounded px-1 py-0.5 text-[11px] text-t1 outline-none focus:border-acc';
  const btnCls =
    'h-[22px] min-w-[22px] px-1 rounded border border-brd bg-surf2 text-[12px] text-t1 hover:bg-hov';
  const btnActiveCls = 'border-acc bg-accdim text-acc';

  const isBold = style.fontWeight === 'bold';
  const isItalic = style.fontStyle === 'italic';
  // ponytail: no standalone strikethrough toggle button in the text row —
  // the 删除 preset applies strikethrough. A T/strike button can be wired
  // later by reading `style.textDecoration === 'line-through'` and calling
  // `onPatch({ textDecoration: 'line-through' })`.

  // parse the existing `border: "${w}px solid ${c}"` shorthand so the
  // border-width + border-color inputs show the current values when
  // re-opening the panel on an already-styled node.
  const borderMatch = style.border
    ? style.border.match(/^(\d+)px\s+solid\s+(.+)$/)
    : null;
  const borderWidth = borderMatch?.[1] ?? DEFAULT_BORDER_WIDTH;
  const borderColor = borderMatch?.[2] ?? '#9ca3af';

  const applyBorder = (width: string, color: string) => {
    onPatch({ border: `${width || '1'}px solid ${color || '#9ca3af'}` });
  };

  return (
    <>
      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>{t('node.font')}</span>
          <select
            className={`${inputCls} flex-1`}
            value={style.fontFamily ?? DEFAULT_FONT_FAMILY}
            onChange={(e) => onPatch({ fontFamily: e.target.value })}
          >
            <option value="Microsoft YaHei">{t('node.fontMicrosoft')}</option>
            <option value="PingFang SC">{t('node.fontPingfang')}</option>
            <option value="SimSun">{t('node.fontSimsun')}</option>
            <option value="SimHei">{t('node.fontSimhei')}</option>
            <option value="Helvetica">Helvetica</option>
            <option value="Arial">Arial</option>
            <option value="monospace">monospace</option>
          </select>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>{t('node.fontSize')}</span>
          <input
            type="number"
            min={8}
            max={48}
            className={`${inputCls} w-[56px]`}
            value={style.fontSize ?? DEFAULT_FONT_SIZE}
            onChange={(e) =>
              onPatch({ fontSize: `${e.target.value || '14'}px` })
            }
          />
          <button
            type="button"
            className={`${btnCls} font-bold ${isBold ? btnActiveCls : ''}`}
            onClick={() => onPatch({ fontWeight: 'bold' })}
            title={t('node.bold')}
          >
            B
          </button>
          <button
            type="button"
            className={`${btnCls} italic ${isItalic ? btnActiveCls : ''}`}
            onClick={() => onPatch({ fontStyle: 'italic' })}
            title={t('node.italic')}
          >
            I
          </button>
          <input
            type="color"
            className="w-[22px] h-[22px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={style.color ?? '#18181b'}
            onChange={(e) => onPatch({ color: e.target.value })}
            title={t('node.textColor')}
          />
        </div>
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>{t('node.fill')}</span>
          <input
            type="color"
            className="w-[22px] h-[22px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={style.background ?? '#ffffff'}
            onChange={(e) => onPatch({ background: e.target.value })}
          />
        </div>
        <div className={rowCls}>
          <span className={labelCls}>{t('node.border')}</span>
          <input
            type="color"
            className="w-[22px] h-[22px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={borderColor}
            onChange={(e) => applyBorder(borderWidth, e.target.value)}
          />
          <input
            type="number"
            min={0}
            max={20}
            className={`${inputCls} w-[48px]`}
            value={borderWidth}
            onChange={(e) => applyBorder(e.target.value, borderColor)}
          />
          <span className="text-t3 text-[10px]">px</span>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>{t('node.fixedWidth')}</span>
          <input
            type="number"
            min={40}
            max={600}
            className={`${inputCls} w-[56px]`}
            value={
              style.width ? style.width.replace(/px$/, '') : DEFAULT_FIXED_WIDTH
            }
            onChange={(e) =>
              onPatch({ width: `${e.target.value || '120'}px` })
            }
          />
          <span className="text-t3 text-[10px]">px</span>
        </div>
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>{t('node.line')}</span>
          {/* ponytail: line-width control deferred — mind-elixir hardcodes
              main/sub branch stroke widths (3/2 in MindElixir.js). Re-add
              when overriding generateMainBranch becomes worth it. */}
          <span className="text-t3 text-[10px]">3px</span>
          <span className="text-t3 text-[11px] ml-auto">{t('node.rainbow')}</span>
          <button
            type="button"
            className={`${btnCls} ${rainbowOn ? btnActiveCls : ''}`}
            onClick={onRainbowToggle}
            title={t('node.rainbowTitle')}
          >
            {rainbowOn ? 'ON' : 'OFF'}
          </button>
        </div>
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className="text-t3 text-[11px] font-medium">{t('node.presets')}</div>
        <div className="grid grid-cols-3 gap-1">
          {Object.entries(PRESET_STYLES).map(([key, preset]) => (
            <button
              key={key}
              type="button"
              className="h-[28px] rounded border border-brd text-[12px] hover:bg-hov"
              style={{
                background: preset.style.background ?? 'transparent',
                color: preset.style.color ?? 'var(--t1)',
                textDecoration: preset.style.textDecoration,
                fontWeight: preset.style.fontWeight as 'bold' | undefined,
              }}
              onClick={() => onReplace({ ...preset.style })}
              title={t(`preset.${key}`)}
            >
              {t(`preset.${key}`)}
            </button>
          ))}
        </div>
      </div>

      <div className="px-2.5 py-2">
        <button
          type="button"
          className={`${btnCls} w-full h-[24px]`}
          onClick={onReset}
          title={t('node.resetTitle')}
        >
          {t('node.reset')}
        </button>
      </div>
    </>
  );
}

// ponytail: CanvasStylePanel — canvas-level "画布样式" panel, distinct from
// the per-node StylingPanel. Receives the runtime-only mapStyle fields
// (palette/background/alignment/topicSpacing) + the live direction/compact
// state read from `inst` + callbacks. Native HTML inputs only.
//
// Ceilings (rendered as disabled controls with tooltips, NOT stubbed):
//  - 骨架 (skeleton/layout type): mind/org/tree/fishbone/timeline/bracket
//    implemented via direction + CSS/branch overrides. Matrix and other
//    exotic layouts are not — hand-rolling them would be a layout engine.
//  - 方向 up/down: mind-elixir only supports left/right/side. Dropdown lists
//    only the three; up/down omitted (not rendered as disabled to avoid
//    implying a feature that doesn't exist).
//  - 分支自由布局 (free branch layout): now implemented. Positions are saved
//    before each layout and restored after, so auto-layout doesn't reset.
//  - 水印 (watermark): mind-elixir has no watermark API. Omitted entirely
//    (not even rendered as a disabled control — would be pure theater).

// ponytail: StylePanel — single merged panel replacing the old split
// CanvasStylePanel + StylingPanel. Tabs header switches between 画布样式
// (canvas-level palette/background/alignment/topicSpacing/direction) and
// 节点样式 (per-node font/fill/border/presets). The two bodies are the
// existing CanvasStylePanel + StylingPanel components, refactored to
// header-less fragments (this wrapper provides the absolute container +
// tabs + close X so the bodies don't need their own). When the user
// switches to 节点样式 without a selection, we render a placeholder
// instead of the body so the panel doesn't flash empty controls.
interface StylePanelProps extends CanvasStylePanelProps {
  activeTab: 'canvas' | 'node';
  onTabChange: (tab: 'canvas' | 'node') => void;
  onClose: () => void;
  hasSelection: boolean;
  nodeStyle: MmapNodeStyle;
  onPatchNode: (patch: MmapNodeStyle) => void;
  onReplaceNode: (style: MmapNodeStyle) => void;
  onResetNode: () => void;
  onRainbowToggle: () => void;
}

function StylePanel(props: StylePanelProps) {
  const { t } = useTranslation('mmap');
  const {
    activeTab,
    onTabChange,
    onClose,
    hasSelection,
    // node-tab props
    nodeStyle,
    onPatchNode,
    onReplaceNode,
    onResetNode,
    onRainbowToggle,
    // canvas-tab props (spread remainder)
    ...canvasProps
  } = props;
  const tabBtnCls = (active: boolean) =>
    `flex-1 px-3 py-2 text-[12px] font-medium border-b-2 ${
      active
        ? 'border-acc text-acc'
        : 'border-transparent text-t3 hover:text-t1'
    }`;
  return (
    <div
      className="w-[260px] shrink-0 h-full flex flex-col border-l border-brd bg-panel text-t1"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-center border-b border-brd shrink-0">
        <button
          type="button"
          className={tabBtnCls(activeTab === 'canvas')}
          onClick={() => onTabChange('canvas')}
        >
          {t('stylePanel.canvasTab')}
        </button>
        <button
          type="button"
          className={tabBtnCls(activeTab === 'node')}
          onClick={() => onTabChange('node')}
        >
          {t('stylePanel.nodeTab')}
        </button>
        <button
          type="button"
          className="text-t3 hover:text-t1 text-[14px] leading-none px-2"
          onClick={onClose}
          title={t('stylePanel.close')}
        >
          ×
        </button>
      </div>
      <div className="flex-1 overflow-auto">
        {activeTab === 'canvas' ? (
          <CanvasStylePanel {...canvasProps} />
        ) : (
          // ponytail: when no node is selected, render the StylingPanel body
          // disabled+greyed rather than a placeholder. `<fieldset disabled>`
          // natively disables every form control inside; opacity-60 signals
          // the state visually. Keeps the layout stable so toggling
          // selection doesn't reflow the sidebar.
          <fieldset
            disabled={!hasSelection}
            className={`border-0 p-0 m-0 min-w-0 ${!hasSelection ? 'opacity-60 pointer-events-none' : ''}`}
          >
            <StylingPanel
              style={nodeStyle}
              rainbowOn={props.rainbowOn}
              onPatch={onPatchNode}
              onReplace={onReplaceNode}
              onReset={onResetNode}
              onRainbowToggle={onRainbowToggle}
            />
          </fieldset>
        )}
      </div>
    </div>
  );
}

interface CanvasStylePanelProps {
  mapStyle: MmapMapStyle;
  direction: MmapDirection;
  compact: boolean;
  rainbowOn: boolean;
  onDirection: (d: MmapDirection) => void;
  onPalette: (name: string | undefined) => void;
  onBackground: (bg: string | undefined) => void;
  onAlignment: (mode: 'root' | 'nodes') => void;
  onTopicSpacing: (px: number | undefined) => void;
  skeleton: MmapSkeleton;
  onSkeleton: (skeleton: MmapSkeleton) => void;
  onCompact: (on: boolean) => void;
  onCreateStyle: (name: string | undefined) => void;
  onFreeLayout: (on: boolean) => void;
}

function CanvasStylePanel({
  mapStyle,
  direction,
  compact,
  rainbowOn,
  onDirection,
  onPalette,
  onAlignment,
  onBackground,
  onTopicSpacing,
  skeleton,
  onSkeleton,
  onCompact,
  onCreateStyle,
  onFreeLayout,
}: CanvasStylePanelProps) {
  const { t } = useTranslation('mmap');
  const labelCls = 'text-t3 text-[12px] font-medium w-[54px] shrink-0';
  const rowCls = 'flex items-center gap-2';
  const inputCls =
    'bg-surf2 border border-brd rounded px-1 py-0.5 text-[12px] text-t1 outline-none focus:border-acc disabled:opacity-50 disabled:cursor-not-allowed';
  const checkboxCls = 'w-[14px] h-[14px] accent-[var(--acc)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed';

  // palette is grayed out when rainbow is OFF (mono wins).
  const paletteDisabled = !rainbowOn;
  // topic spacing is grayed out when compact is ON (compact hardcodes gaps).
  const spacingDisabled = compact;

  return (
    <>
      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className="text-t3 text-[11px] font-medium">{t('canvas.sectionTheme')}</div>
        <div className={rowCls} title={t('canvas.skeletonTitle')}>
          <span className={labelCls}>{t('canvas.skeleton')}</span>
          <select
            className={`${inputCls} flex-1`}
            value={skeleton}
            onChange={(e) => onSkeleton(e.target.value as MmapSkeleton)}
          >
            <option value="mind">{t('canvas.skeletonMind')}</option>
            <option value="tree">{t('canvas.skeletonTree')}</option>
            <option value="fishbone">{t('canvas.skeletonFishbone')}</option>
            <option value="timeline">{t('canvas.skeletonTimeline')}</option>
            <option value="bracket">{t('canvas.skeletonBracket')}</option>
            <option value="org">{t('canvas.skeletonOrg')}</option>
          </select>
        </div>
        <div className={rowCls}>
          <span className={labelCls}>{t('canvas.direction')}</span>
          <select
            className={`${inputCls} flex-1`}
            value={String(direction)}
            onChange={(e) => onDirection(Number(e.target.value) as MmapDirection)}
          >
            <option value="1">{t('canvas.directionRight')}</option>
            <option value="0">{t('canvas.directionLeft')}</option>
            <option value="2">{t('canvas.directionBoth')}</option>
          </select>
        </div>
        <div className={rowCls} title={paletteDisabled ? t('canvas.paletteTitle') : undefined}>
          <span className={labelCls}>{t('canvas.palette')}</span>
          <select
            className={`${inputCls} flex-1`}
            value={mapStyle.palette ?? ''}
            disabled={paletteDisabled}
            onChange={(e) => onPalette(e.target.value || undefined)}
          >
            <option value="">{t('canvas.paletteDefault')}</option>
            {Object.entries(CANVAS_PALETTES).map(([key]) => (
              <option key={key} value={key}>
                {t(`palette.${key}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={rowCls} title={t('canvas.createStyleTitle')}>
          <span className={labelCls}>{t('canvas.createStyle')}</span>
          <select
            className={`${inputCls} flex-1`}
            value={mapStyle.createStyle ?? 'default'}
            onChange={(e) => onCreateStyle(e.target.value || undefined)}
          >
            {Object.entries(CREATE_STYLES).map(([key]) => (
              <option key={key} value={key}>{t(`createStyle.${key}`)}</option>
            ))}
          </select>
        </div>
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className={rowCls}>
          <span className={labelCls}>{t('canvas.background')}</span>
          <input
            type="color"
            className="w-[22px] h-[22px] p-0 border border-brd rounded bg-surf2 cursor-pointer"
            value={mapStyle.background ?? '#f6f6f6'}
            onChange={(e) => onBackground(e.target.value)}
          />
          {mapStyle.background && (
            <button
              type="button"
              className="text-t3 text-[10px] hover:text-t1 ml-auto"
              onClick={() => onBackground(undefined)}
              title={t('canvas.clearBgTitle')}
            >
              {t('canvas.clearBg')}
            </button>
          )}
        </div>
      </div>

      <div className="px-3 py-2.5 flex flex-col gap-2 border-b border-brd">
        <div className="text-t3 text-[11px] font-medium">{t('canvas.sectionLayout')}</div>
        <label className={`${rowCls} cursor-pointer`} title={t('canvas.alignTitle')}>
          <input
            type="checkbox"
            className={checkboxCls}
            checked={mapStyle.alignment === 'nodes'}
            onChange={(e) => onAlignment(e.target.checked ? 'nodes' : 'root')}
          />
          <span className="text-[11px] text-t1">{t('canvas.alignLabel')}</span>
        </label>
        <label className={`${rowCls} cursor-pointer`} title={t('canvas.freeLayoutTitle')}>
          <input
            type="checkbox"
            className={checkboxCls}
            checked={!!mapStyle.freeLayout}
            onChange={(e) => onFreeLayout(e.target.checked)}
          />
          <span className="text-[11px] text-t1">{t('canvas.freeLayoutLabel')}</span>
        </label>
        <label className={`${rowCls} cursor-pointer`} title={t('canvas.compactTitle')}>
          <input
            type="checkbox"
            className={checkboxCls}
            checked={compact}
            onChange={(e) => onCompact(e.target.checked)}
          />
          <span className="text-[11px] text-t1">{t('canvas.compactLabel')}</span>
        </label>
        <div className={rowCls} title={spacingDisabled ? t('canvas.spacingTitle') : undefined}>
          <span className={labelCls}>{t('canvas.spacingLabel')}</span>
          <input
            type="number"
            min={2}
            max={80}
            className={`${inputCls} w-[56px]`}
            value={mapStyle.topicSpacing ?? 14}
            disabled={spacingDisabled}
            onChange={(e) => {
              const v = e.target.value === '' ? undefined : Number(e.target.value);
              onTopicSpacing(v);
            }}
          />
          <span className="text-t3 text-[10px]">px</span>
        </div>
      </div>
    </>
  );
}
