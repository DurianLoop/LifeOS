/* LifeOS v0.2 finishing layer: keep controls direct, calm, and responsive. */
(() => {
  'use strict';

  let writerOpening = false;

  function writerRoot() {
    return document.querySelector('.i2Desk');
  }

  function setButtonCopy(id, text, label) {
    const button = document.querySelector(`#${id}`);
    if (!button) return;
    if (button.textContent.trim() !== text) button.textContent = text;
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  }

  function normaliseSizeChoices(root) {
    root.querySelectorAll('[data-cell-size]').forEach(select => {
      const compact = select.querySelector('option[value="compact"]');
      if (compact) compact.remove();
      const standard = select.querySelector('option[value="standard"]');
      if (standard) standard.textContent = '1x1';
    });
  }

  function syncSystemCopy() {
    const mobileSearch = document.querySelector('#mobileSearch small');
    if (mobileSearch) mobileSearch.textContent = '搜索全部 142 个系统';

    const homeCount = document.querySelector('.archiveLedger dl div:nth-child(2) dd');
    if (homeCount) homeCount.textContent = '142';

    const paletteHint = document.querySelector('.paletteHint');
    if (paletteHint) paletteHint.textContent = paletteHint.textContent.replace(/141 total/g, '142 total');
  }

  function simplifyWriter() {
    const root = writerRoot();
    if (!root) return;

    const grid = root.querySelector('.i2WriterGrid');
    if (grid && !grid.dataset.view) grid.dataset.view = 'day';

    setButtonCopy('writerAddQuick', '＋', '新增格子');
    setButtonCopy('writerCustomizeCells', '编排', '编排格子');
    setButtonCopy('writerSaveTemplate', '模板', '保存或套用模板');

    const dateJump = root.querySelector('#writerDateJump');
    if (dateJump) {
      dateJump.setAttribute('aria-label', '跳转日期');
      dateJump.setAttribute('title', '跳转日期');
    }

    root.querySelectorAll('[placeholder]').forEach(field => field.removeAttribute('placeholder'));
    root.querySelectorAll('[data-focus-command="tag"]').forEach(button => button.setAttribute('aria-label', '标签'));
    root.querySelectorAll('.i2HabitCell .i2CellTune').forEach(button => {
      button.textContent = '···';
      button.setAttribute('aria-label', '编辑习惯');
      button.setAttribute('title', '编辑习惯');
    });
    normaliseSizeChoices(root);
  }

  function showWriterOpening() {
    const panel = document.querySelector('#productPanel');
    if (!panel || panel.querySelector('.i2Writer')) return;
    panel.setAttribute('aria-busy', 'true');
    panel.innerHTML = '<div class="lifeosWriterOpening" role="status" aria-label="正在打开落笔"><span>落笔</span><i></i><i></i></div>';
  }

  function installFastWriterOpen() {
    const originalOpen = window.openProductDock;
    if (typeof originalOpen !== 'function' || originalOpen.__lifeosPolished) return;

    const polishedOpen = async function(tab = 'writer', context = {}) {
      if (tab !== 'writer') return originalOpen.call(this, tab, context);
      if (writerOpening) return;

      writerOpening = true;
      document.body.classList.add('writerImmersive');
      window.setProductDock?.(true);
      showWriterOpening();

      try {
        return await originalOpen.call(this, tab, context);
      } finally {
        writerOpening = false;
        const panel = document.querySelector('#productPanel');
        panel?.removeAttribute('aria-busy');
        requestAnimationFrame(simplifyWriter);
      }
    };
    polishedOpen.__lifeosPolished = true;
    window.openProductDock = polishedOpen;
  }

  const panel = document.querySelector('#productPanel');
  if (panel) new MutationObserver(() => requestAnimationFrame(simplifyWriter)).observe(panel, { childList: true });
  const view = document.querySelector('#view');
  if (view) new MutationObserver(() => requestAnimationFrame(syncSystemCopy)).observe(view, { childList: true });

  installFastWriterOpen();
  simplifyWriter();
  syncSystemCopy();
  window.addEventListener('lifeos:i2-ready', () => {
    installFastWriterOpen();
    simplifyWriter();
    syncSystemCopy();
  });
})();
