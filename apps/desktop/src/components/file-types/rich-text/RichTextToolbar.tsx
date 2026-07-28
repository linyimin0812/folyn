import type { Editor } from '@tiptap/react';
import type { LucideIcon } from 'lucide-react';
import {
  Bold,
 Italic,
  Underline,
  Strikethrough,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  ListChecks,
  Quote,
  Code,
  Code2,
  Minus,
  Link as LinkIcon,
  Undo,
  Redo,
} from 'lucide-react';

// ponytail: icon-only buttons with title= attributes — no visible text, so
// no i18n namespace sprawl. Active state via editor.isActive(); disabled
// when the command is unavailable (no selection / not editable). One row,
// wraps on narrow widths. Matches the host-drawn toolbar pattern from
// file-type-editors.md (GrapesJS: panels disabled, host self-draws).

interface RichTextToolbarProps {
  editor: Editor;
}

interface ToolButton {
  icon: LucideIcon;
  title: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

export function RichTextToolbar({ editor }: RichTextToolbarProps) {
  const buttons: ToolButton[] = [
    {
      icon: Bold,
      title: 'Bold',
      active: editor.isActive('bold'),
      disabled: !editor.can().toggleBold(),
      onClick: () => editor.chain().focus().toggleBold().run(),
    },
    {
      icon: Italic,
      title: 'Italic',
      active: editor.isActive('italic'),
      disabled: !editor.can().toggleItalic(),
      onClick: () => editor.chain().focus().toggleItalic().run(),
    },
    {
      icon: Underline,
      title: 'Underline',
      active: editor.isActive('underline'),
      disabled: !editor.can().toggleUnderline(),
      onClick: () => editor.chain().focus().toggleUnderline().run(),
    },
    {
      icon: Strikethrough,
      title: 'Strikethrough',
      active: editor.isActive('strike'),
      disabled: !editor.can().toggleStrike(),
      onClick: () => editor.chain().focus().toggleStrike().run(),
    },
    {
      icon: Heading1,
      title: 'Heading 1',
      active: editor.isActive('heading', { level: 1 }),
      disabled: !editor.can().toggleHeading({ level: 1 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 1 }).run(),
    },
    {
      icon: Heading2,
      title: 'Heading 2',
      active: editor.isActive('heading', { level: 2 }),
      disabled: !editor.can().toggleHeading({ level: 2 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
    },
    {
      icon: Heading3,
      title: 'Heading 3',
      active: editor.isActive('heading', { level: 3 }),
      disabled: !editor.can().toggleHeading({ level: 3 }),
      onClick: () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
    },
    {
      icon: List,
      title: 'Bullet list',
      active: editor.isActive('bulletList'),
      disabled: !editor.can().toggleBulletList(),
      onClick: () => editor.chain().focus().toggleBulletList().run(),
    },
    {
      icon: ListOrdered,
      title: 'Ordered list',
      active: editor.isActive('orderedList'),
      disabled: !editor.can().toggleOrderedList(),
      onClick: () => editor.chain().focus().toggleOrderedList().run(),
    },
    {
      icon: ListChecks,
      title: 'Task list',
      active: editor.isActive('taskList'),
      disabled: !editor.can().toggleTaskList(),
      onClick: () => editor.chain().focus().toggleTaskList().run(),
    },
    {
      icon: Quote,
      title: 'Blockquote',
      active: editor.isActive('blockquote'),
      disabled: !editor.can().toggleBlockquote(),
      onClick: () => editor.chain().focus().toggleBlockquote().run(),
    },
    {
      icon: Code,
      title: 'Inline code',
      active: editor.isActive('code'),
      disabled: !editor.can().toggleCode(),
      onClick: () => editor.chain().focus().toggleCode().run(),
    },
    {
      icon: Code2,
      title: 'Code block',
      active: editor.isActive('codeBlock'),
      disabled: !editor.can().toggleCodeBlock(),
      onClick: () => editor.chain().focus().toggleCodeBlock().run(),
    },
    {
      icon: Minus,
      title: 'Horizontal rule',
      disabled: !editor.can().setHorizontalRule(),
      onClick: () => editor.chain().focus().setHorizontalRule().run(),
    },
    {
      icon: LinkIcon,
      title: 'Link',
      active: editor.isActive('link'),
      disabled: !editor.can().toggleLink({ href: '' }),
      onClick: () => {
        const prev = editor.getAttributes('link').href as string | undefined;
        const url = typeof window !== 'undefined' ? window.prompt('URL', prev ?? '') : prev ?? '';
        if (url === null) return;
        if (url === '') {
          editor.chain().focus().extendMarkRange('link').unsetLink().run();
          return;
        }
        editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
      },
    },
    {
      icon: Undo,
      title: 'Undo',
      disabled: !editor.can().undo(),
      onClick: () => editor.chain().focus().undo().run(),
    },
    {
      icon: Redo,
      title: 'Redo',
      disabled: !editor.can().redo(),
      onClick: () => editor.chain().focus().redo().run(),
    },
  ];

  return (
    <div className="flex flex-wrap items-center gap-[2px] px-2 py-1 border-b border-brd bg-surf2">
      {buttons.map((b, i) => (
        <button
          key={i}
          type="button"
          title={b.title}
          disabled={b.disabled}
          onClick={b.onClick}
          className={`inline-flex items-center justify-center w-7 h-7 rounded text-t2 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-default ${
            b.active ? 'bg-accdim text-acc' : ''
          }`}
        >
          <b.icon size={15} strokeWidth={1.6} />
        </button>
      ))}
    </div>
  );
}
