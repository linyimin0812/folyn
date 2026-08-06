// ponytail: hand-rolled line parser instead of a markdown lib — the source
// format is mind-elixir plaintext (`- text\n  - child`), 2-space indent per
// depth. The OutlineEditor works on a flat list of {text, depth, note?} rows
// rather than a nested tree: hierarchy is implicit in depth, fold is a
// range-hide over subsequent deeper rows. Per-node notes live on the same
// row, encoded as `> ` continuation lines at depth+1 indent in the source.
//
// ponytail: arrows / summaries / links / per-node styles / map-level style
// round-trip via a trailing metadata block (`<!-- mmap:meta ... -->`) that
// references nodes by topic text. Source format (one directive per line):
//   arrow: <from-topic> -> <to-topic> | <label>     (one-way)
//   arrow: <from-topic> <-> <to-topic> | <label>    (bidirectional)
//   summary: <parent-topic> / <start>-<end> | <label>
//   link: <topic> -> <url>
//   styles: <JSON map of topic-text -> node style>  (single line)
//   mapStyle: <JSON of map-level style>             (single line)
// Topic references resolve to the FIRST node whose `topic` equals the text
// (case-sensitive, tree-walk order). Ceilings (upgrade to inline `#id:xxx`
// suffixes or a JSON metadata block when one bites):
//   - Renaming a node in the OutlineEditor orphan-refs any arrow/summary/link/
//     style entry that pointed at the old text; the entry is silently dropped
//     on re-init.
//   - Duplicate topic texts are ambiguous — only the first match is used.
//   - Topic texts containing ` -> `, ` <-> `, ` | `, or ` / ` break the
//     regex; the directive is mis-parsed.
// The block is optional and only emitted when at least one directive exists,
// so trees without arrows/summaries/links/styles round-trip identically to
// before.

import type { MindElixirData, NodeObj } from 'mind-elixir';

// ponytail: mind-elixir's NodeObj.style type doesn't list `fontStyle` (italic),
// but the runtime applier (`e.style[o] = n[o]` in MindElixir.js) honors any
// CSS key — so we add `fontStyle` locally and cast when assigning to
// `nodeObj.style`. Upgrade path: contribute a PR upstream to add fontStyle
// to the official type.
export interface MmapNodeStyle {
  fontSize?: string;
  fontFamily?: string;
  color?: string;
  background?: string;
  fontWeight?: string;
  fontStyle?: string;
  textDecoration?: string;
  border?: string;
  width?: string;
}

export interface OutlineLine {
  text: string;
  depth: number;
  note?: string;
  // ponytail: metadata block, attached only to lines[0] (the root). Carried
  // through OutlineEditor structural edits via object-spread (splitLine /
  // backspaceAtStart both use `{ ...prevRow, ... }` so `meta` survives).
  meta?: MmapMeta;
}

export interface MmapMetaArrow {
  from: string;
  to: string;
  label: string;
  bidirectional?: boolean;
}
export interface MmapMetaSummary {
  parent: string;
  start: number;
  end: number;
  label: string;
}
export interface MmapMetaLink {
  node: string;
  url: string;
}
// ponytail: mind-elixir direction constants — 0=LEFT, 1=RIGHT (default),
// 2=SIDE (both sides). No UP/DOWN at runtime; `DOWN` exists as a constant in
// the dist but isn't a valid `Options.direction` value, so we don't expose it.
// Ceiling: add when mind-elixir ships a down/up layout.
export type MmapDirection = 0 | 1 | 2;

// ponytail: canvas skeleton (骨架) — 'mind' is the standard mind map
// (default), 'org' is the top-down org chart, 'tree' is the right-branching
// tree. mind-elixir has no native skeleton concept; the canvas maps each
// to a direction + CSS/branch override. Default 'mind' is omitted from the
// meta block.
export type MmapSkeleton = 'mind' | 'org' | 'tree';

