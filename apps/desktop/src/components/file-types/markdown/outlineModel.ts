/**
 * Outline (TOC) model — refactor spec Phase 4 (大纲数据模型与隐藏组件可见性).
 *
 * The outline must list only headings the reader can actually see. Two
 * sources are merged, because neither knows the whole story alone:
 *
 * 1. Source scan (`computeOutlineSource`): headings + container directive
 *    spans read from the markdown text. Knows structure (which heading sits
 *    inside which container span) but NOT runtime state (React owns whether
 *    a tab panel is active / a collapsible is open).
 * 2. DOM probe (`mergeOutlineVisibility`): the rendered preview. Knows
 *    runtime state, but windowed/chunked rendering means far-away headings
 *    may simply not be mounted yet.
 *
 * Merge rule per heading, resolved by its enclosing directive spans:
 * - in a closed collapsible → hidden (the reader can't see it).
 * - in a non-active tab panel → hidden.
 * - in an active tab panel / open collapsible → visible.
 * - inside any container that IS rendered → per above, via the DOM.
 * - in NO container span (plain flow) but not mounted → keep it: a far
 *   windowed chunk — the jump path (`headingNav.navigateToHeadingLine`)
 *   mounts it on demand.
 */

export interface SourceHeading {
  /** Editor-absolute 1-based line (matches `data-source-line`). */
  line: number;
  /** 1–6. */
  level: number;
  /** Raw ATX text with the leading #'s stripped. */
  text: string;
}

export interface DirectiveSpan {
  /** Directive name, e.g. `tabs`, `tab`, `collapsible`. */
  name: string;
  /** Raw text after the directive name (`:::tab 概述` → `概述`); the tab
   * label / collapsible heading shown to the reader. */
  title: string;
  /** Editor-absolute 1-based line of the opening `:::name` fence. */
  startLine: number;
  /** Editor-absolute 1-based line of the closing fence (exclusive). */
  endLine: number;
  /** For `tab` panels whose parent is `tabs`: panel index among siblings. */
  tabPanelIndex: number | null;
}

export interface OutlineSource {
  headings: SourceHeading[];
  spans: DirectiveSpan[];
}

export interface OutlineItem {
  line: number;
  level: number;
  text: string;
}

const ATX = /^(#{1,6})\s+(.*)$/;
/** Any run of 3+ colons: opens a directive when followed by a name. */
const DIRECTIVE_OPEN = /^(:::+)\s*([A-Za-z][\w-]*)\s*(.*)$/;
/** A bare run of 3+ colons closes the innermost open directive. */
const DIRECTIVE_CLOSE = /^:::+\s*$/;
const FENCE = /^\s*(```|~~~)/;

/**
 * Compute the source model: every ATX heading outside code fences + every
 * container directive span (nested via a stack). Fence lines (` ``` `) shield
 * directive syntax; a `:::` inside a fence never opens or closes anything.
 * Unclosed directives at EOF close at the last line. Tab panels count their
 * sibling index only when their parent is a `tabs` container.
 */
export function computeOutlineSource(content: string): OutlineSource {
  const lines = content.split('\n');
  const headings: SourceHeading[] = [];
  const spans: DirectiveSpan[] = [];
  // Stack of open directives: { name, startLine, tabPanelCounter? }
  const stack: Array<{ name: string; startLine: number; panelCount: number; title: string }> = [];
  let inFence = false;
  let fenceMark = '';

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = i + 1; // editor-absolute, 1-based

    // Code fences shield everything (headings + directive syntax).
    if (FENCE.test(raw)) {
      const mark = raw.trim().startsWith('```') ? '```' : '~~~';
      if (!inFence) {
        inFence = true;
        fenceMark = mark;
      } else if (raw.trim().startsWith(fenceMark)) {
        inFence = false;
        fenceMark = '';
      }
      continue;
    }
    if (inFence) continue;

    const m = raw.match(DIRECTIVE_OPEN);
    if (m) {
      stack.push({ name: m[2], startLine: line, panelCount: 0, title: m[3].trim() });
      continue;
    }
    if (DIRECTIVE_CLOSE.test(raw)) {
      // Any bare 3+ colon run closes the most recent open directive.
      const open = stack.pop();
      if (open) {
        const parent = stack.at(-1);
        const isTabPanel =
          open.name === 'tab' && parent?.name === 'tabs';
        // The panel index counts CLOSED sibling panels, so consecutive
        // `:::tab` blocks inside one `::::tabs` get 0, 1, 2… and panels
        // of nested inner tabs never count (their parent isn't `tabs`
        // at that level — it's the enclosing panel).
        const tabPanelIndex = isTabPanel ? parent!.panelCount++ : null;
        spans.push({ name: open.name, title: open.title, startLine: open.startLine, endLine: line, tabPanelIndex });
      }
      continue;
    }

    const h = raw.match(ATX);
    if (h) headings.push({ line, level: h[1].length, text: h[2].trim() });
  }

  // Unclosed directives at EOF close at the last line.
  const lastLine = lines.length;
  while (stack.length) {
    const open = stack.pop()!;
    const parent = stack.at(-1);
    const isTabPanel = open.name === 'tab' && parent?.name === 'tabs';
    const tabPanelIndex = isTabPanel ? parent!.panelCount++ : null;
    spans.push({ name: open.name, title: open.title, startLine: open.startLine, endLine: lastLine, tabPanelIndex });
  }

  return { headings, spans };
}

