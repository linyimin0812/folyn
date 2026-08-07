import type { PluginModule } from 'quill-plugin-sdk';

// ponytail: empty PluginModule. All maps are optional — register
// handlers/containers/exporters as you fill in manifest.json's contributes.*
// and the matching entry-refs here. See plugins/quill-plugin-plantuml for
// a working example.
const module: PluginModule = {
  handlers: {},
  exporters: {},
};

export default module;
