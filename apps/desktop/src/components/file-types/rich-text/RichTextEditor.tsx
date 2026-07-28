import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import type { EditorProps } from '../types';
import {
  deserializeToContent,
  emptyDoc,
  serializeToDisk,
  shouldApplyExternalContent,
} from './richTextContent';
import { RichTextImage } from './RichTextImage';
import { RichTextToolbar } from './RichTextToolbar';

// ponytail: anti-write-back-loop guard — drawio loadedXml + loadedXmlRef
// pattern, adapted for tiptap (no iframe). User edits update the ref ONLY
// (no setLoadedContent) and debounce onChange; external content changes
// (AI apply via setContentExternal → remount; AI reject via revertEditorTab
// → updateTabContent WITHOUT a version bump → in-place setContent) call
// editor.commands.setContent(parsed, { emitUpdate: false }) so onUpdate
// does not fire and the loop is broken. The pending debounce timer is
// cleared before setContent so a stale user save can't clobber the just-
// applied external content (race guard).
//
// Why not mount-only + remount like the drawio editor in this repo: a
// remount destroys tiptap cursor + undo history on every external change.
// The in-place setContent preserves the editor instance; revertEditorTab
// (reject path) deliberately routes through updateTabContent (no version
// bump) so this effect fires. The accept path bumps externalContentVersion
// and remounts — also fine, the effect is a no-op on a fresh mount (ref
// initialized from content).

export function RichTextEditor({ content, onChange }: EditorProps) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks the last content we handed to the editor (mount init or a
  // setContent call) OR the last JSON the user's edit emitted. Either way,
  // it's what the content prop should equal when the change originated from
  // us — so the content-prop effect sees them equal and skips the reload.
  const loadedContentRef = useRef(content);

  const editor = useEditor({
    extensions: [
      StarterKit,
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { allowTableNodeSelection: true } }),
      RichTextImage,
    ],
    content: deserializeToContent(content) ?? emptyDoc(),
    onUpdate: ({ editor }) => {
      // User edit: update ref ONLY (not setState), so when our own onChange
      // flows back via updateTabContent → content prop, the effect below
      // sees content === loadedContentRef.current → no reload. Mirror
      // drawio handleAutoSave.
      const json = serializeToDisk(editor.getJSON());
      loadedContentRef.current = json;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        onChangeRef.current(json);
      }, 500);
    },
  });

  // External content change (AI / file watcher / reject-revert): apply in
  // place without remounting. emitUpdate:false breaks the loop.
  useEffect(() => {
    if (!editor) return;
    if (!shouldApplyExternalContent(content, loadedContentRef)) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current); // race guard
    const parsed = deserializeToContent(content) ?? emptyDoc();
    editor.commands.setContent(parsed, { emitUpdate: false });
    loadedContentRef.current = content;
  }, [content, editor]);

  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    },
    [],
  );

  // ponytail: Re-render the toolbar on editor selection / state changes so
  // active-state (bold/italic/etc.) highlights update. editor.can() and
  // editor.isActive() are reactive across transactions; bumping a tick on
  // selectionUpdate is the minimal signal. Skipping would leave the toolbar
  // stale until next keystroke.
  const [, setToolbarTick] = useState(0);
  useEffect(() => {
    if (!editor) return;
    const rerender = () => setToolbarTick((t) => t + 1);
    editor.on('selectionUpdate', rerender);
    editor.on('transaction', rerender);
    return () => {
      editor.off('selectionUpdate', rerender);
      editor.off('transaction', rerender);
    };
  }, [editor]);

  return (
    <div className="w-full h-full flex flex-col overflow-hidden bg-panel">
      {editor && <RichTextToolbar editor={editor} />}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-[760px] px-8 py-6 min-h-full [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[60vh] [&_.ProseMirror_p]:my-2 [&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:my-3 [&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-semibold [&_.ProseMirror_h2]:my-3 [&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-semibold [&_.ProseMirror_h3]:my-2 [&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ul[data-type=taskList]]:list-none [&_.ProseMirror_ul[data-type=taskList]]:pl-0 [&_.ProseMirror_blockquote]:border-l-2 [&_.ProseMirror_blockquote]:border-brd [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:text-t3 [&_.ProseMirror_pre]:bg-surf2 [&_.ProseMirror_pre]:rounded [&_.ProseMirror_pre]:p-3 [&_.ProseMirror_code]:bg-surf2 [&_.ProseMirror_code]:px-1 [&_.ProseMirror_code]:rounded [&_.ProseMirror_hr]:border-brd [&_.ProseMirror_a]:text-acc [&_.ProseMirror_a]:underline [&_.ProseMirror_table]:border-collapse [&_.ProseMirror_table]:w-full [&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-brd [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1 [&_.ProseMirror_th]:bg-surf2 [&_.ProseMirror_th]:text-left [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-brd [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1 [&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:h-auto [&_.ProseMirror_selectednode]:ring-2 [&_.ProseMirror_selectednode]:ring-acc">
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
