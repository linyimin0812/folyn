import { StreamLanguage, LanguageSupport } from '@codemirror/language';

// ponytail: covers the 80% case — common diagram keywords, comments, strings.
// Not a full PlantUML parser; users editing obscure constructs still get
// readable plain-text. Mirrors mermaid.ts shape (state machine + keyword set).

const DIAGRAM_KEYWORDS = new Set([
  '@startuml', '@enduml', '@startsalt', '@endsalt', '@startmindmap', '@endmindmap',
  '@startgantt', '@endgantt', '@startditaa', '@endditaa', '@startwbs', '@endwbs',
  '@startjson', '@endjson', '@startyaml', '@endyaml', '@startcreole', '@endcreole',
  '@startebnf', '@endebnf', '@startnwdiag', '@endnwdiag', '@startjcckit', '@endjcckit',
  '@startbpm', '@endbpm', '@startbytefield', '@endbytefield', '@startdot', '@enddot',
  '@startfiles', '@endfiles', '@starthcl', '@endhcl', '@startlazy', '@endlazy',
  '@startmath', '@endmath', '@startsdl', '@endsdl', '@startteoz', '@endteoz',
  '@startxml', '@endxml', '@startxdef', '@endxdef',
]);

const KEYWORDS = new Set([
  // Classifier / element keywords
  'actor', 'participant', 'usecase', 'class', 'interface', 'enum', 'abstract',
  'package', 'component', 'node', 'database', 'cloud', 'folder', 'frame',
  'rectangle', 'queue', 'storage', 'agent', 'artifact', 'boundary', 'card',
  'circle', 'collections', 'file', 'hexagon', 'stack', 'object', 'bar',
  'circles', 'entity', 'control', 'annotation', 'partition', 'map', 'person',
  'diamond', 'binary', 'clock', 'concise', 'robust', 'struct', 'exception',
  'metaclass', 'stereotype', 'label', 'mainframe', 'box',

  // Relationships / modifiers
  'extends', 'implements', 'association', 'aggregation', 'composition',
  'dependency', 'inheritance', 'realize', 'link', 'static', 'state', 'note',
  'notes', 'end', 'fork', 'forkagain', 'join', 'hide', 'show', 'empty',
  'entry', 'exit', 'autonumber', 'activate', 'deactivate', 'as', 'over',
  'alt', 'else', 'elseif', 'endif', 'opt', 'loop', 'par', 'break', 'critical',
  'group', 'create', 'destroy', 'return', 'new', 'old', 'true', 'false',
  'null', 'skinparam', 'title', 'header', 'footer', 'legend', 'endlegend',
  'caption', 'scale', 'rotate', 'page', 'newpage', 'include', 'includes',
  'import', 'sprite', 'stylesheet', 'set', 'variable', 'function',
  'procedure', 'local', 'global', 'default', 'switch', 'case', 'endswitch',
  'while', 'endwhile', 'repeat', 'repeatwhile', 'if', 'then', 'start', 'stop',
  'resume', 'kill', 'detach', 'merge', 'split', 'splitagain', 'backward',
  'goto', 'duration', 'at', 'into', 'within', 'every', 'last', 'this',
  'next', 'until', 'from', 'to', 'on', 'off', 'yes', 'no', 'auto', 'color',
  'order', 'same', 'together', 'allowmixing', 'allow_mixing', 'direction',
  'left', 'right', 'top', 'bottom', 'center', 'up', 'down', 'dotted',
  'dashed', 'bold', 'italic', 'underline', 'plain', 'normal', 'reverse',
  'hidden', 'thickness', 'highlight', 'remove', 'allow', 'maxmessagesize',
]);

// Whole-phrase layout keywords, matched before single-word tokenizing.
const PHRASE_KEYWORDS = [
  /^left to right direction\b/i,
  /^top to bottom direction\b/i,
];

// Longest-first so `-->>` wins over `-->`, etc.
const ARROW_RE = /^(?:<<->>|<<-->>|<->>|<-->>|o->>|o-->>|<<-|-->>|->>|-->|<--|<-|\|--|--\||<\|--|--\|>|<\|\.\.|\.\.\|>|o--|--o|o-|x--|--x|x-|\*--|--\*|\*-|#--|--#|#-|0--|--0|0-|\+--|--\+|\+-|\.\.>|\.>|\.\.\|>|<\|\.\.|\.\.|<->|<-->|-\||\|->|->x|x->|->o|o->|->\*|\*->|-\/|\/|->|--|\.\.|\||<|>)/;

interface State {
  inBlockComment: boolean;
  inLineComment: boolean;
}

export const plantumlStream = StreamLanguage.define({
  name: 'plantuml',
  startState(): State {
    return { inBlockComment: false, inLineComment: false };
  },
  token(stream, state: State) {
    if (stream.sol()) state.inLineComment = false;

    if (stream.eatSpace()) return null;

    // Block comment /' ... '/
    if (state.inBlockComment) {
      if (stream.match(/^[^']*'?'/)) {
        if (stream.current().endsWith("'")) state.inBlockComment = false;
        return 'comment';
      }
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\/'/)) {
      state.inBlockComment = true;
      return 'comment';
    }

    // Line comment: ' to end of line, or leading / line
    if (stream.match(/^'[^\n]*/)) {
      state.inLineComment = true;
      return 'comment';
    }
    if (stream.match(/^\/[^\n]*/)) return 'comment';

    // Block comment /* */ (PlantUML also supports C-style)
    if (stream.match(/^\/\*[\s\S]*?\*\//)) return 'comment';

    // Strings "..."
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';

    // Whole-phrase layout keywords (left to right direction, ...)
    for (const phrase of PHRASE_KEYWORDS) {
      if (stream.match(phrase)) return 'meta';
    }

    // Preprocessor-style function calls: %date(), %strlen(...)
    if (stream.match(/^%[A-Za-z_][\w]*\s*\([^)]*\)/)) return 'def';

    // Arrows
    if (stream.match(ARROW_RE)) return 'operator';

    // Visibility modifiers (+ public, # protected, - private, ~ package).
    // 'modifier' is a modifier tag (cannot start a token and logs a warning),
    // so color them like operators.
    if (stream.match(/^[+#~]/)) return 'operator';

    // Punctuation
    if (stream.match(/^[{}()\[\];,:.|]/)) return 'punctuation';

    // Words (case-insensitive — PlantUML keywords are case-insensitive)
    if (stream.eat(/[A-Za-z@]/)) {
      stream.eatWhile(/[\w@-]/);
      const w = stream.current().toLowerCase();
      if (DIAGRAM_KEYWORDS.has(w)) return 'meta';
      if (KEYWORDS.has(w)) return 'keyword';
      return 'variable';
    }

    // Numbers
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: "'", block: { open: "/'", close: "'/" } },
  },
});

/** ponytail: factory shape — host narrows the `unknown` return to LanguageSupport. */
export function plantuml(): LanguageSupport {
  return new LanguageSupport(plantumlStream);
}
