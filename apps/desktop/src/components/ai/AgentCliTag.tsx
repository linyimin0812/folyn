/**
 * Per-message "Agent CLI" tag for Ask/Agent-mode assistant bubbles. Mirrors
 * `PairTag`'s presentational contract (icon + bold label + dim pipe + value)
 * but surfaces the CLI adapter identity instead of the rig LLM pair.
 *
 * Chat (rig) mode still uses `<PairTag>`; Ask/Agent (CLI adapter) uses this.
 */

import { Bot } from 'lucide-react';
import { getInputModeDef } from './inputModes';

export interface AgentCliTagProps {
  /** Active input-mode id (e.g. 'agent', 'ask'). Looked up via
   *  `getInputModeDef` for the display label. */
  modeId: string;
}

export function AgentCliTag({ modeId }: AgentCliTagProps) {
  const def = getInputModeDef(modeId);
  const label = def?.label ?? modeId;
  return (
    <>
      <Bot size={13} />
      <span className="font-semibold text-t2">Agent CLI</span>
      <span className="text-t3">|</span>
      <span className="text-t3">{label}</span>
    </>
  );
}