export interface MmapMapStyle {
  // ponytail: `rainbow: false` opts every first-level branch into a single
  // muted color. `true` (or omitted) keeps mind-elixir's default multi-color
  // palette. Line width and per-node numbering are NOT covered here —
  // mind-elixir hardcodes main/sub branch stroke widths (3/2 in MindElixir.js)
  // and has no built-in numbering; left as `ponytail:` ceilings in
  // MindMapCanvas.tsx until a real need lands.
  rainbow?: boolean;
  // ponytail: persisted to `data.direction` on init (mind-elixir reads it
  // directly). Default `1` (RIGHT) is omitted from the meta block — keeps
  // the file small and the round-trip stable for the common case.
  direction?: MmapDirection;
  // ponytail: persisted to `data.compact` on init. Default `false` omitted.
  compact?: boolean;
  // ponytail: palette preset NAME (e.g. 'classic', 'dark'). mind-elixir has
  // no field for a "preset name" on `data.theme` (it stores the color array),
  // so the canvas applies this at runtime by mutating `inst.theme.palette`.
  // Round-trips only because we keep the name here, not the colors.
  palette?: string;
  // ponytail: canvas background color — applied via `--bgcolor` CSS var on
  // `inst.container.style`. Reset by `changeTheme`, so the canvas re-applies
  // it after every theme swap.
  background?: string;
  // ponytail: sibling alignment — 'root' (default) aligns siblings to the
  // root, 'nodes' centers the whole tree. mind-elixir reads `inst.alignment`
  // in its centering fn on every `toCenter()`; the canvas mutates the field
  // then calls `refresh()` + `toCenter()`. Default 'root' omitted from meta.
  alignment?: 'root' | 'nodes';
  // ponytail: vertical gap between siblings, applied to `--node-gap-y` +
  // `--main-gap-y` CSS vars. Overridden by `compact: true` (which hardcodes
  // the gaps), so the canvas panel disables this control when compact is on.
  topicSpacing?: number;
  // ponytail: default style preset for newly created nodes. 'default' means
  // no special style (the mind-elixir default). The preset name is stored
  // here; the actual style values live in CREATE_STYLES.
  createStyle?: string;
  // ponytail: skeleton (骨架) layout preset. Default 'mind' omitted from meta.
  skeleton?: MmapSkeleton;
  // ponytail: when true, nodes can be freely dragged to any position on the
  // canvas, bypassing the automatic layout algorithm. Node positions are
  // stored in the node's metadata. On refresh, saved positions are restored.
  freeLayout?: boolean;
}
export interface MmapMeta {
  arrows: MmapMetaArrow[];
  summaries: MmapMetaSummary[];
  links: MmapMetaLink[];
  styles: Record<string, MmapNodeStyle>;
  mapStyle?: MmapMapStyle;
}

// ponytail: 6 preset theme styles for the styling panel. Each is a full
// `MmapNodeStyle` applied as a REPLACE (not merge) so toggling presets
// doesn't leak the previous preset's keys. Colors are hand-picked to read
// well at 12-14px; tune if the canvas theme changes.
export const PRESET_STYLES: Record<string, { label: string; style: MmapNodeStyle }> = {
  important: {
    label: '重点',
    style: { color: '#ffffff', background: '#dc2626', fontWeight: 'bold' },
  },
  pending: {
    label: '待定',
    style: { color: '#1f2937', background: '#f59e0b' },
  },
  done: {
    label: '完成',
    style: { color: '#ffffff', background: '#16a34a', textDecoration: 'line-through' },
  },
  highlight: {
    label: '突出',
    style: { color: '#ffffff', background: '#2563eb', fontWeight: 'bold' },
  },
  delete: {
    label: '删除',
    style: { color: '#9ca3af', background: '#e5e7eb', textDecoration: 'line-through' },
  },
  secondary: {
    label: '次要',
    style: { color: '#6b7280', background: '#f3f4f6' },
  },
};

