import { useRef, useCallback } from 'react';
import type { EditorProps } from '../types';
import { SourceEditCanvas } from './SourceEditCanvas';
import { GrapesEditor } from './GrapesEditor';
import { useEditorStore } from '@/store/editorStore';

type EditorMode = 'visual' | 'source';

/**
 * Size guard for the visual editor: past this size (in characters) GrapesJS
 * becomes unusably slow / can choke on huge documents, so the editor forces
 * source mode. Mirrors the ~26 MB report that triggered the guard.
 */
export const LARGE_HTML_THRESHOLD = 512 * 1024;

export function isLargeHtmlContent(content: string): boolean {
  return content.length > LARGE_HTML_THRESHOLD;
}

/** The default edit mode for a given document — source when it is too large. */
export function defaultModeForHtmlContent(content: string): EditorMode {
  return isLargeHtmlContent(content) ? 'source' : 'visual';
}

/** Human-friendly size for the status hint; never reports 0 KB. */
export function formatHtmlSizeKb(content: string): number {
  return Math.max(1, Math.round(content.length / 1024));
}

function viewModeToMode(viewMode: string): EditorMode {
  return viewMode === 'source' ? 'source' : 'visual';
}

export function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const viewMode = useEditorStore((state) => state.viewMode);
  // Large documents skip the GrapesJS canvas entirely (source mode) so the
  // editor stays responsive regardless of the Topbar view-mode toggle.
  const mode = isLargeHtmlContent(content) ? 'source' : viewModeToMode(viewMode);
  const currentContentRef = useRef(content);

  // Track content changes from canvases so the next mode switch reads the
  // latest value via `currentContentRef.current`. Each canvas manages its own
  // external-vs-user update detection internally (SourceEditCanvas diffs the
  // doc; GrapesEditor is mount-once and never re-reads `content`).
  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    onChange(newContent);
  }, [onChange]);

  // View mode is owned by the global editor store so the Topbar segment
  // (shared with Markdown's split/edit/preview) controls HTML's
  // visual/source/preview. Preview mode is rendered by WorkArea via
  // HtmlPreview, so this component only handles visual + source.

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === 'visual' && (
          <GrapesEditor content={currentContentRef.current} onChange={handleChange} />
        )}
        {mode === 'source' && (
          <SourceEditCanvas content={currentContentRef.current} onChange={handleChange} />
        )}
      </div>
    </div>
  );
}
