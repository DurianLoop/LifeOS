export function initNavigation() {
  const header = document.querySelector('.site-header');
  const menuButton = document.querySelector('.menu-toggle');
  const mobileNav = document.querySelector('#mobile-nav');
  let frame = 0;

  function closeMenu() {
    menuButton?.setAttribute('aria-expanded', 'false');
    menuButton?.setAttribute('aria-label', '打开导航');
    if (mobileNav) mobileNav.hidden = true;
  }

  function updateHeader() {
    frame = 0;
    header?.classList.toggle('is-scrolled', window.scrollY > 24);
    header?.classList.toggle('is-at-top', window.scrollY <= 24);
  }

  function focusAnchor(hash) {
    let target;
    try { target = document.getElementById(hash ? decodeURIComponent(hash.slice(1)) : 'home'); } catch { return; }
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus({ preventScroll: true });
  }

  menuButton?.addEventListener('click', () => {
    if (!mobileNav) return;
    const willOpen = mobileNav.hidden;
    mobileNav.hidden = !willOpen;
    menuButton.setAttribute('aria-expanded', String(willOpen));
    menuButton.setAttribute('aria-label', willOpen ? '关闭导航' : '打开导航');
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a');
    if (link?.closest('.site-header') || !event.target.closest('.site-header')) closeMenu();
    // Let the browser own scrolling, URL updates, modified clicks and history.
    if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const href = link.getAttribute('href');
    if (!href?.startsWith('#') || link.hasAttribute('download') || (link.target && link.target !== '_self')) return;
    // A hidden mobile link cannot keep keyboard focus after navigation.
    requestAnimationFrame(() => focusAnchor(href));
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mobileNav && !mobileNav.hidden) {
      closeMenu();
      menuButton?.focus();
    }
  });
  window.matchMedia('(min-width: 761px)').addEventListener('change', (event) => {
    if (event.matches) closeMenu();
  });
  window.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(updateHeader);
  }, { passive: true });
  window.addEventListener('hashchange', () => { closeMenu(); focusAnchor(location.hash); });
  window.addEventListener('pageshow', () => { closeMenu(); updateHeader(); });
  updateHeader();
}
