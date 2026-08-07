// ponytail: resolve host React lazily so tests can set window.React after
// import (and the module loads even if window.React isn't set yet). The host
// assigns window.React in main.tsx before any trusted plugin is import()-ed.
export function resolveReact(): typeof import('react') {
  if (typeof window !== 'undefined' && window.React) return window.React;
  throw new Error('[plantuml-viewer] window.React not available — host must expose it (main.tsx)');
}
