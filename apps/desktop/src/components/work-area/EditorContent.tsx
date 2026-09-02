import { WorkArea } from './WorkArea';
import { RightDock } from '@/components/ai/RightDock';
import { TerminalHost } from '@/components/terminal/TerminalHost';

/** Editor + AI dock with a single mounted terminal that moves between bottom
 *  and right via absolute positioning, so xterm and scrollback survive the
 *  dock-location switch.
 *
 *  Composition: WorkArea (editor/preview) + RightDock (AI panel) wrapped in
 *  TerminalHost (persistent terminal overlay). `hideRightDock` (focus mode)
 *  drops the AI dock and the terminal so only the editor/preview remains. */
export function EditorContent({ hideRightDock }: { hideRightDock?: boolean }) {
  return (
    <TerminalHost hideTerminal={hideRightDock}>
      <WorkArea focusMode={hideRightDock} />
      {!hideRightDock && <RightDock />}
    </TerminalHost>
  );
}
