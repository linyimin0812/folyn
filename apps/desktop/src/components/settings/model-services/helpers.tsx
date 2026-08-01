/**
 * Helpers extracted from ModelServicesSettings — pure functions and
 * stateless avatars/pills. Kept here so the main settings component file
 * is smaller; no behavior change.
 */

import type { ProviderEntry } from '@/services/providers/catalog';
import { ProviderIcon, avatarColor } from '@/components/icons/ProviderIcon';
import { CAPABILITY_PILL } from '@/components/icons/capabilityIcons';
import type { Model } from '@/services/modelRegistry/types';

// Re-export so existing model-services consumers (CustomProviderDrawer et al.)
// keep importing from './helpers' after the extraction to components/icons.
export { avatarColor, CAPABILITY_PILL };

// ponytail: model row hover tooltip shows pricing when available.
export function modelOptionTitle(m: Model): string {
  const inPrice = m.pricing?.inputPerMtok;
  const outPrice = m.pricing?.outputPerMtok;
  if (inPrice === undefined && outPrice === undefined) return '';
  return `Input: $${inPrice ?? '—'} / Output: $${outPrice ?? '—'} per million tokens`;
}

/**
 * ponytail: family-grouping heuristic — covers common id shapes
 * (claude-opus-4-7 → "Claude 4.7", gpt-5.2 → "Gpt 5.2", gemini-3.5 →
 * "Gemini 3.5"). Misgroups edge cases like "gpt-image-2" (→ "Gpt 2") and
 * "deepseek-v4-flash" (falls through to id). Acceptable until a
 * provider's naming needs special-casing. For relay providers (id
 * contains "/"), groups by upstream-provider prefix.
 */
export function familyGroup(id: string): string {
  if (id.includes('/')) {
    const p = id.split('/')[0];
    return p.charAt(0).toUpperCase() + p.slice(1);
  }
  const m = id.match(/^([a-z]+)-(?:[a-z]+-)*?(\d+)(?:[-.](\d+))?/);
  if (m) {
    const brand = m[1].charAt(0).toUpperCase() + m[1].slice(1);
    return m[3] ? `${brand} ${m[2]}.${m[3]}` : `${brand} ${m[2]}`;
  }
  return id;
}

export const EMPTY_MODELS: Model[] = [];
export const EMPTY_MANUAL: readonly { id: string; displayName: string; group: string; createdAt: number }[] = [];
export const EMPTY_SELECTED: readonly string[] = [];

export function ModelAvatar({ id }: { id: string }) {
  const char = (id[0] ?? '?').toUpperCase();
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full text-white text-[11px] font-bold"
      style={{ width: 24, height: 24, background: avatarColor(id) }}
    >
      {char}
    </span>
  );
}

export function CapabilityPills({ capabilities }: { capabilities: readonly string[] }) {
  if (capabilities.length === 0) return null;
  return (
    <span className="flex items-center gap-1.5 shrink-0">
      {capabilities.map((c) => {
        const pill = CAPABILITY_PILL[c];
        if (!pill) return null;
        return (
          <span
            key={c}
            title={pill.title}
            className="inline-flex items-center justify-center rounded-[10px]"
            style={{ width: 32, height: 20, background: pill.bg, color: pill.color }}
          >
            <pill.Icon size={12} />
          </span>
        );
      })}
    </span>
  );
}

export function Avatar({ entry, t }: { entry: ProviderEntry; t: (k: string) => string }) {
  return <ProviderIcon entry={entry} t={t} size={16} />;
}
