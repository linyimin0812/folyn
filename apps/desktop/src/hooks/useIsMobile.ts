// useIsMobile — responsive breakpoint detection for the app shell.
// Extracted from App.tsx (split-oversized-p1-files).
// Spec: hook-guidelines.md (inline-hooks section — promoted to hooks/ as part
// of the App.tsx composition-root split).

import { useEffect, useState } from 'react';

/** Hook to detect mobile viewport */
export function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false,
  );
  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const handler = (event: MediaQueryListEvent) => setIsMobile(event.matches);
    mql.addEventListener('change', handler);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [breakpoint]);
  return isMobile;
}
