/**
 * Render a raw inline SVG string (e.g. from a plugin manifest's `icon` field)
 * at a normalized size. Mirrors `ThemeIcon.normalizeSvg` size injection, but
 * without theme coupling — plugin authors may pass any `<svg>...</svg>` string.
 *
 * Used by `featureAdapter.ts` to render `FeatureContribution.icon` into the
 * activity bar. Strings that don't start with `<svg` are treated as
 * `ThemeIcon` names by the caller (not here).
 */

import { useMemo } from 'react';

export function normalizeSvg(raw: string, size: number): string {
  let s = raw;
  // Strip width/height from inline style — CSS inline style overrides the SVG
  // width/height attributes, so an exported style="width:200px;height:200px"
  // would render at 200px regardless of the attributes set below.
  s = s.replace(/\s*style="([^"]*)"/g, (_m, inner: string) => {
    const cleaned = inner
      .replace(/\bwidth\s*:\s*[^;"]+;?/g, '')
      .replace(/\bheight\s*:\s*[^;"]+;?/g, '')
      .replace(/\s+/g, ' ')
      .trim();
    return cleaned ? ` style="${cleaned}"` : '';
  });
  s = /width="[^"]*"/.test(s)
    ? s.replace(/width="[^"]*"/, `width="${size}"`)
    : s.replace(/<svg/, `<svg width="${size}"`);
  s = /height="[^"]*"/.test(s)
    ? s.replace(/height="[^"]*"/, `height="${size}"`)
    : s.replace(/<svg/, `<svg height="${size}"`);
  return s;
}

interface IconFromSvgProps {
  /** Raw `<svg>...</svg>` string. */
  svg: string;
  size?: number;
  className?: string;
}

export function IconFromSvg({ svg, size = 16, className }: IconFromSvgProps) {
  const html = useMemo(() => normalizeSvg(svg, size), [svg, size]);
  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
      }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
