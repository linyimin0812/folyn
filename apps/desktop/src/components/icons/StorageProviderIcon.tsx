/**
 * Render a storage provider's icon. The icon string is either a host ThemeIcon
 * name (resolved against assets/icons/*.svg — e.g. 'cloudflare', 'qiniu',
 * 'aliyun', 'github'), an emoji/short text, or undefined. Shared by the
 * Storage & Sharing settings, the export dialogs' provider pickers, and the
 * image-paste upload-method dropdown so every surface renders provider icons
 * the same way.
 *
 * Distinct from `ProviderIcon` (AI model-service providers — image asset +
 * letter-avatar fallback); storage providers key off a ThemeIcon name.
 */
import { ThemeIcon, hasIcon } from './ThemeIcon';

export function StorageProviderIcon({ icon, size = 14 }: { icon?: string; size?: number }) {
  if (!icon) return null;
  if (hasIcon(icon)) return <ThemeIcon name={icon} size={size} />;
  return <span className="text-[14px] leading-none">{icon}</span>;
}
