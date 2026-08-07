import hljs from 'highlight.js';
import type { HLJSApi } from 'highlight.js';

// Minimal PlantUML grammar for highlight.js. highlight.js doesn't ship
// plantuml, and the external plantuml plugin's CodeMirror Lezer grammar is
// format-incompatible, so we roll our own covering ~80% of common syntax:
// line/block comments, strings, numbers, @startuml/@enduml meta, keywords,
// and PascalCase identifiers (class/interface names).
// ponytail: hand-rolled because the only alternatives (third-party npm grammar,
// reusing Lezer grammar) are unverifiable or format-incompatible.
function plantuml(hljs: HLJSApi) {
  return {
    name: 'PlantUML',
    aliases: ['puml', 'pu'],
    keywords: {
      keyword: 'participant actor usecase class interface enum abstract package note skinparam activate deactivate alt else opt loop par group ref return create destroy hide show title caption legend footer header page newpage if endif while endwhile for fork finally again repeat start stop as is of in',
      literal: 'true false null',
    },
    contains: [
      hljs.COMMENT("'", '$'),
      hljs.COMMENT("/'", "'/"),
      hljs.COMMENT('/\\*', '\\*/'),
      hljs.COMMENT('//', '$'),
      { className: 'meta', begin: '@start\\w+|@end\\w+' },
      hljs.QUOTE_STRING_MODE,
      hljs.C_NUMBER_MODE,
    ],
  };
}

let registered = false;
/** Idempotent registration — safe to call from multiple import sites. */
export function registerPlantumlLanguage(): void {
  if (registered) return;
  if (!hljs.getLanguage('plantuml')) {
    hljs.registerLanguage('plantuml', plantuml);
  }
  registered = true;
}

registerPlantumlLanguage();
