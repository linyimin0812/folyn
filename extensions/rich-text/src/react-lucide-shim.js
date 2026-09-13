// ponytail: lucide-react shim — re-exports the host's window.lucideReact so
// the extension's esbuild bundle doesn't include lucide-react. esbuild's
// tree-shaking mangles lucide-react's namespace re-export pattern in
// dist/esm/lucide-react.mjs (`export { index as icons }; export { default
// as Bold } from './icons/bold.mjs'; ...`) — the named imports resolve to
// undefined or to the per-icon __iconNode SVG-data array instead of the
// React Component, making <b.icon /> render the array's indices as text
// ("0,1,2,3"). Sharing the host's already-initialized instance via
// window.lucideReact (mirrors the React/react-dom/react-i18next pattern
// at apps/desktop/src/main.tsx:17-40) avoids the bundler bug entirely.
//
// ESM named exports must be statically known at parse time, so we
// enumerate every named value import the extension uses. Add to this list
// when a new lucide icon is imported; the build will throw "X is not
// exported" if you miss one. Type imports (LucideIcon) are stripped by
// esbuild and resolve to the real lucide-react types in node_modules at
// typecheck time — no need to re-export them here.
const lucide = window.lucideReact;
export default lucide;

// Enumerated from grep `from 'lucide-react'` across extensions/rich-text/src:
// RichTextToolbar.tsx, RichTextSlashMenu.tsx, RichTextEditor.tsx,
// RichTextImage.tsx, TableControlsOverlay.tsx, dialogs/ImagePasteDialog.tsx.
export const {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  ArrowDownToLine,
  ArrowLeftFromLine,
  ArrowRightToLine,
  ArrowUpFromLine,
  Bold,
  ChevronDown,
  Code,
  Code2,
  Columns3,
  Download,
  Eraser,
  FolderOpen,
  Heading,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareText,
  Minus,
  Paintbrush,
  Quote,
  Redo,
  Rows3,
  Sigma,
  Strikethrough,
  Table,
  TableCellsMerge,
  TableCellsSplit,
  Trash2,
  Type,
  Underline,
  Undo,
  ZoomIn,
  ZoomOut,
} = lucide;
