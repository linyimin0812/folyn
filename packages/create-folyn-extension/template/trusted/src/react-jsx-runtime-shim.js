const React = window.React;

// ponytail: jsx/jsxs (automatic runtime) pass the element key as the 3rd arg,
// but React.createElement treats the 3rd arg as the first child. Merge the
// key into props (createElement extracts `key` from config) so `<button
// key={...}>` doesn't render the key string as visible text.
function jsx(type, props, key) {
  return React.createElement(type, key !== undefined ? { ...props, key } : props);
}

export { jsx };
export const jsxs = jsx;
export const Fragment = React.Fragment;
