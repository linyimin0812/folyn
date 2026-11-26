/**
 * Reader-navigation into the markdown preview: precise heading jumps that
 * also REVEAL hidden content (refactor spec Phase 4.4 — “跳转到隐藏章节时
 * 自动展开必要组件”). Three entry points share this module:
 *
 *   - outline sidebar clicks (navigateToHeadingLine, by data-source-line)
 *   - in-document anchor links `#id` (navigateToHeadingId)
 *   - doc-link restore with a `#fragment` (navigateToHeadingId)
 *
 * Revealing works by driving the SAME interactions a user would: clicking
 * the collapsed panel's head button and the owning tabs' panel button. The
 * components' React state then renders/switches; a couple of rAFs later the
 * target element lays out and scrolls into view. For far, unmounted windowed
 * chunks the heading element doesn't exist yet — we nudge the scroll onto
 * the nearest mounted block (which makes the windowing mount the chunk) and
 * watch the DOM until the heading appears, then reveal + scroll.
 */

/** rAF helper that works when the host provides none (tests). */
const raf = (fn: () => void) =>
  typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(fn)
    : setTimeout(fn, 16) as unknown as number;

/** Minimal CSS ident escaper (CSS.escape isn't in every host). */
const cssEscape = (id: string): string => id.replace(/[^a-zA-Z0-9_\u00A0-\uFFFF-]/g, (ch) => `\\${ch}`);

/**
 * Expand every component that hides an ancestor of `el`: closed
 * `:::collapsible` panels get their head clicked, inactive `:::tabs` panels
 * get the panel's button clicked. Nested containers each reveal in turn —
 * the walk goes outermost-inward, which is the order a user would have to
 * expand them in.
 */
export function revealHiddenAncestors(el: Element): void {
  // Collect the collapsible/panel chain from el upward (innermost first).
  const collapses: Element[] = [];
  const panels: Element[] = [];
  let cur: Element | null = el;
  while (cur && !cur.classList.contains('md-preview')) {
    if (cur.classList.contains('docmd-collapse') && !cur.classList.contains('is-open')) collapses.push(cur);
    if (cur instanceof HTMLElement && cur.hasAttribute('data-is-tab') && cur.style.display === 'none') panels.push(cur);
    cur = cur.parentElement;
  }
  // Expand outermost collapsible first so inner panels exist to switch.
  for (const collapse of collapses.reverse()) {
    collapse.querySelector<HTMLElement>('.docmd-collapse-head')?.click();
  }
  for (const panel of panels) {
    // Panel index = its position among the tab panels of the owning tabs.
    const tabsRoot = panel.closest('.docmd-tabs');
    if (!tabsRoot) continue;
    const all = Array.from(tabsRoot.querySelectorAll('[data-is-tab]'));
    const idx = all.indexOf(panel);
    if (idx >= 0) tabsRoot.querySelector<HTMLElement>(`[data-tab-button="${idx}"]`)?.click();
  }
}

function headingLineSelector(line: number): string {
  return `h1[data-source-line="${line}"],h2[data-source-line="${line}"],h3[data-source-line="${line}"],h4[data-source-line="${line}"],h5[data-source-line="${line}"],h6[data-source-line="${line}"]`;
}

/** Scroll (and reveal) a heading element that already exists in the DOM. */
function scrollToExistingHeading(
  container: Element,
  el: Element,
  smooth: boolean,
): void {
  revealHiddenAncestors(el);
  // The reveal clicks flip React state; commits + TabsComponent's display
  // effect land a couple of frames later, and a collapsible body REMOUNTS
  // its children — the element identity goes stale. Re-query by line/id
  // after the commits settle and scroll the live node.
  const line = el.getAttribute('data-source-line');
  const id = el.id;
  raf(() => raf(() => {
    const byLine = line != null ? container.querySelector<HTMLElement>(headingLineSelector(Number(line))) : null;
    const target = byLine
      ?? (id ? container.querySelector<HTMLElement>(`#${cssEscape(id)}`) : null)
      ?? el;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }));
}

/**
 * Jump to the heading at editor-absolute source `line`. If the heading is
 * not mounted (far windowed chunk), scroll near it so the chunk mounts,
 * then jump precisely once it appears.
 */
