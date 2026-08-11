import React, { useMemo } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';

const allIcons = import.meta.glob<string>('../../assets/icons/*.svg', {
  eager: true,
  query: '?raw',
  import: 'default',
});

const iconMap: Record<string, { light?: string; dark?: string }> = {};

for (const [path, svg] of Object.entries(allIcons)) {
  const fileName = path.split('/').pop()!.replace('.svg', '');
  if (fileName.endsWith('_dark')) {
    const name = fileName.slice(0, -5);
    iconMap[name] = iconMap[name] || {};
    iconMap[name].dark = svg;
  } else {
    iconMap[fileName] = iconMap[fileName] || {};
    iconMap[fileName].light = svg;
  }
}

function normalizeSvg(raw: string, size: number): string {
  let s = raw;
  s = /width="[^"]*"/.test(s)
    ? s.replace(/width="[^"]*"/, `width="${size}"`)
    : s.replace(/<svg/, `<svg width="${size}"`);
  s = /height="[^"]*"/.test(s)
    ? s.replace(/height="[^"]*"/, `height="${size}"`)
    : s.replace(/<svg/, `<svg height="${size}"`);
  // ponytail: an inline `style="width:...; height:..."` on the root <svg>
  // overrides the width/height attributes above (CSS beats presentation
  // attributes). Source SVGs exported from design tools sometimes ship
  // with a hardcoded 200px / 500px etc. size in the style — that paints
  // a giant square that overflows the icon's `size` container. If the
  // root <svg> has a style attribute, replace its value with an explicit
  // px size matching `size`. Icons without root-level style are
  // unaffected — they keep using the attribute path above.
  s = s.replace(
    /<svg\b([^>]*?)\bstyle="[^"]*"/,
    `<svg$1style="width:${size}px;height:${size}px"`,
  );
  return s;
}

interface ThemeIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function ThemeIcon({ name, size = 16, className, style }: ThemeIconProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const isDark = theme === 'dark';

  const svg = useMemo(() => {
    const entry = iconMap[name];
    if (!entry) return null;
    const raw = (isDark ? entry.dark : entry.light) || entry.light;
    return raw ? normalizeSvg(raw, size) : null;
  }, [name, isDark, size]);

  if (!svg) return null;
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: size, height: size, ...style }}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function hasIcon(name: string): boolean {
  return name in iconMap;
}
