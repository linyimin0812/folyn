/**
 * dbml file-preview export: render a static SVG from the parsed DBML so the
 * export is self-contained and doesn't depend on x6 runtime stylesheets or
 * foreignObject content.
 *
 * Reads the .dbml file, parses via parseDbml, lays out via layoutEr, and
 * renders an SVG from the layout — does NOT depend on x6 having mounted in
 * the export container. The in-app preview uses x6 + react-shape; for
 * export we re-render in pure SVG.
 */

import { useVaultStore } from '@/store/vaultStore';
import { resolveVaultPath } from './shared';
import {
  zOrthPath,
  type ErLayout,
  type Point,
  type PositionedEnum,
  type PositionedTable,
} from '@/components/file-types/dbml/erLayout';
import { extractDbmlMeta } from '@/components/file-types/dbml/parseDbml';

export interface EnhanceCtx {
  src: string;
  filePath: string;
  vaultRoot: string;
}

export async function enhance(body: HTMLElement, ctx: EnhanceCtx): Promise<void> {
  const { src, filePath } = ctx;
  if (!src) return;
  const vaultRelPath = resolveVaultPath(src, filePath);
  let content: string;
  try {
    content = await useVaultStore.getState().readFile(vaultRelPath);
  } catch { return; }
  const { parseDbml } = await import('@/components/file-types/dbml/parseDbml');
  const { layoutEr } = await import('@/components/file-types/dbml/erLayout');
  const result = await parseDbml(content);
  if (result.errors.length > 0 || !result.schema) return;
  // Restore user-dragged card positions from the file's meta block so the
  // export matches the preview layout instead of re-running d3-force from
  // scratch (which produces different positions and messier edges).
  const { meta } = extractDbmlMeta(content);
  const manualPositions = new Map<string, Point>();
  if (meta?.positions) {
    for (const [name, p] of Object.entries(meta.positions)) {
      if (p && typeof p.x === 'number' && typeof p.y === 'number') {
        manualPositions.set(name, { x: p.x, y: p.y });
      }
    }
  }
  const layout = layoutEr(result.schema, 800, 600, manualPositions);
  // Resolve the applied theme at export time. documentElement.dataset.theme is
  // set by appearanceStore to the ACTUAL applied theme (system already
  // resolved), matching how exportActiveHtml picks its palette.
  const theme =
    document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const svgString = renderErLayoutToSvg(layout, theme);
  body.innerHTML = svgString;
  const svgEl = body.querySelector<SVGSVGElement>('svg');
  if (svgEl) {
    svgEl.style.display = 'block';
    svgEl.style.margin = '0 auto';
    svgEl.style.maxWidth = '100%';
  }
  body.style.height = '420px';
  body.style.minHeight = '420px';
  body.style.overflow = 'hidden';
}

type Palette = {
  surf: string; brd: string; hov: string; brd2: string;
  t1: string; t3: string; acc: string;
};

// ponytail: concrete theme hex, NOT var(--xxx). The SVG is extracted
// standalone by shared.renderFilePreviewToSvg (no :root ancestor), so CSS
// vars don't resolve in .svg files or PNG canvas rasterization — fills fall
// back to black. Both palettes mirror LIGHT_THEME_VARS / DARK_THEME_VARS in
// exportService.ts. Pick the palette from the applied app theme so dark-mode
// exports stay dark instead of always baking the light palette.
const LIGHT_C: Palette = {
  surf: '#f8f9fd', brd: '#dde2f0', hov: '#e8ecf8', brd2: '#c8d0e8',
  t1: '#1a2040', t3: '#8892b0', acc: '#3a6ef0',
};
const DARK_C: Palette = {
  surf: '#13161f', brd: '#1c2136', hov: '#1b1f2e', brd2: '#252d4a',
  t1: '#e2e8f8', t3: '#6b7a96', acc: '#5b8af5',
};
// ponytail: duplicated from erLayout.ts (ER_HEADER_H=38, ER_ROW_H=28). The
// constants are stable layout sizing — duplicate beats a static import
// that would pull d3-force into the main bundle. Revisit if they drift.
const ER_HEADER_H = 38;
const ER_ROW_H = 28;

/** Y of a field's row center on the card, or null if not found. */
function fieldRowY(t: PositionedTable, fieldName: string | undefined): number | null {
  if (!fieldName) return null;
  const idx = t.fields.findIndex((f) => f.name === fieldName);
  if (idx < 0) return null;
  return t.y + ER_HEADER_H + idx * ER_ROW_H + ER_ROW_H / 2;
}