// ponytail: 4 create-style presets for the canvas panel. When a create style
// is selected, newly created nodes inherit these style defaults. 'default' means
// no override (mind-elixir's own default). The styles are applied in
// the operation listener (addChild/insertSibling/insertParent) via reshapeNode.
// Colors are hand-picked to complement the default Catppuccin Latte palette.
export const CREATE_STYLES: Record<string, { label: string; style: MmapNodeStyle }> = {
  default: {
    label: '默认',
    style: {},
  },
  rounded: {
    label: '圆角大',
    style: {
      border: '2px solid #cbd5e1',
      background: '#f8fafc',
    },
  },
  colorFill: {
    label: '彩色填充',
    style: {
      background: '#ede9fe',
      color: '#5b21b6',
      fontWeight: 'bold',
    },
  },
  minimal: {
    label: '简洁',
    style: {
      border: '1px solid #e2e8f0',
      color: '#334155',
    },
  },
};

const FALLBACK: OutlineLine[] = [{ text: 'Root', depth: 0 }];

const META_START = '<!-- mmap:meta';
const META_END = '-->';

// ponytail: rainbow ON uses mind-elixir's default Catppuccin Latte palette
// (10 colors). Rainbow OFF swaps to this single muted gray — every
// first-level branch gets the same color. Picked a literal over
// `var(--t2)` because SVG `stroke` attributes don't honor CSS variables
// unless set via `style` not `setAttribute`; literal is simplest.
export const MONO_PALETTE = ['#9ca3af'];

// ponytail: canvas-level palette presets for the "配色" dropdown. Each is a
// branch-color array swapped in by mutating `inst.theme.palette` (same path
// the rainbow toggle uses). 'classic' matches mind-elixir's default Latte
// palette so the canvas treats picking 'classic' as a no-op (re-applies the
// default). Add presets when asked; do not extend mind-elixir's Theme type —
// runtime honors any string array.
export const CANVAS_PALETTES: Record<string, { label: string; colors: string[] }> = {
  classic: {
    label: '经典推荐',
    colors: [
      '#dd7878', '#ea76cb', '#8839ef', '#e64553', '#fe640b',
      '#df8e1d', '#40a02b', '#209fb5', '#1e66f5', '#7287fd',
    ],
  },
  dark: {
    label: '深色',
    colors: [
      '#f38ba8', '#f5c2e7', '#cba6f5', '#fab387', '#f9e2af',
      '#a6e3a1', '#94e2d5', '#89b4fa', '#b4befe', '#f38ba8',
    ],
  },
  pastel: {
    label: '柔粉',
    colors: [
      '#ffadad', '#ffd6a5', '#fdffb6', '#caffbf', '#9bf6ff',
      '#a0c4ff', '#bdb2ff', '#ffc6ff', '#bdb2ff', '#fdffb6',
    ],
  },
  vibrant: {
    label: '鲜艳',
    colors: [
      '#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93',
      '#ff595e', '#ffca3a', '#8ac926', '#1982c4', '#6a4c93',
    ],
  },
};

// Resolve a preset name to its color array. Returns undefined for unknown
// names (the canvas falls back to its current palette, no-op).
export function resolveCanvasPalette(name: string | undefined): string[] | undefined {
  if (!name) return undefined;
  return CANVAS_PALETTES[name]?.colors;
}

function emptyMeta(): MmapMeta {
  return { arrows: [], summaries: [], links: [], styles: {} };
}

function isMetaEmpty(m: MmapMeta | undefined): boolean {
  if (!m) return true;
  return (
    m.arrows.length === 0 &&
    m.summaries.length === 0 &&
    m.links.length === 0 &&
    Object.keys(m.styles ?? {}).length === 0 &&
    !m.mapStyle
  );
}

