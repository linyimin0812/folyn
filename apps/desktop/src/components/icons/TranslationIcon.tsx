import { useMemo } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';
import translationSvgText from '@/assets/icons/translation.svg?raw';

/** Translation page icon. Inactive state uses the SVG's native colors.
 * Active state rewrites fill+stroke to the resolved `--acc` so the icon
 * turns blue when selected, matching the Schedule page button. */
export function TranslationIcon({ size = 18, active = false }: { size?: number; active?: boolean }) {
  const theme = useAppearanceStore((s) => s.theme);
  const dataUri = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const stripped = translationSvgText
      .replace(/^<\?xml[^?]*\?>\s*/, '')
      .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
      .trim();
    if (!active) return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(stripped)))}`;
    const color = getComputedStyle(document.documentElement).getPropertyValue('--acc').trim();
    const colored = color
      ? stripped
          .replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${color}"`)
          .replace(/stroke="#[0-9a-fA-F]{3,8}"/g, `stroke="${color}"`)
      : stripped;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(colored)))}`;
  }, [active, theme]);

  return <img src={dataUri} width={size} height={size} alt="" />;
}
