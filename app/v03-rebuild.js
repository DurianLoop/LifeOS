/* LifeOS v0.2 rebuild surface.
   This file only coordinates the existing v0.1 page; data still stays local. */
(() => {
  'use strict';

  const FONT_KEY = 'lifeos.font.size.v03';
  const FONT_SCALE = {default: 1.12, large: 1.28, xlarge: 1.45};

  function readFontSize() {
    const value = localStorage.getItem(FONT_KEY);
    return Object.prototype.hasOwnProperty.call(FONT_SCALE, value) ? value : 'default';
  }

  function applyFontSize(value) {
    const next = Object.prototype.hasOwnProperty.call(FONT_SCALE, value) ? value : 'default';
    localStorage.setItem(FONT_KEY, next);
    document.body.dataset.lifeFontSize = next;
    document.documentElement.style.setProperty('--life-font-scale', String(FONT_SCALE[next]));
    const select = document.querySelector('#v03FontSize');
    if (select) select.value = next;
  }

  function installFontControl() {
    const panel = document.querySelector('#tweaksPanel');
    if (!panel || document.querySelector('#v03FontSize')) return;
    const field = document.createElement('label');
    field.className = 'tweakField v03FontField';
    field.innerHTML = '<span>字体大小</span><div><select id="v03FontSize" aria-label="字体大小"><option value="default">大 · 默认</option><option value="large">更大</option><option value="xlarge">特大</option></select></div>';
    const anchor = panel.querySelector('#atticOpen');
    if (anchor) anchor.parentNode.insertBefore(field, anchor);
    else panel.append(field);
    field.querySelector('select').addEventListener('change', event => applyFontSize(event.target.value));
    applyFontSize(readFontSize());
  }

  function installOtherRoom() {
    if (typeof FEATURES === 'undefined' || typeof RENDERERS === 'undefined') return;
    if (!FEATURES.some(item => item.name === 'Other')) {
      FEATURES.push({name: 'Other', room: 'OTHER', desc: '高级分析、证据、治理与实验工具', no: FEATURES.length + 1});
    }
    if (typeof ROOMS !== 'undefined' && !ROOMS.OTHER) {
      ROOMS.OTHER = {no: '16', desc: '', features: ['Other']};
    }
    if (typeof FRONT_FEATURES !== 'undefined') FRONT_FEATURES.add('Other');
    if (typeof DREAM_META !== 'undefined') DREAM_META.Other = ['其他', '高级分析与证据工具'];
    RENDERERS.Other = async () => {
      const items = FEATURES.filter(item => !FRONT_FEATURES.has(item.name) && item.name !== 'Other');
      return pageWrap(`<section class="v03Other"><header class="v03OtherHead"><div><h1>其他</h1></div><span class="v03OtherCount">${items.length} 个工具</span></header><div class="v03OtherGrid">${items.map(item => `<button type="button" class="v03OtherItem" data-v03-other="${esc(item.name)}"><strong>${esc(dreamMeta(item.name).title)}</strong><span>${String(item.no).padStart(3, '0')} · ${esc(item.room)} · ${esc(dreamMeta(item.name).subtitle || item.desc || '')}</span></button>`).join('')}</div></section>`);
    };
  }

  function bindOtherRoom() {
    document.querySelectorAll('[data-v03-other]').forEach(button => {
      if (button.dataset.v03Bound) return;
      button.dataset.v03Bound = '1';
      button.addEventListener('click', () => openFeature(button.dataset.v03Other));
    });
  }

  function installOtherDelegation() {
    if (document.body.dataset.v03OtherDelegation) return;
    document.body.dataset.v03OtherDelegation = '1';
    document.addEventListener('click', event => {
      const button = event.target.closest?.('[data-v03-other]');
      if (!button || button.dataset.v03Bound) return;
      openFeature(button.dataset.v03Other);
    });
  }

  function normalizeWriter() {
    const form = document.querySelector('#writerForm');
    if (!form) return;
    document.querySelectorAll('.i2WriterGrid textarea, .i2WriterGrid input').forEach(field => field.removeAttribute('placeholder'));
    document.querySelector('#writerTitle')?.removeAttribute('placeholder');
    const writerTitle = document.querySelector('.i2WriterTitle');
    if (writerTitle) {
      writerTitle.setAttribute('aria-label', '标题');
      [...writerTitle.childNodes].filter(node => node.nodeType === Node.TEXT_NODE).forEach(node => node.remove());
    }
    document.querySelectorAll('.i2WriterGrid [data-cell-helper]').forEach(node => { node.hidden = true; node.textContent = ''; });
    if (form.querySelector('.i2FreeLayout')) return;
  }

  function safeRichExcerpt(value) {
    const source = String(value || '');
    if (!/<\/?(strong|b|u|s|em|i|mark|span|br)\b/i.test(source)) return source;
    const holder = document.createElement('template');
    holder.innerHTML = source;
    const allowed = new Set(['STRONG', 'B', 'U', 'S', 'EM', 'I', 'MARK', 'SPAN', 'BR']);
    const walk = node => [...node.childNodes].forEach(child => {
      if (child.nodeType !== Node.ELEMENT_NODE) return;
      if (!allowed.has(child.tagName)) {
        child.replaceWith(document.createTextNode(child.textContent || ''));
        return;
      }
      [...child.attributes].forEach(attr => child.removeAttribute(attr.name));
      walk(child);
    });
    walk(holder.content);
    return holder.innerHTML;
  }

  function normalizeOnThisDay() {
    document.querySelectorAll('.journalPaper p[data-rawtext]').forEach(node => {
      if (node.dataset.v03Rich) return;
      const raw = (node.textContent || '').trim();
      if (!/<\/?(strong|b|u|s|em|i|mark|span|br)\b/i.test(raw)) return;
      node.innerHTML = safeRichExcerpt(raw);
      node.dataset.v03Rich = '1';
    });
    document.querySelectorAll('.dayEdition blockquote').forEach(block => {
      const raw = (block.textContent || '').trim();
      if (!/<\/?(strong|b|u|s|em|i|mark|span|br)\b/i.test(raw)) return;
      const quoted = raw.startsWith('“') && raw.endsWith('”');
      const source = quoted ? raw.slice(1, -1) : raw;
      block.innerHTML = `${quoted ? '“' : ''}${safeRichExcerpt(source)}${quoted ? '”' : ''}`;
      block.dataset.v03Rich = '1';
    });
    document.querySelectorAll('#timelineBody .event > b').forEach(node => {
      if (node.dataset.v03Rich) return;
      const raw = (node.textContent || '').trim();
      if (!/<\/?(strong|b|u|s|em|i|mark|span|br)\b/i.test(raw)) return;
      /* Replace the escaped wrapper itself so the result is one clean rich
         node instead of a bold node containing another bold node. */
      node.outerHTML = safeRichExcerpt(raw);
    });
  }

  function install() {
    installFontControl();
    installOtherRoom();
    installOtherDelegation();
    applyFontSize(readFontSize());
    const attic = document.querySelector('#atticOpen');
    if (attic) {
      attic.textContent = '进入「其他」 →';
      attic.onclick = () => { setPanelOpen?.(document.querySelector('#tweaksPanel'), document.querySelector('#allRail'), false); document.querySelector('#atticPanel')?.classList.remove('open'); openFeature('Other'); };
    }
    const mobileAttic = document.querySelector('#mobileAttic');
    if (mobileAttic) mobileAttic.onclick = () => { closeMobileMore(); openFeature('Other'); };
    normalizeWriter();
    normalizeOnThisDay();
    bindOtherRoom();
    if (!document.body.dataset.v03WriterObserver) {
      document.body.dataset.v03WriterObserver = '1';
      /* Route pages such as Timeline render outside the product panel. Watch
         the document surface so late-rendered rich excerpts are normalized at
         every viewport, not only when the writer dock happens to be open. */
      new MutationObserver(() => { normalizeWriter(); normalizeOnThisDay(); bindOtherRoom(); }).observe(document.body, {childList: true, subtree: true});
    }
  }

  if (typeof bindSpecific === 'function' && !bindSpecific.__v03Rebuild) {
    const previousBind = bindSpecific;
    const wrapped = function(...args) {
      const result = previousBind.apply(this, args);
      installFontControl();
      applyFontSize(readFontSize());
      normalizeWriter();
      normalizeOnThisDay();
      bindOtherRoom();
      return result;
    };
    wrapped.__v03Rebuild = true;
    bindSpecific = wrapped;
    window.bindSpecific = wrapped;
  }

  window.addEventListener('lifeos:i2-ready', install, {once: true});
  setTimeout(install, 900);
})();
