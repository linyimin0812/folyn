/* ── Pet mascot sprite ──
 * The Quill logo — feather + ink drop — cropped tight so the icon is "just
 * the quill," with no rounded-rect background and no empty margin around it.
 * A separate `.pet-glow` layer (see PetApp + pet.css) pulses behind it for
 * the breathing-light feel. States (idle/hover/drag/click) still switch via
 * `is-<state>` classes on `.pet-mascot`.
 *
 * Artwork mirrors /public/quill.svg (feather tilted -38°, cream gradient +
 * blue ink-gradient nib/drop), just without the dark square background so the
 * transparent pet window shows only the feather silhouette.
 */

export interface PetMascotProps {
  /** Animation state class. The root element receives `is-<state>`. */
  state: 'idle' | 'hover' | 'drag' | 'click';
}

export function PetMascot({ state }: PetMascotProps) {
  return (
    <svg
      className={`pet-mascot is-${state}`}
      viewBox="-155 -155 310 310"
      width="120"
      height="120"
      fill="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="petQuillGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#f0ece0" />
          <stop offset="100%" stopColor="#d4c9a8" />
        </linearGradient>
        <linearGradient id="petInkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#6b9fff" />
          <stop offset="100%" stopColor="#3a6ef0" />
        </linearGradient>
      </defs>

      {/* Feather quill, tilted -38° (same artwork as /public/quill.svg). */}
      <g transform="rotate(-38)">
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

      {/* Ink drop at the nib tip. */}
      <circle cx="-5" cy="133" r="20" fill="url(#petInkGrad)" />
      <ellipse cx="-12" cy="125" rx="6" ry="7" fill="white" opacity="0.3"
               transform="rotate(-20 -12 125)" />
    </svg>
  );
}
