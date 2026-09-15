/**
 * Host-realm entry for the Carousel (走马灯) extension — trusted tier.
 *
 * Contributes two container directives:
 *  - `:::carousel` — a group of rotating slide regions (Carousel component)
 *  - `:::slide`    — a single slide, used inside `:::carousel` (Slide component)
 *
 * The host's `buildComponentMap` maps these directive names to the React
 * components exported below under `containers` (entry-refs match the
 * manifest's `contributes.containers[].component`).
 *
 * No iframe bundle — slides are plain React nodes rendered inline in the host
 * tree. React is shared with the host via `window.React` (react-shim).
 */
import type { ExtensionModule } from 'folyn-extension-sdk';
import { Carousel, Slide } from './Carousel';

const module: ExtensionModule = {
  containers: {
    Carousel,
    Slide,
  },
};

export default module;
