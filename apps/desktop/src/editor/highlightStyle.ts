import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { EditorView } from '@codemirror/view';
import { tags } from '@lezer/highlight';

// ponytail: defaultHighlightStyle hardcodes light colors (e.g. #00c/#00f),
// which become unreadable on dark backgrounds. Use CSS variables so colors
// flip via [data-theme] without a compartment swap.

const t = tags;

export const folynHighlightStyle = HighlightStyle.define([
  { tag: t.meta, color: 'var(--cm-meta)' },
  { tag: t.link, textDecoration: 'underline' },
  { tag: t.heading, textDecoration: 'underline', fontWeight: 'bold' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strong, fontWeight: 'bold' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: t.keyword, color: 'var(--cm-keyword)' },
  { tag: [t.atom, t.bool, t.url, t.contentSeparator, t.labelName], color: 'var(--cm-atom)' },
  { tag: [t.literal, t.inserted], color: 'var(--cm-number)' },
  { tag: [t.string, t.deleted], color: 'var(--cm-string)' },
  { tag: [t.regexp, t.escape, t.special(t.string)], color: 'var(--cm-regexp)' },
  { tag: t.definition(t.variableName), color: 'var(--cm-var-def)' },
  { tag: t.local(t.variableName), color: 'var(--cm-var-local)' },
  { tag: [t.typeName, t.namespace], color: 'var(--cm-type)' },
  { tag: t.className, color: 'var(--cm-class)' },
  { tag: [t.special(t.variableName), t.macroName], color: 'var(--cm-var-special)' },
  { tag: t.definition(t.propertyName), color: 'var(--cm-prop)' },
  { tag: t.comment, color: 'var(--cm-comment)' },
  { tag: t.invalid, color: 'var(--cm-invalid)' },
]);

// ponytail: math decorations come from MarkdownMathExtension's ViewPlugin
// (Decoration.mark classes), not lezer tags — HighlightStyle can't target
// them. Theme the classes directly. Inline math gets a tinted background;
// display math gets a left border so block equations stand out.
export const mathTokenTheme = EditorView.theme({
  '.tok-math-inline': {
    color: 'var(--cm-string)',
    backgroundColor: 'var(--cm-math-bg, rgba(122, 110, 240, 0.12))',
    borderRadius: '2px',
  },
  '.tok-math-display': {
    color: 'var(--cm-string)',
    backgroundColor: 'var(--cm-math-bg, rgba(122, 110, 240, 0.12))',
    borderLeft: '2px solid var(--acc, #3a6ef0)',
    paddingLeft: '4px',
    borderRadius: '2px',
  },
});

export const folynHighlighting = () => [
  syntaxHighlighting(folynHighlightStyle, { fallback: true }),
  mathTokenTheme,
];
