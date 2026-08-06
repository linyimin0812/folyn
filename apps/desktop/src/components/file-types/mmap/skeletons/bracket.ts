import type { MindElixirInstance } from 'mind-elixir';
import type { MmapSkeletonStrategy } from './types';

// ponytail: right-branching with a bracket overlay that spans each child
// group (leader from parent to bracket, stubs into each child). mind-elixir
// draws one path per parent-child; we hide the default lines and draw one
// bracket per sibling group after linkDiv.
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
    svg!.appendChild(path);
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

const css = `
  .map-container[data-mmap-skeleton="bracket"] .map-canvas me-nodes {
    padding: 24px;
  }
`;

export const bracketStrategy: MmapSkeletonStrategy = {
  name: 'bracket',
  css,
  // ponytail: bracket uses mind-elixir's default branch generators (undefined
  // here) — they're hidden by the overlay anyway. teardown removes the
  // overlay when switching away so the default lines re-appear.
  init: (inst) => {
    if (inst.direction !== 1) inst.initRight();
  },
  directionEnabled: false,
  teardown: removeBracketOverlay,
  postLinkDiv: drawBracketConnectors,
};
