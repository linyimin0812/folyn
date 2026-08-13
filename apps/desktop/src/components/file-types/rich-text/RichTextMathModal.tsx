import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Editor } from '@tiptap/react';
import katex from 'katex';
import type { MathEditKind } from './richTextExtensions';

// ponytail: LaTeX entry/editing modal for math nodes. The Mathematics
// extension renders atoms via KaTeX NodeViews with no built-in inline
// editing — its documented pattern is an onClick handler that opens a
// dialog. This modal is that dialog: textarea + live KaTeX preview +
// Inline/Block choice (new insertions only) + Insert/Update.
//
// Why katex.renderToString instead of a <MathComponent>? No React wrapper
// dep needed; KaTeX is already a direct dependency for the extension.
// throwOnError:false mirrors the editor's katexOptions so invalid LaTeX
// previews as the raw red source instead of throwing.
//
// Modal chrome mirrors UrlModal (fixed overlay + panel) so the two inline
// modals in this editor look and behave identically.

interface RichTextMathModalProps {
  editor: Editor;
  /** null = inserting a new formula at the cursor; number = node pos to update. */
  pos: number | null;
  initialLatex: string;
  initialKind: MathEditKind;
  onClose: () => void;
}

export function RichTextMathModal({ editor, pos, initialLatex, initialKind, onClose }: RichTextMathModalProps) {
  const { t } = useTranslation();
  const [latex, setLatex] = useState(initialLatex);
  // Editing an existing node keeps its original kind — switching would have
  // to delete + re-insert a different node type (more transactions, more
  // undo steps) for no real gain.
  const [kind, setKind] = useState<MathEditKind>(initialKind);
  const isEdit = pos != null;

  const previewHtml = useMemo(
    () => katex.renderToString(latex, { throwOnError: false, displayMode: kind === 'block' }),
    [latex, kind],
  );

  const submit = () => {
    const value = latex.trim();
    if (!value) return;
    if (isEdit) {
      if (kind === 'inline') editor.chain().updateInlineMath({ latex: value, pos: pos! }).focus().run();
      else editor.chain().updateBlockMath({ latex: value, pos: pos! }).focus().run();
    } else if (kind === 'inline') {
      editor.chain().focus().insertInlineMath({ latex: value }).run();
    } else {
      editor.chain().focus().insertBlockMath({ latex: value }).run();
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30" onClick={onClose}>
      <div
        className="w-[480px] max-w-[90vw] rounded-lg border border-brd bg-panel shadow-lg p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-[length:calc(var(--ui-font-size)+1px)] font-semibold text-t1 mb-2">
          {t(isEdit ? 'editor:math.editTitle' : 'editor:math.title')}
        </div>

        {!isEdit && (
          <div className="flex gap-1 mb-2">
            {(['inline', 'block'] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setKind(k)}
                className={`px-3 py-1 rounded text-xs transition-colors ${
                  kind === k ? 'bg-accdim text-acc font-medium' : 'text-t2 hover:bg-hov hover:text-t1'
                }`}
              >
                {t(k === 'inline' ? 'editor:math.inline' : 'editor:math.block')}
              </button>
            ))}
          </div>
        )}

        <div className="text-[10px] font-semibold text-t3 uppercase tracking-[.08em] mb-1">{t('editor:math.latexLabel')}</div>
        <textarea
          autoFocus
          rows={3}
          value={latex}
          placeholder={t('editor:math.placeholder')}
          onChange={(e) => setLatex(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            }
          }}
          spellCheck={false}
          className="w-full px-2 py-1.5 rounded border border-brd2 bg-surf text-t1 font-mono text-[length:var(--ui-font-size)] outline-none focus:border-acc resize-y"
        />

        <div className="text-[10px] font-semibold text-t3 uppercase tracking-[.08em] mt-3 mb-1">{t('editor:math.preview')}</div>
        <div
          className="px-2 py-2 rounded border border-brd2 bg-surf overflow-x-auto min-h-[48px] flex items-center justify-center"
          // ponytail: KaTeX output is trusted (rendered from user's own
          // LaTeX with throwOnError:false — no HTML passthrough, only
          // KaTeX-generated spans).
          dangerouslySetInnerHTML={{ __html: previewHtml }}
        />

        <div className="flex justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-1 rounded text-t2 hover:bg-hov text-[length:var(--ui-font-size)]"
          >
            {t('editor:math.cancel')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!latex.trim()}
            className="px-3 py-1 rounded bg-acc text-white hover:opacity-90 disabled:opacity-40 text-[length:var(--ui-font-size)]"
          >
            {t(isEdit ? 'editor:math.update' : 'editor:math.insert')}
          </button>
        </div>
      </div>
    </div>
  );
}