/** A heading's innermost enclosing span for a given directive name. */
function enclosingSpan(
  spans: DirectiveSpan[],
  line: number,
  name?: string,
): DirectiveSpan | undefined {
  let innermost: DirectiveSpan | undefined;
  for (const s of spans) {
    if (line < s.startLine || line > s.endLine) continue;
    if (name && s.name !== name) continue;
    if (!innermost || (s.endLine - s.startLine) < (innermost.endLine - innermost.startLine)) {
      innermost = s;
    }
  }
  return innermost;
}

/** Find a rendered container wrapper for a directive span. */
export function spanWrapper(container: Element, span: DirectiveSpan): HTMLElement | null {
  return container.querySelector<HTMLElement>(
    `[data-container="${span.name}"][data-source-line="${span.startLine}"]`,
  );
}

/**
 * Probe: does this element have layout? jsdom has no layout engine, so tests
 * inject a fake; production reads getBoundingClientRect.
 */
export type VisibilityProbe = (el: HTMLElement) => boolean;

export const probeDom: VisibilityProbe = (el) =>
  el.getBoundingClientRect().height > 0;

/**
 * Merge the source model with the rendered DOM: keep only headings the
 * reader can currently see. Visibility rules per heading:
 *
 * - The heading element exists AND has layout → visible.
 * - The heading element exists but has no layout (display:none ancestor —
 *   an inactive tab panel) → hidden.
 * - The heading element does NOT exist:
 *   - it sits inside a collapsible span whose wrapper is missing (nested
 *     inside another closed collapsible, or far chunk) → hidden;
 *   - the innermost collapsible wrapper is rendered and closed → hidden
 *     (a closed collapsible unmounts its children);
 *   - otherwise → visible (a far windowed chunk in plain flow or inside an
 *     OPEN container; the jump path mounts it on demand).
 */
export function mergeOutlineVisibility(
  source: OutlineSource,
  container: Element | null,
  probe: VisibilityProbe = probeDom,
): OutlineItem[] {
  if (!container) return [];
  const items: OutlineItem[] = [];
  for (const h of source.headings) {
    const el = container.querySelector<HTMLElement>(
      `h${h.level}[data-source-line="${h.line}"]`,
    );
    if (el) {
      if (probe(el)) items.push({ line: h.line, level: h.level, text: h.text });
      continue;
    }
    // Unmounted: hidden when a collapsible swallows it — closed (children
    // unmount) OR its wrapper itself missing (nested inside another closed
    // collapsible / far chunk — can't promise visibility).
    const collapsible = enclosingSpan(source.spans, h.line, 'collapsible');
    if (collapsible) {
      const wrapper = spanWrapper(container, collapsible);
      if (!wrapper) continue;
      if (!wrapper.classList.contains('is-open')) continue;
      // Open collapsible, heading in a far chunk — keep.
    }
    items.push({ line: h.line, level: h.level, text: h.text });
  }
  return items;
}

/** Source scan + DOM merge in one call. */
export function computeOutline(
  content: string,
  container: Element | null,
  probe: VisibilityProbe = probeDom,
): OutlineItem[] {
  return mergeOutlineVisibility(computeOutlineSource(content), container, probe);
}

/**
 * Scroll-spy: the heading the reader is "at" — the last heading whose top
 * sits above the offset line (viewport top + `offset` px). Returns null
 * before the first heading. Headings with no client rects (hidden) are
 * skipped, so the active entry recovers when its panel becomes visible.
 */
export function computeActiveHeading(
  container: Element,
  items: OutlineItem[],
  offset = 96,
): OutlineItem | null {
  const rect = container.getBoundingClientRect();
  const threshold = rect.top + offset;
  let active: OutlineItem | null = null;
  for (const item of items) {
    const el = container.querySelector<HTMLElement>(
      `h${item.level}[data-source-line="${item.line}"]`,
    );
    if (!el) continue;
    if (el.getClientRects().length === 0) continue; // not laid out
    if (el.getBoundingClientRect().top <= threshold) active = item;
    else break; // items are in document order — first past the line ends it
  }
  return active;
}
