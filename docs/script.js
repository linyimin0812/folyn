// stage: hover activity-bar icons to preview selection; no auto-cycle
(function () {
  const bar = document.querySelector('.activity-bar');
  if (!bar) return;
  bar.addEventListener('mouseover', (e) => {
    const b = e.target.closest('.activity-icon');
    if (!b) return;
    bar.querySelectorAll('.activity-icon').forEach((x) => x.classList.remove('active'));
    b.classList.add('active');
  });
})();

// lightbox: click .shot img to enlarge; click overlay or Esc to close
(function () {
  function open(src) {
    var lb = document.createElement('div');
    lb.className = 'lightbox';
    var big = document.createElement('img');
    big.src = src;
    lb.appendChild(big);
    lb.addEventListener('click', function () { lb.remove(); });
    document.body.appendChild(lb);
  }
  document.addEventListener('click', function (e) {
    var img = e.target.closest('.shot img');
    if (!img) return;
    open(img.src);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var lb = document.querySelector('.lightbox');
    if (lb) lb.remove();
  });
})();
