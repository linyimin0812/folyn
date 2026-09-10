import type { PluginModule } from 'folyn-extension-sdk';

// ponytail: empty PluginModule. All maps are optional — register
// handlers/containers/exporters/markdownCodeRenderers/editorLanguages
// as you fill in manifest.json's contributes.* and the matching entry-refs
// here. See folyn-extension-sdk/folyn-plugin-plantuml (external repo) for a working example.
const module: PluginModule = {
  handlers: {},
  exporters: {},
};

export default module;