// ponytail: standalone ER→SVG renderer. Mirrors the layout coordinates from
// erLayout (header / row heights already agree with the in-app x6 render).
// Shares `zOrthPath` with the x6 `z-orth` router so preview and export draw
// the same Z-shape, grid-snapped, field-row-anchored edges.
function renderErLayoutToSvg(layout: ErLayout, theme: 'light' | 'dark'): string {
  const { tables, enums, refs } = layout;
  if (tables.length === 0 && enums.length === 0) return '';
  const C = theme === 'dark' ? DARK_C : LIGHT_C;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const bounds = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x); minY = Math.min(minY, y);
    maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
  };
  for (const t of tables) bounds(t.x, t.y, t.width, t.height);
  for (const e of enums) bounds(e.x, e.y, e.width, e.height);
  const PAD = 40;
  const vbX = minX - PAD, vbY = minY - PAD;
  const vbW = (maxX - minX) + PAD * 2, vbH = (maxY - minY) + PAD * 2;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="100%"`,
    ` viewBox="${vbX} ${vbY} ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">`,
  );
  // ponytail: replicate x6's er-one-double-start + er-many-end markers so the
  // exported SVG carries the same crow's-foot cardinality cues as the preview
  // (ErDiagramX6.tsx). Shapes are the post-rotate forms that match SVG marker
  // semantics: marker-start uses orient="auto-start-reverse" with the same
  // pre-rotate path x6 registers (SVG's 180° reversal for start mirrors the
  // bars to +2/+5 into the path interior); marker-end uses orient="auto"
  // with the already-mirrored path (prongs at the boundary, convergence 9px
  // into the path). markerUnits=userSpaceOnUse keeps size independent of
  // stroke-width, matching x6's marker registration.
  parts.push(
    `<defs>`,
    `<marker id="er-one-double-start" viewBox="0 0 10 10" refX="7" refY="5"`,
    ` markerWidth="10" markerHeight="10" orient="auto-start-reverse" markerUnits="userSpaceOnUse">`,
    `<path d="M 5 1 L 5 9 M 2 1 L 2 9" fill="none" stroke="${C.t3}" stroke-width="1.4" stroke-linecap="round" />`,
    `</marker>`,
    `<marker id="er-many-end" viewBox="-10 -8 10 16" refX="0" refY="0"`,
    ` markerWidth="10" markerHeight="16" orient="auto" markerUnits="userSpaceOnUse">`,
    `<path d="M 0 -7 L -9 0 M 0 0 L -9 0 M 0 7 L -9 0" fill="none" stroke="${C.t3}" stroke-width="1.3" stroke-linecap="round" />`,
    `</marker>`,
    `</defs>`,
  );
  // Edges last so they draw on top of cards (mirrors x6's edge z-order —
  // lines crossing a card stay visible instead of being hidden by the fill).
  const tableByName = new Map(tables.map((t) => [t.name, t]));
  for (const t of tables) parts.push(renderTableCardSvg(t, C));
  for (const e of enums) parts.push(renderEnumCardSvg(e, C));
  for (const r of refs) {
    const from = tableByName.get(r.fromTable);
    const to = tableByName.get(r.toTable);
    if (!from || !to) continue;
    // Anchor at the field row when the ref names a field, else the card's
    // vertical center — mirrors the x6 port anchor so export matches preview.
    const fy = fieldRowY(from, r.fromFields[0]) ?? from.y + from.height / 2;
    const ty = fieldRowY(to, r.toFields[0]) ?? to.y + to.height / 2;
    const fromBox = { x: from.x, y: fy, width: from.width, height: 0 };
    const toBox = { x: to.x, y: ty, width: to.width, height: 0 };
    // ponytail: zOrthPath returns null when scy === tcy (two field rows
    // Y-aligned — the straight-line case the x6 router also returns [] for).
    // x6's default connector draws a straight line there; the export must do
    // the same instead of skipping, otherwise perfectly-aligned edges vanish
    // from the exported SVG.
    const path = zOrthPath(fromBox, toBox);
    const sourceOnRight = (to.x + to.width / 2) >= (from.x + from.width / 2);
    const fx = sourceOnRight ? from.x + from.width : from.x;
    const tx = sourceOnRight ? to.x : to.x + to.width;
    const pts = path
      ? path.map((p) => `${p.x},${p.y}`).join(' ')
      : `${fx},${fy} ${tx},${ty}`;
    parts.push(
      `<polyline points="${pts}" fill="none" stroke="${C.t3}" stroke-width="1.4" stroke-dasharray="0"`,
      ` marker-start="url(#er-one-double-start)" marker-end="url(#er-many-end)" />`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTableCardSvg(t: PositionedTable, C: Palette): string {
  const parts: string[] = [];
  parts.push('<g>');
  // Card body
  parts.push(
    `<rect x="${t.x}" y="${t.y}" width="${t.width}" height="${t.height}" rx="6" ry="6"`,
    ` fill="${C.surf}" stroke="${C.brd}" stroke-width="1" />`,
  );
  // Header band (top rounded)
  parts.push(
    `<path d="M ${t.x + 6} ${t.y} H ${t.x + t.width - 6} A 6 6 0 0 1 ${t.x + t.width} ${t.y + 6} V ${t.y + ER_HEADER_H} H ${t.x} V ${t.y + 6} A 6 6 0 0 1 ${t.x + 6} ${t.y} Z"`,
    ` fill="${C.hov}" />`,
  );
  parts.push(
    `<text x="${t.x + 14}" y="${t.y + ER_HEADER_H / 2}" dominant-baseline="central"`,
    ` font-family="'Sora',sans-serif" font-size="15" font-weight="700" fill="${C.t1}">${escapeXml(t.name)}</text>`,
  );
  // Divider
  parts.push(
    `<line x1="${t.x}" y1="${t.y + ER_HEADER_H}" x2="${t.x + t.width}" y2="${t.y + ER_HEADER_H}"`,
    ` stroke="${C.brd2}" stroke-width="1" />`,
  );
  // Fields
  t.fields.forEach((f, i) => {
    const ry = t.y + ER_HEADER_H + i * ER_ROW_H + ER_ROW_H / 2;
    if (f.pk) {
      parts.push(
        `<circle cx="${t.x + 10}" cy="${ry}" r="3" fill="${C.acc}" />`,
      );
    }
    parts.push(
      `<text x="${t.x + 22}" y="${ry}" dominant-baseline="central"`,
      ` font-family="'Sora',sans-serif" font-size="13" fill="${C.t1}">${escapeXml(f.name)}</text>`,
    );
    parts.push(
      `<text x="${t.x + t.width - 14}" y="${ry}" text-anchor="end" dominant-baseline="central"`,
      ` font-family="'DM Mono',monospace" font-size="12" fill="${C.t3}">${escapeXml(f.type)}</text>`,
    );
  });
  parts.push('</g>');
  return parts.join('');
}

function renderEnumCardSvg(e: PositionedEnum, C: Palette): string {
  const parts: string[] = [];
  parts.push('<g>');
  parts.push(
    `<rect x="${e.x}" y="${e.y}" width="${e.width}" height="${e.height}" rx="6" ry="6"`,
    ` fill="${C.surf}" stroke="${C.brd}" stroke-width="1" stroke-dasharray="3 2" />`,
  );
  parts.push(
    `<path d="M ${e.x + 6} ${e.y} H ${e.x + e.width - 6} A 6 6 0 0 1 ${e.x + e.width} ${e.y + 6} V ${e.y + ER_HEADER_H} H ${e.x} V ${e.y + 6} A 6 6 0 0 1 ${e.x + 6} ${e.y} Z"`,
    ` fill="${C.brd2}" />`,
  );
  parts.push(
    `<text x="${e.x + 14}" y="${e.y + ER_HEADER_H / 2}" dominant-baseline="central"`,
    ` font-family="'Sora',sans-serif" font-size="12" fill="${C.t3}">«enum»</text>`,
  );
  parts.push(
    `<text x="${e.x + 62}" y="${e.y + ER_HEADER_H / 2}" dominant-baseline="central"`,
    ` font-family="'Sora',sans-serif" font-size="15" font-weight="700" fill="${C.t1}">${escapeXml(e.name)}</text>`,
  );
  e.values.forEach((v, i) => {
    const ry = e.y + ER_HEADER_H + i * ER_ROW_H + ER_ROW_H / 2;
    parts.push(
      `<text x="${e.x + 22}" y="${ry}" dominant-baseline="central"`,
      ` font-family="'Sora',sans-serif" font-size="13" fill="${C.t1}">${escapeXml(v.name)}</text>`,
    );
  });
  parts.push('</g>');
  return parts.join('');
}
