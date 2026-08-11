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

interface ThemeIconProps {
  name: string;
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

export function ThemeIcon({ name, size = 16, className, style }: ThemeIconProps) {
  const theme = useAppearanceStore((s) => s.theme);
  const isDark = theme === 'dark';

  const src = useMemo(() => {
    const entry = iconMap[name];
    if (!entry) return null;
    const raw = (isDark ? entry.dark : entry.light) || entry.light;
    return raw ? `data:image/svg+xml;utf8,${encodeURIComponent(raw)}` : null;
  }, [name, isDark]);

  if (!src) return null;
  return (
    <img
      src={src}
      width={size}
      height={size}
      className={className}
      style={{ display: 'inline-block', ...style }}
      alt=""
    />
  );
}

export function hasIcon(name: string): boolean {
  return name in iconMap;
}
