// Scroll stays native. The scene only follows it, once per animation frame.
export function initPageMotion() {
  if (!('IntersectionObserver' in window)) return;

  const body = document.body;
  const hero = document.querySelector('.hero');
  const future = document.querySelector('.future');
  const compact = window.matchMedia('(max-width: 760px)');
  let frame = 0;
  let active = !document.hidden;
  const clamp = (value) => Math.max(0, Math.min(1, value));

  // Small groups unfold in reading order; long groups never delay their last item.
  const groups = [
    ['.workspace-notes', 'article'],
    ['.ai-features', 'article'],
    ['.company-grid', ':scope > div'],
    ['.archive-index', 'details'],
    ['.privacy', ':scope > div'],
    ['.download-faq', 'details'],
  ];
  groups.forEach(([selector, children]) => {
    const group = document.querySelector(selector);
    if (!group) return;
    group.classList.remove('reveal');
    group.querySelectorAll(children).forEach((item, index) => {
      item.classList.add('reveal');
      item.style.setProperty('--reveal-delay', `${Math.min(index, 3) * 85}ms`);
    });
  });
  document.querySelectorAll('.future-timeline, .bottle-scene, .download .section-kicker').forEach((item) => item.classList.add('reveal'));
  document.querySelectorAll('.real-workspace, .memory-product, .bottle-scene').forEach((item) => item.classList.add('reveal-scene'));

  const reveal = (element) => element.classList.add('is-visible');
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(({ target, isIntersecting }) => {
      if (!isIntersecting) return;
      reveal(target);
      observer.unobserve(target);
    });
  }, { threshold: 0, rootMargin: '0px 0px -36px 0px' });
  document.querySelectorAll('.reveal').forEach((element) => observer.observe(element));

  // Keyboard navigation must never land in an invisible part of the page.
  document.addEventListener('focusin', (event) => {
    const element = event.target.closest('.reveal');
    if (element) { reveal(element); observer.unobserve(element); }
  });

  function render() {
    frame = 0;
    if (!active || body.dataset.motion === 'paused') return;
    const height = window.innerHeight;
    if (hero) {
      const rect = hero.getBoundingClientRect();
      const progress = clamp(-rect.top / rect.height);
      const distance = compact.matches ? 28 : 76;
      hero.style.setProperty('--scene-drift', `${(progress * distance).toFixed(2)}px`);
      hero.style.setProperty('--copy-drift', `${(progress * distance * .38).toFixed(2)}px`);
      hero.style.setProperty('--scene-opacity', (1 - progress * .5).toFixed(3));
    }
    if (future) {
      const rect = future.getBoundingClientRect();
      if (rect.top < height && rect.bottom > 0) {
        const progress = clamp((height - rect.top) / (height + rect.height));
        const distance = compact.matches ? 16 : 44;
        future.style.setProperty('--tide-drift', `${((progress - .5) * distance).toFixed(2)}px`);
        future.style.setProperty('--chapter-progress', clamp(progress * 1.8).toFixed(3));
      }
    }
  }
  function schedule() {
    if (!frame && active && body.dataset.motion !== 'paused') frame = requestAnimationFrame(render);
  }
  function sync() {
    if (body.dataset.motion === 'paused') {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // Revealed content stays readable when motion is re-enabled.
      document.querySelectorAll('.reveal').forEach((element) => {
        reveal(element);
        observer.unobserve(element);
      });
    } else schedule();
  }
  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['data-motion'] });
  window.addEventListener('scroll', schedule, { passive: true });
  window.addEventListener('resize', schedule, { passive: true });
  window.addEventListener('pageshow', () => { active = !document.hidden; schedule(); });
  window.addEventListener('pagehide', () => {
    active = false;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  });
  document.addEventListener('visibilitychange', () => {
    active = !document.hidden;
    if (!active && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (active) schedule();
  });
  body.classList.add('js-ready', 'motion-ready');
  sync();
}
