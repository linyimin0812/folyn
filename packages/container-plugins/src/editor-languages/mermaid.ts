import { StreamLanguage, LanguageSupport } from '@codemirror/language';

const DIAGRAM_KEYWORDS = new Set([
  'graph', 'flowchart', 'sequenceDiagram', 'classDiagram', 'stateDiagram', 'stateDiagram-v2',
  'erDiagram', 'gantt', 'pie', 'journey', 'gitGraph', 'mindmap', 'quadrantChart',
  'requirementDiagram', 'C4Context', 'C4Container', 'C4Component', 'C4Dynamic', 'C4Relationship',
  'sankey', 'timeline', 'zenuml', 'packet', 'architecture', 'kanban', 'xychart', 'block',
]);

const KEYWORDS = new Set([
  'subgraph', 'end', 'direction', 'class', 'classDef', 'style', 'click', 'linkStyle',
  'hyperlink', 'activate', 'deactivate', 'participant', 'as', 'alt', 'opt', 'else',
  'loop', 'par', 'and', 'rect', 'autonumber', 'Note', 'note', 'over', 'rgb', 'fill',
  'stroke', 'color', 'transparent', 'date', 'title', 'section', 'accTitle', 'accDescr',
  'config', 'init', '%%', 'format', 'sortable', 'read-only', 'contains',
]);

const DIRECTIONS = new Set(['TB', 'TD', 'BT', 'RL', 'LR']);

interface State {
  inLineComment: boolean;
  inFrontmatter: boolean;
  sawFirstLine: boolean;
}

export const mermaidStream = StreamLanguage.define({
  name: 'mermaid',
  startState(): State {
    return { inLineComment: false, inFrontmatter: false, sawFirstLine: false };
  },
  token(stream, state: State) {
    if (stream.sol()) {
      state.inLineComment = false;
    }

    if (stream.eatSpace()) return null;

    // YAML frontmatter: --- ... --- at very top of block
    if (!state.sawFirstLine && stream.match(/^---\s*$/)) {
      state.inFrontmatter = true;
      state.sawFirstLine = true;
      return 'meta';
    }
    state.sawFirstLine = true;
    if (state.inFrontmatter) {
      if (stream.match(/^---\s*$/)) {
        state.inFrontmatter = false;
        return 'meta';
      }
      // YAML key:value
      const yamlKey = stream.match(/^\s*[A-Za-z][\w-]*(?=\s*:)/);
      if (yamlKey) return 'property';
      stream.skipToEnd();
      return 'string';
    }

    // Line comment %%
    if (stream.match(/^%%[^\n]*/)) return 'comment';
    // Block comment /* */
    if (stream.match(/^\/\*[\s\S]*?\*\//)) return 'comment';

    // Strings (double or single quoted)
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';
    if (stream.match(/^'(?:[^'\\]|\\.)*'/)) return 'string';

    // Arrows (longest first)
    if (stream.match(/^(==>>|==>>|<-->|-->|---|==>|-.->|--|<--|~~|->|~>)/)) return 'operator';

    // Node shape punctuation
    if (stream.match(/^(<-->|\(\(|\)\)|\[\[|\]\]|\(|\)|\[|\]|\{|\}|>|\)|<|\/\/|\\|\/)/)) return 'bracket';

    // Words
    if (stream.eat(/[A-Za-z]/)) {
      stream.eatWhile(/[\w-]/);
      const w = stream.current();
      if (DIAGRAM_KEYWORDS.has(w) || KEYWORDS.has(w)) return 'keyword';
      if (DIRECTIONS.has(w)) return 'atom';
      if (/^\d+$/.test(w)) return 'number';
      return 'variable';
    }

    // Numbers
    if (stream.match(/^\d+(\.\d+)?%?/)) return 'number';

    // YAML key in inline config: key: value
    if (stream.match(/^[A-Za-z][\w-]*(?=\s*:)/)) return 'property';
    if (stream.match(/^:/)) return 'punctuation';

    if (stream.match(/^\|[^|]*\|/)) return 'string';
    if (stream.match(/^(?:::|;|,)/)) return 'punctuation';

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '%%' },
  },
});

/** ponytail: factory shape — host narrows the `unknown` return to LanguageSupport. */
export function mermaid(): LanguageSupport {
  return new LanguageSupport(mermaidStream);
}
