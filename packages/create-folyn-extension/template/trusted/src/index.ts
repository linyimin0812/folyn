import type { ExtensionModule } from 'folyn-extension-sdk';

// ponytail: empty ExtensionModule. All maps are optional — register
// handlers/containers/exporters/markdownCodeRenderers/editorLanguages
// as you fill in manifest.json's contributes.* and the matching entry-refs
// here. React is shared from the host via window.React (see the shims in
// src/react-shim.js + src/react-jsx-runtime-shim.js, aliased by build.mjs).
// See folyn-extension-sdk/folyn-extension-plantuml (external repo) for a working example.
const module: ExtensionModule = {
  handlers: {},
  exporters: {},
};

export default module;
