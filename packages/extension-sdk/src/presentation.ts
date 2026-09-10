/**
 * File Presentation model (doc §11–§14, §43).
 *
 * A file type is not "a text editor" — it is a **File Presentation Provider**:
 * it declares which presentation modes it offers (edit / preview / split /
 * custom), and the shell resolves the active mode to render.
 *
 * Modes are declarative: a mode carries a `kind` (shell-editor | component |
 * split) + optional component, rather than a `create(ctx)` factory. This keeps
 * the builtin migration mechanical and WorkArea resolution a `switch(kind)`.
 * The shell owns the split layout + resizer (doc §13.3); `split` is a
 * composition of two sibling mode ids, not a separate renderer.
 *
 * `FilePresentationContext` is the props bundle the shell hands to a mode's
 * component (content / cursor-sync / signal). It subsumes the legacy
 * EditorProps/PreviewProps so extension-authored custom editors/previews share
 * one shape.
 *
 * React appears as a peer type only (`ComponentType`, `ReactNode`); type-only
 * imports of `react` are erased at build, so the SDK has no runtime dep.
 */

import type { ComponentType, ReactNode } from 'react';

/** Stable id of a presentation mode: built-ins + an open string tail. */
export type PresentationModeId =
  | 'edit'
  | 'split'
  | 'preview'
  | (string & {});

/** Icon reference: inline SVG string, ThemeIcon name, or any ReactNode. */
export type IconRef = ReactNode;

/**
 * Props bundle the shell passes to a mode's component. Subsumes the legacy
 * EditorProps/PreviewProps (content / filePath / onChange / onSave / cursor
 * sync). `document` is an opaque forward slot for the shared DocumentModel
 * (§23) — deferred; not wired in P1.
 */
export interface FilePresentationContext {
  readonly filePath: string;
  readonly tabId: string;
  readonly content: string;
  readonly vaultRoot: string;
  readonly mode: PresentationModeId;
  readonly readonly: boolean;
  readonly signal: AbortSignal;
  onChange?(content: string): void;
  onSave?(): void;
  readonly cursorLine?: number;
  readonly cursorViewportY?: number;
  readonly editorViewportTop?: number;
  readonly cursorCol?: number;
  readonly lineLength?: number;
  readonly hasSelection?: boolean;
}

/** Kind of view a mode produces. */
export type PresentationModeKind = 'shell-editor' | 'component' | 'split';

/** Optional split composition (doc §13.3). */
export interface SplitComposition {
  orientation?: 'horizontal' | 'vertical';
  left: PresentationModeId;
  right: PresentationModeId;
}

/**
 * A presentation mode offered by a provider. `kind` selects how the shell
 * renders it:
 *  - `shell-editor`: the host renders its built-in CodeMirror editor. Core
 *    owns CodeMirror; extensions never get the internal view (doc §15).
 *  - `component`: render `component` with the active {@link FilePresentationContext}.
 *  - `split`: shell-owned layout composing two sibling modes (resizer etc.).
 */
export interface PresentationModeRegistration {
  id: PresentationModeId;
  title?: string;
  icon?: IconRef;
  kind: PresentationModeKind;
  /** Component for `kind: 'component'` (typed loosely — the host narrows to
   * EditorProps/PreviewProps at the render site; `any` so any concrete
   * component is assignable). */
  component?: ComponentType<any>;
  /** Composition for `kind: 'split'`. */
  split?: SplitComposition;
  /**
   * For `kind: 'component'`: where the component renders. Defaults by id —
   * `'preview'` → `'preview-pane'` (shell cursor-sync wrapper), else `'inline'`
   * (custom editor area). Providers with a non-preview component living under
   * the `preview` id (e.g. clip's card view) set `'inline'` explicitly.
   */
  via?: 'preview-pane' | 'inline';
}

/**
 * A file-type presentation provider. Replaces the flat `FileTypeHandler`
 * (Editor/Preview/supportedViewModes) with declarative `modes`.
 */
export interface FileTypeProvider {
  id: string;
  extensions: string[];
  mimeTypes?: string[];
  icon?: IconRef;
  /** Whether opening this type requires the file content loaded (vs binary). */
  needsFileContent?: boolean;
  /** Resolution priority (doc §25): higher wins. Tiers:
   *  10000 first-party first-class builtin, 5000 installed specialized,
   *  1000 user-configured, 0 generic, -1000 fallback File Viewer.
   *  Default 0. A specialized provider thus overrides the generic viewer. */
  priority?: number;
  /** Presentation modes offered. The shell switches the active mode. */
  modes: PresentationModeRegistration[];
  /** Optional default mode id (otherwise the first mode). */
  defaultMode?: PresentationModeId;
  /** Normalize content on load (e.g. CRLF → LF). */
  serialize?: (content: string) => string;
  /** Normalize content before display. */
  deserialize?: (raw: string) => string;
}

/** Type alias kept so existing `import type { FileTypeHandler }` migrates
 * mechanically — it IS the provider now. */
export type FileTypeHandler = FileTypeProvider;

// ── Legacy component prop shapes ──────────────────────────────────────────────
// Builtin modes reference their components against these; the shell builds a
// FilePresentationContext and projects the relevant fields onto them.

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
  onChange?: (content: string) => void;
  cursorLine?: number;
  cursorViewportY?: number;
  editorViewportTop?: number;
  cursorCol?: number;
  lineLength?: number;
  hasSelection?: boolean;
}

/** Back-compat alias (ViewMode is now PresentationModeId). */
export type ViewMode = PresentationModeId;
