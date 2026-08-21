import { useMemo } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';
import translationSvgText from '@/assets/icons/translation.svg?raw';

/** Translation page icon. The asset uses `fill="currentColor"` so both
 *  consumers (PluginIcon in settings + this ActivityBar icon) can recolor
 *  it. Inactive → `--t3` (faded gray); active → `--acc`. */
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
      ? stripped.replace(/currentColor/gi, color)
      : stripped;
    return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(colored)))}`;
  }, [active, theme]);

  return <img src={dataUri} width={size} height={size} alt="" />;
}
