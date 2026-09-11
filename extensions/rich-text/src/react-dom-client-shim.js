// ponytail: react-dom/client shim — re-exports the host's react-dom/client
// API (createRoot, hydrateRoot) from window.ReactDOM. Paired with
// react-dom-shim.js so any transitive `import { createRoot } from
// 'react-dom/client'` also resolves to the host's single react-dom instance.
const ReactDOMNamespace = window.ReactDOM;
const ReactDOM = ReactDOMNamespace.default || ReactDOMNamespace;

export const createRoot = ReactDOM.createRoot;
export const hydrateRoot = ReactDOM.hydrateRoot;
export default { createRoot, hydrateRoot };
