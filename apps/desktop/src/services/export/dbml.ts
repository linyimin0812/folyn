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
  const layout = layoutEr(result.schema, 800, 600);
  const svgString = renderErLayoutToSvg(layout);
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

// ponytail: concrete light-theme hex, NOT var(--xxx). The SVG is extracted
// standalone by shared.renderFilePreviewToSvg (no :root ancestor), so CSS
// vars don't resolve in .svg files or PNG canvas rasterization — fills fall
// back to black. Hex matches LIGHT_THEME_VARS in exportService.ts.
const C = {
  surf: '#f8f9fd', brd: '#dde2f0', hov: '#e8ecf8', brd2: '#c8d0e8',
  t1: '#1a2040', t3: '#8892b0', acc: '#3a6ef0',
};
// ponytail: duplicated from erLayout.ts (ER_HEADER_H=38, ER_ROW_H=28). The
// constants are stable layout sizing — duplicate beats a static import
// that would pull d3-force into the main bundle. Revisit if they drift.
const ER_HEADER_H = 38;
const ER_ROW_H = 28;

// ponytail: standalone ER→SVG renderer. Mirrors the layout coordinates from
// erLayout (header / row heights already agree with the in-app x6 render).
// Drops x6-specific styling (drag handles, popovers, grid). Add when an
// export needs closer visual parity with the in-app preview.
function renderErLayoutToSvg(layout: import('@/components/file-types/dbml/erLayout').ErLayout): string {
  const { tables, enums, refs } = layout;
  if (tables.length === 0 && enums.length === 0) return '';
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
  // Edges last so they draw on top of cards (mirrors x6's edge z-order —
  // lines crossing a card stay visible instead of being hidden by the fill).
  const tableByName = new Map(tables.map((t) => [t.name, t]));
  for (const t of tables) parts.push(renderTableCardSvg(t));
  for (const e of enums) parts.push(renderEnumCardSvg(e));
  for (const r of refs) {
    const from = tableByName.get(r.fromTable);
    const to = tableByName.get(r.toTable);
    if (!from || !to) continue;
    // Exit point: midpoint of the facing side of `from` → facing side of `to`.
    const fx = from.x + (to.x + to.width / 2 >= from.x + from.width / 2 ? from.width : 0);
    const fy = from.y + from.height / 2;
    const tx = to.x + (from.x + from.width / 2 >= to.x + to.width / 2 ? to.width : 0);
    const ty = to.y + to.height / 2;
    const mx = (fx + tx) / 2;
    parts.push(
      `<polyline points="${fx},${fy} ${mx},${fy} ${mx},${ty} ${tx},${ty}"`,
      ` fill="none" stroke="${C.t3}" stroke-width="1.4" stroke-dasharray="0" />`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

function escapeXml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function renderTableCardSvg(t: import('@/components/file-types/dbml/erLayout').PositionedTable): string {
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

function renderEnumCardSvg(e: import('@/components/file-types/dbml/erLayout').PositionedEnum): string {
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
