/**
 * GrapesJS initialization config factory for the Quill HTML editor.
 *
 * Quill renders its own React UI shell (toolbar / panels / tabs) — GrapesJS
 * built-in panels are disabled, and the Block/Style/Selector/Layer/Trait
 * managers are mounted into React-managed container refs instead.
 *
 * Persistence is handled by Quill's Zustand store (via the `onChange`
 * callback in `useGrapesEditor`), so GrapesJS's own storageManager is disabled.
 */

import type { Editor } from 'grapesjs';
import grapesjsBlocksBasic from 'grapesjs-blocks-basic';

export interface GrapesInitOptions {
  /** Canvas container — GrapesJS owns the iframe inside this node. */
  container: HTMLElement;
  /** Mount point for the StyleManager panel. */
  stylesContainer: HTMLElement;
  /** Mount point for the SelectorManager panel. */
  selectorsContainer: HTMLElement;
  /** Mount point for the LayerManager panel. */
  layersContainer: HTMLElement;
  /** Mount point for the TraitManager panel. */
  traitsContainer: HTMLElement;
}

/**
 * Style Manager sectors — 6 sectors covering the full CSS surface area the
 * existing PropertiesPanel exposed (plus everything prd §4.3 lists).
 */
const STYLE_SECTORS = [
  {
    name: 'Typography',
    open: false,
    buildProps: [
      'font-family',
      'font-size',
      'font-weight',
      'line-height',
      'letter-spacing',
      'color',
      'text-align',
      'text-decoration',
      'text-transform',
    ],
  },
  {
    name: 'Background',
    open: false,
    buildProps: [
      'background-color',
      'background-image',
      'background-repeat',
      'background-position',
      'background-size',
    ],
  },
  {
    name: 'Dimensions',
    open: false,
    buildProps: [
      'width',
      'min-width',
      'max-width',
      'height',
      'min-height',
      'max-height',
    ],
  },
  {
    name: 'Spacing',
    open: false,
    buildProps: ['margin', 'padding'],
  },
  {
    name: 'Border',
    open: false,
    buildProps: ['border-radius', 'border', 'box-shadow'],
  },
  {
    name: 'Layout',
    open: false,
    buildProps: [
      'display',
      'flex-direction',
      'justify-content',
      'align-items',
      'flex-wrap',
      'gap',
      'position',
      'overflow',
      'opacity',
    ],
  },
];

/** External stylesheet URLs injected into the canvas iframe on load. */
const CANVAS_STYLES = [
  'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
];

/**
 * Build the config object handed to `grapesjs.init()`.
 */
export function createGrapesConfig(opts: GrapesInitOptions): Record<string, unknown> {
  return {
    container: opts.container,
    height: '100%',
    // Fill the React shell's center column width. `width: 'auto'` sizes the
    // canvas iframe to content width, leaving a blank strip on the right; we
    // must take the full container width so no empty gap appears.
    width: '100%',
    fromElement: false,
    // Quill owns persistence via Zustand store; GrapesJS must not try to
    // autosave to localStorage or remote backends.
    storageManager: false,
    // Disable built-in panels — the React shell renders its own toolbar.
    panels: { defaults: [] },

    // BlockManager is intentionally left unmounted: the React shell no longer
    // renders a block-library sidebar. GrapesJS falls back to its default
    // hidden block container, and `registerCustomBlocks` still works (it
    // only mutates the manager's registry, not the DOM). Removing the
    // `blockManager` config key entirely is safe.
    styleManager: { appendTo: opts.stylesContainer, sectors: STYLE_SECTORS },
    selectorManager: { appendTo: opts.selectorsContainer },
    layerManager: { appendTo: opts.layersContainer },
    traitManager: { appendTo: opts.traitsContainer },

    deviceManager: {
      devices: [
        { name: 'Desktop', width: '' },
        { name: 'Tablet', width: '768px', widthMedia: '992px' },
        { name: 'Mobile portrait', width: '375px', widthMedia: '480px' },
      ],
    },

    canvas: {
      styles: CANVAS_STYLES,
    },

    plugins: [grapesjsBlocksBasic],
    pluginsOpts: {
      // GrapesJS matches plugin options by plugin reference; at runtime the
      // function is coerced to a string key. The cast keeps TS happy because
      // `pluginsOpts` is typed as `Record<string, any>`.
      [grapesjsBlocksBasic as unknown as string]: {
        flexGrid: true,
        category: '基础',
      },
    },
  };
}

/**
 * Inject external <link> stylesheets from the parsed <head> into the canvas
 * iframe document. Called once on `editor.on('load', ...)` (prd §6.2).
 */
export function injectExternalLinks(editor: Editor, headContent: string): void {
  const canvasDoc = editor.Canvas?.getDocument?.();
  if (!canvasDoc || !headContent) return;
  // Match <link rel="stylesheet" href="..."> (case-insensitive, tolerant attrs)
  const linkRegex = /<link\b[^>]*>/gi;
  const matches = headContent.match(linkRegex) || [];
  for (const tag of matches) {
    const tmp = document.createElement('div');
    tmp.innerHTML = tag;
    const link = tmp.firstChild as HTMLLinkElement | null;
    if (!link || link.tagName.toLowerCase() !== 'link') continue;
    const cloned = canvasDoc.importNode(link, true);
    canvasDoc.head.appendChild(cloned);
  }
}

/**
 * Hide scrollbars inside the canvas iframe document. GrapesJS renders the
 * edited page inside a sandboxed iframe; parent-page CSS cannot reach into
 * it, so a <style> tag is injected into the iframe's <head> to suppress the
 * html/body scrollbar gutter while keeping wheel/trackpad scrolling working.
 */
export function injectCanvasScrollbarHide(editor: Editor): void {
  const canvasDoc = editor.Canvas?.getDocument?.();
  if (!canvasDoc) return;
  const style = canvasDoc.createElement('style');
  style.setAttribute('data-quill', 'canvas-scrollbar-hide');
  style.textContent = `
    html, body {
      width: 100% !important;
      min-height: 100% !important;
      margin: 0 !important;
      padding: 0 !important;
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
    html::-webkit-scrollbar,
    body::-webkit-scrollbar,
    body *::-webkit-scrollbar { display: none !important; }
    body * {
      scrollbar-width: none !important;
      -ms-overflow-style: none !important;
    }
  `;
  canvasDoc.head.appendChild(style);
}