export function navigateToHeadingLine(
  container: Element,
  line: number,
  opts: { smooth?: boolean; waitMs?: number } = {},
): void {
  const { smooth = true, waitMs = 3000 } = opts;
  const el = container.querySelector(headingLineSelector(line));
  if (el) {
    scrollToExistingHeading(container, el, smooth);
    return;
  }
  // Far chunk: nudge the scroll to the nearest mounted block so the windowed
  // chunk mounts, then watch for the heading.
  const mounted = Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'))
    .map((n) => ({ n, l: Number(n.getAttribute('data-source-line')) }))
    .filter((x) => Number.isFinite(x.l) && x.l > 0);
  const before = mounted.filter((x) => x.l < line).at(-1);
  const after = mounted.find((x) => x.l > line);
  const anchor = before ?? after;
  anchor?.n.scrollIntoView({ behavior: 'auto', block: before ? 'end' : 'start' });

  const find = () => container.querySelector(headingLineSelector(line));
  let obs: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    obs?.disconnect();
    clearTimeout(timer);
  };
  const poll = () => {
    const target = find();
    if (target) {
      stop();
      scrollToExistingHeading(container, target, false);
      return true;
    }
    return false;
  };
  if (poll()) return;
  obs = new MutationObserver(() => poll());
  obs.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  timer = setTimeout(stop, waitMs);
}

/**
 * Reading-position component state (refactor spec Phase 4.5 — 记录 Tabs
 * 当前选择、Collapsible 展开状态): a tiny, serializable summary of which
 * containers the reader had open. Snapshotted when a navigation leaves a
 * position, replayed when Back/Forward returns to it — by driving the SAME
 * clicks a user would (React state stays the owner).
 */
export interface ComponentStateSnapshot {
  /** `data-source-line` of each `.docmd-collapse` wrapper that was open. */
  openCollapsibles: number[];
  /** `data-source-line` of each `.docmd-tabs` wrapper + its active panel index. */
  tabsSelections: Array<{ line: number; active: number }>;
}

/** Read the visible component state out of a rendered preview. */
export function snapshotComponentState(container: Element): ComponentStateSnapshot {
  const openCollapsibles: number[] = [];
  const tabsSelections: ComponentStateSnapshot['tabsSelections'] = [];
  for (const wrap of Array.from(container.querySelectorAll<HTMLElement>('.docmd-collapse'))) {
    if (wrap.classList.contains('is-open')) {
      const line = Number(wrap.getAttribute('data-source-line'));
      if (Number.isFinite(line) && line > 0) openCollapsibles.push(line);
    }
  }
  for (const tabs of Array.from(container.querySelectorAll<HTMLElement>('.docmd-tabs'))) {
    const panels = Array.from(tabs.querySelectorAll<HTMLElement>('[data-is-tab]'));
    const active = panels.findIndex((p) => p.style.display !== 'none');
    if (active >= 0) {
      const line = Number(tabs.getAttribute('data-source-line'));
      if (Number.isFinite(line) && line > 0) tabsSelections.push({ line, active });
    }
  }
  return { openCollapsibles, tabsSelections };
}

/**
 * Replay a snapshot onto a rendered preview: expand the collapsibles the
 * reader had open, switch each tabs to the panel they were on. Missing
 * containers (far chunks) are skipped — windowing remounts them later and
 * the restore scroll brings them near, where the outline merge picks them
 * up. Idempotent: only divergent state is clicked, so replaying a fresh
 * snapshot is a no-op.
 */
export function restoreComponentState(container: Element, snap: ComponentStateSnapshot): void {
  for (const line of snap.openCollapsibles) {
    const wrap = container.querySelector<HTMLElement>(`.docmd-collapse[data-source-line="${line}"]`);
    if (wrap && !wrap.classList.contains('is-open')) {
      wrap.querySelector<HTMLElement>('.docmd-collapse-head')?.click();
    }
  }
  for (const { line, active } of snap.tabsSelections) {
    const tabs = container.querySelector<HTMLElement>(`.docmd-tabs[data-source-line="${line}"]`);
    if (!tabs) continue;
    const panels = Array.from(tabs.querySelectorAll<HTMLElement>('[data-is-tab]'));
    const current = panels.findIndex((p) => p.style.display !== 'none');
    if (current !== active) {
      tabs.querySelector<HTMLElement>(`[data-tab-button="${active}"]`)?.click();
    }
  }
}

