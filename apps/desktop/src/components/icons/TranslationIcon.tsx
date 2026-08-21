import { useMemo } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';
import translationSvgText from '@/assets/icons/translation.svg?raw';

/** Translation page icon. The asset uses a fixed fill (`#374151`) — recolor
 * per state: inactive resolves to `--t3` (faded gray, matches the user's
 * `#9CA3AF` design intent), active resolves to `--acc`. */
export function TranslationIcon({ size = 18, active = false }: { size?: number; active?: boolean }) {
  const theme = useAppearanceStore((s) => s.theme);
  const dataUri = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const stripped = translationSvgText
      .replace(/^<\?xml[^?]*\?>\s*/, '')
      .replace(/^<!DOCTYPE[^>]*>\s*/i, '')
      .trim();
    const targetVar = active ? '--acc' : '--t3';
    const color = getComputedStyle(document.documentElement).getPropertyValue(targetVar).trim();
    const colored = color
      ? stripped.replace(/fill="#[0-9a-fA-F]{3,8}"/g, `fill="${color}"`)
      : stripped;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(colored)))}`;
  }, [active, theme]);

  return <img src={dataUri} width={size} height={size} alt="" />;
}
