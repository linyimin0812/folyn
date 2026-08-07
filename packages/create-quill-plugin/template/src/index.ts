import type { PluginModule } from 'quill-plugin-sdk';

// ponytail: empty PluginModule. All maps are optional — register
// handlers/containers/exporters/markdownCodeRenderers/editorLanguages
// as you fill in manifest.json's contributes.* and the matching entry-refs
// here. See quill-plugin-sdk/quill-plugin-plantuml (external repo) for a working example.
const module: PluginModule = {
  handlers: {},
  exporters: {},
};

export default module;
