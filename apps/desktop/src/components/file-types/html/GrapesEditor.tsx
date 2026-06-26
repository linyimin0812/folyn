/**
 * GrapesEditor — React shell around the GrapesJS canvas.
 *
 * Layout (Issue 1 + Issue 3):
 *
 *   ┌──────────────────────────────────┬────────────────┐
 *   │                                  │ styles|layers  │
 *   │   GrapesJS canvas (flex: 1)      │ |traits (260px) │
 *   │                                  │ (only when     │
 *   │                                  │  element       │
 *   │                                  │  selected)     │
 *   └──────────────────────────────────┴────────────────┘
 *
 * The top toolbar (devices / undo-redo / source) and the left block-library
 * sidebar were removed per Issue 1. The right panel is conditionally rendered
 * only when a component is selected in the canvas (Issue 3); when nothing is
 * selected the canvas takes the full width.
 *
 * All DOM refs are React-owned; GrapesJS panels are mounted INTO them so
 * React owns the chrome while GrapesJS owns the inner UI.
 */

import { useEffect, useRef, useState } from 'react';
import { useGrapesEditor } from './useGrapesEditor';

interface GrapesEditorProps {
  content: string;
  onChange: (content: string) => void;
}

type SidePanelTab = 'styles' | 'layers' | 'traits';

const SIDE_TABS: { id: SidePanelTab; label: string }[] = [
  { id: 'styles', label: '样式' },
  { id: 'layers', label: '图层' },
  { id: 'traits', label: '属性' },
];

export function GrapesEditor({ content, onChange }: GrapesEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stylesRef = useRef<HTMLDivElement>(null);
  const selectorsRef = useRef<HTMLDivElement>(null);
  const layersRef = useRef<HTMLDivElement>(null);
  const traitsRef = useRef<HTMLDivElement>(null);

  // `activeTab` persists across show/hide cycles of the right panel so
  // re-selecting an element returns to the previously active tab.
  const [activeTab, setActiveTab] = useState<SidePanelTab>('styles');

  const { hasSelection, selectionTick } = useGrapesEditor({
    containerRef,
    stylesRef,
    selectorsRef,
    layersRef,
    traitsRef,
    content,
    onChange,
  });

  // `userClosed` lets the user dismiss the right panel manually via the ✕
  // button. It resets to `false` whenever a NEW selection happens. We watch
  // `selectionTick` (a monotonic counter bumped on every non-null
  // `component:select`) rather than `hasSelection` because `hasSelection` is
  // a boolean and does NOT transition when re-selecting while another element
  // is already selected (true → true) — which would leave the panel stuck
  // in the closed state. The tick increments on each distinct selection, so
  // the effect fires even on true → true transitions.
  const [userClosed, setUserClosed] = useState(false);
  useEffect(() => {
    if (selectionTick > 0) setUserClosed(false);
  }, [selectionTick]);

  const panelVisible = hasSelection && !userClosed;

  return (
    <div className="flex-1 flex overflow-hidden bg-panel">
      {/* Center: canvas — always present, flexes to full width when the
          right panel is hidden. */}
      <div className="flex-1 flex flex-col overflow-hidden bg-surf2">
        <div ref={containerRef} className="flex-1 overflow-hidden quill-grapes-root" />
      </div>

      {/* Right: styles | layers | traits.
          The panel's container divs are ALWAYS mounted (so the React refs
          exist on first render and GrapesJS can attach its Style/Selector/
          Layer/Trait managers into them during the mount-once effect). When
          nothing is selected the whole panel is hidden via the `hidden` class
          rather than unmounted — unmounting would null out the refs and break
          the next init. The canvas column flexes to full width naturally
          because the hidden panel no longer claims layout space. */}
      <div
        className={`w-[260px] shrink-0 border-l border-brd bg-panel overflow-hidden quill-grapes-root ${
          panelVisible ? 'flex flex-col' : 'hidden'
        }`}
      >
        <div className="shrink-0 flex border-b border-brd">
          {SIDE_TABS.map((t) => (
            <button
              key={t.id}
              className={`flex-1 px-2 py-1.5 text-[11px] font-medium transition-colors duration-100 ${
                activeTab === t.id
                  ? 'text-acc bg-accdim border-b-2 border-acc -mb-px'
                  : 'text-t3 hover:text-t2 hover:bg-hov'
              }`}
              onClick={() => setActiveTab(t.id)}
            >
              {t.label}
            </button>
          ))}
          <button
            type="button"
            title="关闭"
            onClick={() => setUserClosed(true)}
            className="shrink-0 w-7 h-7 flex items-center justify-center text-t3 hover:text-t1 hover:bg-hov rounded transition-colors duration-100"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.3}
              strokeLinecap="round"
            >
              <path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" />
            </svg>
          </button>
        </div>
        {/* Selector strip — always mounted (ref must exist for SelectorManager
            init), shown only on the styles tab. */}
        <div
          ref={selectorsRef}
          className={`shrink-0 border-b border-brd max-h-[120px] overflow-y-auto quill-no-scrollbar ${
            activeTab === 'styles' ? 'block' : 'hidden'
          }`}
        />
        <div className="flex-1 overflow-y-auto quill-no-scrollbar">
          <div ref={stylesRef} className={activeTab === 'styles' ? 'block' : 'hidden'} />
          <div ref={layersRef} className={activeTab === 'layers' ? 'block' : 'hidden'} />
          <div ref={traitsRef} className={activeTab === 'traits' ? 'block' : 'hidden'} />
        </div>
      </div>
    </div>
  );
}
