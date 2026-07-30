import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiConfigStore, type ChatProvider, type ProviderModelPair } from '@/store/aiConfigStore';
import {
  allProviders,
  providerDisplayName,
  type ProviderEntry,
} from '@/services/providers/catalog';

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
        // ponytail: cast — `entry.id` is `string`, but `Pair.provider` is
        // typed `ChatProvider` (catalog id union). Custom provider ids are
        // unsoundly cast here; the same convention already applies to
        // `aiConfigStore.chatProvider` (typed `ChatProvider`, accepts custom
        // ids at runtime via `setChatProvider`). Widening to `string` would
        // ripple through `ProviderModelPair` / `AiSession` / `CliMessage` /
        // `setSessionPair` signatures — not the simpler fix. Hydrate guard
        // `isChatProvider` (catalog-only) means custom-id pairs reset to null
        // on restart, matching the existing `chatProvider` reset-to-'anthropic'
        // behavior; fix both together if/ouf custom-provider persistence matters.
        out.push({ provider: entry.id as ChatProvider, model });
      }
    }
    return out;
    // ponytail: returning a fresh array on every change to either input is
    // fine — both inputs are stable refs from zustand, so the memo only
    // recomputes when the user actually toggles a provider/model.
  }, [providerSettings, customerProviders]);

  return { pairs, hasAny: pairs.length > 0 };
}

function pairLabel(entry: ProviderEntry, model: string, t: (k: string) => string): string {
  return `${providerDisplayName(entry, t)} : ${model}`;
}

/**
 * Reusable (provider, model) dropdown. Reads enabled providers × their
 * selectedModelIds from `aiConfigStore` and renders a flat option list
 * (ponytail: flat over `<optgroup>` — simpler, and the provider name is
 * already a prefix in the label, so optgroup adds no clarity). The
 * "clear" semantic is `onChange(null)` — fired when the placeholder
 * option is re-selected.
 */
export function PairSelector({
  value,
  onChange,
  onOpenSettings,
  i18nPrefix = 'ai:pairSelector',
  className,
  disabled,
}: PairSelectorProps) {
  const { t } = useTranslation();
  const { pairs, hasAny } = useEnabledPairs();
  const customerProviders = useAiConfigStore((s) => s.customerProviders);

  // ponytail: precompute id→entry lookup once per render so option labels
  // don't re-walk the catalog per option. allProviders is cheap (≤20+few).
  const entryById = useMemo(() => {
    const map = new Map<string, ProviderEntry>();
    for (const e of allProviders(customerProviders)) map.set(e.id, e);
    return map;
  }, [customerProviders]);

  // ponytail: index-based option value keeps the round-trip simple even when
  // model ids contain '/' or '-'. Indices are stable for a given render of
  // the pairs array; if the list changes between open-and-select, the select
  // re-renders and resets to the placeholder anyway.
  const valueIndex = value
    ? pairs.findIndex((p) => p.provider === value.provider && p.model === value.model)
    : -1;
  const selectValue = valueIndex >= 0 ? String(valueIndex) : '';

  if (!hasAny) {
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

  return (
    <select
      data-testid="pair-selector"
      className={`fi2 h-[28px] py-[3px] px-2 rounded-md border border-brd bg-inp text-t1 text-[length:calc(var(--ui-font-size)-2px)] outline-none font-ui ${className ?? ''}`}
      value={selectValue}
      disabled={disabled}
      onChange={(e) => {
        const v = e.target.value;
        // ponytail: empty string = placeholder. `Number('') === 0`, so the
        // explicit guard is required — without it re-selecting the
        // placeholder would fire onChange(pairs[0]) instead of onChange(null).
        if (v === '') { onChange(null); return; }
        const idx = Number(v);
        if (Number.isNaN(idx) || idx < 0 || idx >= pairs.length) {
          onChange(null);
          return;
        }
        onChange(pairs[idx] ?? null);
      }}
    >
      <option value="" disabled={!value}>
        {t(`${i18nPrefix}.placeholder`)}
      </option>
      {pairs.map((p, i) => {
        const entry = entryById.get(p.provider);
        const label = entry ? pairLabel(entry, p.model, t) : `${p.provider} : ${p.model}`;
        return (
          <option key={`${p.provider}:${p.model}`} value={String(i)}>
            {label}
          </option>
        );
      })}
    </select>
  );
}

// Re-export so PR3/PR5 settings pages can pass typed pairs around.
export type { ProviderModelPair };
