/**
 * Helpers extracted from ModelServicesSettings — pure functions and
 * stateless avatars/pills. Kept here so the main settings component file
 * is smaller; no behavior change.
 */

import { useState } from 'react';
import { Eye, Brain, Search, Wrench, type LucideIcon } from 'lucide-react';
import { providerIconUrl } from '@/services/providers/icon';
import { providerAvatarChar, type ProviderEntry } from '@/services/providers/catalog';
import type { Model } from '@/services/modelRegistry/types';

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

/** Deterministic color from id — used for the avatar background. */
export function avatarColor(id: string): string {
  // ponytail: 8 hand-picked colors; hash picks one. Catalog ids map to
  // stable colors so the same provider keeps the same avatar across reloads.
  const colors = ['#3a6ef0', '#6a3af0', '#0a8ab8', '#8040d0', '#cc44cc', '#22a863', '#f5a623', '#e0484d'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

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

// ponytail: capability → colored pill per HTML design. 4 mapped, 1
// (structured-output) skipped — no pill in the reference design. Uses
// lucide-react icons instead of raw SVG paths — React's dev-mode path
// validator rejects several of the original hand-written paths.
export const CAPABILITY_PILL: Record<string, { title: string; bg: string; color: string; Icon: LucideIcon }> = {
  vision: { title: 'vision', bg: '#e6f7ed', color: '#10b981', Icon: Eye },
  reasoning: { title: 'reasoning', bg: '#f0f3ff', color: '#6366f1', Icon: Brain },
  'web-search': { title: 'web', bg: '#e0f2fe', color: '#3b82f6', Icon: Search },
  'function-call': { title: 'tools', bg: '#fff7ed', color: '#f97316', Icon: Wrench },
};

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
  const icon = providerIconUrl(entry.id);
  const [imgError, setImgError] = useState(false);
  if (icon && !imgError) {
    return (
      <img
        src={icon}
        alt=""
        onError={() => setImgError(true)}
        className="shrink-0"
        style={{ width: 16, height: 16, objectFit: 'contain' }}
      />
    );
  }
  const char = providerAvatarChar(entry, t);
  const color = avatarColor(entry.id);
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full text-white text-[11px] font-bold"
      style={{ width: 16, height: 16, background: color }}
    >
      {char}
    </span>
  );
}
