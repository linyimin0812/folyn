// `react/jsx-runtime` over the host's React. The automatic runtime calls
// `jsx(type, props, key)` with children inside `props`; `createElement` takes
// `(type, props, ...children)`, so the key is folded back into the props and
// never passed where children go.
const React = window.React;

export function jsx(type, props, key) {
  return React.createElement(type, key === undefined ? props : { ...props, key });
}
export const jsxs = jsx;
export const Fragment = React.Fragment;
