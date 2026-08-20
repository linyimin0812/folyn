/**
 * Per-message "Agent CLI" tag for Ask/Agent-mode assistant bubbles. Mirrors
 * `PairTag`'s presentational contract (icon + bold label + dim pipe + value)
 * but surfaces the active CLI adapter identity (icon + displayName) plus
 * the input-mode label, instead of the rig LLM pair.
 *
 * Chat (rig) mode still uses `<PairTag>`; Ask/Agent (CLI adapter) uses this.
 *
 * Icon + displayName come from `aiConfig.cliAdapter` + `listAdapters()` —
 * same source `AdapterSelector` uses — so the tag stays in sync with the
 * user's chosen CLI.
 */

import { useAiConfigStore } from '@/store/aiConfigStore';
import { listAdapters } from '@quill/cli-adapter';
import { getInputModeDef } from './inputModes';
import claudeIcon from '@/assets/agents/claude_code.svg';
import codexIcon from '@/assets/agents/codex.svg';
import geminiIcon from '@/assets/agents/gemini.svg';
import opencodeIcon from '@/assets/agents/opencode.svg';
import piIcon from '@/assets/agents/pi.svg';
import qoderIcon from '@/assets/agents/qoder.svg';

const ADAPTER_ICON: Record<string, string> = {
  claude: claudeIcon,
  codex: codexIcon,
  gemini: geminiIcon,
  opencode: opencodeIcon,
  pi: piIcon,
  qoder: qoderIcon,
  'qoder-cn': qoderIcon,
};

export interface AgentCliTagProps {
  /** Active input-mode id (e.g. 'agent', 'ask'). Looked up via
   *  `getInputModeDef` for the display label. */
  modeId: string;
}

export function AgentCliTag({ modeId }: AgentCliTagProps) {
  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const adapters = listAdapters();
  const current = adapters.find((a) => a.id === cliAdapter) ?? adapters[0];
  const modeDef = getInputModeDef(modeId);
  const modeLabel = modeDef?.label ?? modeId;
  const iconSrc = current ? ADAPTER_ICON[current.id] : undefined;

  return (
    <>
      {iconSrc && (
        <img src={iconSrc} alt="" className="w-[13px] h-[13px]" />
      )}
      <span className="font-semibold text-t2">{current?.displayName ?? 'Agent CLI'}</span>
      <span className="text-t3">|</span>
      <span className="text-t3">{modeLabel}</span>
    </>
  );
}
