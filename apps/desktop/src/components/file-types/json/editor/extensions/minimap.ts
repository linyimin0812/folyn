/**
 * Minimap extension for the JSON5 CodeMirror editor (PR7).
 *
 * Uses `@replit/codemirror-minimap`'s `showMinimap` facet. The minimap
 * renders a scaled-down DOM mirror of the document in the right gutter;
 * the overlay highlights the current viewport.
 *
 * Theme adaptation is handled by the parent editor's `EditorView.theme`
 * (the minimap inherits the editor's CSS variables).
 */
import { showMinimap } from '@replit/codemirror-minimap';
import type { Extension } from '@codemirror/state';

export function minimapExtension(): Extension {
  return showMinimap.of({
    create: () => {
      const dom = document.createElement('div');
      dom.className = 'cm-minimap-dom';
      dom.style.setProperty('width', '80px');
      return { dom };
    },
    displayText: 'blocks',
    showOverlay: 'always',
  });
}
