import type { ExtensionModule } from 'folyn-extension-sdk';

// ponytail: empty ExtensionModule. All maps are optional — register
// handlers/containers/exporters/markdownCodeRenderers/editorLanguages
// as you fill in manifest.json's contributes.* and the matching entry-refs
// here. See folyn-extension-sdk/folyn-extension-plantuml (external repo) for a working example.
const module: ExtensionModule = {
  handlers: {},
  exporters: {},
};

export default module;
