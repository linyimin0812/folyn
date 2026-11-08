import { useEffect, useState } from 'react';

/** Matches the `.ft-collapse` transition duration in index.css. */
const COLLAPSE_MS = 200;

/**
 * Animated expand/collapse for a file-tree folder's children. Children stay
 * mounted until the closing transition ends, then unmount. `children` is a
 * render function so a collapsed folder's subtree is never built.
 */
export function TreeCollapse({ open, children }: { open: boolean; children: () => React.ReactNode }): React.JSX.Element | null {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  // Mount in the same commit that opens, so callers can find the new rows right away.
  if (open && !mounted) setMounted(true);

  useEffect(() => {
    if (open) {
      // Let the 0fr frame paint before switching to 1fr, or there is nothing to transition from.
      const frame = requestAnimationFrame(() => setExpanded(true));
      return () => cancelAnimationFrame(frame);
    }
    setExpanded(false);
    // Fallback for when transitionend never fires (reduced motion, hidden panel).
    const timer = setTimeout(() => setMounted(false), COLLAPSE_MS + 50);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      className={`ft-collapse${expanded ? ' open' : ''}`}
      onTransitionEnd={(e) => {
        if (e.target === e.currentTarget && !open) setMounted(false);
      }}
    >
      <div className="ft-collapse-inner">{children()}</div>
    </div>
  );
}
