/**
 * Lifecycle hook for the GrapesJS editor inside Quill.
 *
 * Responsibilities (prd §4.2):
 *   - Mount GrapesJS once into the provided container refs
 *   - Load parsed content into the editor (scripts stripped before ingestion)
 *   - Inject external <link> CSS into the canvas iframe on `load`
 *   - Debounce content changes (500ms, matching the legacy bridge) and emit
 *     `onChange` with a full reconstructed HTML document
 *   - Track the current selection so the React shell can show/hide the right
 *     panel only when an element is selected (Issue 3)
 *   - Flush final content on unmount BEFORE destroying the editor
 *
 * The hook is mount-once: `content` and `onChange` are captured into refs so
 * the GrapesJS lifecycle is NOT torn down and re-initialized when the parent
 * re-renders. Content echoed back via `onChange` is never fed back into
 * `editor.setComponents` — that would create a write loop.
 */

import { useEffect, useRef, useState, useCallback, type RefObject } from 'react';
import grapesjs from 'grapesjs';
import type { Editor } from 'grapesjs';
import 'grapesjs/dist/css/grapes.min.css';
import './grapesTheme.css';

import { createGrapesConfig, injectExternalLinks, injectCanvasScrollbarHide } from './grapesConfig';
import { registerCustomBlocks } from './grapesBlocks';
import {
  parseHtmlForGrapes,
  reconstructHtml,
  type ParsedHtml,
} from './grapesContentPipeline';

export interface UseGrapesEditorOptions {
  containerRef: RefObject<HTMLElement>;
  stylesRef: RefObject<HTMLElement>;
  selectorsRef: RefObject<HTMLElement>;
  layersRef: RefObject<HTMLElement>;
  traitsRef: RefObject<HTMLElement>;
  content: string;
  onChange: (content: string) => void;
}

export interface UseGrapesEditorResult {
  editor: Editor | null;
  /** True when a component is currently selected in the canvas. */
  hasSelection: boolean;
  /**
   * Monotonically increasing counter bumped each time a NON-NULL component is
   * selected via `component:select`. Used by the React shell to reset the
   * `userClosed` flag on every new selection — including re-selecting an
   * element while another is already selected (a case `hasSelection` alone
   * can't detect, since the boolean doesn't change true → true).
   */
  selectionTick: number;
}

const DEBOUNCE_MS = 500;

// Events that should trigger a debounced content extraction. `component:drag:move`
// is intentionally NOT included — it fires continuously during drag and would
// cause layout thrash. Only the drag-end (and structural/style change) events
// are wired, and even those are debounced so `getHtml`/`getCss` never run
// mid-interaction.
const CHANGE_EVENTS = [
  'component:update',
  'component:add',
  'component:remove',
  'component:drag:end',
  'styleUpdate',
  'style:custom',
  'undo',
  'redo',
] as const;

