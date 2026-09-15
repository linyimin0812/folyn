import type { ContainerExtension, ContainerProps } from '../ContainerExtension';

/**
 * Marquee (跑马灯) container — scrolls its content horizontally on a loop.
 *
 * Attributes:
 *  - speed: scroll duration in seconds (default 10). Larger = slower.
 *  - direction: 'left' (default) | 'right' — which way the content travels.
 *
 * Implemented with a pure CSS keyframe animation (no JS RAF), so it's cheap
 * and survives export (the keyframes are inlined via a scoped <style> on the
 * wrapper). Two children are rendered back-to-back with the animation so the
 * loop is seamless — the second copy is off-screen until the first scrolls
 * fully out, then the animation resets with no gap.
 */
function MarqueeComponent({ children, attributes }: ContainerProps) {
  const speed = Number(attributes?.speed) || 10;
  const direction = attributes?.direction === 'right' ? 'right' : 'left';
  const duration = `${speed}s`;

  return (
    <div
      className="docmd-marquee"
      style={{
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        margin: '1rem 0',
        padding: '.5rem 0',
        borderTop: '1px solid var(--brd, #e4e4e7)',
        borderBottom: '1px solid var(--brd, #e4e4e7)',
      }}
    >
      <style>{`
        @keyframes docmd-marquee-scroll-left {
          from { transform: translateX(0); }
          to { transform: translateX(-50%); }
        }
        @keyframes docmd-marquee-scroll-right {
          from { transform: translateX(-50%); }
          to { transform: translateX(0); }
        }
      `}</style>
      <div
        style={{
          display: 'inline-flex',
          minWidth: 'max-content',
          animation: `docmd-marquee-scroll-${direction} ${duration} linear infinite`,
        }}
      >
        <span style={{ paddingRight: '3rem', color: 'var(--t2, #3f3f46)' }}>{children}</span>
        <span style={{ paddingRight: '3rem', color: 'var(--t2, #3f3f46)' }} aria-hidden>
          {children}
        </span>
      </div>
    </div>
  );
}

export const marqueeExtension: ContainerExtension = {
  name: 'marquee',
  icon: '📢',
  label: '跑马灯',
  category: 'layout',
  component: MarqueeComponent,
  template: ':::marquee{speed="10" direction="left"}\n这是一段滚动文字 🎉\n:::',
  description: '横向循环滚动的文字（speed 秒数，direction left/right）',
};