// ponytail: split content into outline text + metadata block. The metadata
// block is the first `<!-- mmap:meta` ... `-->` span. Everything outside the
// span is the outline (with the span removed). If the marker appears in a
// topic text, it's misinterpreted — ceiling documented at file top.
function extractMetaBlock(content: string): { outline: string; meta: MmapMeta | undefined } {
  const startIdx = content.indexOf(META_START);
  if (startIdx < 0) return { outline: content, meta: undefined };
  const endIdx = content.indexOf(META_END, startIdx + META_START.length);
  if (endIdx < 0) return { outline: content, meta: undefined };
  const block = content.slice(startIdx + META_START.length, endIdx);
  const outline = (content.slice(0, startIdx) + content.slice(endIdx + META_END.length)).replace(/\s+$/, '');
  return { outline, meta: parseMetaBlock(block) };
}

function parseMetaBlock(block: string): MmapMeta {
  const meta = emptyMeta();
  for (const rawLine of block.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    // ponytail: `<->` tried before `->` so the `->` inside `<->` doesn't
    // pre-empt the bidirectional match. Non-greedy `from` lets `to` absorb
    // a ` -> ` substring if the to-topic itself contains ` -> ` — but a
    // from-topic containing ` -> ` then breaks (regex can't disambiguate).
    const arrowBi = line.match(/^arrow:\s+(.+?)\s+<->\s+(.+?)(?:\s*\|\s*(.*))?$/);
    if (arrowBi) {
      meta.arrows.push({
        from: arrowBi[1],
        to: arrowBi[2],
        label: arrowBi[3] ?? '',
        bidirectional: true,
      });
      continue;
    }
    const arrowOne = line.match(/^arrow:\s+(.+?)\s+->\s+(.+?)(?:\s*\|\s*(.*))?$/);
    if (arrowOne) {
      meta.arrows.push({
        from: arrowOne[1],
        to: arrowOne[2],
        label: arrowOne[3] ?? '',
        bidirectional: false,
      });
      continue;
    }
    const summary = line.match(/^summary:\s+(.+?)\s+\/\s+(\d+)-(\d+)(?:\s*\|\s*(.*))?$/);
    if (summary) {
      meta.summaries.push({
        parent: summary[1],
        start: parseInt(summary[2], 10),
        end: parseInt(summary[3], 10),
        label: summary[4] ?? '',
      });
      continue;
    }
    const link = line.match(/^link:\s+(.+?)\s+->\s+(.+)$/);
    if (link) {
      meta.links.push({ node: link[1], url: link[2] });
      continue;
    }
    // ponytail: `styles:` and `mapStyle:` are single-line JSON directives.
    // JSON.parse handles all escaping; the only failure mode is a `-->`
    // sequence inside the JSON (would prematurely end the metadata block) —
    // not a concern for the color/size string values we serialize here.
    const stylesLine = line.match(/^styles:\s*(\{.*\})\s*$/);
    if (stylesLine) {
      try {
        const parsed = JSON.parse(stylesLine[1]) as Record<string, MmapNodeStyle>;
        if (parsed && typeof parsed === 'object') {
          meta.styles = { ...meta.styles, ...parsed };
        }
      } catch {
        // malformed JSON — skip silently (forward-compat: a future writer
        // emits a different shape; we don't fail the whole file).
      }
      continue;
    }
    const mapStyleLine = line.match(/^mapStyle:\s*(\{.*\})\s*$/);
    if (mapStyleLine) {
      try {
        const parsed = JSON.parse(mapStyleLine[1]) as MmapMapStyle;
        if (parsed && typeof parsed === 'object') {
          meta.mapStyle = { ...meta.mapStyle, ...parsed };
        }
      } catch {
        // malformed — skip
      }
      continue;
    }
    // unrecognized directive — skip silently (forward-compat for future
    // directives without breaking old files).
  }
  return meta;
}

