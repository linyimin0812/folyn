import { useState, type ReactNode } from 'react';
import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTerminalStore } from '@/store/terminalStore';
import { TerminalDock } from './TerminalDock';

/** Shared terminal host used by editor and schedule layouts. Wraps children
 *  (the editor area) in a relative container and overlays a single
 *  persistent TerminalDock at the bottom or right edge. The dock-location
 *  switch (bottom <-> right) keeps padding in sync so the editor never
 *  overlaps the terminal. */
export function TerminalHost({ children, hideTerminal }: { children: ReactNode; hideTerminal?: boolean }) {
  const sessions = useTerminalStore((s) => s.sessions);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const terminalInRightDock = useEditorViewStateStore((s) => s.terminalInRightDock);
  const terminalRightWidth = useEditorViewStateStore((s) => s.terminalRightWidth);
  const [bottomHeight, setBottomHeight] = useState(240);

  const hasSessions = sessions.length > 0;
  const bottomOpen = hasSessions && terminalPanelVisible && !terminalInRightDock && !hideTerminal;
  const rightOpen = hasSessions && terminalInRightDock && !hideTerminal;

  return (
    <div className="relative flex-1 min-w-0 flex flex-col overflow-hidden">
      <div
        className="flex-1 min-h-0 flex"
        style={{
          paddingBottom: bottomOpen ? bottomHeight + 8 : 0,
          paddingRight: rightOpen ? terminalRightWidth : 0,
        }}
      >
        {children}
      </div>
      <TerminalDock
        bottomHeight={bottomHeight}
        onBottomHeightChange={setBottomHeight}
        hidden={!!hideTerminal}
      />
    </div>
  );
}
