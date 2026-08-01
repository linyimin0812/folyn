/**
 * Shared provider icon — image asset with a deterministic letter-avatar
 * fallback. Extracted from settings/model-services/helpers so any surface
 * (settings lists, pair dropdown, chat toolbar) renders a provider
 * identically without importing across feature folders.
 */

import { useState } from 'react';
import { providerIconUrl } from '@/services/providers/icon';
import { providerAvatarChar, type ProviderEntry } from '@/services/providers/catalog';

/** Deterministic color from id — used for the avatar background. */
export function avatarColor(id: string): string {
  // ponytail: 8 hand-picked colors; hash picks one. Catalog ids map to
  // stable colors so the same provider keeps the same avatar across reloads.
  const colors = ['#3a6ef0', '#6a3af0', '#0a8ab8', '#8040d0', '#cc44cc', '#22a863', '#f5a623', '#e0484d'];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return colors[Math.abs(h) % colors.length];
}

export interface ProviderIconProps {
  entry: ProviderEntry;
  t: (k: string) => string;
  /** Square edge in px — defaults to 16 (settings list size). */
  size?: number;
}

export function ProviderIcon({ entry, t, size = 16 }: ProviderIconProps) {
  const icon = providerIconUrl(entry.id);
  const [imgError, setImgError] = useState(false);
  if (icon && !imgError) {
    return (
      <img
        src={icon}
        alt=""
        onError={() => setImgError(true)}
        className="shrink-0"
        style={{ width: size, height: size, objectFit: 'contain' }}
      />
    );
  }
  const char = providerAvatarChar(entry, t);
  const color = avatarColor(entry.id);
  return (
    <span
      className="shrink-0 inline-flex items-center justify-center rounded-full text-white font-bold"
      style={{ width: size, height: size, background: color, fontSize: Math.max(8, size - 5) }}
    >
      {char}
    </span>
  );
}