function serializeMetaBlock(meta: MmapMeta): string {
  const lines: string[] = [];
  for (const a of meta.arrows) {
    const sep = a.bidirectional ? '<->' : '->';
    const label = a.label ? ` | ${a.label}` : '';
    lines.push(`arrow: ${a.from} ${sep} ${a.to}${label}`);
  }
  for (const s of meta.summaries) {
    const label = s.label ? ` | ${s.label}` : '';
    lines.push(`summary: ${s.parent} / ${s.start}-${s.end}${label}`);
  }
  for (const l of meta.links) {
    lines.push(`link: ${l.node} -> ${l.url}`);
  }
  if (meta.styles && Object.keys(meta.styles).length > 0) {
    lines.push(`styles: ${JSON.stringify(meta.styles)}`);
  }
  if (meta.mapStyle) {
    lines.push(`mapStyle: ${JSON.stringify(meta.mapStyle)}`);
  }
  if (lines.length === 0) return '';
  return `${META_START}\n${lines.join('\n')}\n${META_END}`;
}

/**
 * Parse mind-elixir plaintext (`- Root\n  - Child`) into a flat list of
 * outline rows. Empty/whitespace-only lines end any pending note block and
 * are dropped. If the input has no non-empty lines, returns a single root
 * placeholder (the canvas needs at least one node to init).
 *
 * Note continuation lines: after a topic line at depth D, any line matching
 * `^{(D+1)*2 spaces}> {text}` is appended to the topic's `note` (joined with
 * `\n`). A non-note line (or a blank line) terminates the note block.
 *
 * Metadata block: a trailing `<!-- mmap:meta ... -->` span is stripped from
 * the outline text and attached to `lines[0].meta` so it survives structural
 * edits in the OutlineEditor.
 */
export function parseOutline(content: string): OutlineLine[] {
  if (!content) return FALLBACK.slice();
  const { outline, meta } = extractMetaBlock(content);
  const lines = outline.split('\n');
  const result: OutlineLine[] = [];
  let noteTarget: OutlineLine | null = null;
  let noteLines: string[] = [];

  const flushNote = () => {
    if (noteTarget && noteLines.length) {
      noteTarget.note = noteLines.join('\n');
    }
    noteTarget = null;
    noteLines = [];
  };

  for (const raw of lines) {
    if (!raw.trim()) {
      flushNote();
      continue;
    }
    // Note continuation: 2+ leading spaces then `> `. Only recognized while
    // a topic is pending as the note target, and only at the expected
    // (topicDepth+1)*2 indent — otherwise the line is treated as a topic.
    if (noteTarget) {
      const noteMatch = raw.match(/^(\s{2,})>\s?(.*)$/);
      if (noteMatch) {
        const expected = (noteTarget.depth + 1) * 2;
        if (noteMatch[1].length === expected) {
          noteLines.push(noteMatch[2]);
          continue;
        }
      }
    }
    flushNote();
    const m = raw.match(/^(\s*)(?:-\s+)?(.*)$/);
    const spaces = m?.[1].length ?? 0;
    const parsedDepth = Math.floor(spaces / 2);
    const text = m?.[2] ?? '';
    // ponytail: single-root invariant — the first non-empty line is always
    // the root (depth 0); every subsequent non-empty line MUST be a
    // descendant (depth >= 1). Without this, sibling-of-root lines parse
    // at depth 0 and render bullet-less (bullets are gated on depth > 0),
    // breaking the outliner contract. Source files with multiple depth-0
    // lines (e.g. `- A\n- B`) are normalized: B is bumped to depth 1.
    const depth = result.length === 0 ? 0 : Math.max(parsedDepth, 1);
    const line: OutlineLine = { text, depth };
    result.push(line);
    noteTarget = line;
  }
  flushNote();
  if (result.length === 0) return FALLBACK.slice();
  if (meta && result.length > 0) {
    result[0].meta = meta;
  }
  return result;
}

/**
 * Serialize a flat list of outline rows back to mind-elixir plaintext.
 * Each row becomes `<2*depth spaces>- <text>`. If the row has a note,
 * each note line is emitted as `<2*(depth+1) spaces>> {noteline}` immediately
 * after the topic line (before any children, which live at the same indent).
 *
 * If `lines[0].meta` carries arrows/summaries/links, a trailing metadata
 * block is appended after a blank-line separator.
 */