/**
 * Jump to a heading by its DOM id (the slug HeadingWithId stamps). Returns
 * false if no element with that id exists. Fragment ids may arrive
 * percent-encoded — both raw and decoded forms are tried.
 */
export function navigateToHeadingId(
  container: Element,
  fragment: string,
  opts: { smooth?: boolean } = {},
): boolean {
  let id = fragment;
  let decoded: string | null = null;
  try {
    const d = decodeURIComponent(fragment);
    if (d !== fragment) decoded = d;
  } catch { /* malformed escape — use raw only */ }
  const find = () =>
    container.querySelector(`#${cssEscape(id)}`)
    ?? (decoded ? container.querySelector(`#${cssEscape(decoded)}`) : null);
  const el = find();
  if (!el) return false;
  scrollToExistingHeading(container, el, opts.smooth ?? true);
  return true;
}

/**
 * The innermost mounted element whose `data-source-line` is at-or-before
 * `line` — the block that OWNS the line the way cursor-sync's selection
 * loop does (nearest start at-or-before the target). Sub-directive wrappers
 * (tab panels, collapsibles) carry the attr too, so a line inside a panel
 * resolves to the innermost stamped element — which is also the best reveal
 * anchor (its own hidden state gets expanded too).
 */
function findBlockAtOrBefore(container: Element, line: number): HTMLElement | null {
  let best: HTMLElement | null = null;
  let bestLine = 0;
  for (const el of Array.from(container.querySelectorAll<HTMLElement>('[data-source-line]'))) {
    const l = Number(el.getAttribute('data-source-line'));
    if (!Number.isFinite(l) || l <= 0 || l > line) continue;
    if (l >= bestLine) {
      best = el;
      bestLine = l;
    }
  }
  return best;
}

/** Any mounted stamped element (for the far-chunk nudge anchor). */
function anyMountedBlock(container: Element): HTMLElement | null {
  return container.querySelector<HTMLElement>('[data-source-line]');
}

/**
 * Jump to the source `line` of ANY block — the find-in-doc entry (Phase
 * 5.3 定位匹配). Same reveal + mount machinery as the heading jumps:
 * reveal hidden ancestors (closed collapsibles, inactive tab panels —
 * including the block's own container when the block IS the wrapper),
 * re-query after the React commits, then scroll. A far unmounted chunk is
 * nudged into the window by scrolling to a mounted neighbor, and a
 * MutationObserver retries once the block mounts. Optionally flash the
 * target block so the reader's eye lands on it (.md-find-flash).
 */
export function navigateToDocLine(
  container: Element,
  line: number,
  opts: { smooth?: boolean; waitMs?: number; flash?: boolean } = {},
): void {
  const { smooth = false, waitMs = 3000, flash = true } = opts;

  const scrollAndFlash = () => {
    // The reveal clicks flip React state; commits land a couple of frames
    // later and a collapsible body REMOUNTS its children — re-query the
    // live node before scrolling (element identity is stale by now).
    const target = findBlockAtOrBefore(container, line) ?? anyMountedBlock(container);
    if (!target) return;
    if (flash) {
      target.classList.remove('md-find-flash');
      // restart the animation on re-jumps to the same block
      void (target as HTMLElement).offsetWidth;
      target.classList.add('md-find-flash');
      target.addEventListener('animationend', () => target.classList.remove('md-find-flash'), { once: true });
    }
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  };

  const el = findBlockAtOrBefore(container, line);
  if (el) {
    revealHiddenAncestors(el);
    raf(() => raf(scrollAndFlash));
    return;
  }

  // Far chunk: nudge the scroll to ANY mounted block so the windowing
  // mounts the region around `line`, then watch for the block to appear.
  anyMountedBlock(container)?.scrollIntoView({ behavior: 'auto', block: 'start' });
  let obs: MutationObserver | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    obs?.disconnect();
    clearTimeout(timer);
  };
  const poll = (): boolean => {
    const target = findBlockAtOrBefore(container, line);
    if (target) {
      stop();
      revealHiddenAncestors(target);
      raf(() => raf(scrollAndFlash));
      return true;
    }
    return false;
  };
  if (poll()) return;
  obs = new MutationObserver(() => poll());
  obs.observe(container, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
  timer = setTimeout(stop, waitMs);
}
