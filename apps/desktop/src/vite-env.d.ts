/// <reference types="vite/client" />
// ponytail: the vite-plugin emits an array of FileRenderHandler with the same
// shape as preset-all's default export; reuse that type so FileViewer's
// options.preset accepts it without hand-rolled generics.
declare module 'virtual:file-viewer-renderers' {
  const renderers: typeof import('@file-viewer/preset-all')['default'];
  export default renderers;
}
