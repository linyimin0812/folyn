/**
 * react/jsx-runtime shim — the automatic JSX runtime, backed by the host's
 * `window.React`. Keeps JSX in bundled deps on the host's single React.
 */
const React = window.React;

export const jsx = React.createElement;
export const jsxs = React.createElement;
export const Fragment = React.Fragment;
