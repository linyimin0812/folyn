import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MarkdownPreview } from '../file-types/markdown/MarkdownPreview';
import { extractHeadings } from '@/utils/markdownUtils';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { isTauri } from '@/utils/platform';

interface PresentationOverlayProps {
  content: string;
  filePath: string;
  vaultRoot: string;
}

/** Fullscreen presentation of the active markdown doc: a full-viewport
 * title page (first heading) that scrolls directly into the document. */
export function PresentationOverlay({ content, filePath, vaultRoot }: PresentationOverlayProps) {
  const { t } = useTranslation('editor');
  const title = extractHeadings(content)[0]?.text;
  const scrollRef = useRef<HTMLDivElement>(null);
  const setPresentationMode = useEditorViewStateStore((s) => s.setPresentationMode);
  const [hintVisible, setHintVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setHintVisible(false), 3000);
    return () => clearTimeout(timer);
  }, []);

  // ponytail: temporarily hide the always-on-top pet OS window for the
  // presentation; restore via the Rust `show_pet_if_hidden` command (idempotent
  // NSPanel show) on unmount — JS hide()/show() never touch the tray or the
  // pet-enabled preference, so the user's setting is preserved.
  const hidPetRef = useRef(false);
  useEffect(() => {
    if (!isTauri()) return;
    (async () => {
      try {
        const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const pet = await WebviewWindow.getByLabel('pet');
        if (!pet || !(await pet.isVisible())) return;
        await pet.hide();
        hidPetRef.current = true;
      } catch {
        // non-fatal: pet window absent
      }
    })();
    return () => {
      if (!hidPetRef.current) return;
      hidPetRef.current = false;
      import('@tauri-apps/api/core')
        .then(({ invoke }) => invoke('show_pet_if_hidden').catch(() => {}))
        .catch(() => {});
    };
  }, []);

  // Focus the scroll container on mount so PgUp/PgDn/Home/End (native
  // scrolling) land here — without this, keys still reach the hidden
  // CodeMirror editor beneath the overlay.
  useEffect(() => {
    scrollRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPresentationMode(false);
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // ←/→ page through the deck one viewport at a time (PRD keyboard nav).
        const el = scrollRef.current;
        if (!el) return;
        e.preventDefault();
        el.scrollBy({ top: (e.key === 'ArrowRight' ? 1 : -1) * el.clientHeight });
      }
    };
    // Capture phase: beats the editor's keymaps on the pane below the overlay.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [setPresentationMode]);

  return (
    <div className="fixed inset-0 z-[200] bg-bg presentation-mode flex flex-col">
      <div ref={scrollRef} tabIndex={-1} className="flex-1 overflow-auto outline-none">
        {title && (
          <div className="min-h-screen flex items-center justify-center px-8">
            <h1 className="text-6xl font-bold text-t1 text-center">{title}</h1>
          </div>
        )}
        <div className="py-16 px-8">
          <MarkdownPreview
            content={content}
            filePath={filePath}
            vaultRoot={vaultRoot}
            cursorLine={0}
            cursorViewportY={0}
            editorViewportTop={0}
            hasSelection={false}
          />
        </div>
      </div>
      {/* Kept mounted (opacity transition) so the hint fades instead of popping. */}
      <div
        className="absolute top-6 left-1/2 -translate-x-1/2 px-4 py-2 rounded-[8px] bg-panel border border-brd text-t2 text-[13px] shadow-[0_2px_12px_rgba(0,0,0,0.15)] select-none pointer-events-none transition-opacity duration-500"
        style={{ opacity: hintVisible ? 1 : 0 }}
      >
        {t('presentation.exitHint')}
      </div>
    </div>
  );
}
