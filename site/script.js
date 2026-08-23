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
