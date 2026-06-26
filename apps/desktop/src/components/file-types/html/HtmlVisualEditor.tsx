import { useRef, useCallback } from 'react';
import type { EditorProps } from '../types';
import { SourceEditCanvas } from './SourceEditCanvas';
import { GrapesEditor } from './GrapesEditor';
import { useEditorStore } from '@/store/editorStore';

type EditorMode = 'visual' | 'source';

function viewModeToMode(viewMode: string): EditorMode {
  return viewMode === 'source' ? 'source' : 'visual';
}

export function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const viewMode = useEditorStore((state) => state.viewMode);
  const mode = viewModeToMode(viewMode);
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
