/**
 * Inline adapter (Claude Code / Pi / …) selector for a feature agent row.
 *
 * Mirrors `AdapterSelector`'s visuals (icon button + bottom-up dropdown) but
 * binds to `aiConfigStore.featureCliAdapter[feature]` (per-feature override)
 * instead of the global `cliAdapter`. Falls back to global when no override
 * is set — the dropdown shows the effective adapter id, and picking the same
 * value as global clears the override (so the row goes back to "follow
 * global").
 *
 * Hidden when only one adapter is registered (no choice to make).
 */
import { useState, useRef, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore } from '@/store/aiConfigStore';
import { listAdapters } from '@mochi/cli-adapter';
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

const BUILTIN_ROW_TO_FEATURE: Record<string, string> = {
  'builtin:wiki': 'wiki',
  'builtin:clips': 'clips',
  'builtin:analyze': 'analyze',
  'builtin:schedule': 'schedule',
};

export function FeatureAdapterDropdown({ rowId }: { rowId: string }) {
  const { t } = useTranslation();
  const feature = BUILTIN_ROW_TO_FEATURE[rowId];
  const cliAdapter = useAiConfigStore((s) => s.cliAdapter);
  const featureCliAdapter = useAiConfigStore((s) => s.featureCliAdapter);
  const setFeatureCliAdapter = useAiConfigStore((s) => s.setFeatureCliAdapter);
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

  if (!feature || adapters.length < 2) return null;

  const override = featureCliAdapter[feature];
  const effective = override ?? cliAdapter;
  const current = adapters.find((a) => a.id === effective) ?? adapters[0];

  return (
    <div className="relative" ref={ref}>
      <button
        className="px-1.5 h-6 flex items-center gap-1 rounded text-[10.5px] cursor-pointer border border-brd2 bg-surf2 transition-all duration-[120ms] text-t2 hover:bg-hov hover:text-t1"
        onClick={() => setOpen((v) => !v)}
        title={override
          ? t('settings:plugins.cli.overrideTooltip', { adapter: current.displayName })
          : t('settings:plugins.cli.fallbackTooltip', { adapter: current.displayName })}
      >
        <img src={ADAPTER_ICON[current.id]} alt={current.displayName} className="w-3.5 h-3.5" />
        <span className="font-mono">{current.displayName}</span>
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 min-w-[120px] bg-panel border border-brd rounded-md shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[100] py-0.5">
          {adapters.map((a) => {
            const active = a.id === effective;
            return (
              <div
                key={a.id}
                className={`flex items-center gap-1.5 py-1.5 px-3 text-[11px] cursor-pointer whitespace-nowrap ${active ? 'bg-accdim text-acc font-semibold' : 'text-t2 hover:bg-hov hover:text-t1'}`}
                title={a.description}
                onMouseDown={(e) => {
                  e.preventDefault();
                  // Picking the global value clears the override → row follows global.
                  setFeatureCliAdapter(feature, a.id === cliAdapter ? '' : a.id);
                  setOpen(false);
                }}
              >
                <img src={ADAPTER_ICON[a.id]} alt={a.displayName} className="w-3.5 h-3.5" />
                <span>{a.displayName}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
