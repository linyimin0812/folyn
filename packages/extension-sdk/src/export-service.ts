/**
 * Export Service (doc §20–§22).
 *
 * ExportService is Core-owned: query / select / execute / progress / cancel /
 * error-normalize / save. Exporters are Extension (or builtin) contributors
 * registered with the ExporterRegistry, keyed by file-type id. An Exporter
 * never writes the filesystem — it returns an {@link ExportResult} and Core
 * saves it via the save dialog (doc §22).
 */

import type { Disposable } from './Disposable';

/** Context handed to an exporter. */
export interface ExportContext {
  /** Vault-relative path of the active document. */
  filePath: string;
  /** Absolute vault root, for resolving sibling assets. */
  vaultRoot: string;
  /** Active document content (string). Empty for binary types. */
  content: string;
}

/** One output format an exporter can produce. */
export interface ExportFormat {
  id: string;
  title: string;
  extension: string; // without dot, e.g. 'pdf'
  mimeType: string;
}

/** Per-export options (e.g. page size, quality). Opaque key→value. */
export type ExportOptions = Record<string, unknown>;

/** What an exporter returns. Core saves it. */
export interface ExportResult {
  /** Output bytes; strings are accepted for text formats. */
  data: Uint8Array | string;
  mimeType: string;
  suggestedName: string;
}

/** A registered exporter. `export` returns the result; Core saves. */
export interface ExporterRegistration {
  /** Globally-unique id, e.g. 'markdown.html'. */
  id: string;
  /** Menu label. */
  title: string;
  /** Provider ids this exporter applies to. Empty = all (backward-compat). */
  fileTypes: string[];
  formats: ExportFormat[];
  /** Higher wins when multiple match. */
  priority?: number;
  /** Optional capability gate (e.g. skip png for foreignObject SVGs). */
  supports?(ctx: ExportContext): boolean;
  /** Produce the output. Core saves the returned ExportResult. */
  export(ctx: ExportContext, options?: ExportOptions): Promise<ExportResult>;
}

/** Read-only descriptor for menu building (doc §20 getAvailableExporters). */
export interface ExporterDescriptor {
  id: string;
  title: string;
  format: ExportFormat;
}

/** Request to run an exporter (doc §20 export). */
export interface ExportRequest {
  exporterId: string;
  ctx: ExportContext;
  options?: ExportOptions;
}

/**
 * Owned registry of exporters. `register` returns a Disposable; `removeByOwner`
 * bulk-removes an extension's exporters on reload/deactivate.
 */
export interface ExporterRegistry {
  register(registration: ExporterRegistration, ownerExtensionId: string): Disposable;
  get(id: string): ExporterRegistration | undefined;
  list(): ExporterRegistration[];
  remove(id: string): boolean;
  removeByOwner(ownerExtensionId: string): void;
  /** Exporters applicable to a file-type id (filtered + supports() gate). */
  getForFileType(fileTypeId: string, ctx: ExportContext): ExporterRegistration[];
}

/** Core-owned export service (doc §20). */
export interface ExportService {
  getAvailableExporters(ctx: ExportContext, fileTypeId: string): ExporterDescriptor[];
  export(request: ExportRequest): Promise<ExportResult>;
}
