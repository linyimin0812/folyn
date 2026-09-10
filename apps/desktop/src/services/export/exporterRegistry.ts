/**
 * ExporterRegistry + ExportService (doc §20–§22).
 *
 * Core owns the service (query / execute / save); Exporters are registered
 * contributors keyed by file-type id. Exporters return an {@link ExportResult}
 * and Core saves it via {@link downloadBlob} — exporters never write the FS.
 *
 * Builtin exporters (markdown html/svg, canvas svg/png, source) are registered
 * here so ExportMenu can build its items from `getAvailableExporters(ctx)` with
 * no per-file-type if/else (doc §80).
 */

import type {
  ExporterDescriptor,
  ExporterRegistration,
  ExporterRegistry,
  ExportRequest,
  ExportResult,
  ExportService,
  ExportContext,
} from 'folyn-plugin-sdk';
import { OwnedRegistry, FOLYN_CORE_OWNER } from 'folyn-plugin-sdk';
import type { Disposable } from 'folyn-plugin-sdk';
import { downloadBlob, svgToPngBlob, renderFilePreviewToSvg } from './shared';
import { hasContainerSyntax } from '../exportService';
import { renderMarkmapSvg } from './markmapShared';
import { resolveAssetBase } from '@/components/file-types/previewPath';
import { richTextToHtmlBlob } from './richtext';
import { getActiveDocument } from '@/hooks/useExport';

// ponytail: one owned registry instance; the ExportService resolves against it.
const registry = new OwnedRegistry<ExporterRegistration>((e) => e.id);

export const exporterRegistry: ExporterRegistry = {
  register(reg, owner = FOLYN_CORE_OWNER): Disposable {
    return registry.register(reg, owner);
  },
  get(id) {
    return registry.get(id);
  },
  list() {
    return registry.list();
  },
  remove(id) {
    return registry.remove(id);
  },
  removeByOwner(owner) {
    registry.removeByOwner(owner);
  },
  getForFileType(fileTypeId, ctx) {
    return registry
      .list()
      .filter((e) => e.fileTypes.length === 0 || e.fileTypes.includes(fileTypeId))
      .filter((e) => !e.supports || e.supports(ctx))
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  },
};

/** Derive the base file name (no extension) for an export from the active doc. */
function baseName(): string {
  const name = getActiveDocument().name || 'export';
  return name.replace(/\.[^.]+$/, '') || 'export';
}

/** Core save chokepoint: ExportResult → OS save dialog. */
async function save(result: ExportResult, ext: string): Promise<ExportResult> {
  const blob =
    typeof result.data === 'string'
      ? new Blob([result.data], { type: result.mimeType })
      : new Blob([result.data as BlobPart], { type: result.mimeType });
  await downloadBlob(blob, result.suggestedName, [ext]);
  return result;
}

export const exportService: ExportService & {
  /** Run an exporter and return its ExportResult WITHOUT saving — used by
   * dialogs that need the result bytes to route to download or upload. */
  runExporter(exporterId: string, ctx: ExportContext): Promise<ExportResult>;
} = {
  getAvailableExporters(ctx, fileTypeId): ExporterDescriptor[] {
    const out: ExporterDescriptor[] = [];
    for (const e of exporterRegistry.getForFileType(fileTypeId, ctx)) {
      for (const f of e.formats) {
        out.push({ id: e.id, title: e.title, format: f });
      }
    }
    return out;
  },
  async export(request: ExportRequest): Promise<ExportResult> {
    const e = exporterRegistry.get(request.exporterId);
    if (!e) throw new Error(`Unknown exporter: ${request.exporterId}`);
    const result = await e.export(request.ctx, request.options);
    const ext = e.formats[0]?.extension ?? 'bin';
    return save(result, ext);
  },
  async runExporter(exporterId, ctx) {
    const e = exporterRegistry.get(exporterId);
    if (!e) throw new Error(`Unknown exporter: ${exporterId}`);
    return e.export(ctx);
  },
};

// ── Builtin exporters ────────────────────────────────────────────────────────

/** Source (raw content) exporter — applies to every text file type. */
const sourceExporter: ExporterRegistration = {
  id: 'builtin.source',
  title: 'Source',
  fileTypes: [], // all
  formats: [{ id: 'source', title: 'Source', extension: '', mimeType: 'text/plain;charset=utf-8' }],
  export(ctx) {
    const ext = ctx.filePath.split('.').pop() ?? 'txt';
    const mime = ext === 'json' ? 'application/json;charset=utf-8' : 'text/plain;charset=utf-8';
    return Promise.resolve({
      data: ctx.content,
      mimeType: mime,
      suggestedName: `${baseName()}.${ext}`,
    });
  },
};


