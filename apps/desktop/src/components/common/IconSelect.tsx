import { useState, useRef, useEffect, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';

export interface IconSelectOption {
  value: string;
  label: string;
  icon: ReactNode;
  disabled?: boolean;
  suffix?: string;
}

interface IconSelectProps {
  value: string;
  options: IconSelectOption[];
  onChange: (value: string) => void;
  className?: string;
  triggerClassName?: string;
  ariaLabel?: string;
}

export function IconSelect({ value, options, onChange, className, triggerClassName, ariaLabel }: IconSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  return (
    <div ref={ref} className={`relative ${className ?? ''}`}>
      <button
        type="button"
        aria-label={ariaLabel}
        className={`settings-select w-full flex items-center gap-2 cursor-pointer ${triggerClassName ?? ''}`}
        onClick={() => setOpen((o) => !o)}
      >
        {selected && <span className="flex items-center shrink-0">{selected.icon}</span>}
        <span className="flex-1 text-left truncate">{selected?.label}{selected?.suffix}</span>
        <ChevronDown size={14} className="text-t3 shrink-0" />
      </button>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 bg-panel border border-brd rounded-md shadow-[0_8px_24px_rgba(0,0,0,.14)] z-[100] p-1 max-h-[240px] overflow-y-auto"
          role="listbox"
        >
          {options.map((o) => {
            const active = o.value === value;
            return (
              <div
                key={o.value}
                role="option"
                aria-selected={active}
                className={`flex items-center gap-2 py-1.5 px-2 rounded-md text-[13px] whitespace-nowrap transition-colors ${o.disabled ? 'opacity-50 cursor-not-allowed' : active ? 'bg-accdim text-acc cursor-pointer' : 'text-t2 cursor-pointer hover:bg-hov hover:text-t1'}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  if (o.disabled) return;
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                <span className="flex items-center shrink-0">{o.icon}</span>
                <span className="truncate">{o.label}{o.suffix}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
