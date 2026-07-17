import { useEffect, useState } from 'react';
import { useAppearanceStore } from '@/store/appearanceStore';
import type { Theme } from '@/store/appearanceStore';

/**
 * Hook to initialize and manage the theme.
 * Syncs the theme from store to the DOM on mount.
 * Supports 'system' theme that follows OS preference.
 */
export function useTheme() {
  const theme = useAppearanceStore((state) => state.theme);
  const setTheme = useAppearanceStore((state) => state.setTheme);
  const toggleTheme = useAppearanceStore((state) => state.toggleTheme);

  useEffect(() => {
    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const applySystemTheme = () => {
        document.documentElement.dataset.theme = mediaQuery.matches ? 'dark' : 'light';
      };
      applySystemTheme();
      mediaQuery.addEventListener('change', applySystemTheme);
      return () => mediaQuery.removeEventListener('change', applySystemTheme);
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return { theme, setTheme, toggleTheme };
}

/** Resolve the user's theme setting ('system' → OS preference) to a concrete
 *  'light' | 'dark'. Used by viewers that need a concrete theme (FileViewer's
 *  `theme: 'light' | 'dark'`) and must re-render on OS-prefers-color-scheme
 *  change while in 'system' mode. Mirrors the DOM-sync logic in `useTheme`
 *  / `appearanceStore.setTheme` so the viewer's theme tracks `data-theme`. */
export function useResolvedTheme(): 'light' | 'dark' {
  const theme = useAppearanceStore((state) => state.theme);
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(theme));

  useEffect(() => {
    if (theme !== 'system') {
      setResolved(theme);
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => setResolved(mq.matches ? 'dark' : 'light');
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);

  return resolved;
}

function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return theme;
}
