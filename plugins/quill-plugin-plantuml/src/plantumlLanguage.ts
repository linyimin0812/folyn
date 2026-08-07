import { resolveCodemirror } from './codemirror';

// ponytail: PlantUML StreamLanguage mirrors the builtin mermaid one at
// packages/container-plugins/src/editor-languages/mermaid.ts. Small keyword
// set + line-comment token is enough for MVP per prd. Uses the host's
// @codemirror/language instance via window.codemirrorLanguage (see
// ./codemirror.ts) so the resulting LanguageSupport extension is the same
// module instance the host's EditorState applies — in-editor highlighting
// now renders for ```plantuml fenced blocks.
const { StreamLanguage, LanguageSupport } = resolveCodemirror();
type LanguageSupport = InstanceType<typeof LanguageSupport>;

const KEYWORDS = new Set([
  '@startuml', '@enduml', '@startsalt', '@endsalt',
  'participant', 'actor', 'usecase', 'class', 'interface', 'enum',
  'package', 'note', 'over', 'as',
]);

interface State {
  inLineComment: boolean;
}

export const plantumlStream = StreamLanguage.define({
  name: 'plantuml',
  startState(): State {
    return { inLineComment: false };
  },
  token(stream, state: State) {
    if (stream.sol()) state.inLineComment = false;
    if (stream.eatSpace()) return null;

    // Single-quote line comment
    if (stream.match(/^'[^\n]*/)) return 'comment';

    // Arrows (longest first)
    if (stream.match(/^(<-->|-->|<--|->|<-)/)) return 'operator';

    // @-prefixed block markers + words
    if (stream.eat(/[A-Za-z@]/)) {
      stream.eatWhile(/[\w-]/);
      const w = stream.current();
      if (KEYWORDS.has(w)) return 'keyword';
      if (/^\d+$/.test(w)) return 'number';
      return 'variable';
    }

    if (stream.match(/^\d+(\.\d+)?/)) return 'number';
    if (stream.match(/^:/)) return 'punctuation';

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "'" },
  },
});

let cached: LanguageSupport | null = null;
export function plantumlLanguage(): LanguageSupport {
  if (!cached) cached = new LanguageSupport(plantumlStream);
  return cached;
}
