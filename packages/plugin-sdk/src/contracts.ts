/**
 * Plugin runtime contracts — the typed shapes a plugin's ESM bundle exports
 * and the host-side handler/container interfaces. Moved into the SDK so
 * external plugin authors can typecheck their bundles against `quill-plugin-sdk`
 * without importing host internals.
 *
 * React appears as a peer type only (`ComponentType`, `ReactNode`); type-only
 * imports of `react` are erased at build, so the SDK has no runtime dependency.
 */

import type { ComponentType, ReactNode } from 'react';
import type { PluginContext } from './types';

// ── File-type contracts ────────────────────────────────────────────────────
// (Moved from apps/desktop/src/components/file-types/types.ts — that file now
// re-exports from here so existing app consumers are unchanged.)

// Built-in view modes plus an open string tail so plugins can register custom
// modes (e.g. a canvas plugin's 'canvas' mode). The `(string & {})` tail keeps
// literal autocomplete for built-ins while allowing any custom id.
export type ViewMode = 'split' | 'edit' | 'preview' | 'visual' | 'source' | (string & {});

export interface EditorProps {
  content: string;
  tabId: string;
  filePath: string;
  onChange: (content: string) => void;
  onSave: () => void;
}

export interface PreviewProps {
  content: string;
  filePath: string;
  vaultRoot: string;
  /**
   * Optional write-back hook for preview components that allow in-place
   * editing (e.g. the JSON file viewer's left CodeMirror pane). When bound,
   * edits flow through `editorStore.updateTabContent` so Cmd+S / auto-save
   * persist the new content to disk. Optional — handlers that don't edit
   * (csv, office, dbml, markdown) simply omit it.
   */
  onChange?: (content: string) => void;
}

export interface FileTypeHandler {
  id: string;
  extensions: string[];
  icon?: ReactNode;
  supportedViewModes: ViewMode[];
  defaultViewMode?: ViewMode;
  needsFileContent: boolean;
  useCodeMirror?: boolean;
  Editor?: ComponentType<EditorProps>;
  Preview?: ComponentType<PreviewProps>;
  serialize?: (content: string) => string;
  deserialize?: (raw: string) => string;
}

// ── Container contracts ────────────────────────────────────────────────────
// (Moved from packages/container-plugins/src/ContainerPlugin.ts — that file
// now re-exports from here.)

/** Props passed to every container component */
export interface ContainerProps {
  /** Raw children content from the directive */
  children?: ReactNode;
  /** Directive attributes (e.g. type="info") */
  attributes?: Record<string, string>;
  /** Container name (e.g. "callout") */
  name?: string;
}

/** Category for organizing plugins in the slash menu */
export type ContainerCategory = 'layout' | 'media' | 'ai' | 'data' | 'custom';

/**
 * Interface that all container plugins must implement.
 * Registered plugins appear in the `/` slash command menu
 * and render inside the preview pane.
 */
export interface ContainerPlugin {
  /** Unique name matching the directive (e.g. "callout") */
  name: string;
  /** Emoji or icon for the slash menu */
  icon: string;
  /** Human-readable label */
  label: string;
  /** Category for grouping in the slash menu */
  category: ContainerCategory;
  /** React component that renders this container */
  component: ComponentType<ContainerProps>;
  /** Markdown template inserted when selected from slash menu */
  template: string;
  /** Optional description shown in the slash menu */
  description?: string;
}

// ── PluginModule export contract ────────────────────────────────────────────
// (Moved from apps/desktop/src/services/plugin-host/contributionAdapters.ts.)
//
// The resolved exports of a plugin's ESM bundle. All maps are optional — a
// plugin may contribute only commands, only file-types, etc. Entry-ref keys
// match the strings declared in the manifest's `contributes.*[].handler` /
// `component` / `run` / `entry` fields.

/** Context passed to an exporter function (`PluginModule.exporters[entryRef]`). */
export interface ExporterContext {
  /** Vault-relative path of the active document being exported. */
  filePath: string;
  /** Absolute vault root, for resolving sibling assets. */
  vaultRoot: string;
}

/** A custom exporter: takes doc content + ctx, returns a Blob or string to write. */
export type ExporterHandler = (content: string, ctx: ExporterContext) => Promise<Blob | string>;

/**
 * A post-render export enhancer: takes the rendered container/file-preview body
 * element + ctx, mutates it in place to be self-contained for export (e.g.
 * canvas→SVG capture, stripping action buttons, inlining async content). Runs
 * host-realm on a real HTMLElement after the in-DOM render has settled.
 */
export type ExportEnhancerHandler = (body: HTMLElement, ctx: ExporterContext) => Promise<void>;

export interface PluginModule {
  /** Entry-ref → file-type handler. Keys match `contributes.fileTypes[].handler`. */
  handlers?: Record<string, FileTypeHandler>;
  /** Entry-ref → React component. Keys match `contributes.containers[].component`. */
  containers?: Record<string, ComponentType<ContainerProps>>;
  /**
   * Entry-ref → React component. Keys match `contributes.features[].component`.
   * Used by `registerPluginFeatures` (services/plugin-host/featureAdapter.ts)
   * to mount trusted-tier sidebar panels.
   */
  features?: Record<string, ComponentType>;
  /** Entry-ref → command handler. Keys match `contributes.commands[].run`. */
  commands?: Record<string, () => void | Promise<void>>;
  /** Entry-ref → exporter function. Keys match `contributes.exporters[].run`. */
  exporters?: Record<string, ExporterHandler>;
  /** Entry-ref → export enhancer. Keys match `contributes.exportEnhancers[].run`. */
  exportEnhancers?: Record<string, ExportEnhancerHandler>;
  /** Optional lifecycle hook; called by the trusted loader on activate. */
  activate?: (ctx: PluginContext) => void | Promise<void>;
  /** Optional lifecycle hook; called by the trusted loader on deactivate. */
  deactivate?: (ctx: PluginContext) => void | Promise<void>;
}
