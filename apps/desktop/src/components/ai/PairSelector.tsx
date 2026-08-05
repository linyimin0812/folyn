import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Cpu } from 'lucide-react';
import { useAiConfigStore, type ChatProvider, type ProviderModelPair } from '@/store/aiConfigStore';
import { useModelRegistryStore } from '@/store/modelRegistryStore';
import {
  allProviders,
  providerDisplayName,
  type ProviderEntry,
} from '@/services/providers/catalog';
import { findModelInCatalog } from '@/services/modelRegistry/loader';
import type { Model } from '@/services/modelRegistry/types';
import { ProviderIcon } from '@/components/icons/ProviderIcon';
import { CapabilityIcons } from '@/components/icons/capabilityIcons';

export type Pair = { provider: ChatProvider; model: string };

export interface PairSelectorProps {
  value: Pair | null;
  onChange: (pair: Pair | null) => void;
  /** Where to send the user when no pair is available. */
  onOpenSettings?: () => void;
  /** i18n key prefix — defaults to 'ai:pairSelector'. */
  i18nPrefix?: string;
  className?: string;
  disabled?: boolean;
  /**
   * Trigger variant. `'full'` (default) renders the labeled button
   * (provider icon + name | model) for toolbars/settings rows; `'icon'`
   * renders a compact square icon button for dense input toolbars (e.g.
   * the chat input's mode-linked model picker).
   */
  trigger?: 'full' | 'icon';
  /**
   * Panel placement relative to the trigger. `'down'` (default) for
   * top-of-page placements; `'up'` when the trigger sits near the bottom
   * edge (chat input).
   */
  dropDirection?: 'up' | 'down';
  /**
   * Horizontal panel anchor relative to the trigger. `'right'` (default)
   * grows the panel leftward from the trigger's right edge — correct for
   * right-aligned triggers (settings rows). `'left'` grows rightward from
   * the trigger's left edge — for left-aligned triggers (chat input icon
   * button) whose panel would otherwise run off the left edge and get
   * clipped by an `overflow-hidden` ancestor.
   */
  panelAlign?: 'left' | 'right';
}

/**
 * List every enabled-provider × selectedModelIds pair. Callers use it to
 * decide "disable send button when no pair" without re-rendering the
 * dropdown. Selects `providerSettings` and `customerProviders` separately
 * (both stable refs from the store) and derives the cross product in a
 * memo so the returned array is referentially stable across renders that
 * don't touch either input.
 */
export function useEnabledPairs(): { pairs: Pair[]; hasAny: boolean } {
  const providerSettings = useAiConfigStore((s) => s.providerSettings);
  const customerProviders = useAiConfigStore((s) => s.customerProviders);

  const pairs = useMemo<Pair[]>(() => {
    const entries = allProviders(customerProviders);
    const out: Pair[] = [];
    for (const entry of entries) {
      const slot = providerSettings[entry.id];
      if (!slot || !slot.enabled) continue;
      if (slot.selectedModelIds.length === 0) continue;
      for (const model of slot.selectedModelIds) {
        out.push({ provider: entry.id, model });
      }
    }
    return out;
    // ponytail: returning a fresh array on every change to either input is
    // fine — both inputs are stable refs from zustand, so the memo only
    // recomputes when the user actually toggles a provider/model.
  }, [providerSettings, customerProviders]);

  return { pairs, hasAny: pairs.length > 0 };
}

/** Capability lookup: static catalog first, then the fetched-models cache
 *  (covers manually-added + freshly fetched models not yet in the shipped
 *  catalog). Missing → no icons. */
function useModelLookup(): (provider: string, model: string) => Model | undefined {
  const modelsByProvider = useModelRegistryStore((s) => s.modelsByProvider);
  return useMemo(
    () => (provider: string, model: string) =>
      findModelInCatalog(provider, model) ??
      modelsByProvider[provider]?.find((m) => m.id === model),
    [modelsByProvider],
  );
}

/**
 * Reusable (provider, model) dropdown. Reads enabled providers × their
 * selectedModelIds from `aiConfigStore` and renders a custom panel whose
 * rows are two lines — **provider** (+ right-aligned capability icons) on
 * line 1, full model id on line 2. The panel sizes via `w-max` so model
 * ids are never truncated/hidden. The "clear" semantic is `onChange(null)`
 * — fired when the placeholder row is picked.
 */