export function serializeOutline(lines: OutlineLine[]): string {
  const out: string[] = [];
  for (const l of lines) {
    out.push('  '.repeat(l.depth) + '- ' + l.text);
    if (l.note) {
      const noteIndent = '  '.repeat(l.depth + 1);
      for (const noteLine of l.note.split('\n')) {
        out.push(noteIndent + '> ' + noteLine);
      }
    }
  }
  const meta = lines[0]?.meta;
  if (!isMetaEmpty(meta)) {
    const block = serializeMetaBlock(meta!);
    if (block) return out.join('\n') + '\n\n' + block;
  }
  return out.join('\n');
}

// ponytail: mind-elixir's built-in plaintextConverter drops `note` AND
// `arrows`/`summaries`/`hyperLink` on round-trip. The outline is the source
// of truth, so we build/walk the NodeObj tree + the metadata block ourselves.

function genId(): string {
  // ponytail: matches mind-elixir's plaintextConverter ID shape — hex time
  // + random, 16 chars. Used for node identity inside the canvas AND for
  // arrow/summary/link references in the metadata block (resolved to topic
  // text on serialize, resolved back to id on parse).
  return (
    Date.now().toString(16) + Math.random().toString(16).substring(2)
  ).substring(2, 18);
}

function buildTree(lines: OutlineLine[]): NodeObj {
  const root: NodeObj = { topic: lines[0].text, id: genId() };
  if (lines[0].note) root.note = lines[0].note;
  const stack: { node: NodeObj; depth: number }[] = [
    { node: root, depth: lines[0].depth },
  ];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    while (stack.length > 0 && stack[stack.length - 1].depth >= line.depth) {
      stack.pop();
    }
    const parent = stack[stack.length - 1].node;
    const node: NodeObj = { topic: line.text, id: genId() };
    if (line.note) node.note = line.note;
    (parent.children ??= []).push(node);
    stack.push({ node, depth: line.depth });
  }
  return root;
}

// First-match index of topic text → node id. Used to resolve metadata-block
// text references to mind-elixir's internal uids at parse time.
function buildTopicIndex(root: NodeObj): Map<string, string> {
  const index = new Map<string, string>();
  const walk = (node: NodeObj) => {
    if (!index.has(node.topic)) index.set(node.topic, node.id);
    for (const child of node.children ?? []) walk(child);
  };
  walk(root);
  return index;
}

function findNodeById(root: NodeObj, id: string): NodeObj | null {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return null;
}

export function outlineToMindElixirData(src: string): MindElixirData {
  const lines = parseOutline(src);
  const data: MindElixirData = { nodeData: buildTree(lines) };
  const meta = lines[0]?.meta;
  if (isMetaEmpty(meta)) return data;
  const m = meta!;
  const topicIndex = buildTopicIndex(data.nodeData);
  if (m.arrows.length) {
    data.arrows = [];
    for (const a of m.arrows) {
      const from = topicIndex.get(a.from);
      const to = topicIndex.get(a.to);
      // ponytail: dangling text-ref (topic was renamed/deleted) — drop the
      // arrow rather than hand mind-elixir a non-existent uid (it would
      // render nothing and the entry would be lost on next serialize anyway).
      if (from == null || to == null) continue;
      data.arrows.push({
        id: genId(),
        from,
        to,
        label: a.label,
        ...(a.bidirectional ? { bidirectional: true } : {}),
      });
    }
    if (data.arrows.length === 0) delete data.arrows;
  }
  if (m.summaries.length) {
    data.summaries = [];
    for (const s of m.summaries) {
      const parent = topicIndex.get(s.parent);
      if (parent == null) continue;
      data.summaries.push({
        id: genId(),
        parent,
        start: s.start,
        end: s.end,
        label: s.label,
      });
    }
    if (data.summaries.length === 0) delete data.summaries;
  }
  for (const l of m.links) {
    const id = topicIndex.get(l.node);
    if (id == null) continue;
    const node = findNodeById(data.nodeData, id);
    if (node) node.hyperLink = l.url;
  }
  // ponytail: per-node styles — apply by topic text. Dangling refs (renamed
  // topic) are silently dropped, matching the arrow/summary/link behavior.
  // Cast: our MmapNodeStyle adds `fontStyle` which mind-elixir's runtime
  // honors but its TS type omits.
  for (const [topic, style] of Object.entries(m.styles ?? {})) {
    const id = topicIndex.get(topic);
    if (id == null) continue;
    const node = findNodeById(data.nodeData, id);
    if (node) (node as { style?: MmapNodeStyle }).style = style;
  }
  // ponytail: rainbow OFF = ship a theme with a single-color palette so
  // init applies it via changeTheme. Rainbow ON (default) = no theme field
  // → mind-elixir keeps its built-in multi-color palette.
  if (m.mapStyle?.rainbow === false) {
    data.theme = {
      name: 'mmap-mono',
      palette: MONO_PALETTE,
    } as MindElixirData['theme'];
  }
  // ponytail: direction/compact are real MindElixirData fields, so we set
  // them directly — mind-elixir's `init()` reads them. palette/background/
  // alignment/topicSpacing have no MindElixirData field; the canvas reads
  // them from the source meta on mount and applies them at runtime.
  if (m.mapStyle?.direction !== undefined) {
    data.direction = m.mapStyle.direction;
  }
  if (m.mapStyle?.compact) {
    data.compact = true;
  }
  return data;
}

