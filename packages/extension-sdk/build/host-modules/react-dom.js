// `react-dom` inside a trusted extension bundle: the host's instance
// (`window.ReactDOM`).
const ReactDOM = window.ReactDOM;

export default ReactDOM;
export const {
  createPortal,
  createRoot,
  findDOMNode,
  flushSync,
  hydrate,
  hydrateRoot,
  render,
  unmountComponentAtNode,
  unstable_batchedUpdates,
  version,
} = ReactDOM;