export function useGrapesEditor(opts: UseGrapesEditorOptions): UseGrapesEditorResult {
  const {
    containerRef,
    stylesRef,
    selectorsRef,
    layersRef,
    traitsRef,
    content,
    onChange,
  } = opts;

  const editorRef = useRef<Editor | null>(null);
  // Lazy-init parsedRef so parseHtmlForGrapes runs exactly once per mount
  // instead of on every render (the `useRef(initialValue)` pattern evaluates
  // `initialValue` every render even though the value is discarded).
  const parsedRef = useRef<ParsedHtml | null>(null);
  if (parsedRef.current === null) {
    parsedRef.current = parseHtmlForGrapes(content);
  }
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // A guard that suppresses the change→extract→onChange pipeline when we are
  // programmatically loading content (so we don't echo the input back).
  const suppressChangeRef = useRef(false);

  const [hasSelection, setHasSelection] = useState(false);
  const [selectionTick, setSelectionTick] = useState(0);

  const flushFinalContent = useCallback(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
    const editor = editorRef.current;
    if (!editor || !parsedRef.current) return;
    try {
      const html = editor.getHtml() ?? '';
      const css = editor.getCss() ?? '';
      const full = reconstructHtml(parsedRef.current, html, css);
      onChangeRef.current(full);
    } catch {
      // Ignore — best effort flush on teardown.
    }
  }, []);

  const scheduleContentExtraction = useCallback(() => {
    if (suppressChangeRef.current) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      const editor = editorRef.current;
      if (!editor || !parsedRef.current) return;
      try {
        const html = editor.getHtml() ?? '';
        const css = editor.getCss() ?? '';
        const full = reconstructHtml(parsedRef.current, html, css);
        onChangeRef.current(full);
      } catch {
        // Ignore serialization failures — keep editor interactive.
      }
    }, DEBOUNCE_MS);
  }, []);

  // —— Mount / load / teardown ——
  useEffect(() => {
    const container = containerRef.current;
    const styles = stylesRef.current;
    const selectors = selectorsRef.current;
    const layers = layersRef.current;
    const traits = traitsRef.current;

    if (!container || !styles || !selectors || !layers || !traits) {
      return;
    }

    // Re-parse in case `content` changed between first render and effect.
    const parsed = parseHtmlForGrapes(content);
    parsedRef.current = parsed;

    suppressChangeRef.current = true;

    const config = createGrapesConfig({
      container,
      stylesContainer: styles,
      selectorsContainer: selectors,
      layersContainer: layers,
      traitsContainer: traits,
    });

    let editor: Editor;
    try {
      editor = grapesjs.init(config);
    } catch (err) {
      console.error('[useGrapesEditor] grapesjs.init failed:', err);
      suppressChangeRef.current = false;
      return;
    }

    editorRef.current = editor;

    registerCustomBlocks(editor);

    // Load content — setComponents/setStyle before `load` so the canvas
    // renders the correct initial state when it boots.
    //
    // We pass the original <style> blocks to `editor.setStyle()` so the
    // canvas renders with the user's existing CSS and the Style Manager can
    // surface current values for selected components. `reconstructHtml`
    // then relies on `editor.getCss()` for the full CSS output and only
    // re-appends @-rules (keyframes / font-face / import) that GrapesJS
    // may not round-trip faithfully — re-appending the originals verbatim
    // would compound across saves and cause unbounded file growth.
    try {
      editor.setComponents(parsed.bodyContent || '');
      editor.setStyle(parsed.styleBlocks.join('\n'));
    } catch (err) {
      console.error('[useGrapesEditor] setComponents failed:', err);
    }

    const onReady = () => {
      injectExternalLinks(editor, parsed.headContent);
      injectCanvasScrollbarHide(editor);
      // Allow subsequent change events to flow.
      suppressChangeRef.current = false;
    };
    editor.on('load', onReady);

    // Wire change events (debounced 500ms — no setState, no React re-render
    // during the debounce window, so drag is unaffected).
    const onChangeHandler = () => scheduleContentExtraction();
    CHANGE_EVENTS.forEach((evt) => editor.on(evt, onChangeHandler));

    // Track selection so the React shell can show/hide the right panel.
    // `component:select` fires on click-select and on deselect (component
    // argument is null/undefined when nothing is selected). It does NOT fire
    // on `component:drag:move`, so this never triggers React re-renders
    // mid-drag.
    const onSelect = (component: unknown) => {
      const has = Boolean(component);
      setHasSelection(has);
      // Bump the tick only on a real (non-null) selection so that deselect
      // does NOT re-open a user-closed panel — the shell's `hasSelection`
      // fall to `false` already hides it.
      if (has) setSelectionTick((t) => t + 1);
    };
    editor.on('component:select', onSelect);

    return () => {
      // Best-effort final flush BEFORE destroying the editor — this captures
      // the latest in-memory state even if the user switched modes before
      // the debounce timer fired.
      flushFinalContent();
      try {
        editor.destroy();
      } catch {
        // Ignore teardown errors.
      }
      editorRef.current = null;
      setHasSelection(false);
      setSelectionTick(0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    editor: editorRef.current,
    hasSelection,
    selectionTick,
  };
}
