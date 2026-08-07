// ponytail: resolve the host's @codemirror/language lazily so tests can set
// window.codemirrorLanguage after import (and the module loads even if it
// isn't set yet). The host assigns window.codemirrorLanguage in main.tsx
// before any trusted plugin is import()-ed. Mirrors resolveReact — bundling
// @codemirror/language into the plugin's blob would create a second module
// instance whose LanguageSupport extension the host's EditorState won't
// reliably apply (module-instance mismatch).
type CodemirrorLanguage = typeof import('@codemirror/language');

export function resolveCodemirror(): CodemirrorLanguage {
  const w = (typeof window !== 'undefined' ? window : null) as
    | (Window & { codemirrorLanguage?: CodemirrorLanguage })
    | null;
  if (w && w.codemirrorLanguage) return w.codemirrorLanguage;
  throw new Error('[plantuml-viewer] window.codemirrorLanguage not available — host must expose it (main.tsx)');
}
