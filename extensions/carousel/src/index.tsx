/**
 * Host-realm entry for the Carousel (走马灯) extension — trusted tier.
 *
 * Contributes two container directives:
 *  - `:::carousel` — a group of rotating slide regions (Carousel component)
 *  - `:::slide`    — a single slide, used inside `:::carousel` (Slide component)
 *
 * Also contributes an **export enhancer** so the carousel is interactive in
 * exported HTML — the React component's onClick handlers and setInterval
 * timers don't survive SSR/innerHTML extraction, so a plain-JS enhancer
 * injects a `<script>` into the rendered `[data-container="carousel"]` DOM
 * that wires up dot-click + auto-advance (paused on hover). Self-contained:
 * no host-side code changes needed.
 *
 * No iframe bundle — slides are plain React nodes rendered inline in the host
 * tree. React is shared with the host via `window.React` (react-shim).
 */
import type { ExtensionModule, ExportEnhancerHandler } from 'folyn-extension-sdk';
import { Carousel, Slide } from './Carousel';
import { carouselExportScript } from './carouselExportScript';

/** Export enhancer for `::::carousel` — injects the interaction script into
 *  the rendered `[data-container="carousel"]` DOM so the carousel switches
 *  slides + auto-advances in exported (static) HTML. */
const carouselEnhancer: ExportEnhancerHandler = async (body) => {
  // The body is the [data-container="carousel"] wrapper. Inject a scoped
  // <script> that handles dot-click switching + auto-advance for THIS
  // carousel block (the script reads the data-* attributes the Carousel
  // component stamps: data-carousel-dot, data-is-slide, data-carousel-interval,
  // data-carousel-autoplay).
  const script = document.createElement('script');
  script.textContent = `(function(){${carouselExportScript}})();`;
  body.appendChild(script);
};

const module: ExtensionModule = {
  containers: {
    Carousel,
    Slide,
  },
  exportEnhancers: {
    carouselEnhancer,
  },
};

export default module;
