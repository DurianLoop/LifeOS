/* Loaded in the head: desktop identity is explicit, never inferred from a
   viewport or a Mac user agent. Mobile and website navigation stay separate. */
(() => {
  'use strict';
  const bridge = window.lifeosDesktop;
  if (!bridge || typeof bridge.windowControl !== 'function') return;
  document.documentElement.classList.add('desktopRenderer');
  bridge.onCommand?.(async command => {
    if (command === 'write') openProductDock('writer');
    else if (command === 'search') openPalette();
    else if (command === 'import') openProductDock('import');
    else if (command === 'export') openProductDock('export');
    else if (command === 'settings') document.querySelector('#allRail')?.click();
  });
})();
