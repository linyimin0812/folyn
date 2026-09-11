// ponytail: react-dom shim — re-exports the host's window.ReactDOM so a
// bundled dependency (@tiptap/react, which imports react-dom for createPortal
// /flushSync) shares the host's single react-dom instance. Without this,
// esbuild bundles react-dom into the extension, and that bundled copy's
// internal imports of react's ReactCurrentBatchConfig (etc.) hit the
// react-shim's public-only API → `undefined is not an object` crash.
// Mirrors react-shim.js (window.React).
//
// `window.ReactDOM` is the host's `import * as ReactDOMFull from 'react-dom'`
// namespace. Its `.default` is the CJS react-dom object (the same one with
// all methods like createPortal, flushSync); named exports live on the
// namespace too. Resolve both shapes for safety.
const ReactDOMNamespace = window.ReactDOM;
const ReactDOM = ReactDOMNamespace.default || ReactDOMNamespace;

export default ReactDOM;

export const createPortal = ReactDOM.createPortal;
export const flushSync = ReactDOM.flushSync;
export const render = ReactDOM.render;
export const hydrate = ReactDOM.hydrate;
export const unmountComponentAtNode = ReactDOM.unmountComponentAtNode;
export const unstable_batchedUpdates = ReactDOM.unstable_batchedUpdates;
export const version = ReactDOM.version;
export const createRoot = ReactDOM.createRoot;
export const hydrateRoot = ReactDOM.hydrateRoot;
