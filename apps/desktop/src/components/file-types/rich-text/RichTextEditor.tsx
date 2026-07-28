import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { EditorProps } from '../types';

// ponytail: mount-once with initial content only. External (AI / file-watcher)
// content changes are NOT yet synced into the live editor — PR2 adds the
// drawio-style setContent guard (loadedContentRef + debounce-race clear) so AI
// edits apply in place without a remount. Disk is always correct today; a
// stale editor on external change is the known ceiling, cleared by reopening
// the tab or by PR2.
function parseContent(content: string) {
  if (!content.trim()) return undefined;
  try {
    const json = JSON.parse(content);
    return json && typeof json === 'object' ? json : undefined;
  } catch {
    return undefined;
  }
}

export function RichTextEditor({ content, onChange }: EditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [initialContent] = useState(() => parseContent(content));
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: initialContent,
    onUpdate: ({ editor }) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onChangeRef.current(JSON.stringify(editor.getJSON()));
      }, 500);
    },
  });

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return (
    <div className="w-full h-full overflow-auto bg-panel">
      {/* ponytail: scaffold styling — toolbar + themed prose styles land in PR2 */}
      <div className="mx-auto max-w-[760px] px-8 py-6 min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[60vh] [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-3 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-3 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-brd [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-t3 [&_.ProseMirror_pre]:bg-surf2 [&_.ProseMirror_pre]:rounded [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_code]:bg-surf2 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:rounded [&_.ProseMirror_hr]:border-brd [&_.ProseMirror_a]:text-acc [&_.ProseMirror_a]:underline">
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
