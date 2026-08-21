import { useEffect, useRef, useState } from 'react';
import type { LanguageOption } from './languages';

export interface LanguageDropdownProps {
  value: string;
  options: readonly LanguageOption[];
  onChange: (id: string) => void;
  title?: string;
  /** Compact: trigger flexes to fill available width (min 80px) instead of
   *  fixed 140px — used in narrow embedded layouts (pet panel). */
  compact?: boolean;
}

/** Minimal dropdown for language selection. Reuses the click-outside pattern
 * from AdapterSelector. Ponytail: not extracted to a shared component — only
 * the translation panel uses it. */
export function LanguageDropdown({ value, options, onChange, title, compact = false }: LanguageDropdownProps) {
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

  const current = options.find((o) => o.id === value) ?? options[0];

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`h-[28px] py-[3px] px-2 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui flex items-center justify-between gap-1.5 cursor-pointer ${compact ? 'flex-1 min-w-[80px]' : 'w-[140px]'}`}
        onClick={() => setOpen((v) => !v)}
        title={title}
      >
        <span className="truncate">{current?.label}</span>
        <svg className="shrink-0 text-t3 transition-transform duration-150" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 min-w-[160px] max-h-[300px] overflow-y-auto bg-panel border border-brd rounded-md shadow-[0_4px_16px_rgba(0,0,0,.12)] z-[100] py-0.5">
          {options.map((o) => {
            const active = o.id === value;
            return (
              <div
                key={o.id}
                className={`py-1.5 px-3 text-[12px] cursor-pointer whitespace-nowrap ${active ? 'bg-accdim text-acc font-semibold' : 'text-t2 hover:bg-hov hover:text-t1'}`}
                onMouseDown={(e) => { e.preventDefault(); onChange(o.id); setOpen(false); }}
              >
                {o.label}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
