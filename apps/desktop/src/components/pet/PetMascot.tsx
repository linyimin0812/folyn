/* ── Pet mascot sprite ──
 * SVG ink-drop body + quill-pen tip, echoing the "Quill" product name.
 * Drawn with `currentColor` so the editor accent theme applies; states
 * (idle/hover/drag/click) are switched via CSS classes on the root
 * `.pet-mascot` element (see pet.css).
 */

export interface PetMascotProps {
  /** Animation state class. The root element receives `is-<state>`. */
  state: 'idle' | 'hover' | 'drag' | 'click';
}

export function PetMascot({ state }: PetMascotProps) {
  return (
    <svg
      className={`pet-mascot is-${state}`}
      viewBox="0 0 100 100"
      width="80"
      height="80"
      fill="none"
      stroke="none"
      aria-hidden="true"
    >
      {/* Ink-drop body — a soft teardrop/leaf silhouette. */}
      <path
        d="M50 8 C72 8 86 28 86 50 C86 72 70 90 50 90 C30 90 14 72 14 50 C14 28 28 8 50 8 Z"
        fill="currentColor"
        opacity="0.92"
      />
      {/* Highlight gloss on the upper-left of the drop. */}
      <ellipse cx="38" cy="32" rx="9" ry="6" fill="#fff" opacity="0.35" />

      {/* Eyes — two small dots so the "looks up" hover animation reads. */}
      <circle cx="40" cy="50" r="3.2" fill="#fff" />
      <circle cx="60" cy="50" r="3.2" fill="#fff" />
      <circle cx="40" cy="51" r="1.6" fill="currentColor" />
      <circle cx="60" cy="51" r="1.6" fill="currentColor" />

      {/* Quill-pen tip — a feather slanting up-right from the drop. */}
      <path
        d="M74 22 C82 14 90 12 92 10 C90 18 86 26 78 32 C74 35 70 34 68 31 C66 28 70 26 74 22 Z"
        fill="currentColor"
      />
      {/* Quill spine. */}
      <path
        d="M70 30 L90 12"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinecap="round"
        opacity="0.6"
      />
    </svg>
  );
}
