import { useRef, useCallback } from 'react';
import type { EditorProps } from '../types';
import { SourceEditCanvas } from './SourceEditCanvas';
import { VisualEditCanvas } from './VisualEditCanvas';
import { GrapesEditor } from './GrapesEditor';
import { useEditorStore } from '@/store/editorStore';

/**
 * Feature flag for the GrapesJS migration (prd §八 Phase 3).
 * When true, Visual mode renders the new GrapesEditor. When false, the legacy
 * VisualEditCanvas (iframe + bridge) is used. Flip to false to A/B test.
 *
 * Phase 4 (delete bridge.ts / VisualEditCanvas.tsx / PropertiesPanel.tsx)
 * is intentionally out of scope until this flag is validated.
 */
const USE_GRAPES = true;

type EditorMode = 'visual' | 'source';

function viewModeToMode(viewMode: string): EditorMode {
  return viewMode === 'source' ? 'source' : 'visual';
}

export function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const viewMode = useEditorStore((state) => state.viewMode);
  const mode = viewModeToMode(viewMode);
  const currentContentRef = useRef(content);
  const isDirtyRef = useRef(false);

  // Track content changes from canvases, preventing feedback loops
  const handleChange = useCallback((newContent: string) => {
    currentContentRef.current = newContent;
    isDirtyRef.current = true;
    onChange(newContent);
    // Reset dirty flag after a tick so the other canvas knows it's an external update
    setTimeout(() => { isDirtyRef.current = false; }, 0);
  }, [onChange]);

  // View mode is owned by the global editor store so the Topbar segment
  // (shared with Markdown's split/edit/preview) controls HTML's
  // visual/source/preview. Preview mode is rendered by WorkArea via
  // HtmlPreview, so this component only handles visual + source.
  void viewMode;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === 'visual' && (
          USE_GRAPES ? (
            <GrapesEditor content={currentContentRef.current} onChange={handleChange} />
          ) : (
            <VisualEditCanvas content={currentContentRef.current} onChange={handleChange} />
          )
        )}
        {mode === 'source' && (
          <SourceEditCanvas content={currentContentRef.current} onChange={handleChange} />
        )}
      </div>
    </div>
  );
}
