/* ── Pet mascot sprite — circular badge ──
 * The mascot is a circular dark badge: the feather quill + ink drop artwork
 * from /public/quill.svg rendered inside a true `<circle>` background
 * (`<circle cx="256" cy="256" r="256" fill="url(#petBg)"/>`). The pet window
 * is `transparent: true`, so the corners of the 512×512 viewBox outside the
 * inscribed circle show the desktop through — no square silhouette, only a
 * round badge ("圆,不是方").
 *
 * The viewBox is the full `0 0 512 512` (so the circle fills it); the
 * feather group transform `translate(240,252) rotate(-38)` and the ink drop
 * at (318,360) r=20 are copied verbatim from /public/quill.svg (left/right
 * barbs + spine + nib + nib split + ink drop + highlight). The dark `petBg`
 * gradient (`#0f1420`→`#181e30`) is restored from the original icon.
 *
 * width/height are 88px (mascot is 88px in the 120×120 window, leaving
 * ~16px of headroom for the breathing `scale` self-pulse on
 * `.pet-mascot` and the state-animation scale, so the circle is not
 * clipped at the edges during animation). States (idle/hover/drag/click)
 * switch via `is-<state>` classes on `.pet-mascot`. The `petBg` + `petQuillGrad` + `petInkGrad` defs
 * use ids prefixed with `pet` to avoid collisions with the main app's icon.
 */

export interface PetMascotProps {
  /** Animation state class. The root element receives `is-<state>`. */
  state: 'idle' | 'hover' | 'drag' | 'click';
}

export function PetMascot({ state }: PetMascotProps) {
  return (
    <svg
      className={`pet-mascot is-${state}`}
      viewBox="0 0 512 512"
      width="88"
      height="88"
      fill="none"
      overflow="visible"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="petBg" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#0f1420" />
          <stop offset="100%" stopColor="#181e30" />
        </linearGradient>
        <linearGradient id="petQuillGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0ece0" />
          <stop offset="100%" stopColor="#d4c9a8" />
        </linearGradient>
        <linearGradient id="petInkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6b9fff" />
          <stop offset="100%" stopColor="#3a6ef0" />
        </linearGradient>
      </defs>

      {/* Circular dark badge background — a true circle inscribed WITH MARGIN
          inside the 512 square (r=244, not r=256) so the circle does not touch
          the viewBox edge. The breathing `scale` self-pulse and the
          hover/drag/click state scales all scale the SVG briefly; the margin
          + `overflow="visible"` on the svg root + `.pet-mascot { overflow:
          visible }` in pet.css ensure the circle is never clipped even if a
          scale pushes it past the viewBox. The transparent corners still show
          the desktop through. */}
      <circle cx="256" cy="256" r="244" fill="url(#petBg)" />

      {/* Feather quill, tilted -38deg, centered — copied verbatim from
          /public/quill.svg. */}
      <g transform="translate(240,252) rotate(-38)">
        {/* Left barbs */}
        <path d="M 0,-140 C -44,-90 -64,-38 -58,18 C -52,62 -30,96 0,116 Z"
              fill="url(#petQuillGrad)" opacity="0.95" />
        {/* Right barbs */}
        <path d="M 0,-140 C 44,-90 64,-38 58,18 C 52,62 30,96 0,116 Z"
              fill="url(#petQuillGrad)" opacity="0.78" />
        {/* Spine */}
        <line x1="0" y1="-140" x2="0" y2="144"
              stroke="#b0985a" strokeWidth="2.5" strokeLinecap="round" />
        {/* Nib */}
        <path d="M -9,116 Q 0,144 9,116 Z" fill="url(#petInkGrad)" />
        {/* Nib split */}
        <line x1="0" y1="120" x2="0" y2="144"
              stroke="#2448b8" strokeWidth="1.4" strokeLinecap="round" opacity="0.6" />
      </g>

      {/* Ink drop — offset bottom right of quill tip, copied verbatim. */}
      <circle cx="318" cy="360" r="20" fill="url(#petInkGrad)" />
      {/* Highlight on ink drop */}
      <ellipse cx="311" cy="352" rx="6" ry="7" fill="white" opacity="0.3"
               transform="rotate(-20 311 352)" />
    </svg>
  );
}
