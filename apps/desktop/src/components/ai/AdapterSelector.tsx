/**
 * Inline adapter (Claude Code / Pi / …) selector for the AI Panel + pet Chat.
 *
 * Registry-driven: renders whatever `listAdapters()` returns, writes the
 * selection to `aiConfig.cliAdapter`. This is the user-facing adapter choice
 * for the two chat surfaces; feature agents pick their own adapter at
 * implementation time (see `featureAgentService` `FeatureAgentEntry.adapterId`)
 * and do NOT follow this selector.
 *
 * Rendered inside the chat input `leadingSlot`, mirroring the input-mode
 * dropdown style. Hidden when only one adapter is registered (no choice to
 * make) or when disabled (e.g. a feature-agent session that ignores it).
 */
import { useState, useRef, useEffect } from 'react';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { listAdapters } from '@quill/cli-adapter';
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

export function AdapterSelector({ disabled }: { disabled?: boolean }) {
  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const setCliAdapter = useAiConfigStore((s) => s.setCliAdapter);
  const adapters = listAdapters();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // No choice to make — don't render.
  if (adapters.length < 2) return null;

  const current = adapters.find((a) => a.id === cliAdapter) ?? adapters[0];

  return (
    <div className="relative" ref={ref}>
      <button
        className="px-1.5 h-7 flex items-center gap-1 rounded text-[11px] cursor-pointer border-none transition-all duration-[120ms] bg-transparent text-t3 hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
        title={current?.description}
      >
        <img src={ADAPTER_ICON[current.id]} alt={current?.displayName} className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute bottom-full left-0 mb-1 min-w-[120px] bg-panel border border-brd rounded-md shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[100] py-0.5">
          {adapters.map((a) => {
            const active = a.id === cliAdapter;
            return (
              <div
                key={a.id}
                className={`flex items-center gap-1.5 py-1.5 px-3 text-[12px] cursor-pointer whitespace-nowrap ${active ? 'bg-accdim text-acc font-semibold' : 'text-t2 hover:bg-hov hover:text-t1'}`}
                title={a.description}
                onMouseDown={(e) => { e.preventDefault(); setCliAdapter(a.id); setOpen(false); }}
              >
                <img src={ADAPTER_ICON[a.id]} alt={a.displayName} className="w-4 h-4" />
                <span>{a.displayName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
