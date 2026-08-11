import { StreamLanguage, LanguageSupport } from '@codemirror/language';

// ponytail: covers the 80% case — graph/node/edge keywords, comments,
// strings, attributes. Not a full DOT parser; users editing obscure
// constructs still get readable plain-text. Mirrors mermaid.ts shape.

const GRAPH_KEYWORDS = new Set(['digraph', 'graph', 'subgraph', 'strict']);

// Statement keywords + Graphviz attribute names (graph/node/edge attrs).
const KEYWORDS = new Set([
  // Statements
  'node', 'edge', 'cluster',

  // Graph / layout attributes
  'rankdir', 'rank', 'ranksep', 'size', 'ratio', 'rotate', 'orientation',
  'center', 'margin', 'pad', 'page', 'pagedir', 'dpi', 'bgcolor',
  'color', 'fillcolor', 'fontcolor', 'fontname', 'fontsize', 'fontpath',
  'fontnames', 'label', 'labelloc', 'labeljust', 'label_scheme', 'layout',
  'splines', 'overlap', 'overlap_scaling', 'overlap_shrink', 'pack',
  'packmode', 'compound', 'concentrate', 'clusterrank', 'nodesep',
  'nslimit', 'nslimit1', 'maxiter', 'mclimit', 'mindist', 'mode', 'model',
  'mosek', 'newrank', 'normalize', 'notranslate', 'ordering',
  'outputorder', 'remincross', 'resolution', 'root', 'searchsize',
  'showboxes', 'start', 'stylesheet', 'target', 'truecolor', 'viewport',
  'xdotversion', 'charset', 'comment', 'forcelabels', 'gradientangle',
  'landscape', 'layerlistsep', 'layers', 'layerselect', 'layersep',
  'nojustify', 'pencolor', 'quantum', 'recolorscheme', 'scale', 'sep',
  'rotation', 'bb', 'area', 'defaultdist', 'Damping', 'K', 'levels',
  'levels_gap', 'linelength', 'quads',

  // Node attributes
  'shape', 'shapefile', 'height', 'width', 'fixedsize', 'pos', 'pin',
  'regular', 'sides', 'skew', 'distortion', 'peripheries', 'group',
  'image', 'imagepath', 'imagescale', 'samplepoints', 'sortv',
  'vertices', 'z', 'rects', 'style', 'class', 'id', 'href', 'URL',
  'tooltip', 'target', 'xlabel', 'xlp', 'layer',

  // Edge attributes
  'arrowhead', 'arrowtail', 'arrowsize', 'dir', 'headlabel', 'taillabel',
  'headport', 'tailport', 'headclip', 'tailclip', 'samehead', 'sametail',
  'lhead', 'ltail', 'head_lp', 'tail_lp', 'headURL', 'tailURL',
  'headhref', 'tailhref', 'headtarget', 'tailtarget', 'headtooltip',
  'tailtooltip', 'edgeURL', 'edgehref', 'edgetarget', 'edgetooltip',
  'labelURL', 'labelhref', 'labeltarget', 'labeltooltip', 'labelangle',
  'labeldistance', 'labelfloat', 'labelfontcolor', 'labelfontname',
  'labelfontsize', 'constraint', 'decorate', 'len', 'minlen', 'weight',
  'penwidth', 'colorlist',

  // Boolean-ish attribute values
  'true', 'false', 'yes', 'no',
]);

// Common DOT values — shapes, arrowheads, line styles, rank directions.
const ATOMS = new Set([
  'box', 'rect', 'rectangle', 'square', 'circle', 'ellipse', 'oval',
  'egg', 'triangle', 'diamond', 'trapezium', 'parallelogram', 'house',
  'pentagon', 'hexagon', 'septagon', 'octagon', 'doublecircle',
  'doubleoctagon', 'tripleoctagon', 'invtriangle', 'invtrapezium',
  'invhouse', 'Mdiamond', 'Msquare', 'Mcircle', 'record', 'Mrecord',
  'plain', 'plaintext', 'none', 'point', 'cylinder', 'note', 'tab',
  'folder', 'box3d', 'component', 'underline', 'star', 'promoter',
  'terminator',
  'normal', 'inv', 'dot', 'invdot', 'odot', 'invodot', 'tee', 'empty',
  'invempty', 'open', 'halfopen', 'vee', 'crow', 'box',
  'solid', 'dashed', 'dotted', 'bold', 'invis', 'filled', 'striped',
  'wedged', 'diagonals', 'rounded', 'radial',
  'spline', 'polyline', 'ortho', 'curved', 'line',
  'neato', 'fdp', 'sfdp', 'twopi', 'circo', 'osage', 'patchwork',
  'TB', 'LR', 'BT', 'RL',
  'same', 'min', 'max', 'source', 'sink',
]);

interface State {
  inBlockComment: boolean;
}

export const dotStream = StreamLanguage.define({
  name: 'dot',
  startState(): State {
    return { inBlockComment: false };
  },
  token(stream, state: State) {
    if (stream.eatSpace()) return null;

    // Block comment /* */
    if (state.inBlockComment) {
      if (stream.match(/^[^*]*\*\//)) {
        state.inBlockComment = false;
        return 'comment';
      }
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^\/\*/)) {
      state.inBlockComment = true;
      return 'comment';
    }

    // Line comment: // and #
    if (stream.match(/^\/\/[^\n]*/)) return 'comment';
    if (stream.match(/^#[^\n]*/)) return 'comment';

    // Strings "..." (with \" escape)
    if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return 'string';

    // HTML-like labels <...> (treat as string)
    if (stream.match(/^<[A-Za-z/][^>]*>/)) return 'string';

    // Arrows / edges
    if (stream.match(/^(->|--)/)) return 'operator';

    // Punctuation
    if (stream.match(/^[{}()\[\];,:=]/)) return 'punctuation';

    // Words
    if (stream.eat(/[A-Za-z_]/)) {
      stream.eatWhile(/[\w_]/);
      const w = stream.current();
      if (GRAPH_KEYWORDS.has(w)) return 'meta';
      if (KEYWORDS.has(w)) return 'keyword';
      if (ATOMS.has(w)) return 'atom';
      return 'variable';
    }

    // Numbers
    if (stream.match(/^\d+(\.\d+)?/)) return 'number';

    stream.next();
    return null;
  },
  languageData: {
    commentTokens: { line: '//', block: { open: '/*', close: '*/' } },
  },
});

/** ponytail: factory shape — host narrows the `unknown` return to LanguageSupport. */
export function dot(): LanguageSupport {
  return new LanguageSupport(dotStream);
}
