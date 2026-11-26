import { createContext, useContext } from 'react';

/**
 * True when the hosting preview pane is the tab currently shown.
 *
 * Why this exists: focus views (code/table/diagram focus, image lightbox)
 * portal their overlay to <body>, but a hidden preview pane is parked
 * offscreen (left:-200vw) rather than unmounted — and parking the pane does
 * NOT hide portals, because the portal DOM is a direct <body> child. Without
 * this context, a focus overlay opened on tab A stays floating above tab B
 * after the user switches tabs.
 *
 * React context crosses portals (it follows the component tree, not the DOM
 * tree), so focus views read this and unmount their portal while another tab
 * is shown. The pane stays mounted, so the focus state itself survives the
 * round trip: returning to the tab resumes the exact focus session.
 *
 * Default true: markdown rendered outside a PreviewPane (presentation deck,
 * settings preview, etc.) is always "shown".
 */
export const PreviewActiveContext = createContext(true);

export const usePreviewActive = (): boolean => useContext(PreviewActiveContext);
