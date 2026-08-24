/* ── Pet mascot sprite ──
 * The mascot is the bundled `pet.gif` (or a user-uploaded custom image via
 * `petIconPath`). Rendered as `<img class="pet-mascot is-img is-<state>">` so
 * the `pet-breathe` keyframes + hover/drag state animations apply to the
 * image unchanged. `object-fit: contain` (set in `pet.css` on
 * `.pet-mascot.is-img`) prevents non-square images from stretching.
 *
 * Custom icon: when `petIconSource === 'custom'` and `petIconPath` is set,
 * `convertFileSrc(petIconPath)` is used as the src; the `<img>` `onError`
 * handler clears the flag to `'builtin'` so a missing/corrupt custom file
 * falls back to the bundled gif (PRD fallback requirement). In non-Tauri
 * envs (tests, web preview) `convertFileSrc` would return a malformed URL,
 * so a custom icon falls back to the builtin gif there too.
 */

import { convertFileSrc } from '@tauri-apps/api/core';
import { usePetStore } from '@/store/petStore';
import { isTauri } from '@/utils/platform';
import { mascotSizeForPetSize, type PetSize } from './petPosition';
import builtinPetGif from '@/assets/pet.gif';

export interface PetMascotProps {
  /** Animation state class. The root element receives `is-<state>`. */
  state: 'idle' | 'hover' | 'drag' | 'click';
  /** Pet size level — drives the mascot's pixel footprint (see
   *  `mascotSizeForPetSize`). Inline style on the `<img>` overrides the
   *  `.pet-mascot { width:72px; height:72px }` CSS rule (which stays as the
   *  medium-default fallback). */
  size?: PetSize;
}

export function PetMascot({ state, size }: PetMascotProps) {
  const petIconSource = usePetStore((s) => s.petIconSource);
  const petIconPath = usePetStore((s) => s.petIconPath);
  // Resolve the mascot pixel size from the level (falls back to the default
  // for unknown values). Inline style on the SVG / `<img>` overrides the
  // `.pet-mascot { width:72px; height:72px }` CSS rule so a small (48px) or
  // large (96px) mascot renders at the right footprint without needing a
  // per-size CSS rule.
  const mascotPx = mascotSizeForPetSize(size);

  // Resolve the mascot image source. Builtin renders the bundled pet.gif;
  // custom uses the Tauri asset protocol on the user-chosen file. In non-Tauri
  // envs (tests, web preview) `convertFileSrc` would return a malformed URL,
  // so a custom icon falls back to the builtin gif. A missing/empty custom
  // path also falls back. The `<img>` onError handler clears the flag to
  // `'builtin'` so a deleted custom file surfaces gracefully at render.
  const imgSrc = petIconSource === 'custom' && petIconPath && isTauri()
    ? convertFileSrc(petIconPath)
    : builtinPetGif;
  const isCustom = petIconSource === 'custom' && !!petIconPath;

  return (
    <img
      className={`pet-mascot is-img is-${state}`}
      src={imgSrc}
      alt="Mochi pet"
      style={{ width: mascotPx, height: mascotPx }}
      onError={isCustom ? () => {
        // Custom file missing or corrupt → fall back to builtin (PRD
        // fallback). Clears the flag in petStore so the next render uses the
        // builtin gif. Non-fatal; logged for diagnostics.
        console.warn('[pet] custom icon load failed, falling back to builtin:', petIconPath);
        usePetStore.getState().setPetIcon('builtin');
      } : undefined}
      draggable={false}
    />
  );
}