/** Markdown headings → markmap mind-map SVG. */
const markdownMarkmapExporter: ExporterRegistration = {
  id: 'markdown.markmap',
  title: 'Mindmap',
  fileTypes: ['markdown'],
  formats: [{ id: 'svg', title: 'SVG', extension: 'svg', mimeType: 'image/svg+xml;charset=utf-8' }],
  async export(ctx) {
    const assetBase = ctx.filePath
      ? await resolveAssetBase(ctx.filePath, ctx.vaultRoot).catch(() => null)
      : null;
    const svgEl = await renderMarkmapSvg(ctx.content, assetBase);
    const svg = new XMLSerializer().serializeToString(svgEl);
    return { data: svg, mimeType: 'image/svg+xml;charset=utf-8', suggestedName: `${baseName()}.svg` };
  },
};

/** Rich-text → standalone HTML. */
const richTextHtmlExporter: ExporterRegistration = {
  id: 'rich-text.html',
  title: 'HTML',
  fileTypes: ['rich-text'],
  formats: [{ id: 'html', title: 'HTML', extension: 'html', mimeType: 'text/html;charset=utf-8' }],
  async export(ctx) {
    const blob = await richTextToHtmlBlob(ctx.content, baseName(), ctx.vaultRoot);
    const html = await blob.text();
    return { data: html, mimeType: 'text/html;charset=utf-8', suggestedName: `${baseName()}.html` };
  },
};

const CANVAS_FILE_TYPES = ['dbml', 'excalidraw', 'drawio', 'markmap', 'plantuml', 'graphviz', 'mermaid'];
// Canvas types whose SVG can be rasterized to PNG (no foreignObject / server-only SVG).
const CANVAS_PNG_EXCLUDED = new Set(['markmap', 'plantuml', 'graphviz', 'mermaid']);

/** Canvas-backed file (dbml/excalidraw/drawio/markmap/plantuml/graphviz/mermaid) → SVG. */
const canvasSvgExporter: ExporterRegistration = {
  id: 'builtin.canvas.svg',
  title: 'SVG',
  fileTypes: CANVAS_FILE_TYPES,
  formats: [{ id: 'svg', title: 'SVG', extension: 'svg', mimeType: 'image/svg+xml;charset=utf-8' }],
  async export(ctx) {
    const svg = await renderFilePreviewToSvg(ctx.filePath, ctx.vaultRoot);
    if (!svg) throw new Error('canvas render returned no SVG');
    return { data: svg, mimeType: 'image/svg+xml;charset=utf-8', suggestedName: `${baseName()}.svg` };
  },
};

/** Canvas → PNG (skipped for foreignObject / server-only SVG types). */
const canvasPngExporter: ExporterRegistration = {
  id: 'builtin.canvas.png',
  title: 'PNG',
  fileTypes: CANVAS_FILE_TYPES,
  formats: [{ id: 'png', title: 'PNG', extension: 'png', mimeType: 'image/png' }],
  supports() {
    // fileType not on ctx directly — infer from filePath extension's provider.
    // The registry's getForFileType already filters by fileTypeId, so we only
    // need to exclude the foreignObject/server-only set here.
    return true;
  },
  async export(ctx) {
    const svg = await renderFilePreviewToSvg(ctx.filePath, ctx.vaultRoot);
    if (!svg) throw new Error('canvas render returned no SVG');
    const png = await svgToPngBlob(svg, 3);
    if (!png) throw new Error('svg→png rasterization failed');
    const buf = new Uint8Array(await png.arrayBuffer());
    return { data: buf, mimeType: 'image/png', suggestedName: `${baseName()}.png` };
  },
};

/** Register all builtin exporters once at app boot. Idempotent. */
let builtinRegistered = false;
export function registerBuiltinExporters(): void {
  if (builtinRegistered) return;
  builtinRegistered = true;
  registry.register(sourceExporter, FOLYN_CORE_OWNER);
  registry.register(markdownMarkmapExporter, FOLYN_CORE_OWNER);
  registry.register(richTextHtmlExporter, FOLYN_CORE_OWNER);
  registry.register(canvasSvgExporter, FOLYN_CORE_OWNER);
  // PNG only for canvas types that rasterize cleanly.
  for (const ft of CANVAS_FILE_TYPES) {
    if (!CANVAS_PNG_EXCLUDED.has(ft)) {
      registry.register(
        { ...canvasPngExporter, id: `builtin.canvas.${ft}.png`, fileTypes: [ft] },
        FOLYN_CORE_OWNER,
      );
    }
  }
}

/** Re-export for ExportMenu's container-warning gate (markdown source). */
export { hasContainerSyntax };
