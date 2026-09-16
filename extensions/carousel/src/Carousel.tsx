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
 * shows one at a time, and advances automatically. Controls (attributes on
 * the `::::carousel` directive):
 *  - interval (seconds; default 5; 0 disables auto-advance)
 *  - autoplay="false" — explicitly disable auto-advance (overrides interval)
 *  - height — CSS length, e.g. "200px" / "12rem"; overrides the default min
 *  - align — text/content alignment inside each slide:
 *      horizontal: "left" | "center" | "right"
 *      vertical:   "top" | "middle" | "bottom"
 *      combine with a space, e.g. align="center middle"
 *  - Dot indicators (click to jump), pause on hover, circular wrap-around
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
  const autoplay = attributes?.autoplay !== 'false';
  const autoMs = autoplay && intervalSec > 0 ? intervalSec * 1000 : 0;

  // height: explicit CSS length overrides the default min-height.
  const heightAttr =
    typeof attributes?.height === 'string' && attributes.height.trim() ? attributes.height.trim() : undefined;

  // align: split tokens → horizontal + vertical alignment of slide content.
  // "center" alone = horizontal-center; "center middle" = both axes.
  const alignTokens = (attributes?.align ?? '').trim().toLowerCase().split(/\s+/).filter(Boolean);
  const textAlign = ((alignTokens.find((t) => ['left', 'center', 'right'].includes(t)) ?? 'left') as 'left' | 'center' | 'right');
  const vToken = (alignTokens.find((t) => ['top', 'middle', 'bottom'].includes(t)) ?? 'top') as 'top' | 'middle' | 'bottom';

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

  // Show the active slide, hide the rest, and apply the alignment to the
  // visible slide's wrapper so content centers within the viewport. The
  // slide wrapper becomes a flex column: justifyContent = vertical, alignItems
  // = horizontal; textAlign also set for inline/paragraph content.
  useEffect(() => {
    slides.forEach((s, i) => {
      const show = i === active;
      s.element.style.display = show ? 'flex' : 'none';
      if (show) {
        s.element.style.flexDirection = 'column';
        s.element.style.width = '100%';
        // flex:1 stretches the slide to fill the viewport's height so
        // justifyContent (vertical) has space to center content. (height:100%
        // would resolve to auto under a min-height-only flex column → no
        // room to center.)
        s.element.style.flex = '1 1 0%';
        s.element.style.textAlign = textAlign;
        s.element.style.justifyContent =
          vToken === 'middle' ? 'center' : vToken === 'bottom' ? 'flex-end' : 'flex-start';
        s.element.style.alignItems =
          textAlign === 'center' ? 'center' : textAlign === 'right' ? 'flex-end' : 'flex-start';
      }
    });
  }, [active, slides, textAlign, vToken]);

  // Auto-advance. Paused on hover (pausedRef) and disabled when interval=0 /
  // autoplay=false or there's only one slide. Wraps around circularly.
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
  const viewportStyle: CSSProperties = {
    padding: '1.25rem 1.5rem',
    display: 'flex',
    flexDirection: 'column',
    boxSizing: 'border-box',
    ...(heightAttr ? { height: heightAttr } : { minHeight: '6rem' }),
  };

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
      <div ref={containerRef} style={viewportStyle}>
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
