import { useEditorViewStateStore } from '@/store/editorViewState';
import { useTerminalStore } from '@/store/terminalStore';
import { TerminalPanel } from './TerminalPanel';
import { TerminalResizeHandle } from './TerminalResizeHandle';
import { TerminalRightResizeHandle } from './TerminalRightResizeHandle';

/** Single persistent terminal dock rendered at the bottom or right edge.
 *
 *  The dock is one absolutely-positioned element that swaps between bottom
 *  and right layouts based on `terminalInRightDock`. The TerminalPanel
 *  inside is a single mounted instance (keyed), so xterm and scrollback
 *  survive the dock-location switch instead of being remounted. */
export function TerminalDock({
  bottomHeight,
  onBottomHeightChange,
  hidden,
}: {
  bottomHeight: number;
  onBottomHeightChange: (height: number) => void;
  hidden?: boolean;
}) {
  const sessions = useTerminalStore((s) => s.sessions);
  const terminalPanelVisible = useEditorViewStateStore((s) => s.terminalPanelVisible);
  const terminalInRightDock = useEditorViewStateStore((s) => s.terminalInRightDock);
  const terminalRightWidth = useEditorViewStateStore((s) => s.terminalRightWidth);

  if (sessions.length === 0 || hidden) return null;

  const right = terminalInRightDock;
  const bottom = terminalPanelVisible && !right;
  const visible = right || bottom;

  return (
    <div
      className="absolute z-10 bg-bg"
      style={
        !visible
          ? { display: 'none' }
          : right
            ? {
                top: 0,
                right: 0,
                bottom: 0,
                width: terminalRightWidth,
                borderLeft: '1px solid var(--brd)',
              }
            : {
                left: 0,
                right: 0,
                bottom: 0,
                height: bottomHeight + 8,
                borderTop: '1px solid var(--brd)',
              }
      }
    >
      {visible && (right ? (
        <TerminalRightResizeHandle key="right-resize" />
      ) : (
        <TerminalResizeHandle
          key="bottom-resize"
          height={bottomHeight}
          onHeightChange={onBottomHeightChange}
        />
      ))}
      <TerminalPanel key="terminal-panel" height={right ? '100%' : bottomHeight} />
    </div>
  );
}
