import { icons } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * Render a lucide icon by its kebab-case name (the `activityDisplay.icon`
 * contract — a name from the host's loaded icon set, design §3.1). Unknown
 * names render the fallback (a gray dot for activity rows) so a bad
 * declaration never crashes the timeline.
 */

const iconByName = new Map<string, LucideIcon>();
for (const [key, Icon] of Object.entries(icons)) {
  iconByName.set(key, Icon);
  // Register kebab-case aliases: GitCommitHorizontal ↔ git-commit-horizontal.
  const kebab = key.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase();
  if (!iconByName.has(kebab)) iconByName.set(kebab, Icon);
}

export function hasLucideIcon(name: string): boolean {
  return iconByName.has(name);
}

interface LucideNameIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function LucideNameIcon({ name, size = 14, className }: LucideNameIconProps) {
  const Icon = iconByName.get(name);
  if (!Icon) return null;
  return <Icon size={size} className={className} />;
}
