import { useMemo } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';
import { useFeaturePanelStore } from '@/store/featurePanelStore';
import wikiSvgText from '@/assets/icons/wiki.svg?raw';

/** Wiki panel icon. Inactive state uses the SVG's native colors (no
 * substitution). Active state rewrites fill+stroke to the resolved
 * `--acc` so the icon turns blue when selected. Active state is read
 * from `featurePanelStore.activePanelId` so the stored ReactNode needs
 * no prop wiring — the hook re-renders when the ActivityBar selection
 * flips.
 *
 * The SVG is base64-encoded into a data-URI <img> — inline SVG via
 * dangerouslySetInnerHTML is unreliable in the Tauri webview, so we
 * route through <img> + a pre-colored data URI. */
export function WikiIcon({ size = 18 }: { size?: number }) {
  const active = useFeaturePanelStore((s) => s.activePanelId === 'wiki');
  const theme = useAppearanceStore((s) => s.theme);
  const dataUri = useMemo(() => {
    if (typeof document === 'undefined') return '';
    const stripped = wikiSvgText
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
    // active + theme in deps: re-resolve color when selection flips or theme switches
  }, [active, theme]);

  return <img src={dataUri} width={size} height={size} alt="" />;
}
