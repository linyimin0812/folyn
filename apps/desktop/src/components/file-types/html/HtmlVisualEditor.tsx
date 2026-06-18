import { useState, useRef, useCallback } from 'react';
import type { EditorProps } from '../types';
import { SourceEditCanvas } from './SourceEditCanvas';
import { VisualEditCanvas } from './VisualEditCanvas';

type EditorMode = 'visual' | 'source' | 'preview';

const MODE_LABELS: Record<EditorMode, string> = {
  visual: '可视化',
  source: '源码',
  preview: '预览',
};

const MODE_ICONS: Record<EditorMode, React.ReactNode> = {
  visual: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" />
      <circle cx="8" cy="8" r="2" />
    </svg>
  ),
  source: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M5 3L1 8l4 5M11 3l4 5-4 5" />
    </svg>
  ),
  preview: (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3">
      <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
      <line x1="1.5" y1="6" x2="14.5" y2="6" />
    </svg>
  ),
};

export function HtmlVisualEditor({ content, onChange }: EditorProps) {
  const [mode, setMode] = useState<EditorMode>('visual');
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

  const handleModeChange = useCallback((newMode: EditorMode) => {
    setMode(newMode);
  }, []);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Mode toolbar */}
      <div className="shrink-0 bg-panel border-b border-brd flex gap-1 p-1 items-center">
        {(['visual', 'source', 'preview'] as EditorMode[]).map((m) => (
          <button
            key={m}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors duration-100 ${
              mode === m
                ? 'text-acc bg-accdim'
                : 'text-t3 hover:text-t2 hover:bg-hov'
            }`}
            onClick={() => handleModeChange(m)}
          >
            {MODE_ICONS[m]}
            {MODE_LABELS[m]}
          </button>
        ))}
      </div>

      {/* Canvas area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {mode === 'visual' && (
          <VisualEditCanvas content={currentContentRef.current} onChange={handleChange} />
        )}
        {mode === 'source' && (
          <SourceEditCanvas content={currentContentRef.current} onChange={handleChange} />
        )}
        {mode === 'preview' && (
          <iframe
            className="flex-1 w-full h-full border-none bg-white"
            sandbox="allow-scripts allow-same-origin"
            srcDoc={currentContentRef.current}
            title="HTML Preview"
          />
        )}
      </div>
    </div>
  );
}
