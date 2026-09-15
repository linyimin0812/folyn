import { useState, useRef, useEffect, type CSSProperties } from 'react';
import type { ContainerProps } from 'folyn-extension-sdk';

/**
 * Single slide — wraps its content in a hidden-by-default element that the
 * parent Carousel locates via `[data-is-slide]` and reveals one at a time.
 * Mirrors the tabs/tab DOM-collection pattern: the child stays in the tree
 * (so its source line / content stays rendered) but is shown/hidden by the
 * parent's index state, not its own.
 */
export function Slide({ children, attributes }: ContainerProps) {
  const label = attributes?.label || attributes?.title || '';
  return (
    <div data-is-slide="true" data-slide-label={label} style={{ display: 'none' }}>
      {children}
    </div>
  );
}

/**
 * Carousel (走马灯) — a group of rotating slide regions.
 *
 * Collects `:::slide` children via DOM after mount (same shape as tabs),
 * shows one at a time, and advances automatically. Controls:
 *  - interval (attribute, seconds; default 5; 0 disables auto-advance)
 *  - Dot indicators (click to jump)
 *  - Pause on hover, circular wrap-around
 *
 * Inline-styled (no Tailwind dependency in the extension bundle) so it
 * renders identically in the host preview and in exported HTML.
 */
export function Carousel({ children, attributes }: ContainerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [slides, setSlides] = useState<Array<{ label: string; element: HTMLElement }>>([]);
  const [active, setActive] = useState(0);
  const pausedRef = useRef(false);

  const intervalSec = Math.max(0, Number(attributes?.interval) || 5);
  const autoMs = intervalSec > 0 ? intervalSec * 1000 : 0;

  // Collect slides from the rendered DOM (children are SlideComponent output).
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const els = Array.from(container.querySelectorAll<HTMLElement>('[data-is-slide="true"]'));
    const collected = els.map((el, i) => ({
      label: el.getAttribute('data-slide-label') || `Slide ${i + 1}`,
      element: el,
    }));
    setSlides(collected);
  }, [children]);

  // Show the active slide, hide the rest. Runs whenever the active index or
  // the collected set changes — so a newly-collected set (first mount) and
  // every advance both converge here.
  useEffect(() => {
    slides.forEach((s, i) => {
      s.element.style.display = i === active ? 'block' : 'none';
    });
  }, [active, slides]);

  // Auto-advance. Paused on hover (pausedRef) and disabled when interval=0
  // or there's only one slide. Wraps around circularly.
  useEffect(() => {
    if (autoMs <= 0 || slides.length < 2) return;
    const id = window.setInterval(() => {
      if (pausedRef.current) return;
      setActive((a) => (a + 1) % slides.length);
    }, autoMs);
    return () => window.clearInterval(id);
  }, [autoMs, slides.length]);

  const go = (i: number) => {
    if (slides.length === 0) return;
    setActive(((i % slides.length) + slides.length) % slides.length);
  };

  const hasNav = slides.length > 1;

  return (
    <div
      className="docmd-carousel"
      style={{
        position: 'relative',
        margin: '1.5rem 0',
        borderRadius: '8px',
        border: '1px solid var(--brd, #e4e4e7)',
        overflow: 'hidden',
        background: 'var(--surf, #fafafa)',
      }}
      onMouseEnter={() => { pausedRef.current = true; }}
      onMouseLeave={() => { pausedRef.current = false; }}
    >
      {/* Slide viewport */}
      <div ref={containerRef} style={{ padding: '1.25rem 1.5rem', minHeight: '6rem' }}>
        {children}
      </div>

      {hasNav && (
        <>
          {/* Dot indicators */}
          <div style={{
            display: 'flex',
            justifyContent: 'center',
            gap: '6px',
            padding: '0 0 0.6rem',
          }}>
            {slides.map((s, i) => (
              <button
                key={i}
                type="button"
                aria-label={s.label}
                title={s.label}
                onClick={() => go(i)}
                style={{
                  width: i === active ? 18 : 7,
                  height: 7,
                  borderRadius: 999,
                  border: 'none',
                  padding: 0,
                  cursor: 'pointer',
                  transition: 'width .2s, background-color .2s',
                  background: i === active ? 'var(--acc, #068ad5)' : 'var(--brd2, #d4d4d8)',
                }}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
