/**
 * Extension runtime contracts — the typed shapes a extension's ESM bundle exports
 * and the host-side handler/container interfaces. Moved into the SDK so
 * external extension authors can typecheck their bundles against `folyn-extension-sdk`
 * without importing host internals.
 *
 * React appears as a peer type only (`ComponentType`, `ReactNode`); type-only
 * imports of `react` are erased at build, so the SDK has no runtime dependency.
 */

import type { ComponentType, ReactNode } from 'react';
import type { ExtensionApi, ExtensionContext } from './extension';
import type { FileTypeHandler } from './presentation';

// ── File-type contracts ──────────────────────────────────────────────────────
// The file presentation model (FileTypeProvider / PresentationMode /
// FilePresentationContext / EditorProps / PreviewProps /
// ViewMode) lives in `./presentation`. Re-exported here so existing
// `import from 'folyn-extension-sdk'` consumers are unchanged.
export type {
  FileTypeProvider,
  FileTypeHandler,
  PresentationModeRegistration,
  PresentationModeId,
  PresentationModeKind,
  SplitComposition,
  
  FilePresentationContext,
  IconRef,
  EditorProps,
  PreviewProps,
  ViewMode,
} from './presentation';

// ── Container contracts ────────────────────────────────────────────────────
// (Moved from packages/container-extensions/src/ContainerExtension.ts — that file
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

/** Category for organizing extensions in the slash menu */
export type ContainerCategory = 'layout' | 'media' | 'ai' | 'data' | 'custom';

/**
 * Interface that all container extensions must implement.
 * Registered extensions appear in the `/` slash command menu
 * and render inside the preview pane.
 */
export interface ContainerExtension {
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

// ── ExtensionModule export contract ────────────────────────────────────────────
// (Moved from apps/desktop/src/services/extension-host/contributionAdapters.ts.)
//
// The resolved exports of a extension's ESM bundle. All maps are optional — a
// extension may contribute only commands, only file-types, etc. Entry-ref keys
// match the strings declared in the manifest's `contributes.*[].handler` /
// `component` / `run` / `entry` fields.

/** Context passed to an exporter function (`ExtensionModule.exporters[entryRef]`). */
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

export interface MarkdownCodeRendererProps {
  /** Raw text content of the fenced code block. */
  source: string;
  /** Fence language as written (e.g. `puml` for an alias hit). */
  language: string;
  /** Canonical language id the renderer registered under (e.g. `plantuml`). */
  resolvedLanguage: string;
  /** Vault-relative path of the markdown file being previewed. */
  filePath: string;
}

/**
 * Lazy CodeMirror language factory. Returns a `LanguageSupport` at runtime;
 * ponytail: typed as `() => unknown` because the SDK has no `@codemirror/language`
 * dependency — the host narrows to `LanguageSupport` when it calls the factory.
 */
export type EditorLanguageFactory = () => unknown;

/**
 * highlight.js grammar factory. Receives the host's `hljs` instance and returns
 * a Language definition object. ponytail: typed `unknown` return because the
 * SDK has no `highlight.js` dependency — the host narrows to `Language` when
 * it calls `hljs.registerLanguage(name, fn)`.
 */
export type HighlightGrammarFn = (hljs: unknown) => unknown;

export interface ExtensionModule {
  /** Entry-ref → file-type handler. Keys match `contributes.fileTypes[].handler`. */
  handlers?: Record<string, FileTypeHandler>;
  /** Entry-ref → React component. Keys match `contributes.containers[].component`. */
  containers?: Record<string, ComponentType<ContainerProps>>;
  /**
   * Entry-ref → React component. Keys match `contributes.features[].component`.
   * Used by `registerExtensionFeatures` (services/extension-host/featureAdapter.ts)
   * to mount trusted-tier sidebar panels.
   */
  features?: Record<string, ComponentType>;
  /** Entry-ref → command handler. Keys match `contributes.commands[].run`. */
  commands?: Record<string, () => void | Promise<void>>;
  /** Entry-ref → exporter function. Keys match `contributes.exporters[].run`. */
  exporters?: Record<string, ExporterHandler>;
  /** Entry-ref → export enhancer. Keys match `contributes.exportEnhancers[].run`. */
  exportEnhancers?: Record<string, ExportEnhancerHandler>;
  /** Entry-ref → fenced-block renderer. Keys match `contributes.markdownCodeRenderers[].component`. */
  markdownCodeRenderers?: Record<string, ComponentType<MarkdownCodeRendererProps>>;
  /** Entry-ref → CodeMirror language factory. Keys match `contributes.editorLanguages[].entry`. */
  editorLanguages?: Record<string, EditorLanguageFactory>;
  /** Entry-ref → highlight.js grammar factory. Keys match `contributes.highlightGrammars[].entry`. */
  highlightGrammars?: Record<string, HighlightGrammarFn>;
  /** Optional lifecycle hook; receives the same (api, ctx) the loader passes
   * to {@link Extension.activate}. */
  activate?: (api: ExtensionApi, ctx: ExtensionContext) => void | Promise<void>;
  /** Optional lifecycle hook; called by the loader on deactivate. */
  deactivate?: (ctx: ExtensionContext) => void | Promise<void>;
}
