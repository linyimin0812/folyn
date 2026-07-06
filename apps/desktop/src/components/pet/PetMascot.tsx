/* ── Pet mascot sprite ──
 * The Quill app icon — dark rounded-square tile + feather quill + ink drop —
 * rendered as an inline SVG so it can be animated by CSS keyframes. The
 * artwork mirrors /public/quill.svg verbatim (same viewBox 0 0 512 512, same
 * rect rx=110 dark `bg` gradient, same feather group transform, same ink
 * drop) so the pet mascot matches the app icon exactly. The gradient ids are
 * prefixed with `pet` (`petBg`, `petQuillGrad`, `petInkGrad`) to avoid id
 * collisions if the SVG is ever inlined alongside the main app's icon.
 *
 * The sprite is sized to 108px inside the 120x120 pet window, leaving a ~6px
 * transparent margin so the breathing `drop-shadow` halo on `.pet-mascot`
 * (see pet.css) is visible around the dark tile. States (idle/hover/drag/
 * click) still switch via `is-<state>` classes on `.pet-mascot`.
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
      width="108"
      height="108"
      fill="none"
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

      {/* Background rounded square — matches quill.svg rx=110. */}
      <rect width="512" height="512" rx="110" fill="url(#petBg)" />

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
