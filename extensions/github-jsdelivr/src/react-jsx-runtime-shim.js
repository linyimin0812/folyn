/**
 * react/jsx-runtime shim — the automatic JSX runtime, backed by the host's
 * `window.React`.
 */
const React = window.React;

export const jsx = React.createElement;
export const jsxs = React.createElement;
export const Fragment = React.Fragment;
