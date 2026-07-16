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
  return raw
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
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