// ponytail: extract the runtime-only mapStyle fields (palette/background/
// alignment/topicSpacing) from the source meta block. The canvas reads these
// on mount and after every external content change, then applies them to
// the mind-elixir instance post-init (mind-elixir has no MindElixirData
// field for them). rainbow/direction/compact are NOT included — they live
// in MindElixirData and `outlineToMindElixirData` already applies them via
// `data.theme`/`data.direction`/`data.compact`.
export function readRuntimeMapStyle(src: string): MmapMapStyle {
  const lines = parseOutline(src);
  const ms = lines[0]?.meta?.mapStyle;
  if (!ms) return {};
  const out: MmapMapStyle = {};
  if (ms.palette) out.palette = ms.palette;
  if (ms.background) out.background = ms.background;
  if (ms.alignment) out.alignment = ms.alignment;
  if (ms.topicSpacing !== undefined) out.topicSpacing = ms.topicSpacing;
  if (ms.createStyle) out.createStyle = ms.createStyle;
  if (ms.skeleton && ms.skeleton !== 'mind') out.skeleton = ms.skeleton;
  return out;
}

export function mindElixirDataToOutline(
  data: MindElixirData,
  // ponytail: canvas-level runtime-only fields (palette/background/alignment/
  // topicSpacing) can't be read from `data` — mind-elixir has no field for
  // them. The canvas passes its source-of-truth here so syncOut persists
  // them. When omitted (e.g. tests), mapStyle is derived purely from `data`.
  mapStyleOverride?: MmapMapStyle,
): string {
  const lines: OutlineLine[] = [];
  const idToTopic = new Map<string, string>();
  const walk = (node: NodeObj, depth: number) => {
    const line: OutlineLine = { text: node.topic ?? '', depth };
    if (node.note) line.note = node.note;
    lines.push(line);
    if (node.id) idToTopic.set(node.id, node.topic ?? '');
    for (const child of node.children ?? []) walk(child, depth + 1);
  };
  walk(data.nodeData, 0);

  const meta: MmapMeta = emptyMeta();
  for (const a of data.arrows ?? []) {
    const from = idToTopic.get(a.from);
    const to = idToTopic.get(a.to);
    // ponytail: dangling uid (node deleted but arrow entry lingers in the
    // data model) — skip on serialize so the file doesn't carry a ref to
    // nothing. The arrow is lost on writeback; acceptable (matches the
    // canvas behavior where deleting a node strays its arrows).
    if (from == null || to == null) continue;
    meta.arrows.push({
      from,
      to,
      label: a.label ?? '',
      ...(a.bidirectional ? { bidirectional: true } : {}),
    });
  }
  for (const s of data.summaries ?? []) {
    const parent = idToTopic.get(s.parent);
    if (parent == null) continue;
    meta.summaries.push({
      parent,
      start: s.start,
      end: s.end,
      label: s.label ?? '',
    });
  }
  const walkLinks = (node: NodeObj) => {
    if (node.hyperLink) meta.links.push({ node: node.topic ?? '', url: node.hyperLink });
    for (const child of node.children ?? []) walkLinks(child);
  };
  walkLinks(data.nodeData);

  // ponytail: collect per-node styles keyed by topic text. Duplicate topic
  // texts resolve to the FIRST occurrence (matches the parse-time
  // topicIndex behavior) — the second occurrence's style is lost on
  // round-trip. Ceiling documented at file top.
  const walkStyles = (node: NodeObj) => {
    const s = (node as { style?: MmapNodeStyle }).style;
    if (s && Object.keys(s).length > 0) {
      const topic = node.topic ?? '';
      if (topic && !meta.styles[topic]) meta.styles[topic] = s;
    }
    for (const child of node.children ?? []) walkStyles(child);
  };
  walkStyles(data.nodeData);

  // ponytail: assemble the mapStyle directive. Fields sourced from two
  // places: (1) `data` for rainbow/direction/compact (mind-elixir owns
  // these); (2) `mapStyleOverride` for palette/background/alignment/
  // topicSpacing (the canvas owns these — they have no MindElixirData
  // field). Defaults (rainbow ON, direction=1, compact=false, alignment=
  // 'root') are omitted so the meta block stays empty for the common case.
  const mapStyle = deriveMapStyle(data, mapStyleOverride);
  if (mapStyle) meta.mapStyle = mapStyle;

  if (lines[0]) lines[0].meta = meta;
  return serializeOutline(lines);
}

