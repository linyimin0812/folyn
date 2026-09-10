/**
 * Shared Toolbar / Context Resolver (doc §16–§17, §19).
 *
 * The Toolbar is Core-owned; its contents are computed from the current
 * Context + Extension capabilities — never from `if (file.ext === '.md')`
 * branches (doc §80). {@link ToolbarResolver} turns a {@link ToolbarContext}
 * into a {@link ToolbarState}, memoized per file-type id and invalidated on
 * file-switch / mode-switch / extension reload — NOT on cursor move / scroll
 * / text edit (doc §16.5).
 *
 * {@link WhenContext} is the typed-predicate evaluation surface (doc §19):
 * start with a typed object, NOT a string expression DSL. Forward-declared
 * here so Context Menu / Command Palette / Shortcuts (P3) reuse it without
 * rework.
 */

import type { PresentationModeId } from './presentation';

/** Reference to the active file (logical; never a physical path). */
export interface FileRef {
  path: string;
  fileType?: string;
}

/** Resolved file type for the active file (provider id + offered modes). */
export interface ResolvedFileType {
  id: string;
  modes: PresentationModeId[];
}

/** A text selection in the active editor (for when-clauses). */
export interface EditorSelection {
  text: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}

/**
 * What the toolbar resolves against (doc §17). Built by the shell from the
 * editor / nav / terminal stores.
 */
export interface ToolbarContext {
  activeFile: FileRef | null;
  fileType: ResolvedFileType | null;
  activeMode: string | null;
  activeWorkspace: string | null;
  selection: EditorSelection | null;
  /** 'editor' | 'settings' | 'schedule' | … — gates terminal/AI visibility. */
  currentPage: string;
}

/** What the toolbar renders. */
export interface ToolbarState {
  showTerminal: boolean;
  showAi: boolean;
  showExport: boolean;
  showLanguage: boolean;
  /** Modes to surface in the mode segment (from provider.modes). */
  modes: PresentationModeId[];
}

/**
 * Typed-predicate context for `when` clauses (doc §19). Stage 1: a typed
 * object — `ctx.get('file.type')` — NOT a string expression language. Context
 * Menu / Command Palette / Shortcuts (P3) evaluate against this.
 */
export interface WhenContext {
  get(key: string): unknown;
}

/**
 * Turns a {@link ToolbarContext} into a {@link ToolbarState}, memoized per
 * `fileType?.id` (doc §16.5). Invalidation events: file-switch, mode-switch,
 * extension reload. NOT invalidated by cursor move / text edit / scroll.
 */
export interface ToolbarResolver {
  resolve(context: ToolbarContext): ToolbarState;
  /** Drop the cached state for a file-type id (reload / provider change). */
  invalidate(fileTypeId: string): void;
}
