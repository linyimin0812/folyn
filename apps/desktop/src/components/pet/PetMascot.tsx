/* ── Pet mascot sprite ──
 * Bare feather quill + ink drop — NO background tile. The pet window is
 * `transparent: true`, so the desktop shows through; the previous dark
 * rounded-square `<rect fill="url(#petBg)"/>` read as a "blank background"
 * tile and is removed. Only the feather artwork (left/right barbs + spine +
 * nib + nib split) and the ink drop circle + highlight remain, copied
 * verbatim from /public/quill.svg (same group transform, same paths).
 *
 * The viewBox is cropped tight to the feather's bounding box in the 512-space
 * (the feather group `translate(240,252) rotate(-38)` maps its local
 * x∈[-64,64], y∈[-140,144] bbox to roughly x∈[103,379], y∈[102,405]; the ink
 * drop at (318,360) r=20 sits inside that). A small margin is added so the
 * feather fills the 120×120 window without huge empty transparent borders —
 * `100 100 285 310`. width/height stay 108px (mascot is 108px in the 120
 * window, leaving ~6px for the breathing `drop-shadow` halo on
 * `.pet-mascot`, which now rings the feather silhouette instead of a square
 * tile). States (idle/hover/drag/click) still switch via `is-<state>`
 * classes on `.pet-mascot`. The `petQuillGrad` + `petInkGrad` defs are kept
 * (ids prefixed with `pet` to avoid collisions with the main app's icon).
 */

export interface PetMascotProps {
  /** Animation state class. The root element receives `is-<state>`. */
  state: 'idle' | 'hover' | 'drag' | 'click';
}

export function PetMascot({ state }: PetMascotProps) {
  return (
    <svg
      className={`pet-mascot is-${state}`}
      viewBox="100 100 285 310"
      width="108"
      height="108"
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

      {/* Feather quill, tilted -38deg, centered — copied verbatim from
          /public/quill.svg (background tile removed; transparent window
          surface shows the desktop through the feather silhouette). */}
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