// ponytail: pure helper — combines data-derived mapStyle (rainbow/direction/
// compact) with canvas-supplied runtime-only fields (palette/background/
// alignment/topicSpacing). Returns undefined when everything is at default,
// so the serializer emits no `mapStyle:` directive. Exported for unit tests.
//
// Field order in the emitted JSON is fixed (direction, compact, rainbow,
// palette, background, alignment, topicSpacing) so round-trip tests can
// compare strings byte-for-byte — `JSON.stringify` uses insertion order.
export function deriveMapStyle(
  data: MindElixirData,
  override?: MmapMapStyle,
): MmapMapStyle | undefined {
  const o = override ?? {};
  // direction — default 1 (RIGHT) omitted.
  const direction =
    data.direction !== undefined && data.direction !== 1
      ? data.direction
      : undefined;
  // compact — default false omitted.
  const compact = data.compact ? true : undefined;
  // rainbow OFF = data.theme carries a single-color palette (length 1).
  // Rainbow ON = palette has 2+ colors OR theme is undefined.
  const palette = data.theme?.palette;
  const rainbow = palette && palette.length <= 1 ? false : undefined;
  // runtime-only fields — straight from override (already filtered to
  // non-default by the canvas).
  const palettePreset = o.palette;
  const background = o.background;
  const alignment = o.alignment === 'root' ? undefined : o.alignment;
  const topicSpacing = o.topicSpacing;

  const out: MmapMapStyle = {};
  if (direction !== undefined) out.direction = direction;
  if (compact !== undefined) out.compact = compact;
  if (rainbow !== undefined) out.rainbow = rainbow;
  if (palettePreset !== undefined) out.palette = palettePreset;
  if (background !== undefined) out.background = background;
  if (alignment !== undefined) out.alignment = alignment;
 if (topicSpacing !== undefined) out.topicSpacing = topicSpacing;
  if (o.createStyle !== undefined) out.createStyle = o.createStyle;
  if (o.skeleton !== undefined && o.skeleton !== 'mind') out.skeleton = o.skeleton;

  if (Object.keys(out).length === 0) return undefined;
  return out;
}