export function PairSelector({
  value,
  onChange,
  onOpenSettings,
  i18nPrefix = 'ai:pairSelector',
  className,
  disabled,
  trigger = 'full',
  dropDirection = 'down',
  panelAlign = 'right',
}: PairSelectorProps) {
  const { t } = useTranslation();
  const { pairs, hasAny } = useEnabledPairs();
  const customerProviders = useAiConfigStore((s) => s.customerProviders);
  const modelLookup = useModelLookup();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Click-outside closes the panel (same pattern as AdapterSelector).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // ponytail: precompute id→entry lookup once per render so rows don't
  // re-walk the catalog per option. allProviders is cheap (≤20+few).
  const entryById = useMemo(() => {
    const map = new Map<string, ProviderEntry>();
    for (const e of allProviders(customerProviders)) map.set(e.id, e);
    return map;
  }, [customerProviders]);

  const entryFor = (id: string): ProviderEntry =>
    entryById.get(id) ?? ({ id, name: id } as ProviderEntry);

  const valueEntry = value ? entryFor(value.provider) : null;
  const valueLabel = value && valueEntry
    ? `${providerDisplayName(valueEntry, t)} | ${value.model}`
    : null;

  if (!hasAny) {
    // Icon variant keeps a trigger so the empty hint + settings shortcut are
    // reachable from dense toolbars too; the full variant stays inline.
    if (trigger === 'icon') {
      return (
        <div className={`relative ${className ?? ''}`} ref={rootRef} data-testid="pair-selector-empty">
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
            onClick={() => setOpen((v) => !v)}
            disabled={disabled}
            title={t(`${i18nPrefix}.empty`)}
          >
            <Cpu size={16} />
          </button>
          {open && (
            <div className={`absolute ${panelAlign === 'left' ? 'left-0' : 'right-0'} ${dropDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} min-w-[200px] bg-panel border border-brd rounded-lg shadow-[0_8px_24px_rgba(0,0,0,.14)] z-[100] p-2`}>
              <div className="text-t3 text-[12px] whitespace-nowrap">{t(`${i18nPrefix}.empty`)}</div>
              {onOpenSettings && (
                <button
                  type="button"
                  className="mt-1 text-acc text-[12px] hover:underline whitespace-nowrap"
                  onMouseDown={(e) => { e.preventDefault(); setOpen(false); onOpenSettings(); }}
                >
                  {t(`${i18nPrefix}.openSettings`)}
                </button>
              )}
            </div>
          )}
        </div>
      );
    }
    return (
      <div className={`flex items-center gap-2 ${className ?? ''}`} data-testid="pair-selector-empty">
        <span className="text-t3 text-[length:calc(var(--ui-font-size)-2px)]">
          {t(`${i18nPrefix}.empty`)}
        </span>
        {onOpenSettings && (
          <button
            type="button"
            className="text-acc text-[length:calc(var(--ui-font-size)-2px)] hover:underline"
            onClick={onOpenSettings}
          >
            {t(`${i18nPrefix}.openSettings`)}
          </button>
        )}
      </div>
    );
  }

  const panel = open && (
    <div
      className={`absolute ${panelAlign === 'left' ? 'left-0' : 'right-0'} ${dropDirection === 'up' ? 'bottom-full mb-1' : 'top-full mt-1'} w-max min-w-[220px] max-w-[360px] max-h-[300px] overflow-y-auto bg-panel border border-brd rounded-lg shadow-[0_8px_24px_rgba(0,0,0,.14)] z-[100] p-1`}
      role="listbox"
      data-testid="pair-selector-panel"
    >
      {/* Placeholder row — mirrors the native select's disabled placeholder
          option: clickable only when a value is set (the "clear" path). */}
      <div
        className={`py-1.5 px-2 rounded-md text-[12px] whitespace-nowrap transition-colors ${value ? 'text-t3 cursor-pointer hover:bg-hov' : 'text-t3/50 cursor-default'}`}
        onMouseDown={(e) => {
          e.preventDefault();
          if (!value) return;
          onChange(null);
          setOpen(false);
        }}
      >
        {t(`${i18nPrefix}.placeholder`)}
      </div>
      {pairs.map((p) => {
        const entry = entryFor(p.provider);
        const active = value?.provider === p.provider && value?.model === p.model;
        const model = modelLookup(p.provider, p.model);
        return (
          <div
            key={`${p.provider}:${p.model}`}
            role="option"
            aria-selected={active}
            className={`flex items-start gap-1.5 py-1.5 px-2 rounded-md cursor-pointer whitespace-nowrap transition-colors ${active ? 'bg-accdim text-acc' : 'text-t2 hover:bg-hov hover:text-t1'}`}
            onMouseDown={(e) => {
              e.preventDefault();
              onChange(p);
              setOpen(false);
            }}
          >
            <ProviderIcon entry={entry} t={t} size={14} />
            <span>
              <span className={`block text-[12px] leading-tight font-semibold ${active ? '' : 'text-t1'}`}>{providerDisplayName(entry, t)}</span>
              <span className="block text-[11px] leading-tight mt-0.5">{p.model}</span>
            </span>
            <span className="ml-auto mt-[1px] flex items-center">
              <CapabilityIcons capabilities={model?.capabilities ?? []} />
            </span>
          </div>
        );
      })}
    </div>
  );

  if (trigger === 'icon') {
    return (
      <div className={`relative ${className ?? ''}`} ref={rootRef}>
        <button
          type="button"
          data-testid="pair-selector"
          className="w-7 h-7 flex items-center justify-center rounded-md text-t3 cursor-pointer transition-all duration-[120ms] hover:bg-hov hover:text-t1 disabled:opacity-40 disabled:cursor-not-allowed"
          onClick={() => setOpen((v) => !v)}
          disabled={disabled}
          title={valueLabel ?? t(`${i18nPrefix}.placeholder`)}
        >
          {valueEntry ? <ProviderIcon entry={valueEntry} t={t} size={16} /> : <Cpu size={16} />}
        </button>
        {panel}
      </div>
    );
  }

  return (
    <div className={`relative inline-block max-w-full ${className ?? ''}`} ref={rootRef}>
      <button
        type="button"
        data-testid="pair-selector"
        className="fi2 h-[28px] py-[3px] px-2 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui flex items-center gap-1.5 max-w-full cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        onClick={() => setOpen((v) => !v)}
        disabled={disabled}
      >
        {value && valueEntry ? (
          <>
            <ProviderIcon entry={valueEntry} t={t} size={14} />
            <span className="font-semibold whitespace-nowrap">{providerDisplayName(valueEntry, t)}</span>
            <span className="text-t3">|</span>
            <span className="truncate min-w-0">{value.model}</span>
          </>
        ) : (
          <span className="text-t3 truncate">{t(`${i18nPrefix}.placeholder`)}</span>
        )}
        <svg className={`shrink-0 text-t3 transition-transform duration-150 ${open ? 'rotate-180' : ''}`} width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {panel}
    </div>
  );
}

// Re-export so PR3/PR5 settings pages can pass typed pairs around.
export type { ProviderModelPair };
