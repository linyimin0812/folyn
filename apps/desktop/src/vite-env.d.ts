/// <reference types="vite/client" />

// Trusted-tier plugins are import()'d into the host realm via a blob URL and
// reach the host's React through `window.React` / `window.ReactDOM` (a blob URL
// can't resolve `import 'react'`). Declared here so main.tsx's assignment
// typechecks and plugin code (`window.React.createElement`) is typed. The
// ReactDOM global is the full `react-dom` API (createPortal/flushSync/…) —
// matching the UMD `export as namespace ReactDOM` global that already merges
// onto Window, so the assignment typechecks without conflict.
declare global {
  interface Window {
    React: typeof import('react');
    ReactDOM: typeof import('react-dom');
  }
}

// ponytail: the vite-plugin emits an array of FileRenderHandler with the same
// shape as preset-all's default export; reuse that type so FileViewer's
// options.preset accepts it without hand-rolled generics.
declare module 'virtual:file-viewer-renderers' {
  const renderers: typeof import('@file-viewer/preset-all')['default'];
  export default renderers;
}
