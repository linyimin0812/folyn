import esbuild from 'esbuild';
import { hostModules } from 'folyn-extension-sdk/build';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));

// ponytail: host bundle only (rich-text renders inline in the host React tree
// via NodeView; no separate origin like dbml's iframe). React, react-dom (which
// @tiptap/react imports), react-i18next and lucide-react resolve to the host's
// instances (hostModules). Tailwind/PostCSS are NOT built here: the host's
// tailwind.config.js scans every extension's `src` so the host's single CSS
// bundle covers the editor's classes. KaTeX CSS is imported in the host's
// main.tsx. esbuild `.css: 'text'` loader inlines the katex CSS string for the
// standalone HTML exporter (richtextHtml.ts).

// Every lucide-react icon the editor imports. A missing one fails the build
// with "No matching export in … for import" — add it here.
const LUCIDE_ICONS = [
  'AlignCenter',
  'AlignJustify',
  'AlignLeft',
  'AlignRight',
  'ArrowDownToLine',
  'ArrowLeftFromLine',
  'ArrowRightToLine',
  'ArrowUpFromLine',
  'Bold',
  'ChevronDown',
  'Code',
  'Code2',
  'Columns3',
  'Download',
  'Eraser',
  'FolderOpen',
  'Heading',
  'Heading1',
  'Heading2',
  'Heading3',
  'Image',
  'Italic',
  'Link',
  'List',
  'ListChecks',
  'ListOrdered',
  'MessageSquareText',
  'Minus',
  'Paintbrush',
  'Quote',
  'Redo',
  'Rows3',
  'Sigma',
  'Strikethrough',
  'Table',
  'TableCellsMerge',
  'TableCellsSplit',
  'Trash2',
  'Type',
  'Underline',
  'Undo',
  'ZoomIn',
  'ZoomOut',
];
const hostAlias = hostModules({ lucideIcons: LUCIDE_ICONS });

await mkdir(path.join(root, 'dist'), { recursive: true });

// ponytail: Copy richtext.svg as a standalone asset so manifest.icon can point
// at it — the host bundle inlines richtext.svg via esbuild's dataurl loader, but
// the settings page reads the manifest icon path separately via read_extension_file.
await copyFile(path.join(root, 'src/icons/richtext.svg'), path.join(root, 'dist/richtext.svg'));

await esbuild.build({
  entryPoints: [path.join(root, 'src/index.tsx')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: path.join(root, 'dist/index.js'),
  target: 'es2022',
  jsx: 'automatic',
  alias: hostAlias,
  // ponytail: .css → text string. richtextHtml.ts imports katex.min.css for
  // the standalone HTML export; the text loader returns the raw CSS so the
  // exporter can inline it into the <style> tag of the exported file.
  loader: { '.css': 'text', '.svg': 'dataurl' },
  minify: true,
  logLevel: 'warning',
});
console.log('host bundle → dist/index.js');

const manifest = JSON.parse(await readFile(path.join(root, 'src/manifest.json'), 'utf8'));
if (typeof manifest.main === 'string') {
  manifest.main = manifest.main.replace(/^dist\//, '');
}
await writeFile(
  path.join(root, 'dist/manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);

console.log('built dist/ — install the dist/ folder in Folyn → Plugins → Install from folder…');
