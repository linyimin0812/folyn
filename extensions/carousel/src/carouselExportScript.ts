/**
 * Plain-JS interaction script injected into exported HTML for each
 * `::::carousel` block. Runs inside the `[data-container="carousel"]` wrapper
 * (an IIFE is appended to the body by the export enhancer).
 *
 * Reads the data-* attributes the Carousel component stamps:
 *  - `button[data-carousel-dot]` + `data-index` — dot indicators
 *  - `[data-is-slide="true"]` — slide panels (Carousel shows one at a time)
 *  - `.docmd-carousel[data-carousel-interval]` — auto-advance interval (ms)
 *  - `.docmd-carousel[data-carousel-autoplay="true"]` — auto-advance enabled
 *
 * Wires up dot-click switching + auto-advance (paused on hover), mirroring the
 * React component's behavior in static HTML where React's onClick/setInterval
 * don't survive.
 */
export const carouselExportScript = `
  var c = document.currentScript.parentElement;
  if (!c) return;
  var inner = c.querySelector('.docmd-carousel');
  if (!inner) return;

  var dots = c.querySelectorAll('[data-carousel-dot]');
  var slides = c.querySelectorAll('[data-is-slide="true"]');
  if (!slides.length) return;

  function go(idx) {
    for (var i = 0; i < slides.length; i++) {
      var active = i === idx;
      if (slides[i]) slides[i].style.display = active ? 'flex' : 'none';
      if (dots[i]) {
        dots[i].style.width = active ? '18px' : '7px';
        dots[i].style.background = active ? 'var(--acc, #068ad5)' : 'var(--brd2, #d4d4d8)';
      }
    }
    c._carouselIdx = idx;
  }

  // Ensure slide 0 is visible (the React useEffect may not have run in SSR).
  go(0);

  // Dot click → switch (delegated).
  c.addEventListener('click', function (e) {
    var dot = e.target.closest && e.target.closest('[data-carousel-dot]');
    if (!dot) return;
    go(parseInt(dot.getAttribute('data-index'), 10) || 0);
  });

  // Auto-advance (paused on hover).
  var autoMs = parseInt(inner.getAttribute('data-carousel-interval'), 10);
  var autoplay = inner.getAttribute('data-carousel-autoplay') === 'true';
  if (autoplay && autoMs > 0 && slides.length > 1) {
    var paused = false;
    inner.addEventListener('mouseenter', function () { paused = true; });
    inner.addEventListener('mouseleave', function () { paused = false; });
    setInterval(function () {
      if (paused) return;
      go(((c._carouselIdx || 0) + 1) % slides.length);
    }, autoMs);
  }
`;
