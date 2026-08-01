/**
 * Shared model-capability icon config — the single source for
 * capability → (icon, color) mapping. Used by the settings model tables
 * (full pills, see model-services/helpers `CapabilityPills`) and by the
 * compact `CapabilityIcons` row rendered inside pair dropdowns.
 *
 * ponytail: 4 of the 5 Capability union members map to an icon;
 * 'structured-output' is intentionally skipped — no pill in the reference
 * design. Uses lucide-react icons instead of raw SVG paths (React's
 * dev-mode path validator rejects several of the original hand-written
 * paths).
 */

import { Eye, Brain, Search, Wrench, type LucideIcon } from 'lucide-react';

export const CAPABILITY_PILL: Record<string, { title: string; bg: string; color: string; Icon: LucideIcon }> = {
  vision: { title: 'vision', bg: '#e6f7ed', color: '#10b981', Icon: Eye },
  reasoning: { title: 'reasoning', bg: '#f0f3ff', color: '#6366f1', Icon: Brain },
  'web-search': { title: 'web', bg: '#e0f2fe', color: '#3b82f6', Icon: Search },
  'function-call': { title: 'tools', bg: '#fff7ed', color: '#f97316', Icon: Wrench },
};

/**
 * Compact capability icon row for dense UI (dropdown rows, toolbar tags).
 * Colored glyph on a faint tinted pill, smaller than the settings pills.
 */
export function CapabilityIcons({ capabilities }: { capabilities: readonly string[] }) {
  if (capabilities.length === 0) return null;
  return (
    <span className="flex items-center gap-1 shrink-0">
      {capabilities.map((c) => {
        const pill = CAPABILITY_PILL[c];
        if (!pill) return null;
        return (
          <span
            key={c}
            title={pill.title}
            className="inline-flex items-center justify-center rounded-[5px]"
            style={{ width: 16, height: 16, background: pill.bg, color: pill.color }}
          >
            <pill.Icon size={10} />
          </span>
        );
      })}
    </span>
  );
}
